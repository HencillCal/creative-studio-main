// Streaming background-video frame source for the export worker.
//
// Replaces the old "seek an HTMLVideoElement frame-by-frame on the main
// thread, capped at 8 fps / 180 frames" extractor. Uses mp4box.js to demux
// the uploaded MP4 (in memory) and the WebCodecs VideoDecoder to decode
// frames in real decode order. Frames are kept in a small bounded queue
// and consumed in lockstep with the encoder, so memory stays roughly
// O(queue size) regardless of source length.
//
// Looping: when the export clip is longer than the source video, the
// decoder is restarted from the first sample as soon as the export's
// time-in-clip crosses a duration boundary. Returned frames always live
// in source-time, so the caller does not need to know about loops.
//
// Caller contract:
// - Treat returned VideoFrame instances as borrowed: do NOT call .close()
//   on them. The source closes them itself when they're evicted from the
//   queue or when close() is invoked.
// - Call close() once when the export finishes.
//
// MP4 only — WebM is not supported by mp4box.js. The exporter detects
// non-MP4 buffers up front and falls back to the legacy seek-based
// extractor on the main thread.

import { createFile, MP4BoxBuffer, DataStream, Endianness, type ISOFile } from "mp4box";

interface VideoTrackInfo {
  id: number;
  codec: string;
  timescale: number;
  durationSec: number;
  codedWidth: number;
  codedHeight: number;
  description: Uint8Array | null;
  nbSamples: number;
}

// Walk the trak's sample entries looking for a codec-config box (avcC,
// hvcC, vpcC, av1C). Serializes the box minus the 8-byte ISO BMFF header
// into a Uint8Array suitable for VideoDecoder.configure({ description }).
function extractDescription(file: ISOFile, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId) as unknown as {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: Array<Record<string, unknown> & { write?: (s: DataStream) => void }> } } } };
  };
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries || entries.length === 0) return null;
  for (const entry of entries) {
    const cfg = (entry.avcC || entry.hvcC || entry.vpcC || entry.av1C) as
      | { write?: (s: DataStream) => void }
      | undefined;
    if (!cfg || typeof cfg.write !== "function") continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    cfg.write(stream);
    const buf = stream.buffer as ArrayBuffer;
    // Skip the 8-byte box header (4 bytes size + 4 bytes type).
    return new Uint8Array(buf, 8);
  }
  return null;
}

function looksLikeMp4(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer, 4, 4);
  // ftyp box = 0x66 0x74 0x79 0x70
  return view.getUint8(0) === 0x66 && view.getUint8(1) === 0x74
    && view.getUint8(2) === 0x79 && view.getUint8(3) === 0x70;
}

// Parse the moov synchronously and return the video track info, or null
// if the buffer isn't a parseable MP4 with a video track. Shared by the
// streaming source's constructor path and by the main-thread preflight
// check in SongVisualizer (so we can decide to fall back to the legacy
// seek extractor before posting a useless buffer to the worker).
function probeVideoTrack(buffer: ArrayBuffer): VideoTrackInfo | null {
  if (!looksLikeMp4(buffer)) return null;
  const file: ISOFile = createFile();
  let info: VideoTrackInfo | null = null;
  file.onReady = (movie) => {
    const track = movie.videoTracks[0];
    if (!track) return;
    const description = extractDescription(file, track.id);
    const movieDur = movie.duration && movie.timescale
      ? movie.duration / movie.timescale : 0;
    const trackDur = track.duration && track.timescale
      ? track.duration / track.timescale : 0;
    const durationSec = trackDur || movieDur;
    const visual = (track as { video?: { width?: number; height?: number } }).video;
    info = {
      id: track.id,
      codec: track.codec,
      timescale: track.timescale,
      durationSec,
      codedWidth: visual?.width ?? track.track_width ?? 0,
      codedHeight: visual?.height ?? track.track_height ?? 0,
      description,
      nbSamples: (track as { nb_samples?: number }).nb_samples ?? 0,
    };
  };
  try {
    const mp4buf = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    file.appendBuffer(mp4buf, true);
    file.flush?.();
  } catch {
    return null;
  }
  if (!info) return null;
  if (!(info as VideoTrackInfo).codec || (info as VideoTrackInfo).durationSec <= 0) return null;
  return info;
}

// Main-thread preflight: returns true iff the worker's streaming MP4
// pipeline should be able to decode this buffer in this environment.
// Combines mp4box parsability with VideoDecoder.isConfigSupported, so
// callers can deterministically decide between the streaming path and
// the legacy frame-extractor fallback before posting to the worker.
export async function canStreamMp4Buffer(buffer: ArrayBuffer): Promise<boolean> {
  if (typeof VideoDecoder === "undefined") return false;
  const info = probeVideoTrack(buffer);
  if (!info) return false;
  try {
    const support = await VideoDecoder.isConfigSupported({
      codec: info.codec,
      codedWidth: info.codedWidth || 16,
      codedHeight: info.codedHeight || 16,
      ...(info.description ? { description: info.description } : {}),
    });
    return !!support.supported;
  } catch {
    return false;
  }
}

