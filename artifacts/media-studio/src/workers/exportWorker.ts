// Export Worker — runs the VideoEncoder + mp4-muxer render loop off the main thread.
// Receives all scene config and pre-computed FFT data from the main thread via postMessage,
// renders each frame on an OffscreenCanvas, encodes with WebCodecs, and returns the muxed
// ArrayBuffer back to the main thread.
//
// All drawing logic lives in ../lib/drawScene.ts and is shared with the live preview.

import {
  createSceneState,
  drawScene,
  type DrawVisConfig,
  type DrawLyricsConfig,
  type SceneState,
} from "../lib/drawScene";
import { createBgVideoFrameSource, type BgVideoFrameSource } from "./bgVideoStream";

// ─── Worker message types ─────────────────────────────────────────────────────

export type WorkerVisConfig = DrawVisConfig;
export type WorkerLyricsConfig = DrawLyricsConfig;

export interface WorkerStartMessage {
  type: "start";
  visConfig: WorkerVisConfig;
  lyricsConfig: WorkerLyricsConfig;
  W: number;
  H: number;
  fps: number;
  startSec: number;
  totalFrames: number;
  freqLen: number;
  timeLen: number;
  bitrate: number;
  chosenCodec: string;
  bgBitmap: ImageBitmap | null;
  freqBuffer: ArrayBuffer;
  timeBuffer: ArrayBuffer;
  // Decoded animated GIF/WebP frames (only present when visStyle === "gif").
  // Frames loop based on per-frame durations to match the live preview.
  gifFrames?: ImageBitmap[] | null;
  gifDurations?: number[] | null;
  // Pre-extracted background-video frames. When present, take precedence over
  // bgBitmap and loop based on the same wrap-around logic as gifFrames so the
  // exported MP4 matches what the user sees in the live preview. Used for
  // WebM sources or when the streaming MP4 path is unavailable.
  bgFrames?: ImageBitmap[] | null;
  bgDurations?: number[] | null;
  // Raw MP4 buffer for the background video. When present, the worker
  // streams it through WebCodecs (mp4box demux + VideoDecoder) instead of
  // pre-extracting frames on the main thread, removing the seek-based
  // fps cap and keeping memory bounded for long source videos.
  bgVideoBuffer?: ArrayBuffer | null;
  // User-controllable pan + zoom for the background image/video. Mirrors the
  // live preview's drawCoverImage transform so the exported MP4 matches what
  // the user composed on screen.
  bgOffsetX?: number;
  bgOffsetY?: number;
  bgScale?: number;
  /** "cover" (default) or "contain" (letterbox). Must match live preview. */
  bgFitMode?: "cover" | "contain";
  // Interleaved Float32 PCM audio for in-browser muxing via AudioEncoder.
  // When present the worker encodes audio directly into the MP4 so no server
  // roundtrip is needed. Layout: [ch0_s0, ch1_s0, ch0_s1, ch1_s1, ...].
  audioPcm?: ArrayBuffer | null;
  audioSampleRate?: number;
  audioChannels?: number;
}

export type WorkerInMessage = WorkerStartMessage | { type: "cancel" };

export type WorkerOutMessage =
  | { type: "progress"; done: number; total: number; eta: string }
  | { type: "done"; buffer: ArrayBuffer; hasAudio: boolean }
  | { type: "error"; message: string };

// ─── Worker postMessage helper ────────────────────────────────────────────────

// `self` is typed as Window & typeof globalThis by the dom lib, but at runtime
// inside a dedicated Web Worker it is a DedicatedWorkerGlobalScope. Because
// DedicatedWorkerGlobalScope is only defined in the webworker lib (not dom), we
// declare the minimal structural interface we actually need and use the
// TypeScript-sanctioned `unknown` double-assertion (no `any` involved).
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  onmessage: ((e: MessageEvent) => void) | null;
}

const workerSelf = self as unknown as WorkerScope;

function postMsg(msg: WorkerOutMessage, transfer?: Transferable[]): void {
  if (transfer) {
    workerSelf.postMessage(msg, transfer);
  } else {
    workerSelf.postMessage(msg);
  }
}

// ─── Export render loop ───────────────────────────────────────────────────────

let cancelled = false;