export interface BgVideoFrameSource {
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  // Returns the most recent decoded VideoFrame for the given clip-time
  // (seconds, monotonically non-decreasing across calls). The returned
  // frame is owned by the source — do not close it.
  getFrameAt(tInClipSec: number): Promise<VideoFrame | null>;
  close(): void;
}

class StreamingBgVideoSource implements BgVideoFrameSource {
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  private trackInfo: VideoTrackInfo;
  private file: ISOFile;
  private decoder!: VideoDecoder;
  // Bounded ring of decoded VideoFrames in source-time order. Always
  // closed in evict() so peak memory ≈ maxQueued × frame size.
  private queue: VideoFrame[] = [];
  // Index of the next compressed sample to pull from mp4box. Resets to
  // 0 whenever the export crosses a source-duration boundary; mp4box's
  // moov stays in memory across loops so no re-parse is needed.
  private nextSampleIdx = 0;
  private currentLoopIdx = 0;
  // Highest sample index whose bytes mp4box still owns. Used to call
  // releaseUsedSamples() exactly once per loop boundary so we don't
  // accumulate decoded byte ranges across the entire source.
  private lastReleasedIdx = -1;
  private decoderError: Error | null = null;
  private waiters: Array<() => void> = [];
  private closed = false;
  private readonly maxQueued = 8;
  private readonly maxDecoderInflight = 16;

  constructor(file: ISOFile, info: VideoTrackInfo) {
    this.file = file;
    this.trackInfo = info;
    this.durationSec = info.durationSec;
    this.width = info.codedWidth;
    this.height = info.codedHeight;
    this.startLoop(0);
  }

  // (Re-)create the decoder and rewind the demuxer to the first sample.
  // Called once at construction and again at every source-duration
  // boundary. Critically: we DO NOT rebuild the mp4box ISOFile here —
  // mp4box keeps the moov + sample table in memory once parsed, so
  // looping is just "reset the sample cursor and start a fresh decoder".
  private startLoop(loopIdx: number) {
    this.currentLoopIdx = loopIdx;
    this.nextSampleIdx = 0;
    this.lastReleasedIdx = -1;
    // Drop any stale frames from the previous loop.
    for (const f of this.queue) {
      try { f.close(); } catch { /* already closed */ }
    }
    this.queue = [];
    if (this.decoder) {
      try { this.decoder.close(); } catch { /* ignore */ }
    }
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) { try { frame.close(); } catch { /* ignore */ } return; }
        this.queue.push(frame);
        this.notify();
      },
      error: (err) => { this.decoderError = err instanceof Error ? err : new Error(String(err)); this.notify(); },
    });
    this.decoder.configure({
      codec: this.trackInfo.codec,
      codedWidth: this.trackInfo.codedWidth,
      codedHeight: this.trackInfo.codedHeight,
      ...(this.trackInfo.description ? { description: this.trackInfo.description } : {}),
      optimizeForLatency: true,
    });
    this.notify();
  }

  private notify() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private waitForChange(): Promise<void> {
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }

  // Pull one compressed sample on demand, hand it to the VideoDecoder,
  // then immediately release it back to mp4box so the encoded bytes
  // don't pile up in memory. Returns false when there are no more
  // samples in the current loop or when the decoder is at its inflight
  // cap (caller will re-try after the decoder drains).
  private feedOne(): boolean {
    if (this.nextSampleIdx >= this.trackInfo.nbSamples) return false;
    if (this.decoder.decodeQueueSize >= this.maxDecoderInflight) return false;
    let s;
    try { s = this.file.getTrackSample(this.trackInfo.id, this.nextSampleIdx); }
    catch (err) {
      this.decoderError = err instanceof Error ? err : new Error(String(err));
      this.notify();
      return false;
    }
    // mp4box returns null when the sample's bytes aren't available
    // (e.g. file was opened without keepMdatData). Treat as a hard
    // failure so getFrameAt() throws instead of waiting forever.
    if (!s) {
      this.decoderError = new Error(
        `mp4box getTrackSample(${this.trackInfo.id}, ${this.nextSampleIdx}) returned null — sample data unavailable`,
      );
      this.notify();
      return false;
    }
    const data = s.data;
    const idx = this.nextSampleIdx++;
    if (data) {
      const tsBaseUs = this.currentLoopIdx * this.durationSec * 1e6;
      const tsUs = tsBaseUs + (1e6 * s.cts) / s.timescale;
      const durUs = (1e6 * s.duration) / s.timescale;
      try {
        // EncodedVideoChunk copies the data into its own backing store
        // per spec, so we can safely tell mp4box to drop the sample's
        // byte range immediately after decode().
        this.decoder.decode(new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round(tsUs),
          duration: Math.round(durUs),
          data,
        }));
      } catch (err) {
        this.decoderError = err instanceof Error ? err : new Error(String(err));
      }
    }
    // Release in small batches — releaseUsedSamples is "release through N",
    // so we just keep advancing the watermark.
    if (idx - this.lastReleasedIdx >= 8) {
      try { this.file.releaseUsedSamples(this.trackInfo.id, idx); }
      catch { /* best effort — nothing to do if mp4box is unhappy */ }
      this.lastReleasedIdx = idx;
    }
    return true;
  }

  async getFrameAt(tInClipSec: number): Promise<VideoFrame | null> {
    if (this.closed) return null;
    const loopIdx = Math.floor(tInClipSec / this.durationSec);
    if (loopIdx > this.currentLoopIdx) {
      // Drain pending decoder output for cleanliness, then reset the
      // sample cursor. mp4box keeps the file parsed; this is cheap.
      try { await this.decoder.flush(); } catch { /* ignore */ }
      this.startLoop(loopIdx);
    }
    const tUs = tInClipSec * 1e6;

    while (true) {
      if (this.decoderError) throw this.decoderError;
      // Feed the decoder while there's room and samples available.
      while (this.queue.length < this.maxQueued && this.feedOne()) { /* loop */ }
      // Drop frames the encoder has already passed by — but keep at least
      // one frame so we always have something to draw at the current time.
      while (this.queue.length >= 2 && this.queue[1].timestamp <= tUs) {
        const old = this.queue.shift()!;
        try { old.close(); } catch { /* ignore */ }
      }
      const front = this.queue[0];
      if (front && (this.queue.length >= 2 || front.timestamp <= tUs)) {
        return front;
      }
      // No usable frame yet. If samples are exhausted and the decoder is
      // empty, flush it to drain the last few frames then return whatever
      // we have.
      const allFed = this.nextSampleIdx >= this.trackInfo.nbSamples;
      if (allFed && this.decoder.decodeQueueSize === 0) {
        try { await this.decoder.flush(); } catch { /* ignore */ }
        if (this.queue.length === 0) return null;
        return this.queue[0];
      }
      // Re-check for an error set during the feed loop above so we never
      // wait on a notify that has already fired.
      if (this.decoderError) throw this.decoderError;
      await this.waitForChange();
      if (this.closed) return null;
    }
  }

  close() {
    this.closed = true;
    for (const f of this.queue) {
      try { f.close(); } catch { /* ignore */ }
    }
    this.queue = [];
    try { this.decoder?.close(); } catch { /* ignore */ }
    this.notify();
  }
}