async function runExport(msg: WorkerStartMessage) {
  const {
    visConfig, lyricsConfig, W, H, fps, startSec, totalFrames,
    freqLen, timeLen, bitrate, chosenCodec, bgBitmap, freqBuffer, timeBuffer,
    gifFrames, gifDurations, bgFrames, bgDurations, bgVideoBuffer,
    bgOffsetX, bgOffsetY, bgScale, bgFitMode,
    audioPcm, audioSampleRate, audioChannels,
  } = msg;
  const bgTransform = {
    offsetX: bgOffsetX ?? 0,
    offsetY: bgOffsetY ?? 0,
    scale: bgScale ?? 1,
    fitMode: bgFitMode ?? "cover" as const,
  };

  // ── In-browser audio encoding (AudioEncoder / WebCodecs) ─────────────────
  // Check whether we can encode audio directly into the MP4 without a server
  // roundtrip. Requires: (a) the main thread passed interleaved PCM data, and
  // (b) the browser's WebCodecs build supports AudioEncoder + AAC-LC.
  const hasAudioInput = !!(audioPcm && audioSampleRate && audioChannels);
  let audioEncoderSupported = false;
  if (hasAudioInput && typeof AudioEncoder !== "undefined") {
    try {
      const probe = await (AudioEncoder as unknown as { isConfigSupported: (c: unknown) => Promise<{ supported: boolean }> })
        .isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: audioSampleRate,
          numberOfChannels: audioChannels,
          bitrate: 192_000,
        });
      audioEncoderSupported = probe.supported;
    } catch { /* AudioEncoder available but codec unsupported — fall back */ }
  }

  // Generic looping frame picker — used for both the foreground GIF visualizer
  // and the (optional) background video. tInClip starts at 0 at the trim-start
  // so the loop matches what the user sees during preview playback.
  const buildPicker = (frames: ImageBitmap[] | null | undefined, durs: number[] | null | undefined) => {
    if (!frames || frames.length === 0 || !durs || durs.length === 0) return null;
    const total = durs.reduce((a, b) => a + b, 0);
    const cum: number[] = [];
    let acc = 0;
    for (const d of durs) { acc += d; cum.push(acc); }
    return (t: number): ImageBitmap => {
      if (frames.length === 1 || total <= 0) return frames[0];
      const tt = ((t % total) + total) % total;
      for (let i = 0; i < cum.length; i++) {
        if (tt < cum[i]) return frames[i];
      }
      return frames[frames.length - 1];
    };
  };
  const pickGifFrame = buildPicker(gifFrames, gifDurations);
  const pickBgFrame = buildPicker(bgFrames, bgDurations);

  // Map WebCodecs codec string → mp4-muxer codec family. Lets us fall back to
  // VP9/AV1 inside an MP4 container when the headless browser used by CI
  // ships without the proprietary H.264 encoder. ffmpeg on the server can
  // still `-c:v copy` the resulting MP4 stream when adding the audio track.
  let muxCodec: "avc" | "hevc" | "vp9" | "av1";
  if (chosenCodec.startsWith("avc1")) muxCodec = "avc";
  else if (chosenCodec.startsWith("hev1") || chosenCodec.startsWith("hvc1")) muxCodec = "hevc";
  else if (chosenCodec.startsWith("vp09")) muxCodec = "vp9";
  else if (chosenCodec.startsWith("av01")) muxCodec = "av1";
  else throw new Error(`Unsupported codec for MP4 export: ${chosenCodec}`);

  // Streaming MP4 background source. Used in preference to the legacy
  // pre-extracted bgFrames path when the main thread handed us the raw
  // file buffer. Stays null for image backgrounds, WebM sources, or when
  // WebCodecs can't decode the source codec in this environment. The
  // source is stateful (internal sample cursor) so a retry pass needs a
  // freshly constructed instance — see attemptEncode below.
  // Explicit `as` cast keeps TS from narrowing the union to `null` after the
  // initial assignment — the closure inside attemptEncode reassigns it but
  // TypeScript can't follow that across the closure boundary.
  let bgVideoSource = null as BgVideoFrameSource | null;

  // Run a single full encode pass: fresh muxer, fresh audio encode, fresh
  // video encode at the given bitrate. Returns the final MP4 buffer or
  // throws. Pulled out so the outer loop can retry with a lower bitrate /
  // software encoder when the GPU encoder rejects a config — without
  // forcing the main thread to re-analyze audio or re-decode the bg.
  const attemptEncode = async (
    attemptBitrate: number,
    hwAccel: "no-preference" | "prefer-software",
  ): Promise<ArrayBuffer> => {
    // (Re-)create the bg video source for this attempt — the previous one
    // (if any) consumed its sample cursor.
    if (bgVideoSource) { try { bgVideoSource.close(); } catch { /* ignore */ } bgVideoSource = null; }
    if (bgVideoBuffer) {
      bgVideoSource = await createBgVideoFrameSource(bgVideoBuffer);
      // Main-thread preflight already validated this MP4, so a null here
      // indicates an environment mismatch (e.g. worker's WebCodecs reports
      // the codec unsupported even though the main thread thought it was
      // streamable). Fail loudly instead of silently rendering a black
      // background — the user gets a real error message and can retry,
      // and our fallback strategy stays at the main-thread layer where
      // it has full file access for the legacy seek extractor.
      if (!bgVideoSource) {
        throw new Error("Background video stream construction failed in export worker (preflight passed but VideoDecoder rejected configuration)");
      }
    }

    const offscreen = new OffscreenCanvas(W, H);
    const ctx = offscreen.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context in export worker");

    const sceneState: SceneState = createSceneState();

    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: muxCodec, width: W, height: H, frameRate: fps },
      ...(audioEncoderSupported ? {
        audio: { codec: "aac", numberOfChannels: audioChannels!, sampleRate: audioSampleRate! },
      } : {}),
      fastStart: "in-memory",
    });

    // ── Audio encoding (runs before video loop so chunks land in muxer first) ─
    let audioEncodeError: Error | null = null;
    if (audioEncoderSupported && audioPcm && audioSampleRate && audioChannels) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          try { (muxer as unknown as { addAudioChunk: (c: unknown, m: unknown) => void }).addAudioChunk(chunk, meta); }
          catch (err) { audioEncodeError = err instanceof Error ? err : new Error(String(err)); }
        },
        error: (err) => { audioEncodeError = err instanceof Error ? err : new Error(String(err)); },
      });
      audioEncoder.configure({
        codec: "mp4a.40.2",
        sampleRate: audioSampleRate,
        numberOfChannels: audioChannels,
        bitrate: 192_000,
      });

      const AUDIO_CHUNK_FRAMES = 1024;
      const pcm = new Float32Array(audioPcm);
      const totalAudioFrames = Math.floor(pcm.length / audioChannels);
      let pos = 0;
      while (pos < totalAudioFrames) {
        if (audioEncodeError) throw audioEncodeError;
        const frames = Math.min(AUDIO_CHUNK_FRAMES, totalAudioFrames - pos);
        const chunk = new Float32Array(frames * audioChannels);
        for (let i = 0; i < frames * audioChannels; i++) chunk[i] = pcm[pos * audioChannels + i];
        const ts = Math.round(pos / audioSampleRate * 1_000_000);
        // AudioData is part of WebCodecs; the dom lib types it but worker context
        // may not expose it through globalThis typings, so we use a minimal shim.
        const AudioDataCtor = (globalThis as unknown as Record<string, unknown>)["AudioData"] as
          new (o: { format: string; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) => { close(): void };
        const audioDataObj = new AudioDataCtor(
          { format: "f32", sampleRate: audioSampleRate, numberOfFrames: frames, numberOfChannels: audioChannels, timestamp: ts, data: chunk }
        );
        (audioEncoder.encode as unknown as (d: unknown) => void)(audioDataObj);
        audioDataObj.close();
        pos += frames;
      }
      await audioEncoder.flush();
      audioEncoder.close();
      if (audioEncodeError) throw audioEncodeError;
    }

    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); }
        catch (err) { encodeError = err instanceof Error ? err : new Error(String(err)); }
      },
      error: (err) => { encodeError = err instanceof Error ? err : new Error(String(err)); },
    });
    const encoderConfig: VideoEncoderConfig = {
      codec: chosenCodec,
      width: W,
      height: H,
      bitrate: attemptBitrate,
      framerate: fps,
      hardwareAcceleration: hwAccel,
    };
    if (muxCodec === "avc") encoderConfig.avc = { format: "avc" };
    encoder.configure(encoderConfig);

    const frameDurationUs = Math.round(1_000_000 / fps);
    const exportStartAt = performance.now();
    let lastProgressAt = exportStartAt;

    for (let i = 0; i < totalFrames; i++) {
      if (cancelled) throw new Error("cancelled");
      if (encodeError) {
        // Drop the encoder + muxer immediately so the outer retry can
        // build a fresh pair without leaking resources.
        try { encoder.close(); } catch { /* already closed */ }
        throw encodeError;
      }

      const tInClip = i / fps;
      const tAudio = startSec + tInClip;
      const freqData = new Uint8Array(freqBuffer, i * freqLen, freqLen);
      const timeData = new Uint8Array(timeBuffer, i * timeLen, timeLen);

      const gifFrame = pickGifFrame ? pickGifFrame(tAudio) : null;
      let bg: ImageBitmap | VideoFrame | null | undefined;
      if (bgVideoSource) bg = await bgVideoSource.getFrameAt(tInClip);
      else if (pickBgFrame) bg = pickBgFrame(tInClip);
      else bg = bgBitmap;
      drawScene(ctx, W, H, freqData, timeData, tAudio, tInClip, sceneState, bg ?? null, visConfig, lyricsConfig, gifFrame, bgTransform);

      const videoFrame = new VideoFrame(offscreen, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });
      const keyFrame = i % (fps * 2) === 0;
      encoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      if (encoder.encodeQueueSize > 12) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }

      const now = performance.now();
      if (now - lastProgressAt > 150) {
        const elapsed = (now - exportStartAt) / 1000;
        const framesLeft = totalFrames - (i + 1);
        const fpsActual = (i + 1) / elapsed;
        const secLeft = fpsActual > 0 ? framesLeft / fpsActual : 0;
        const eta = secLeft < 5 ? "Almost done…"
          : secLeft < 60 ? `~${Math.ceil(secLeft)}s remaining`
          : `~${Math.ceil(secLeft / 60)}m remaining`;
        postMsg({ type: "progress", done: i + 1, total: totalFrames, eta });
        lastProgressAt = now;
      }
    }

    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;
    muxer.finalize();

    return (muxer.target as { buffer: ArrayBuffer }).buffer;
  };

  try {
    // Up to two attempts. The first uses the user's chosen quality bitrate
    // with whatever encoder the browser prefers (usually hardware). If the
    // GPU encoder rejects that config — common on older Intel iGPUs at
    // 1080p+ even at "moderate" bitrates — we automatically retry once at
    // 50% bitrate (floor 3 Mbps) AND force the software encoder. Software
    // H.264 (OpenH264 in Chromium) accepts virtually any bitrate at the
    // cost of slower encoding, which is the right tradeoff vs. failing.
    const attempts: { bitrate: number; hwAccel: "no-preference" | "prefer-software" }[] = [
      { bitrate, hwAccel: "no-preference" },
      { bitrate: Math.max(3_000_000, Math.floor(bitrate * 0.5)), hwAccel: "prefer-software" },
    ];
    let buffer: ArrayBuffer | null = null;
    let lastEncoderErr: Error | null = null;
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      if (i > 0) {
        postMsg({
          type: "progress",
          done: 0,
          total: totalFrames,
          eta: `Encoder rejected ${(attempts[0].bitrate / 1_000_000).toFixed(0)} Mbps — retrying at ${(att.bitrate / 1_000_000).toFixed(1)} Mbps (software)…`,
        });
      }
      try {
        buffer = await attemptEncode(att.bitrate, att.hwAccel);
        break;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        // Cancellation is a user action, never retry.
        if (raw === "cancelled") throw err;
        // Don't retry on configuration errors that happen BEFORE any frames
        // are encoded — those won't get fixed by a different encoder.
        const isPrelude = /Failed to get 2D context|Unsupported codec for MP4 export|Background video stream construction failed/i.test(raw);
        if (isPrelude) throw err;
        // For everything else (encoder errors, mid-stream failures, muxer
        // errors, OOM-like messages, generic DOMExceptions), let the
        // software-encoder retry have a swing. The cost is one extra wait;
        // the cost of NOT retrying is the user's whole export dying.
        if (i === attempts.length - 1) throw err;
        lastEncoderErr = err instanceof Error ? err : new Error(raw);
      }
    }
    if (!buffer) throw lastEncoderErr ?? new Error("Encoder failed without details");
    postMsg({ type: "done", buffer, hasAudio: audioEncoderSupported }, [buffer]);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Pass cancellations through unchanged. For everything else, prepend
    // an actionable suggestion but keep the raw message so the user (and
    // we) can see exactly what the encoder/muxer said when both attempts
    // fail. Without the raw text, mid-stream failures like "Failed to
    // encode frame 723" or DOMException kinds are invisible and we can't
    // tune the retry strategy.
    let message = raw;
    if (raw !== "cancelled") {
      message = `Export failed after retry. Try a lower Quality preset (Fast), a smaller export ratio, or a shorter trim. (Encoder said: ${raw})`;
    }
    postMsg({ type: "error", message });
  } finally {
    if (bgBitmap) bgBitmap.close();
    if (bgFrames) {
      for (const f of bgFrames) {
        try { f.close(); } catch { /* already closed */ }
      }
    }
    if (bgVideoSource) bgVideoSource.close();
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

workerSelf.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type === "start") {
    cancelled = false;
    runExport(msg);
  }
};