// Build a streaming background-video source from a raw MP4 buffer.
// Returns null when the buffer isn't an MP4 the WebCodecs pipeline can
// handle (caller should fall back to the legacy extractor). Callers on
// the main thread should normally use canStreamMp4Buffer() first to
// decide whether to send the buffer at all.
//
// Parses the moov once, learns nb_samples + codec extradata, and keeps
// the live ISOFile around for on-demand getTrackSample() calls — which
// is what makes the source's memory footprint bounded by the encoded
// file size + a small VideoFrame ring instead of "all decoded samples".
export async function createBgVideoFrameSource(buffer: ArrayBuffer): Promise<BgVideoFrameSource | null> {
  if (typeof VideoDecoder === "undefined") return null;
  if (!looksLikeMp4(buffer)) return null;

  // keepMdatData=true is REQUIRED so file.getTrackSample() can return
  // sample bytes later. The default is to discard mdat after parse,
  // which would cause feedOne() to silently fail and stall the export.
  const file: ISOFile = createFile(true);
  let info: VideoTrackInfo | null = null;
  let onReadyFired = false;
  file.onReady = (movie) => {
    onReadyFired = true;
    const track = movie.videoTracks[0];
    if (!track) return;
    const description = extractDescription(file, track.id);
    const movieDur = movie.duration && movie.timescale
      ? movie.duration / movie.timescale : 0;
    const trackDur = track.duration && track.timescale
      ? track.duration / track.timescale : 0;
    const durationSec = trackDur || movieDur;
    const visual = (track as { video?: { width?: number; height?: number } }).video;
    info = {
      id: track.id,
      codec: track.codec,
      timescale: track.timescale,
      durationSec,
      codedWidth: visual?.width ?? track.track_width ?? 0,
      codedHeight: visual?.height ?? track.track_height ?? 0,
      description,
      nbSamples: (track as { nb_samples?: number }).nb_samples ?? 0,
    };
    // Tell mp4box which track we want to extract from. We do NOT call
    // file.start() — extraction is driven sample-by-sample through
    // getTrackSample(), so mp4box never has to materialize the full
    // sample list up front.
    file.setExtractionOptions(track.id, null, { nbSamples: 1 });
  };
  try {
    const mp4buf = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    file.appendBuffer(mp4buf, true);
    file.flush?.();
  } catch {
    return null;
  }
  if (!onReadyFired || !info) return null;
  const ti = info as VideoTrackInfo;
  if (!ti.codec || ti.durationSec <= 0 || ti.nbSamples <= 0) return null;
  try {
    const support = await VideoDecoder.isConfigSupported({
      codec: ti.codec,
      codedWidth: ti.codedWidth || 16,
      codedHeight: ti.codedHeight || 16,
      ...(ti.description ? { description: ti.description } : {}),
    });
    if (!support.supported) return null;
  } catch {
    return null;
  }
  return new StreamingBgVideoSource(file, ti);
}
