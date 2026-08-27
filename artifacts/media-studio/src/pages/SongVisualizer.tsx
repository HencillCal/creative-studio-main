import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft, Zap, Play, Pause, Download, Upload, X,
  Image as ImageIcon, Music, SlidersHorizontal, Loader2, Type, Wand2, Search,
  Scissors, Bold, Italic, Sparkles, Globe, Paintbrush,
  BarChart3, Circle, Activity, Sun, Waves, Dna, Atom, Orbit,
  Disc3, PersonStanding, Sliders, Trash2, HardDrive, RefreshCw, Repeat,
  Eye, ArrowLeftRight, Info,
  Bookmark, BookmarkPlus, FileImage,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  type LyricSegment, type VisStyle, type VisPosition, type LyricsPosition, type LyricsFontFamily,
  type LyricsHighlightStyle,
  type SceneState, type DrawVisConfig, type DrawLyricsConfig,
  CANVAS_W, CANVAS_H,
  createSceneState,
  drawScene as drawSceneShared,
  LYRICS_HIGHLIGHT_STYLES,
} from "@/lib/drawScene";
import {
  type LyricStylePreset,
  LYRIC_STYLE_PRESETS_KEY,
  DEFAULT_LYRIC_STYLE_PRESETS,
  normaliseLyricStylePreset,
} from "@/lib/lyricStylePresets";
import { LyricStylePresetPreview } from "@/components/LyricStylePresetPreview";

const TIMELINE_ROW_H = 16;
const TIMELINE_ROW_TOP_OFFSET = 2;
const TIMELINE_BLOCK_H = 12;
const TIMELINE_SCROLL_PAUSE_MS = 3000;


const TRANSLATE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "sw", label: "Swahili" },
  { code: "ru", label: "Russian" },
];


const FONT_OPTIONS: { id: LyricsFontFamily; label: string }[] = [
  { id: "Arial", label: "Arial" },
  { id: "Georgia", label: "Georgia" },
  { id: "Impact", label: "Impact" },
  { id: "Comic Sans MS", label: "Comic Sans" },
  { id: "Courier New", label: "Courier" },
  { id: "Brush Script MT, cursive", label: "Cursive" },
];


const POSITION_OPTIONS: { id: VisPosition; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "center", label: "Center" },
  { id: "bottom", label: "Bottom" },
];

const LYRICS_POSITION_OPTIONS: { id: LyricsPosition; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "center", label: "Center" },
  { id: "bottom", label: "Bottom" },
];

const VIS_STYLES: { id: VisStyle; label: string; desc: string; icon: typeof BarChart3 }[] = [
  { id: "bars", label: "Frequency Bars", desc: "Classic equalizer bars", icon: BarChart3 },
  { id: "circular", label: "Circular Spectrum", desc: "Radial frequency ring", icon: Circle },
  { id: "waveform", label: "Waveform", desc: "Audio waveform line", icon: Activity },
  { id: "pulse", label: "Pulse Glow", desc: "Pulsing energy burst", icon: Sun },
  { id: "waterfall", label: "Spectrum Waterfall", desc: "Falling frequency bands", icon: Waves },
  { id: "helix", label: "DNA Helix", desc: "Double helix wave", icon: Dna },
  { id: "particles", label: "Particle Burst", desc: "Particles from center", icon: Atom },
  { id: "galaxy", label: "Galaxy Spiral", desc: "Rotating spiral arms", icon: Orbit },
  { id: "turntable", label: "Turntable", desc: "Spinning vinyl record", icon: Disc3 },
  { id: "dancer", label: "Dancer", desc: "Silhouette dances to beat", icon: PersonStanding },
  { id: "djbooth", label: "DJ Booth", desc: "Decks, mixer, club lights", icon: Sliders },
  { id: "gif", label: "GIF", desc: "Upload an animated GIF / WebP", icon: FileImage },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function RangeSlider({ label, value, min, max, step, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs text-muted-foreground">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer accent-primary" />
    </div>
  );
}


const RATIO_OPTIONS = [
  { id: "16:9" as const, label: "16:9", w: 1920, h: 1080 },
  { id: "9:16" as const, label: "9:16", w: 1080, h: 1920 },
  { id: "1:1" as const, label: "1:1", w: 1080, h: 1080 },
  { id: "4:5" as const, label: "4:5", w: 1080, h: 1350 },
];
type RatioId = typeof RATIO_OPTIONS[number]["id"];

// Pick the export ratio whose aspect is closest (in log-space) to the source's
// aspect. Used when a background image/video is uploaded so the output matches
// the source orientation by default — avoids letterbox/pillarbox padding when
// the user immediately exports without manually changing the ratio dropdown.
function pickClosestRatio(srcW: number, srcH: number): RatioId {
  if (!srcW || !srcH) return "16:9";
  const srcAspect = srcW / srcH;
  let best: RatioId = "16:9";
  let bestDiff = Infinity;
  for (const opt of RATIO_OPTIONS) {
    const diff = Math.abs(Math.log((opt.w / opt.h) / srcAspect));
    if (diff < bestDiff) { bestDiff = diff; best = opt.id; }
  }
  return best;
}

type ExportQuality = "fast" | "standard" | "high";
// Bitrates tuned for the export resolutions above (1080p-ish).
// "high" sits at the upper end of YouTube's 1080p30 SDR recommendation
// (8–12 Mbps is YT's range; we go a bit above for sharper direct playback)
// while staying inside the realtime-encode envelope of consumer GPU H.264
// encoders. Earlier we tried 20 Mbps for "high", but Intel iGPU and some
// older NVIDIA encoders rejected that with a generic "Encoding error" at
// 1080×1080 — 16 Mbps is still visibly crisper than the previous 12 Mbps
// ceiling but encodes reliably across hardware.
const QUALITY_BITRATES: Record<ExportQuality, number> = {
  fast: 6_000_000,
  standard: 10_000_000,
  high: 16_000_000,
};

function parseTimeInput(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":");
    if (parts.length !== 2) return null;
    const m = parseFloat(parts[0]);
    const sec = parseFloat(parts[1]);
    if (Number.isNaN(m) || Number.isNaN(sec)) return null;
    return m * 60 + sec;
  }
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : v;
}

function formatTimeInput(t: number): string {
  if (t < 60) return t.toFixed(1);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function formatReadout(t: number): string {
  if (t < 60) return `${t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBadgeTime(t: number): string {
  const totalSec = Math.round(t);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TimelineTrim({ audioDuration, trimStart, trimEnd, setTrimStart, setTrimEnd }: {
  audioDuration: number; trimStart: number; trimEnd: number;
  setTrimStart: (v: number) => void; setTrimEnd: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"start" | "end" | null>(null);
  const trimStartRef = useRef(trimStart);
  trimStartRef.current = trimStart;
  const trimEndRef = useRef(trimEnd);
  trimEndRef.current = trimEnd;
  const [startInput, setStartInput] = useState(formatTimeInput(trimStart));
  const [endInput, setEndInput] = useState(formatTimeInput(trimEnd));

  useEffect(() => { setStartInput(formatTimeInput(trimStart)); }, [trimStart]);
  useEffect(() => { setEndInput(formatTimeInput(trimEnd)); }, [trimEnd]);

  const minGap = Math.min(0.5, audioDuration);
  const startPct = audioDuration > 0 ? (trimStart / audioDuration) * 100 : 0;
  const endPct = audioDuration > 0 ? (trimEnd / audioDuration) * 100 : 100;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const which = dragRef.current;
      const track = trackRef.current;
      if (!which || !track || audioDuration <= 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = ratio * audioDuration;
      if (which === "start") {
        setTrimStart(Math.max(0, Math.min(t, trimEndRef.current - minGap)));
      } else {
        setTrimEnd(Math.min(audioDuration, Math.max(t, trimStartRef.current + minGap)));
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [audioDuration, minGap, setTrimStart, setTrimEnd]);

  const startDrag = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = which;
  };

  const commitStart = () => {
    const v = parseTimeInput(startInput);
    if (v == null) { setStartInput(formatTimeInput(trimStart)); return; }
    setTrimStart(Math.max(0, Math.min(v, trimEnd - minGap)));
  };
  const commitEnd = () => {
    const v = parseTimeInput(endInput);
    if (v == null) { setEndInput(formatTimeInput(trimEnd)); return; }
    setTrimEnd(Math.min(audioDuration, Math.max(v, trimStart + minGap)));
  };

  return (
    <div className="w-full max-w-[640px] mt-3 p-3 rounded-lg border border-border bg-muted/20 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Scissors className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Trim for Export</span>
        </div>
        <span className="text-muted-foreground tabular-nums">
          {formatReadout(trimStart)} → {formatReadout(trimEnd)} · duration {formatReadout(Math.max(0, trimEnd - trimStart))}
        </span>
      </div>
      <div ref={trackRef} className="relative h-7 bg-muted rounded select-none touch-none">
        <div className="absolute top-0 bottom-0 bg-primary/30 rounded"
          style={{ left: `${startPct}%`, right: `${100 - endPct}%` }} />
        <div onPointerDown={startDrag("start")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-7 bg-primary rounded cursor-ew-resize shadow"
          style={{ left: `${startPct}%` }} />
        <div onPointerDown={startDrag("end")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-7 bg-primary rounded cursor-ew-resize shadow"
          style={{ left: `${endPct}%` }} />
      </div>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground">Start</Label>
          <input value={startInput}
            onChange={e => setStartInput(e.target.value)}
            onBlur={commitStart}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-20 bg-background border border-border rounded p-1 focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground">End</Label>
          <input value={endInput}
            onChange={e => setEndInput(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-20 bg-background border border-border rounded p-1 focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <span className="text-[10px] text-muted-foreground ml-auto">Accepts seconds (2.5) or m:ss (1:30.5)</span>
      </div>
    </div>
  );
}

// ── Offline FFT ────────────────────────────────────────────────────────────────
// Mirrors AnalyserNode (fftSize=256, smoothing=0.8, minDb=-100, maxDb=-30) so
// frame-by-frame rendering produces the same visualizations as live playback.

const FFT_N = 256;
const HANN_WINDOW = (() => {
  const w = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
  return w;
})();

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const aRe = real[i + k];
        const aIm = imag[i + k];
        const bRe = real[i + k + half] * curRe - imag[i + k + half] * curIm;
        const bIm = real[i + k + half] * curIm + imag[i + k + half] * curRe;
        real[i + k] = aRe + bRe;
        imag[i + k] = aIm + bIm;
        real[i + k + half] = aRe - bRe;
        imag[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

interface FrameAudio {
  freqData: Uint8Array;
  timeData: Uint8Array;
  smoothed: Float32Array;
}

function computeFrameAudio(
  channels: Float32Array[],
  sampleRate: number,
  time: number,
  prevSmoothed: Float32Array | null,
): FrameAudio {
  const N = FFT_N;
  const startSample = Math.floor(time * sampleRate);
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  const timeData = new Uint8Array(N);
  const numCh = channels.length;
  const len = channels[0].length;

  for (let i = 0; i < N; i++) {
    const idx = startSample + i;
    let sample = 0;
    if (idx >= 0 && idx < len) {
      for (let c = 0; c < numCh; c++) sample += channels[c][idx];
      sample /= numCh;
    }
    let byte = Math.round(sample * 128 + 128);
    if (byte < 0) byte = 0; else if (byte > 255) byte = 255;
    timeData[i] = byte;
    real[i] = sample * HANN_WINDOW[i];
  }

  fftRadix2(real, imag);

  const binCount = N / 2;
  const freqData = new Uint8Array(binCount);
  const smoothed = new Float32Array(binCount);
  const minDb = -100, maxDb = -30, smoothing = 0.8;
  // Window normalization: sum(hann)/N ~ 0.5 → magnitudes get scaled accordingly.
  const norm = 1 / N;
  for (let i = 0; i < binCount; i++) {
    const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) * norm;
    const prev = prevSmoothed ? prevSmoothed[i] : 0;
    const sm = smoothing * prev + (1 - smoothing) * mag;
    smoothed[i] = sm;
    const db = sm > 1e-7 ? 20 * Math.log10(sm) : minDb;
    let byte = ((db - minDb) / (maxDb - minDb)) * 255;
    if (byte < 0) byte = 0; else if (byte > 255) byte = 255;
    freqData[i] = byte;
  }
  return { freqData, timeData, smoothed };
}

async function fetchAudioAsArrayBuffer(src: string, file: File | null): Promise<ArrayBuffer> {
  if (file) return await file.arrayBuffer();
  const res = await fetch(src);
  if (!res.ok) throw new Error("Failed to fetch audio source");
  return await res.arrayBuffer();
}

async function fetchAudioAsBlob(src: string, file: File | null): Promise<Blob> {
  if (file) return file;
  const res = await fetch(src);
  if (!res.ok) throw new Error("Failed to fetch audio source");
  return await res.blob();
}



// ─── SSE helper for the transcribe endpoint ──────────────────────────────────
// The server streams SSE events so the client can show live retry progress.
// Events: "retry" {attempt, total} | "result" <transcription json> | "error" {message}
async function fetchTranscribeSse(
  formData: FormData,
  onRetry: (attempt: number, total: number) => void,
): Promise<unknown> {
  const res = await fetch("/api/media/transcribe", { method: "POST", body: formData });

  if (!res.ok) {
    const errData: { message?: string } = await res.json().catch(() => ({}));
    throw new Error(errData.message || "Transcription failed");
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6).trim();
      }
      if (!data) continue;

      if (event === "retry") {
        const { attempt, total } = JSON.parse(data) as { attempt: number; total: number };
        onRetry(attempt, total);
      } else if (event === "result") {
        return JSON.parse(data) as Record<string, unknown>;
      } else if (event === "error") {
        const { message } = JSON.parse(data) as { message: string };
        throw new Error(message || "Transcription failed");
      }
    }
  }

  throw new Error("Transcription failed — connection closed unexpectedly");
}

// Events: "retry" {attempt, total} | "result" <auto-sync json> | "error" {message}
async function fetchAutoSyncSse(
  formData: FormData,
  onRetry: (attempt: number, total: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch("/api/media/auto-sync-lyrics", { method: "POST", body: formData, signal });

  if (!res.ok) {
    const errData: { message?: string } = await res.json().catch(() => ({}));
    throw new Error(errData.message || "Auto-sync failed");
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    return res.json();
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6).trim();
      }
      if (!data) continue;

      if (event === "retry") {
        const { attempt, total } = JSON.parse(data) as { attempt: number; total: number };
        onRetry(attempt, total);
      } else if (event === "result") {
        return JSON.parse(data) as Record<string, unknown>;
      } else if (event === "error") {
        const { message } = JSON.parse(data) as { message: string };
        throw new Error(message || "Auto-sync failed");
      }
    }
  }

  throw new Error("Auto-sync failed — connection closed unexpectedly");
}

export default function SongVisualizer() {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // When the user uploads a video as the background, the source is held in
  // a hidden HTMLVideoElement instead of an <img>. The element handles its own
  // looping/playback; drawCoverImage knows how to render an HTMLVideoElement.
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoFileRef = useRef<File | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrubTrackRef = useRef<HTMLDivElement>(null);
  const scrubFillRef = useRef<HTMLDivElement>(null);
  const scrubHandleRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const currentLyricElemRef = useRef<HTMLDivElement>(null);
  const isScrubDraggingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const virtualClockRef = useRef<{ time: number; lastWall: number; running: boolean }>({ time: 0, lastWall: 0, running: false });
  const virtualDurationRef = useRef(0);
  const playableLyricsRef = useRef(false);

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [bgIsVideo, setBgIsVideo] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioName, setAudioName] = useState("");
  const [playing, setPlaying] = useState(false);
  const [visStyle, setVisStyle] = useState<VisStyle>("bars");
  const [color, setColor] = useState("#6366f1");
  const [intensity, setIntensity] = useState(70);
  // Smaller default size + top-left default position so the visualizer
  // starts as a compact corner element that the user can resize/reposition.
  const [visSize, setVisSize] = useState(25);
  const [position, setPosition] = useState<VisPosition>("top");
  // Style-aware "top-left default" offset helper. Returns the (visOffsetX,
  // visOffsetY) values that place the visualizer's bounding box at canvas
  // origin (0, 0) for the given style + size + scale. Mirrors the bounds
  // math in drawScene so every style lands at the corner — not just bars.
  const computeTopLeftOffsets = useCallback((
    style: VisStyle, size: number, sW: number = 1, sH: number = 1,
  ): { x: number; y: number } => {
    const W = 1280, H = 720;
    const sizeMul = size / 50;
    switch (style) {
      case "bars": {
        const bW = W * 0.8 * sizeMul * sW, bH = H * 0.5 * sizeMul * sH;
        return { x: -((W - bW) / 2), y: -(H * 0.5 + H * 0.25 * sH - bH) };
      }
      case "circular":
      case "pulse":
      case "particles":
      case "galaxy":
      case "turntable":
      case "dancer": {
        const rad = Math.min(W, H) * 0.4 * sizeMul * Math.min(sW, sH);
        return { x: -(W / 2 - rad), y: -(H / 2 - rad) };
      }
      case "djbooth": {
        const bW = W * 0.7 * sizeMul * sW, bH = H * 0.5 * sizeMul * sH;
        return { x: -(W / 2 - bW / 2), y: -(H / 2 - bH / 2) };
      }
      case "waterfall": {
        const bW = W * 0.8 * sizeMul * sW;
        return { x: -((W - bW) / 2), y: -(H * 0.2) };
      }
      case "helix": {
        const bW = W * 0.7 * sizeMul * sW, bH = H * 0.5 * sizeMul * sH;
        return { x: -((W - bW) / 2), y: -(H / 2 - bH / 2) };
      }
      case "gif": {
        const bW = W * 0.5 * sizeMul * sW, bH = H * 0.5 * sizeMul * sH;
        return { x: -(W / 2 - bW / 2), y: -(H / 2 - bH / 2) };
      }
      default: {
        // waveform + any future style — use the same fallback as drawScene.
        const bW = W * 0.8 * sizeMul * sW, bH = H * 0.5 * sizeMul * sH;
        return { x: -((W - bW) / 2), y: -(H / 2 - bH / 2) };
      }
    }
  }, []);
  // Initial defaults: top-left for the initial bars style at size 25.
  // (Re-computed for every style switch by the effect below.)
  const initialTLDef = computeTopLeftOffsets("bars", 25, 1, 1);
  const [visOffsetX, setVisOffsetX] = useState<number>(initialTLDef.x);
  const [visOffsetY, setVisOffsetY] = useState<number | null>(initialTLDef.y);
  // Tracks whether the user has manually moved/resized the visualizer.
  // While false, switching styles re-anchors to the new style's top-left
  // default so each style starts in the corner as requested.
  const userMovedVisRef = useRef(false);
  const [visScaleW, setVisScaleW] = useState(1);
  const [visScaleH, setVisScaleH] = useState(1);
  // Imperative reset back to the current style's top-left default; also
  // clears the "user has moved" flag so subsequent style switches keep
  // re-anchoring to the corner.
  const resetVisToTopLeft = useCallback(() => {
    const d = computeTopLeftOffsets(visStyle, visSize, 1, 1);
    setVisOffsetX(d.x);
    setVisOffsetY(d.y);
    setVisScaleW(1);
    setVisScaleH(1);
    userMovedVisRef.current = false;
  }, [computeTopLeftOffsets, visStyle, visSize]);
  // Re-anchor to the new style's top-left default whenever the visualizer
  // style changes — but only when the user hasn't manually positioned the
  // visualizer (so we don't clobber their carefully-placed layout).
  useEffect(() => {
    if (userMovedVisRef.current) return;
    const d = computeTopLeftOffsets(visStyle, visSize, 1, 1);
    setVisOffsetX(d.x);
    setVisOffsetY(d.y);
  }, [visStyle, visSize, computeTopLeftOffsets]);
  const isDraggingVis = useRef(false);
  const isResizingVis = useRef<string | null>(null);
  const [isVisHovered, setIsVisHovered] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const resizeStartScale = useRef({ w: 1, h: 1 });
  const resizeStartPos = useRef({ x: 0, y: 0 });
  // ─── Background image/video drag + resize ────────────────────────────
  // Pan offset (canvas px) and uniform zoom applied around the canvas
  // center. drawCoverImage's cover-fit math is preserved when both are at
  // their defaults (offset=0, scale=1), so existing layouts stay intact.
  const [bgOffsetX, setBgOffsetX] = useState(0);
  const [bgOffsetY, setBgOffsetY] = useState(0);
  const [bgScale, setBgScale] = useState(1);
  const [bgFitMode, setBgFitMode] = useState<"cover" | "contain">("cover");
  const [isBgHovered, setIsBgHovered] = useState(false);
  const isDraggingBg = useRef(false);
  const isResizingBg = useRef<string | null>(null);
  const dragStartBgOffset = useRef({ x: 0, y: 0 });
  const resizeStartBgScale = useRef(1);
  const resizeStartBgCenter = useRef({ x: 0, y: 0 });
  const resetBgTransform = useCallback(() => {
    setBgOffsetX(0);
    setBgOffsetY(0);
    setBgScale(1);
  }, []);
  // Whenever the background source is swapped or cleared, drop any prior
  // pan/zoom — the new image's framing is unrelated to the old one's.
  useEffect(() => {
    setBgOffsetX(0);
    setBgOffsetY(0);
    setBgScale(1);
  }, [imgSrc, bgIsVideo]);
  // ─── Lyrics-on-canvas drag/resize ──────────────────────────────────────
  const [lyricsOffsetX, setLyricsOffsetX] = useState(0);
  const [lyricsOffsetY, setLyricsOffsetY] = useState(0);
  const [lyricsScale, setLyricsScale] = useState(1);
  const [isLyricsHovered, setIsLyricsHovered] = useState(false);
  const isDraggingLyrics = useRef(false);
  const isResizingLyrics = useRef<string | null>(null);
  const dragStartLyricsOffset = useRef({ x: 0, y: 0 });
  const resizeStartLyricsScale = useRef(1);
  const resizeStartLyricsCenter = useRef({ x: 0, y: 0 });
  // Last rendered lyrics bounds (canvas px) — populated by the render loop
  // after each drawScene call. Used for hit testing.
  const lyricsBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // ─── GIF visualizer style ──────────────────────────────────────────────
  const [gifSrc, setGifSrc] = useState<string | null>(null);
  const [gifName, setGifName] = useState<string | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  // Decoded animated-image frames + per-frame display durations (seconds).
  const gifFramesRef = useRef<{ frames: ImageBitmap[]; durations: number[]; total: number } | null>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const waterfallBuf = useRef<number[][]>([]);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[]>([]);
  const galaxyAngleRef = useRef(0);
  const turntableAngleRef = useRef(0);
  const turntableAngleRRef = useRef(0);
  const dancerBeatRef = useRef({ lastBass: 0, beatPhase: 0, lastBeatT: 0 });
  const djFaderRef = useRef(0);
  const [showPanel, setShowPanel] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number; eta?: string } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderCancelRef = useRef(false);
  const renderWorkerRef = useRef<Worker | null>(null);
  const previewAudioCacheRef = useRef<{
    src: string;
    channels: Float32Array[];
    sampleRate: number;
    duration: number;
  } | null>(null);
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | null>(null);
  const [prevFramePreviewUrl, setPrevFramePreviewUrl] = useState<string | null>(null);
  const [isPreviewingFrame, setIsPreviewingFrame] = useState(false);
  const [previewTimePct, setPreviewTimePct] = useState(10);
  const [previewRenderedSec, setPreviewRenderedSec] = useState<number | null>(null);
  const [previewTimeInput, setPreviewTimeInput] = useState("");
  const [splitView, setSplitView] = useState(false);
  const [splitViewSwapped, setSplitViewSwapped] = useState(false);
  const [compareRatioId, setCompareRatioId] = useState<RatioId>("9:16");
  const [framePreviewUrl2, setFramePreviewUrl2] = useState<string | null>(null);

  const [lyricsSegments, setLyricsSegments] = useState<LyricSegment[]>([]);
  const [manualLyrics, setManualLyrics] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [whisperNote, setWhisperNote] = useState(false);
  const [whisperGapThreshold, setWhisperGapThreshold] = useState<number>(() => {
    const stored = parseFloat(localStorage.getItem("cs_whisper_gap_threshold") ?? "");
    return Number.isFinite(stored) && stored > 0 ? stored : 0.8;
  });
  const [songTitle, setSongTitle] = useState("");
  const [songArtist, setSongArtist] = useState("");
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [lyricsSource, setLyricsSource] = useState<string | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);
  const [lyricsFontSize, setLyricsFontSize] = useState(36);
  const [lyricsColor, setLyricsColor] = useState("#ffffff");
  const [lyricsHighlightColor, setLyricsHighlightColor] = useState("#ffd700");
  const [lyricsPosition, setLyricsPosition] = useState<LyricsPosition>("bottom");


  const [translateLang, setTranslateLang] = useState("en");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedLyrics, setTranslatedLyrics] = useState<string | null>(null);

  const [aiImagePrompt, setAiImagePrompt] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [aiImageError, setAiImageError] = useState<string | null>(null);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [loopSegIdx, setLoopSegIdx] = useState<number | null>(null);
  const [exportRatio, setExportRatio] = useState<RatioId>("16:9");
  const [exportQuality, setExportQuality] = useState<ExportQuality>(() => {
    const stored = localStorage.getItem("cs_export_quality");
    return (stored === "fast" || stored === "standard" || stored === "high") ? stored : "high";
  });

  const [lyricsFontFamily, setLyricsFontFamily] = useState<LyricsFontFamily>("Arial");
  const [lyricsBold, setLyricsBold] = useState(true);
  const [lyricsItalic, setLyricsItalic] = useState(false);
  const [lyricsOutline, setLyricsOutline] = useState(false);
  const [lyricsGlow, setLyricsGlow] = useState(false);
  const [autoEmoji, setAutoEmoji] = useState(false);
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const [lyricsPace, setLyricsPace] = useState(1);
  const [lyricsHighlightStyle, setLyricsHighlightStyle] = useState<LyricsHighlightStyle>("karaoke");
  const [lyricsDropShadow, setLyricsDropShadow] = useState(false);
  const [lyricsHardShadow, setLyricsHardShadow] = useState(false);
  const [lyricsNeon, setLyricsNeon] = useState(false);
  const [lyrics3D, setLyrics3D] = useState(false);
  const [lyricsGradient, setLyricsGradient] = useState(false);
  const [lyricsStroke, setLyricsStroke] = useState(false);
  const [lyricsUnderline, setLyricsUnderline] = useState(false);
  const [lyricsStrikethrough, setLyricsStrikethrough] = useState(false);
  const [lyricsUppercase, setLyricsUppercase] = useState(false);
  const [lyricsSmallCaps, setLyricsSmallCaps] = useState(false);
  const [lyricsBgPill, setLyricsBgPill] = useState(false);
  const [lyricsSticker, setLyricsSticker] = useState(false);
  const [lyricsComicPop, setLyricsComicPop] = useState(false);
  const [lyricsSubtitleBar, setLyricsSubtitleBar] = useState(false);
  const [lyricsPopActiveWord, setLyricsPopActiveWord] = useState(false);
  const [lyricsPopIntensity, setLyricsPopIntensity] = useState(40);
  // Empty string = use lyricsHighlightColor (default behavior).
  const [lyricsPopAccentColor, setLyricsPopAccentColor] = useState("");
  const [lyricsLetterSpacing, setLyricsLetterSpacing] = useState(0);
  const [lyricsBgColor, setLyricsBgColor] = useState("#000000");
  const [lyricsBgOpacity, setLyricsBgOpacity] = useState(0.6);
  const [tapSyncMode, setTapSyncMode] = useState(false);
  const [tapSyncIdx, setTapSyncIdx] = useState(0);
  const [lyricStylePresets, setLyricStylePresets] = useState<LyricStylePreset[]>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [fullSyncedSegments, setFullSyncedSegments] = useState<LyricSegment[]>([]);
  const [showLyricTimeline, setShowLyricTimeline] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [autoSyncMessage, setAutoSyncMessage] = useState<string | null>(null);
  const [lineByLineSync, setLineByLineSync] = useState<{ matched: number; total: number } | null>(null);
  const [cacheStats, setCacheStats] = useState<{ totalBytes: number; entryCount: number; oldestMtime: number | null; maxBytes: number } | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRefiningSync, setIsRefiningSync] = useState(false);
  // True when lyrics came in as plain text and were evenly distributed across
  // the full song duration. In this state the timing is just an estimate and
  // the first lyric typically appears at t=0 regardless of any intro. Once
  // auto-sync has redistributed from the real vocal onset this becomes false.
  const [lyricsAreDistributed, setLyricsAreDistributed] = useState(false);
  const lyricsAreDistributedRef = useRef(false);
  lyricsAreDistributedRef.current = lyricsAreDistributed;
  // Persists the vocal onset and signal source from the last successful sync so
  // it can (a) pre-seed initial distribution on new lyrics fetch, and (b) drive
  // the dismissible intro hint in the UI. Keyed to the audioSrc that was active
  // when the sync ran — any different song clears this automatically.
  const [detectedIntroInfo, setDetectedIntroInfo] = useState<{ vocalOnset: number; source: "python" | "consensus" | "consensus-acoustic" | "gemini" | "acoustic-fallback" | "manual" | string; audioSrc: string } | null>(null);
  const detectedIntroInfoRef = useRef<{ vocalOnset: number; source: string; audioSrc: string } | null>(null);
  detectedIntroInfoRef.current = detectedIntroInfo;
  const [introHintDismissed, setIntroHintDismissed] = useState(false);
  const syncRefineTokenRef = useRef(0);
  // Bumped every time a vocal-alignment run starts. Lets the most recent run
  // win when the user (or auto-trigger) fires multiple alignments back-to-back.
  const autoSyncTokenRef = useRef(0);
  // AbortController for the in-flight auto-sync network request, so a new
  // run can cancel the previous one instead of letting them pile up.
  const autoSyncAbortRef = useRef<AbortController | null>(null);

  const lyricsSegmentsRef = useRef<LyricSegment[]>([]);
  lyricsSegmentsRef.current = lyricsSegments;
  const playableLyrics = lyricsSegments.length > 0 && lyricsSegments.some(s => Number.isFinite(s.endTime) && s.endTime > 0);
  playableLyricsRef.current = playableLyrics;
  const virtualDuration = (() => {
    if (!playableLyrics) return 0;
    let max = 0;
    for (const s of lyricsSegments) if (Number.isFinite(s.endTime) && s.endTime > max) max = s.endTime;
    return max + 1;
  })();
  virtualDurationRef.current = virtualDuration;
  const lyricsFontSizeRef = useRef(lyricsFontSize);
  lyricsFontSizeRef.current = lyricsFontSize;
  const lyricsColorRef = useRef(lyricsColor);
  lyricsColorRef.current = lyricsColor;
  const lyricsHighlightColorRef = useRef(lyricsHighlightColor);
  lyricsHighlightColorRef.current = lyricsHighlightColor;
  const lyricsPositionRef = useRef(lyricsPosition);
  lyricsPositionRef.current = lyricsPosition;
  const lyricsFontFamilyRef = useRef(lyricsFontFamily);
  lyricsFontFamilyRef.current = lyricsFontFamily;
  const lyricsBoldRef = useRef(lyricsBold);
  lyricsBoldRef.current = lyricsBold;
  const lyricsItalicRef = useRef(lyricsItalic);
  lyricsItalicRef.current = lyricsItalic;
  const lyricsOutlineRef = useRef(lyricsOutline);
  lyricsOutlineRef.current = lyricsOutline;
  const lyricsGlowRef = useRef(lyricsGlow);
  lyricsGlowRef.current = lyricsGlow;
  const autoEmojiRef = useRef(autoEmoji);
  autoEmojiRef.current = autoEmoji;
  const lyricsOffsetRef = useRef(lyricsOffset);
  lyricsOffsetRef.current = lyricsOffset;
  const lyricsPaceRef = useRef(lyricsPace);
  lyricsPaceRef.current = lyricsPace;
  const lyricsHighlightStyleRef = useRef(lyricsHighlightStyle);
  lyricsHighlightStyleRef.current = lyricsHighlightStyle;
  const lyricsDropShadowRef = useRef(lyricsDropShadow);
  lyricsDropShadowRef.current = lyricsDropShadow;
  const lyricsHardShadowRef = useRef(lyricsHardShadow);
  lyricsHardShadowRef.current = lyricsHardShadow;
  const lyricsNeonRef = useRef(lyricsNeon);
  lyricsNeonRef.current = lyricsNeon;
  const lyrics3DRef = useRef(lyrics3D);
  lyrics3DRef.current = lyrics3D;
  const lyricsGradientRef = useRef(lyricsGradient);
  lyricsGradientRef.current = lyricsGradient;
  const lyricsStrokeRef = useRef(lyricsStroke);
  lyricsStrokeRef.current = lyricsStroke;
  const lyricsUnderlineRef = useRef(lyricsUnderline);
  lyricsUnderlineRef.current = lyricsUnderline;
  const lyricsStrikethroughRef = useRef(lyricsStrikethrough);
  lyricsStrikethroughRef.current = lyricsStrikethrough;
  const lyricsUppercaseRef = useRef(lyricsUppercase);
  lyricsUppercaseRef.current = lyricsUppercase;
  const lyricsSmallCapsRef = useRef(lyricsSmallCaps);
  lyricsSmallCapsRef.current = lyricsSmallCaps;
  const lyricsBgPillRef = useRef(lyricsBgPill);
  lyricsBgPillRef.current = lyricsBgPill;
  const lyricsStickerRef = useRef(lyricsSticker);
  lyricsStickerRef.current = lyricsSticker;
  const lyricsComicPopRef = useRef(lyricsComicPop);
  lyricsComicPopRef.current = lyricsComicPop;
  const lyricsSubtitleBarRef = useRef(lyricsSubtitleBar);
  lyricsSubtitleBarRef.current = lyricsSubtitleBar;
  const lyricsPopActiveWordRef = useRef(lyricsPopActiveWord);
  lyricsPopActiveWordRef.current = lyricsPopActiveWord;
  const lyricsPopIntensityRef = useRef(lyricsPopIntensity);
  lyricsPopIntensityRef.current = lyricsPopIntensity;
  const lyricsPopAccentColorRef = useRef(lyricsPopAccentColor);
  lyricsPopAccentColorRef.current = lyricsPopAccentColor;
  const lyricsLetterSpacingRef = useRef(lyricsLetterSpacing);
  lyricsLetterSpacingRef.current = lyricsLetterSpacing;
  const lyricsBgColorRef = useRef(lyricsBgColor);
  lyricsBgColorRef.current = lyricsBgColor;
  const lyricsBgOpacityRef = useRef(lyricsBgOpacity);
  lyricsBgOpacityRef.current = lyricsBgOpacity;
  const lyricsOffsetXRef = useRef(lyricsOffsetX);
  lyricsOffsetXRef.current = lyricsOffsetX;
  const lyricsOffsetYRef = useRef(lyricsOffsetY);
  lyricsOffsetYRef.current = lyricsOffsetY;
  const lyricsScaleRef = useRef(lyricsScale);
  lyricsScaleRef.current = lyricsScale;
  const trimStartRef = useRef(trimStart);
  trimStartRef.current = trimStart;
  const trimEndRef = useRef(trimEnd);
  trimEndRef.current = trimEnd;
  const exportRatioRef = useRef(exportRatio);
  exportRatioRef.current = exportRatio;
  const exportQualityRef = useRef(exportQuality);
  exportQualityRef.current = exportQuality;
  const framePreviewOpenRef = useRef(false);
  framePreviewOpenRef.current = framePreviewUrl !== null;
  const framePreviewUrlRef = useRef<string | null>(null);
  framePreviewUrlRef.current = framePreviewUrl;
  const previewTimePctRef = useRef(previewTimePct);
  previewTimePctRef.current = previewTimePct;
  const splitViewRef = useRef(splitView);
  splitViewRef.current = splitView;
  const compareRatioIdRef = useRef(compareRatioId);
  compareRatioIdRef.current = compareRatioId;
  const previewExportFrameRef = useRef<((timePct?: number) => Promise<void>) | null>(null);
  const uploadedAudioFileRef = useRef<File | null>(null);
  const realSongDurationRef = useRef<number | null>(null);
  const [lyricsMismatch, setLyricsMismatch] = useState<{ heard: string; firstLyricLine: string } | null>(null);
  const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
  const lastActiveLyricIdxRef = useRef(-1);
  const lyricListScrollRef = useRef<HTMLDivElement>(null);
  const lyricTimelineRef = useRef<HTMLDivElement>(null);
  const lyricTimelineScrollRef = useRef<HTMLDivElement>(null);
  const [editingLyricIdx, setEditingLyricIdx] = useState<number | null>(null);
  const [editingLyricText, setEditingLyricText] = useState('');
  const lyricEditKeyClosedRef = useRef(false);
  const [lyricTimelineScrollPaused, setLyricTimelineScrollPaused] = useState(false);
  const lyricTimelineProgrammaticScrollRef = useRef(false);
  const lyricTimelinePauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricDragRef = useRef<{
    segIdx: number;
    part: 'start' | 'end' | 'move';
    startX: number;
    startY: number;
    origStart: number;
    origEnd: number;
    containerWidth: number;
    totalDuration: number;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem("cs_whisper_gap_threshold", String(whisperGapThreshold));
  }, [whisperGapThreshold]);

  useEffect(() => {
    localStorage.setItem("cs_export_quality", exportQuality);
  }, [exportQuality]);


  // ── Lyric style presets ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LYRIC_STYLE_PRESETS_KEY);
      if (!raw) { setLyricStylePresets([]); return; }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) { setLyricStylePresets([]); return; }
      const cleaned = arr
        .map(normaliseLyricStylePreset)
        .filter((p): p is LyricStylePreset => !!p && !p.builtIn);
      setLyricStylePresets(cleaned);
    } catch {
      setLyricStylePresets([]);
    }
  }, []);

  const persistLyricStylePresets = (presets: LyricStylePreset[]): boolean => {
    try {
      localStorage.setItem(LYRIC_STYLE_PRESETS_KEY, JSON.stringify(presets));
      setLyricStylePresets(presets);
      return true;
    } catch {
      return false;
    }
  };

  const applyLyricStylePreset = (preset: LyricStylePreset) => {
    setLyricsFontSize(preset.lyricsFontSize);
    setLyricsFontFamily(preset.lyricsFontFamily);
    setLyricsColor(preset.lyricsColor);
    setLyricsHighlightColor(preset.lyricsHighlightColor);
    setLyricsPosition(preset.lyricsPosition);
    setLyricsHighlightStyle(preset.lyricsHighlightStyle);
    setLyricsPace(preset.lyricsPace);
    setLyricsLetterSpacing(preset.lyricsLetterSpacing);
    setLyricsBold(preset.lyricsBold);
    setLyricsItalic(preset.lyricsItalic);
    setLyricsOutline(preset.lyricsOutline);
    setLyricsGlow(preset.lyricsGlow);
    setLyricsDropShadow(preset.lyricsDropShadow);
    setLyricsHardShadow(preset.lyricsHardShadow);
    setLyricsNeon(preset.lyricsNeon);
    setLyrics3D(preset.lyrics3D);
    setLyricsGradient(preset.lyricsGradient);
    setLyricsStroke(preset.lyricsStroke);
    setLyricsUnderline(preset.lyricsUnderline);
    setLyricsStrikethrough(preset.lyricsStrikethrough);
    setLyricsUppercase(preset.lyricsUppercase);
    setLyricsSmallCaps(preset.lyricsSmallCaps);
    setLyricsBgPill(preset.lyricsBgPill);
    setLyricsSticker(preset.lyricsSticker);
    setLyricsComicPop(preset.lyricsComicPop);
    setLyricsSubtitleBar(preset.lyricsSubtitleBar);
    setLyricsPopActiveWord(preset.lyricsPopActiveWord);
    setLyricsPopIntensity(preset.lyricsPopIntensity);
    setLyricsPopAccentColor(preset.lyricsPopAccentColor);
    setLyricsBgColor(preset.lyricsBgColor ?? "#000000");
    setLyricsBgOpacity(preset.lyricsBgOpacity ?? 0.6);
    toast({ title: "Style applied", description: `"${preset.name}" preset applied.` });
  };

  const saveCurrentAsLyricStylePreset = () => {
    const name = savePresetName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give your preset a name.", variant: "destructive" });
      return;
    }
    const preset: LyricStylePreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      lyricsFontSize, lyricsFontFamily, lyricsColor, lyricsHighlightColor,
      lyricsPosition, lyricsHighlightStyle, lyricsPace, lyricsLetterSpacing,
      lyricsBold, lyricsItalic, lyricsOutline, lyricsGlow,
      lyricsDropShadow, lyricsHardShadow, lyricsNeon, lyrics3D,
      lyricsGradient, lyricsStroke, lyricsUnderline, lyricsStrikethrough,
      lyricsUppercase, lyricsSmallCaps, lyricsBgPill, lyricsSticker,
      lyricsComicPop, lyricsSubtitleBar, lyricsPopActiveWord, lyricsPopIntensity,
      lyricsPopAccentColor, lyricsBgColor, lyricsBgOpacity,
    };
    const updated = [preset, ...lyricStylePresets];
    if (persistLyricStylePresets(updated)) {
      setSavePresetName("");
      setSavePresetOpen(false);
      toast({ title: "Preset saved", description: `"${name}" saved to your style presets.` });
    } else {
      toast({ title: "Save failed", description: "Could not save the preset.", variant: "destructive" });
    }
  };

  const deleteLyricStylePreset = (id: string) => {
    const updated = lyricStylePresets.filter(p => p.id !== id);
    persistLyricStylePresets(updated);
  };


  const releaseBgVideo = () => {
    const v = bgVideoRef.current;
    if (v) {
      try { v.pause(); } catch { /* ignore */ }
      v.removeAttribute("src");
      try { v.load(); } catch { /* ignore */ }
    }
    bgVideoRef.current = null;
    bgVideoFileRef.current = null;
  };

  const bgUploadTokenRef = useRef(0);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = /^video\/(mp4|webm)$/i.test(file.type)
      || /\.(mp4|webm)$/i.test(file.name);
    // Block other video containers up-front so the user sees a clear error
    // here instead of a confusing failure during export.
    if (!isVideo && file.type.startsWith("video/")) {
      toast({
        title: "Unsupported video format",
        description: "Background videos must be MP4 or WebM.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    // Bump the upload token so any in-flight async load callback from a
    // previous upload knows it's stale and bails out before mutating state.
    const token = ++bgUploadTokenRef.current;

    // Release previous asset (image or video) before swapping in the new one.
    // Clear imgSrc immediately so a failed new upload can't leave a revoked
    // blob URL referenced in state (which would render as a broken preview).
    if (imgSrc) URL.revokeObjectURL(imgSrc);
    imgRef.current = null;
    releaseBgVideo();
    setBgIsVideo(false);
    setImgSrc(null);

    const url = URL.createObjectURL(file);

    if (isVideo) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.src = url;
      const onReady = () => {
        if (bgUploadTokenRef.current !== token) {
          // Newer upload superseded this one — discard.
          try { video.pause(); } catch { /* ignore */ }
          video.removeAttribute("src");
          try { video.load(); } catch { /* ignore */ }
          URL.revokeObjectURL(url);
          return;
        }
        bgVideoRef.current = video;
        bgVideoFileRef.current = file;
        setBgIsVideo(true);
        setImgSrc(url);
        // Match the export aspect to the uploaded background's aspect so
        // cover-fit produces no padding/cropping by default. User can still
        // override via the export-ratio dropdown afterwards.
        const matched = pickClosestRatio(video.videoWidth, video.videoHeight);
        setExportRatio(matched);
        // Reset fit mode to cover so a previous "contain" toggle doesn't
        // leak into the new upload and reintroduce side-bars.
        setBgFitMode("cover");
        // If audio is currently playing, kick the video off in sync.
        if (playing) {
          try { video.play().catch(() => {}); } catch { /* ignore */ }
        }
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.onerror = () => {
        if (bgUploadTokenRef.current !== token) return;
        URL.revokeObjectURL(url);
        toast({
          title: "Could not load video",
          description: "Please try a different MP4 or WebM file.",
          variant: "destructive",
        });
      };
    } else {
      const img = new window.Image();
      img.src = url;
      img.decode().then(() => {
        if (bgUploadTokenRef.current !== token) {
          URL.revokeObjectURL(url);
          return;
        }
        imgRef.current = img;
        setImgSrc(url);
        // Match the export aspect to the image so the export fills cleanly
        // without padding (same behavior as the video upload path above).
        const matched = pickClosestRatio(img.naturalWidth, img.naturalHeight);
        setExportRatio(matched);
        setBgFitMode("cover");
      }).catch(() => {
        if (bgUploadTokenRef.current !== token) return;
        imgRef.current = null;
        setImgSrc(null);
        URL.revokeObjectURL(url);
      });
    }
    e.target.value = "";
  };

  const extractSongInfo = (filename: string): { title: string; artist: string } => {
    let name = filename.replace(/\.[^/.]+$/, "");
    name = name.replace(/[\[\(].*?[\]\)]/g, "").trim();
    name = name.replace(/\s+/g, " ");

    const separators = [" - ", " – ", " — ", " _ "];
    for (const sep of separators) {
      const idx = name.indexOf(sep);
      if (idx > 0) {
        return {
          artist: name.substring(0, idx).trim(),
          title: name.substring(idx + sep.length).trim(),
        };
      }
    }
    return { title: name, artist: "" };
  };

  const setupAudioDuration = useCallback((audio: HTMLAudioElement) => {
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
        setTrimStart(0);
        setTrimEnd(Math.min(30, audio.duration));
      }
    };
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      onLoaded();
    } else {
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    }
  }, []);

  // Decode an animated GIF/WebP into ImageBitmap frames + per-frame durations
  // (seconds) using the WebCodecs ImageDecoder API. Falls back to a single
  // static bitmap when the format isn't an animation or the API isn't available.
  const decodeAnimatedImage = useCallback(async (file: File) => {
    interface DecodedImageFrame { image: VideoFrame; duration?: number | null }
    interface ImageTrack { frameCount: number }
    interface ImageDecoderInstance {
      tracks: { ready: Promise<void>; selectedTrack: ImageTrack | null };
      decode(opts: { frameIndex: number }): Promise<DecodedImageFrame>;
    }
    interface ImageDecoderCtor {
      new (init: { data: ArrayBuffer; type: string }): ImageDecoderInstance;
    }
    const buf = await file.arrayBuffer();
    const ID = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (typeof ID === "function") {
      try {
        const decoder = new ID({ data: buf, type: file.type || "image/gif" });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        const count = track?.frameCount ?? 1;
        const frames: ImageBitmap[] = [];
        const durations: number[] = [];
        for (let i = 0; i < count; i++) {
          const { image, duration } = await decoder.decode({ frameIndex: i });
          // duration is in microseconds; default to 100ms if missing.
          const durSec = typeof duration === "number" && duration > 0 ? duration / 1_000_000 : 0.1;
          const bmp = await createImageBitmap(image);
          frames.push(bmp);
          durations.push(durSec);
          image.close();
        }
        const total = durations.reduce((a, b) => a + b, 0);
        return { frames, durations, total };
      } catch {
        // Fall through to single-frame fallback below.
      }
    }
    const bmp = await createImageBitmap(new Blob([buf], { type: file.type || "image/gif" }));
    return { frames: [bmp], durations: [1], total: 1 };
  }, []);

  const handleGifUpload = useCallback(async (file: File) => {
    setGifLoading(true);
    try {
      // Release previous frames so we don't leak GPU memory across uploads.
      if (gifFramesRef.current) {
        for (const f of gifFramesRef.current.frames) {
          if (typeof f.close === "function") f.close();
        }
        gifFramesRef.current = null;
      }
      if (gifSrc && gifSrc.startsWith("blob:")) URL.revokeObjectURL(gifSrc);
      const decoded = await decodeAnimatedImage(file);
      gifFramesRef.current = decoded;
      setGifSrc(URL.createObjectURL(file));
      setGifName(file.name);
      toast({ title: "GIF loaded", description: `${decoded.frames.length} frame${decoded.frames.length === 1 ? "" : "s"}` });
    } catch (err) {
      console.error("GIF decode failed", err);
      toast({ title: "Could not load GIF", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setGifLoading(false);
    }
  }, [decodeAnimatedImage, gifSrc, toast]);

  const loadAudioSource = useCallback((opts: {
    src: string;
    name: string;
    file?: File | null;
    title?: string;
    artist?: string;
    keepLyrics?: boolean;
  }) => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
    }
    virtualClockRef.current = { time: 0, lastWall: 0, running: false };
    if (audioSrc && audioSrc.startsWith("blob:")) URL.revokeObjectURL(audioSrc);
    previewAudioCacheRef.current = null;

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
    }

    setAudioSrc(opts.src);
    setAudioName(opts.name);
    uploadedAudioFileRef.current = opts.file ?? null;

    if (!opts.keepLyrics) {
      setLyricsSegments([]);
      setManualLyrics("");
    }
    setTranscribeError(null);
    setDetectionStatus(null);

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = opts.src;
    audio.preload = "auto";
    audioRef.current = audio;
    setupAudioDuration(audio);

    if (opts.title !== undefined) setSongTitle(opts.title);
    if (opts.artist !== undefined) setSongArtist(opts.artist);

    realSongDurationRef.current = null;
    setLyricsMismatch(null);
  }, [playing, audioSrc, setupAudioDuration, toast]);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const songInfo = extractSongInfo(file.name);
    loadAudioSource({
      src: url,
      name: file.name,
      file,
      title: songInfo.title,
      artist: songInfo.artist,
    });
    e.target.value = "";
  };

  const translateLyrics = async () => {
    const text = manualLyrics.trim();
    if (!text || isTranslating) return;
    setIsTranslating(true);
    setTranslatedLyrics(null);

    try {
      const res = await fetch("/api/media/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, lang: translateLang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTranslatedLyrics(data?.message || "Translation failed. Please try again.");
        return;
      }
      if (data.translatedText) {
        setTranslatedLyrics(data.translatedText);
      } else {
        setTranslatedLyrics("Translation returned empty result.");
      }
    } catch {
      setTranslatedLyrics("Translation failed. Please try again.");
    } finally {
      setIsTranslating(false);
    }
  };

  const generateAiBackground = async () => {
    if (!aiImagePrompt.trim() || isGeneratingImage) return;
    setIsGeneratingImage(true);
    setAiImageError(null);

    try {
      const res = await fetch("/api/media/ai-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiImagePrompt.trim() }),
      });

      if (!res.ok) throw new Error("Image generation failed");

      const contentType = res.headers.get("content-type") || "";
      let imageUrl: string;

      if (contentType.includes("image")) {
        const blob = await res.blob();
        imageUrl = URL.createObjectURL(blob);
      } else {
        const data = await res.json();
        imageUrl = data.imageUrl;
        if (!imageUrl) throw new Error("No image returned");
      }

      if (imgSrc) URL.revokeObjectURL(imgSrc);
      releaseBgVideo();
      setBgIsVideo(false);
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imgRef.current = img;
        setImgSrc(imageUrl);
      };
      img.onerror = () => {
        setImgSrc(null);
      };
      img.src = imageUrl;
    } catch (err) {
      setAiImageError(err instanceof Error ? err.message : "Failed to generate AI background");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return false;

    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      sourceRef.current = null;
      analyserRef.current = null;
    }

    const ctx = audioCtxRef.current;

    if (!sourceRef.current) {
      sourceRef.current = ctx.createMediaElementSource(audio);
    }

    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
    }

    sourceRef.current.disconnect();
    sourceRef.current.connect(analyserRef.current);
    analyserRef.current.connect(ctx.destination);

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    return true;
  }, []);

  const clearImage = () => {
    if (imgSrc) URL.revokeObjectURL(imgSrc);
    imgRef.current = null;
    releaseBgVideo();
    setBgIsVideo(false);
    setImgSrc(null);
  };

  const handleAutoSync = async (
    opts: { silent?: boolean; segmentsOverride?: LyricSegment[] } = {},
  ) => {
    if (!audioSrc) return;
    // Snapshot the audio URL before any `await` so all async branches
    // reference the track that triggered this sync, not whatever is current
    // by the time they run (important for intro-info keying).
    const syncAudioSrc = audioSrc;
    const segmentsToUse = (opts.segmentsOverride && opts.segmentsOverride.length > 0)
      ? opts.segmentsOverride
      : fullSyncedSegments;
    if (segmentsToUse.length === 0) return;
    const silent = !!opts.silent;

    // Supersede any previous in-flight run: bump the token (so its setState
    // calls become no-ops) and abort its network request.
    const token = ++autoSyncTokenRef.current;
    syncRefineTokenRef.current++;
    if (autoSyncAbortRef.current) {
      try { autoSyncAbortRef.current.abort(); } catch {}
    }
    const abortCtrl = new AbortController();
    autoSyncAbortRef.current = abortCtrl;

    setIsRefiningSync(false);
    setIsAutoSyncing(true);
    setAutoSyncMessage(silent ? "Aligning lyrics to vocals\u2026" : null);

    // Token-aware setters so a stale auto-run can't overwrite UI state that a
    // newer run (or the user's manual edit) already updated.
    const guarded = <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => { if (token === autoSyncTokenRef.current) fn(...args); };
    const safeSetMessage = guarded(setAutoSyncMessage);
    const safeSetOffset = guarded(setLyricsOffset);
    const safeSetSegments = guarded(setLyricsSegments);
    const safeSetFullSegments = guarded(setFullSyncedSegments);
    const safeSetMismatch = guarded(setLyricsMismatch);
    const safeSetLineByLineSync = guarded(setLineByLineSync);
    const showToast = (...args: Parameters<typeof toast>) => {
      if (!silent) toast(...args);
    };

    try {
      const formData = new FormData();
      formData.append("lyrics", JSON.stringify(segmentsToUse));
      formData.append("isPreviewClip", "false");
      formData.append("gapThreshold", String(whisperGapThreshold));

      if (uploadedAudioFileRef.current) {
        formData.append("file", uploadedAudioFileRef.current);
      } else if (audioSrc && audioSrc.startsWith("blob:")) {
        try {
          const blobRes = await fetch(audioSrc);
          if (!blobRes.ok) throw new Error("Blob fetch failed");
          const blob = await blobRes.blob();
          formData.append("file", blob, "audio.mp3");
        } catch {
          safeSetMessage(silent ? "Couldn't reach audio to align lyrics — use the offset slider." : "Could not access audio source");
          showToast({ title: "Auto-Sync", description: "Could not access audio source", variant: "destructive" });
          if (token === autoSyncTokenRef.current) setIsAutoSyncing(false);
          return;
        }
      } else if (audioSrc) {
        formData.append("audioUrl", audioSrc);
      } else {
        safeSetMessage("No audio source available");
        showToast({ title: "Auto-Sync", description: "No audio source available", variant: "destructive" });
        if (token === autoSyncTokenRef.current) setIsAutoSyncing(false);
        return;
      }

      const data = await fetchAutoSyncSse(formData, (attempt, total) => {
        safeSetMessage(silent
          ? `Aligning lyrics to vocals\u2026 (retry ${attempt}/${total})`
          : `Retrying\u2026 (attempt ${attempt} of ${total})`);
      }, abortCtrl.signal) as Record<string, unknown>;

      // A newer alignment run started while this one was in-flight — bail.
      if (token !== autoSyncTokenRef.current) return;

      // Prefer real per-line forced alignment when the backend produced it.
      // This is the "real-time" path the user wants — every lyric line gets
      // its own start/end timestamp from whisper word timings, so the
      // lyrics follow the actual sung audio instead of relying on a single
      // global offset that drifts later in the song.
      if (Array.isArray(data.alignedSegments) && data.alignedSegments.length > 0) {
        const aligned = data.alignedSegments.filter((s: LyricSegment) =>
          s && typeof s.text === "string" && Number.isFinite(s.startTime) && Number.isFinite(s.endTime),
        );
        if (aligned.length > 0) {
          safeSetSegments(aligned);
          safeSetFullSegments(aligned);
          safeSetOffset(0);
          safeSetMismatch(null);
          setLyricsAreDistributed(false);
          // If the first aligned line starts after 0.5s, that's a detected intro
          const firstAlignedStart = aligned[0]?.startTime ?? 0;
          if (firstAlignedStart > 0.5) {
            const introSource = typeof data.source === "string" ? data.source as string : "whisper";
            const resolvedSource = introSource === "python" && data.pythonMethod === "whisper"
              ? "whisper"
              : introSource;
            setDetectedIntroInfo({ vocalOnset: firstAlignedStart, source: resolvedSource, audioSrc: syncAudioSrc });
            setIntroHintDismissed(false);
          }
          const matched = typeof data.matchedLineCount === "number" ? data.matchedLineCount : aligned.length;
          const total = typeof data.totalLineCount === "number" ? data.totalLineCount : aligned.length;
          safeSetLineByLineSync({ matched, total });
          safeSetMessage(silent
            ? `Aligned to vocals — matched ${matched} of ${total} lines.`
            : `Synced line-by-line — matched ${matched} of ${total} lines from the audio.`);
          showToast({
            title: "Auto-Sync Complete",
            description: `Line-by-line timing applied (${matched}/${total} lines matched).`,
          });
          return;
        }
      }

      if (data.lyricsMismatch) {
        const heard = (data.pythonTranscript || "").toString().trim();
        const firstLine = (data.firstLyricLine || "").toString().trim();
        const transcribed = Array.isArray(data.transcribedSegments) ? data.transcribedSegments : [];
        // Only the user-initiated (loud) path is allowed to swap fetched
        // lyrics for the audio transcript. Silent auto-runs must never
        // mutate lyric text content behind the user's back.
        if (!silent && transcribed.length > 0) {
          safeSetSegments(transcribed);
          safeSetFullSegments(transcribed);
          safeSetOffset(0);
          safeSetMismatch(null);
          safeSetLineByLineSync(null);
          safeSetMessage(`Used what we heard from the audio (${transcribed.length} lines).`);
          showToast({
            title: "Lyrics replaced with audio transcript",
            description: `The fetched lyrics didn't match. Showing what was actually sung instead (${transcribed.length} lines).`,
          });
          return;
        }
        if (silent) {
          // In silent (auto) mode we don't want to surface a heavy mismatch
          // dialog the user didn't ask for — and we must not overwrite the
          // provider lyrics. Just leave them alone with a soft note.
          safeSetMessage("Couldn't align lyrics to vocals — adjust offset manually or press Re-sync to vocals.");
        } else {
          safeSetMismatch({ heard, firstLyricLine: firstLine });
          safeSetMessage(null);
          showToast({
            title: "Lyrics may not match",
            description: "Auto-Sync skipped — the fetched lyrics don't match the audio.",
            variant: "destructive",
          });
        }
        return;
      }

      if (data.offset !== null && data.offset !== undefined) {
        safeSetMismatch(null);
        safeSetLineByLineSync(null);

        const vocalOnset = typeof data.firstVocalTime === "number" ? data.firstVocalTime as number : null;
        const shouldRedistribute = (data.redistribute === true || lyricsAreDistributedRef.current)
          && vocalOnset !== null && vocalOnset > 0.5;

        if (shouldRedistribute && vocalOnset !== null) {
          // Redistribute plain-distributed lyrics from the detected vocal onset
          // instead of applying a flat shift. A flat offset can't fix the fact
          // that every line's duration is wrong — only redistribution corrects
          // the full timeline from intro through the end of the song.
          const dur = audioRef.current?.duration ?? audioDuration;
          if (dur > vocalOnset + 1) {
            const texts = segmentsToUse.map(s => s.text);
            const redistributed = distributeLines(texts, dur, vocalOnset);
            safeSetSegments(redistributed);
            safeSetFullSegments(redistributed);
            safeSetOffset(0);
            setLyricsAreDistributed(false);
            // Persist onset + source so next plain-lyrics fetch pre-seeds distribution
            // and the dismissible hint can show source attribution.
            const introSource = typeof data.source === "string" ? data.source as string : "detected";
            const resolvedSource = introSource === "python" && data.pythonMethod === "whisper"
              ? "whisper"
              : introSource;
            setDetectedIntroInfo({ vocalOnset, source: resolvedSource, audioSrc: syncAudioSrc });
            setIntroHintDismissed(false);
            const mm = Math.floor(vocalOnset / 60);
            const ss = String((vocalOnset % 60).toFixed(1)).padStart(4, "0");
            const introMsg = `${vocalOnset.toFixed(1)}s intro detected — first lyric at ${mm}:${ss}.`;
            if (silent) {
              safeSetMessage(introMsg);
            } else {
              safeSetMessage(`Synced! ${introMsg}`);
            }
            showToast({
              title: "Auto-Sync Complete",
              description: `Detected ${vocalOnset.toFixed(1)}s intro. Lyrics redistributed from first vocal.`,
            });
            return;
          }
        }

        safeSetOffset(data.offset as number);
        // Sync ran successfully — the timing is now as good as we can get,
        // so clear the "estimated" badge regardless of whether redistribution
        // ran (covers songs where vocals start at t ≈ 0 and offset is small).
        setLyricsAreDistributed(false);
        // Persist onset + source if we have them (vocal onset ≤ 0.5s means
        // immediate vocals — no meaningful intro to remember).
        if (vocalOnset !== null && vocalOnset > 0.5) {
          const introSource = typeof data.source === "string" ? data.source as string : "detected";
          const resolvedSource = introSource === "python" && data.pythonMethod === "whisper"
            ? "whisper"
            : introSource;
          setDetectedIntroInfo({ vocalOnset, source: resolvedSource, audioSrc: syncAudioSrc });
        }
        if (silent) {
          const firstVocal = vocalOnset !== null
            ? ` — lyrics start at ${vocalOnset.toFixed(1)}s`
            : "";
          safeSetMessage(`Aligned to vocals (offset ${data.offset}s)${firstVocal}.`);
        } else {
          const details: string[] = [];
          if (vocalOnset !== null) {
            details.push(`vocal at ${vocalOnset.toFixed(1)}s`);
          }
          if (typeof data.source === "string") {
            const sourceLabel = data.source === "python" && data.pythonMethod === "whisper"
              ? "whisper"
              : data.source;
            details.push(`source: ${sourceLabel}`);
          }
          if (typeof data.pythonMatchedWord === "string" && data.pythonMatchedWord) {
            details.push(`matched "${data.pythonMatchedWord.trim()}"`);
          } else if (typeof data.pythonFirstWord === "string" && data.pythonFirstWord) {
            details.push(`first word "${data.pythonFirstWord.trim()}"`);
          }
          if (typeof data.acousticOnset === "number" && data.source !== "acoustic-fallback") {
            details.push(`first sound at ${data.acousticOnset.toFixed(1)}s`);
          }
          const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
          const noteStr = data.validationNote ? ` — ${data.validationNote}` : "";
          const transcriptStr = (typeof data.pythonTranscript === "string" && data.pythonTranscript)
            ? `\nHeard: "${data.pythonTranscript.slice(0, 120)}${data.pythonTranscript.length > 120 ? "…" : ""}"`
            : "";
          safeSetMessage(`Synced! Offset ${data.offset}s${detailStr}${noteStr}${transcriptStr}`);
        }
        showToast({ title: "Auto-Sync Complete", description: `Lyrics offset set to ${data.offset}s` });
      } else {
        safeSetLineByLineSync(null);
        const msg = typeof data.message === "string" ? data.message : "Could not auto-detect timing";
        if (silent) {
          safeSetMessage("Couldn't detect vocals — adjust the offset slider manually.");
        } else {
          const onsetStr = typeof data.acousticOnset === "number"
            ? ` (first sound detected at ${data.acousticOnset.toFixed(1)}s)`
            : "";
          safeSetMessage(`${msg}${onsetStr}`);
          showToast({ title: "Auto-Sync", description: msg, variant: "destructive" });
        }
      }
    } catch (err) {
      // Aborted by a newer run — leave UI alone, the new run owns it now.
      if ((err as { name?: string })?.name === "AbortError" || token !== autoSyncTokenRef.current) {
        return;
      }
      safeSetLineByLineSync(null);
      safeSetMessage(silent
        ? "Couldn't align lyrics to vocals — adjust offset manually."
        : "Auto-sync failed — use manual controls");
      showToast({ title: "Auto-Sync Failed", description: "Could not detect timing. Use manual controls to adjust.", variant: "destructive" });
    } finally {
      if (token === autoSyncTokenRef.current) {
        setIsAutoSyncing(false);
        autoSyncAbortRef.current = null;
      }
    }
  };

  const autoRefineSync = async (segments: LyricSegment[], file: File) => {
    const token = ++syncRefineTokenRef.current;
    setIsRefiningSync(true);
    setDetectionStatus("Refining timing to match your audio...");
    try {
      const formData = new FormData();
      formData.append("lyrics", JSON.stringify(segments));
      formData.append("isPreviewClip", "false");
      formData.append("gapThreshold", String(whisperGapThreshold));
      formData.append("file", file);

      const data = await fetchAutoSyncSse(formData, (attempt, total) => {
        if (token !== syncRefineTokenRef.current) return;
        setDetectionStatus(`Retrying\u2026 (attempt ${attempt} of ${total})`);
      }) as Record<string, unknown>;
      if (token !== syncRefineTokenRef.current) return;

      if (Array.isArray(data.alignedSegments) && data.alignedSegments.length > 0) {
        const aligned = data.alignedSegments.filter((s: LyricSegment) =>
          s && typeof s.text === "string" && Number.isFinite(s.startTime) && Number.isFinite(s.endTime),
        );
        if (aligned.length > 0) {
          setLyricsSegments(aligned);
          setFullSyncedSegments(aligned);
          setLyricsOffset(0);
          const matched = typeof data.matchedLineCount === "number" ? data.matchedLineCount : aligned.length;
          const total = typeof data.totalLineCount === "number" ? data.totalLineCount : aligned.length;
          setLineByLineSync({ matched, total });
          setDetectionStatus(`Line-by-line sync active — ${matched} of ${total} lines matched`);
          return;
        }
      }

      setLineByLineSync(null);
      if (typeof data.offset === "number") {
        setLyricsOffset(data.offset);
        setDetectionStatus(`Timing refined — offset ${data.offset.toFixed(1)}s`);
      } else {
        setDetectionStatus(null);
      }
    } catch {
      if (token === syncRefineTokenRef.current) setDetectionStatus(null);
    } finally {
      if (token === syncRefineTokenRef.current) setIsRefiningSync(false);
    }
  };

  const applyManualLyricsAndSync = async () => {
    const lines = manualLyrics.split("\n").filter(l => l.trim());
    if (lines.length === 0 || !audioSrc) return;

    const audio = audioRef.current;
    const dur = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 60;
    const perLine = dur / lines.length;

    const segments: LyricSegment[] = lines.map((text, i) => ({
      text: text.trim(),
      startTime: i * perLine,
      endTime: (i + 1) * perLine,
    }));

    setFullSyncedSegments(segments);
    setLyricsSegments(segments);
    setLyricsOffset(0);

    await handleAutoSync({ silent: true, segmentsOverride: segments });
  };

  // Called any time the user manually adjusts the timing offset (slider or ±
  // buttons). Updates the offset and re-tags the intro hint source as "manual"
  // so the UI shows the user that they're in control of the timing.
  const handleManualOffsetChange = (newOffset: number) => {
    setLyricsOffset(newOffset);
    setDetectedIntroInfo(prev => {
      if (!prev || !audioSrc || prev.audioSrc !== audioSrc) return prev;
      return { ...prev, source: "manual" };
    });
  };

  const clearAudio = () => {
    syncRefineTokenRef.current++;
    autoSyncTokenRef.current++;
    if (autoSyncAbortRef.current) {
      try { autoSyncAbortRef.current.abort(); } catch {}
      autoSyncAbortRef.current = null;
    }
    setIsAutoSyncing(false);
    setIsRefiningSync(false);
    lastActiveLyricIdxRef.current = -1;
    setActiveLyricIdx(-1);
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
    }
    if (rendering) renderCancelRef.current = true;
    if (audioSrc && audioSrc.startsWith("blob:")) URL.revokeObjectURL(audioSrc);
    previewAudioCacheRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      sourceRef.current = null;
      analyserRef.current = null;
    }
    audioRef.current = null;
    uploadedAudioFileRef.current = null;
    setAudioSrc(null);
    setAudioName("");
    setLyricsSegments([]);
    setManualLyrics("");
    setTranscribeError(null);
    setDetectionStatus(null);
    setTrimStart(0);
    setTrimEnd(0);
    setAudioDuration(0);
    // Clear intro memory — it's tied to the audio track we just discarded.
    setDetectedIntroInfo(null);
    setIntroHintDismissed(false);
    setLyricsAreDistributed(false);
  };

  const togglePlay = useCallback(() => {
    if (rendering) return;
    const audio = audioRef.current;
    if (audio && audioSrc) {
      if (playing) {
        audio.pause();
        setPlaying(false);
      } else {
        ensureAudioGraph();
        if (audio.currentTime < trimStartRef.current || audio.currentTime >= trimEndRef.current) {
          audio.currentTime = trimStartRef.current;
        }
        audio.play().then(() => setPlaying(true)).catch(() => {});
      }
      return;
    }
    if (!playableLyricsRef.current) return;
    const vc = virtualClockRef.current;
    if (playing) {
      vc.running = false;
      setPlaying(false);
    } else {
      const dur = virtualDurationRef.current;
      if (dur > 0 && vc.time >= dur - 0.05) vc.time = 0;
      vc.lastWall = performance.now();
      vc.running = true;
      setPlaying(true);
    }
  }, [playing, audioSrc, rendering, ensureAudioGraph]);

  // Keep the background video in sync with the audio: play/pause together,
  // and snap the video back to the equivalent looped offset whenever the user
  // scrubs the audio. The phase is relative to the trim-start so the live
  // preview matches the export, which loops bg frames by tInClip (frame 0 of
  // the export corresponds to phase 0 of the loop).
  const bgPhase = (audioCurrent: number, vdur: number): number => {
    const tInClip = audioCurrent - trimStartRef.current;
    return ((tInClip % vdur) + vdur) % vdur;
  };

  useEffect(() => {
    const video = bgVideoRef.current;
    if (!video || !bgIsVideo) return;
    if (playing) {
      const audio = audioRef.current;
      const vdur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (audio && vdur > 0) {
        const target = bgPhase(audio.currentTime, vdur);
        if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target;
      }
      video.play().catch(() => {});
    } else {
      try { video.pause(); } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, bgIsVideo]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = bgVideoRef.current;
    if (!audio || !video || !bgIsVideo) return;
    const onSeeked = () => {
      const vdur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      if (vdur <= 0) return;
      const target = bgPhase(audio.currentTime, vdur);
      if (Math.abs(video.currentTime - target) > 0.05) {
        try { video.currentTime = target; } catch { /* ignore */ }
      }
    };
    audio.addEventListener("seeked", onSeeked);
    return () => audio.removeEventListener("seeked", onSeeked);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgIsVideo, audioSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      setPlaying(false);
    };
    const onTimeUpdate = () => {
      const trimNarrowed =
        trimStartRef.current > 0.05 ||
        (Number.isFinite(audio.duration) && trimEndRef.current < audio.duration - 0.05);
      if (trimNarrowed && audio.currentTime >= trimEndRef.current) {
        audio.currentTime = trimStartRef.current;
      }
      const segs = lyricsSegmentsRef.current;
      if (segs.length > 0) {
        const adjustedTime = audio.currentTime + lyricsOffsetRef.current;
        const idx = segs.findIndex(s => adjustedTime >= s.startTime && adjustedTime < s.endTime);
        if (idx !== lastActiveLyricIdxRef.current) {
          lastActiveLyricIdxRef.current = idx;
          setActiveLyricIdx(idx);
        }
      }
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
  });

  const applyTranscriptionResult = async (data: {
    songTitle?: string | null;
    songArtist?: string | null;
    segments?: LyricSegment[];
    message?: string;
    reason?: string;
    source?: string;
  }): Promise<boolean> => {
    if (data.songTitle) setSongTitle(data.songTitle);
    if (data.songArtist) setSongArtist(data.songArtist);

    if (data.segments && data.segments.length > 0) {
      setLyricsSegments(data.segments);
      setFullSyncedSegments(data.segments);
      setManualLyrics(data.segments.map((s: LyricSegment) => s.text).join("\n"));
      setWhisperNote(data.source === "whisper");
      setDetectionStatus(data.songTitle ? `Transcribed "${data.songTitle}" — refining timing...` : "Transcription complete — refining timing...");
      const file = uploadedAudioFileRef.current;
      if (file) {
        void autoRefineSync(data.segments, file);
      } else {
        setDetectionStatus(data.songTitle ? `Transcribed "${data.songTitle}"` : "Transcription complete");
      }
      return true;
    }

    if (data.reason === "quota_exceeded") {
      setTranscribeError("AI quota limit reached — paste your lyrics and use Apply & Auto-Sync, or click Fetch Lyrics.");
    } else {
      setTranscribeError(data.message || "No speech detected — paste your lyrics and use Apply & Auto-Sync");
    }
    setDetectionStatus(null);
    return false;
  };

  const handleTranscribe = async () => {
    if (!uploadedAudioFileRef.current || isTranscribing) return;
    setIsTranscribing(true);
    setTranscribeError(null);
    setDetectionStatus("Transcribing audio with AI...");

    try {
      const formData = new FormData();
      formData.append("file", uploadedAudioFileRef.current);
      formData.append("gapThreshold", String(whisperGapThreshold));

      const rawData = await fetchTranscribeSse(formData, (attempt, total) => {
        setDetectionStatus(`Retrying\u2026 (attempt ${attempt} of ${total})`);
      });
      await applyTranscriptionResult(rawData as Parameters<typeof applyTranscriptionResult>[0]);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Transcription failed");
      setDetectionStatus(null);
    } finally {
      setIsTranscribing(false);
    }
  };

  const distributeLines = (lines: string[], dur: number, introTime = 0): LyricSegment[] => {
    const effective = Math.max(1, dur - introTime);
    const segDuration = effective / lines.length;
    const newSegments: LyricSegment[] = lines.map((text: string, i: number) => ({
      text: text.trim(),
      startTime: introTime + i * segDuration,
      endTime: introTime + (i + 1) * segDuration,
    }));
    setLyricsSegments(newSegments);
    return newSegments;
  };

  const distributeWhenReady = (
    lines: string[],
    onDistributed?: (segments: LyricSegment[]) => void,
    introTime = 0,
  ) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      const segs = distributeLines(lines, audio.duration, introTime);
      onDistributed?.(segs);
    } else if (audio) {
      const onMeta = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          const segs = distributeLines(lines, audio.duration, introTime);
          onDistributed?.(segs);
        }
        audio.removeEventListener("loadedmetadata", onMeta);
      };
      audio.addEventListener("loadedmetadata", onMeta);
    }
  };


  const applySyncedLyricsResponse = (data: any) => {
    setLyricsMismatch(null);
    if (typeof data.source === "string") setLyricsSource(data.source);
    if (data.synced && data.segments) {
      const allText = data.segments.map((s: LyricSegment) => s.text).join("\n");
      setManualLyrics(allText);
      setFullSyncedSegments(data.segments);
      setLyricsSegments(data.segments);
      setLyricsAreDistributed(false);
      setLyricsOffset(0);
      return true;
    }

    const plainText = data.plainLyrics;
    if (plainText) {
      setManualLyrics(plainText);
      const allLines = plainText.split("\n").filter((l: string) => l.trim());
      if (allLines.length === 0) return true;

      setLyricsOffset(0);
      // Mark as distributed so the auto-sync handler can redistribute from the
      // real vocal onset instead of applying a flat offset.
      setLyricsAreDistributed(true);
      // Reset the dismiss flag so the intro hint shows again for the new song.
      setIntroHintDismissed(false);

      // If a prior sync for THIS SAME audio track already detected an intro,
      // pre-seed the initial distribution from that vocal onset so the first
      // lyric doesn't appear at t=0 even before auto-sync runs. We check the
      // audioSrc key to ensure we never bleed a previous song's intro into a
      // different track (e.g. load Song A (long intro), then load Song B with
      // immediate vocals — Song B should start at t=0).
      const priorInfo = detectedIntroInfoRef.current;
      const priorIntro = (priorInfo && priorInfo.audioSrc === audioSrc)
        ? priorInfo.vocalOnset
        : 0;

      // Distribute the plain lines evenly (from any known intro offset), then
      // (once we know the audio duration) silently align them to the actual
      // vocal onsets so the highlight starts when the singer does. We seed
      // fullSyncedSegments with the distributed segments so the offset/status
      // UI is visible immediately even if the alignment endpoint only returns a
      // global offset rather than per-line aligned segments.
      distributeWhenReady(allLines, (segs) => {
        setFullSyncedSegments(segs);
        if (audioSrc && segs.length > 0) {
          void handleAutoSync({ silent: true, segmentsOverride: segs });
        }
      }, priorIntro);
      return true;
    }

    return false;
  };

  const fetchLyricsFromAPI = async () => {
    if (!songTitle.trim() || isFetchingLyrics) return;
    if (!audioRef.current && playing) setPlaying(false);
    virtualClockRef.current = { time: 0, lastWall: 0, running: false };
    setIsFetchingLyrics(true);
    setLyricsSource(null);
    setTranscribeError(null);

    try {
      const params = new URLSearchParams({ title: songTitle.trim() });
      if (songArtist.trim()) params.set("artist", songArtist.trim());
      const dur = realSongDurationRef.current ?? (audioDuration > 60 ? audioDuration : null);
      if (dur && dur > 60) params.set("duration", String(Math.round(dur)));

      const syncedRes = await fetch(`/api/media/lyrics-synced?${params.toString()}`);

      if (syncedRes.ok) {
        const data = await syncedRes.json();
        if (applySyncedLyricsResponse(data)) {
          // Lyrics loaded — kick off vocal-onset alignment in the background so
          // the highlighter follows the singer instead of starting on the first
          // beat of the intro. Only fires when we have audio + per-line synced
          // segments to align (the plain-text path does its own distribution
          // and the user can press the Re-sync button when ready).
          if (audioSrc && data?.synced && Array.isArray(data?.segments) && data.segments.length > 0) {
            void handleAutoSync({ silent: true, segmentsOverride: data.segments as LyricSegment[] });
          }
          return;
        }
      }

      setTranscribeError("No lyrics found. Try a different title or spelling.");
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Failed to fetch lyrics");
    } finally {
      setIsFetchingLyrics(false);
    }
  };

  // Note: lyrics fetching and AI vocal-onset detection are no longer triggered
  // automatically when audio is uploaded. The user must click "Fetch Lyrics"
  // (or use AI Transcribe) to start either flow explicitly.


  const clearLyrics = () => {
    syncRefineTokenRef.current++;
    autoSyncTokenRef.current++;
    if (autoSyncAbortRef.current) {
      try { autoSyncAbortRef.current.abort(); } catch {}
      autoSyncAbortRef.current = null;
    }
    setIsAutoSyncing(false);
    setIsRefiningSync(false);
    lastActiveLyricIdxRef.current = -1;
    setActiveLyricIdx(-1);
    if (!audioRef.current && playing) setPlaying(false);
    virtualClockRef.current = { time: 0, lastWall: 0, running: false };
    setLyricsSegments([]);
    setManualLyrics("");
    setTranscribeError(null);
    setWhisperNote(false);
    setDetectionStatus(null);
    setLyricsOffset(0);
    setLyricsPace(1);
    setFullSyncedSegments([]);
    setLyricsMismatch(null);
    setAutoSyncMessage(null);
    setLineByLineSync(null);
    setLyricsSource(null);
  };

  const drawScene = useCallback((
    target: HTMLCanvasElement,
    freqData: Uint8Array,
    timeData: Uint8Array,
    audioTime: number,
    sceneTime: number,
    showSelection: boolean,
    sceneState: SceneState,
    exportImg?: HTMLImageElement | HTMLVideoElement | null,
  ) => {
    const ctx = target.getContext("2d");
    if (!ctx) return;

    const W = target.width;
    const H = target.height;

    const vc: DrawVisConfig = {
      visStyle, color, intensity, visSize, position,
      visOffsetX, visOffsetY, visScaleW, visScaleH,
    };
    const lc: DrawLyricsConfig = {
      segments: lyricsSegmentsRef.current,
      fontSize: lyricsFontSizeRef.current,
      color: lyricsColorRef.current,
      highlightColor: lyricsHighlightColorRef.current,
      position: lyricsPositionRef.current,
      fontFamily: lyricsFontFamilyRef.current,
      bold: lyricsBoldRef.current,
      italic: lyricsItalicRef.current,
      outline: lyricsOutlineRef.current,
      glow: lyricsGlowRef.current,
      autoEmoji: autoEmojiRef.current,
      offset: lyricsOffsetRef.current,
      pace: lyricsPaceRef.current,
      highlightStyle: lyricsHighlightStyleRef.current,
      dropShadow: lyricsDropShadowRef.current,
      hardShadow: lyricsHardShadowRef.current,
      neon: lyricsNeonRef.current,
      threeD: lyrics3DRef.current,
      gradient: lyricsGradientRef.current,
      stroke: lyricsStrokeRef.current,
      underline: lyricsUnderlineRef.current,
      strikethrough: lyricsStrikethroughRef.current,
      uppercase: lyricsUppercaseRef.current,
      smallCaps: lyricsSmallCapsRef.current,
      bgPill: lyricsBgPillRef.current,
      sticker: lyricsStickerRef.current,
      comicPop: lyricsComicPopRef.current,
      subtitleBar: lyricsSubtitleBarRef.current,
      popActiveWord: lyricsPopActiveWordRef.current,
      popIntensity: lyricsPopIntensityRef.current,
      popAccentColor: lyricsPopAccentColorRef.current,
      letterSpacing: lyricsLetterSpacingRef.current,
      bgColor: lyricsBgColorRef.current,
      bgOpacity: lyricsBgOpacityRef.current,
      offsetX: lyricsOffsetXRef.current,
      offsetY: lyricsOffsetYRef.current,
      scale: lyricsScaleRef.current,
    };

    // Background priority: explicit override (export preview) > video > image.
    const bgImg = exportImg !== undefined
      ? exportImg
      : (bgVideoRef.current ?? imgRef.current);

    // Pick the current GIF frame (if the GIF style is active and we have
    // decoded frames) based on the audio playhead so the visualizer loops
    // through frames at the rate dictated by the GIF's own timing.
    const gifFrame = (() => {
      if (vc.visStyle !== "gif") return null;
      const data = gifFramesRef.current;
      if (!data || data.frames.length === 0 || data.total <= 0) return null;
      let t = audioTime;
      // Wrap into [0, total) so the loop continues even before/after audio.
      t = ((t % data.total) + data.total) % data.total;
      let acc = 0;
      for (let i = 0; i < data.durations.length; i++) {
        acc += data.durations[i];
        if (t < acc) return data.frames[i];
      }
      return data.frames[data.frames.length - 1];
    })();

    // drawScene draws the lyrics block internally and returns the actual
    // rendered bounds (or null when no lyrics are present). We stash those
    // bounds for hit testing on the next mouse event so drag/resize stays
    // pixel-accurate to what the user sees, with no duplicated geometry.
    const renderedLyricsBounds = drawSceneShared(
      ctx, W, H, freqData, timeData, audioTime, sceneTime, sceneState, bgImg, vc, lc, gifFrame,
      { offsetX: bgOffsetX, offsetY: bgOffsetY, scale: bgScale, fitMode: bgFitMode },
    );
    lyricsBoundsRef.current = renderedLyricsBounds;
    // Test-only side channel: e2e tests need to know the live lyrics bounds
    // (which depend on font metrics + canvas size) so they can simulate a
    // drag that actually lands inside the overlay's hit box. Gated to dev
    // mode so production bundles don't pollute window with internal geometry.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as unknown as { __lyricsBounds?: typeof renderedLyricsBounds }).__lyricsBounds = renderedLyricsBounds;
    }

    if (showSelection) {
      const defaultPosYB = position === "top" ? -H * 0.3 : position === "bottom" ? H * 0.3 : 0;
      const oYB = visOffsetY !== null ? visOffsetY : defaultPosYB;
      const sizeMulB = visSize / 50;
      let bx: number, by: number, bw: number, bh: number;
      if (visStyle === "bars") {
        bw = W * 0.8 * sizeMulB * visScaleW;
        bh = H * 0.5 * sizeMulB * visScaleH;
        bx = (W - bw) / 2 + visOffsetX;
        by = H * 0.5 + oYB + H * 0.25 * visScaleH - bh;
      } else if (visStyle === "circular" || visStyle === "pulse" || visStyle === "particles" || visStyle === "galaxy" || visStyle === "turntable" || visStyle === "dancer") {
        const rad = Math.min(W, H) * 0.4 * sizeMulB * Math.min(visScaleW, visScaleH);
        bw = rad * 2; bh = rad * 2;
        bx = W / 2 + visOffsetX - rad;
        by = H / 2 + oYB - rad;
      } else if (visStyle === "djbooth") {
        bw = W * 0.7 * sizeMulB * visScaleW;
        bh = H * 0.5 * sizeMulB * visScaleH;
        bx = W / 2 + visOffsetX - bw / 2;
        by = H / 2 + oYB - bh / 2;
      } else if (visStyle === "waterfall") {
        bw = W * 0.8 * sizeMulB * visScaleW;
        bh = H * 0.6 * visScaleH;
        bx = (W - bw) / 2 + visOffsetX;
        by = H * 0.2 + oYB;
      } else if (visStyle === "helix") {
        bw = W * 0.7 * sizeMulB * visScaleW;
        bh = H * 0.5 * sizeMulB * visScaleH;
        bx = (W - bw) / 2 + visOffsetX;
        by = H / 2 + oYB - bh / 2;
      } else if (visStyle === "gif") {
        bw = W * 0.5 * sizeMulB * visScaleW;
        bh = H * 0.5 * sizeMulB * visScaleH;
        bx = W / 2 + visOffsetX - bw / 2;
        by = H / 2 + oYB - bh / 2;
      } else {
        bw = W * 0.8 * sizeMulB * visScaleW;
        bh = H * 0.5 * sizeMulB * visScaleH;
        bx = (W - bw) / 2 + visOffsetX;
        by = H / 2 + oYB - bh / 2;
      }
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
      const hs = 8;
      const corners = [
        { x: bx, y: by }, { x: bx + bw, y: by },
        { x: bx, y: by + bh }, { x: bx + bw, y: by + bh },
      ];
      for (const c of corners) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        ctx.strokeStyle = "rgba(99,102,241,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
      }
      ctx.restore();
    }

    // Background selection box: only shown when the user is hovering near a
    // bg corner handle or actively dragging/resizing the background, and only
    // when a background is loaded. Drawn before the lyrics box so lyrics
    // handles stay on top when both overlap at the canvas corners.
    const showBgSel = !rendering && (bgIsVideo || imgSrc !== null)
      && (isBgHovered || isDraggingBg.current || !!isResizingBg.current);
    if (showBgSel) {
      const inset = 12;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      ctx.setLineDash([]);
      const hs = 8;
      const corners = [
        { x: inset, y: inset }, { x: W - inset, y: inset },
        { x: inset, y: H - inset }, { x: W - inset, y: H - inset },
      ];
      for (const c of corners) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        ctx.strokeStyle = "rgba(34,197,94,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
      }
      ctx.restore();
    }

    // Lyrics selection box (only when not exporting and the user is hovering
    // or actively dragging/resizing the lyrics block).
    const showLyricsSel = !rendering && lyricsBoundsRef.current !== null
      && (isLyricsHovered || isDraggingLyrics.current || !!isResizingLyrics.current);
    if (showLyricsSel) {
      const lb = lyricsBoundsRef.current!;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(lb.x, lb.y, lb.w, lb.h);
      ctx.setLineDash([]);
      const hs = 8;
      const corners = [
        { x: lb.x, y: lb.y }, { x: lb.x + lb.w, y: lb.y },
        { x: lb.x, y: lb.y + lb.h }, { x: lb.x + lb.w, y: lb.y + lb.h },
      ];
      for (const c of corners) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        ctx.strokeStyle = "rgba(99,102,241,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
      }
      ctx.restore();
    }
  }, [visStyle, color, intensity, visSize, position, visOffsetX, visOffsetY, visScaleW, visScaleH, rendering, isLyricsHovered, bgOffsetX, bgOffsetY, bgScale, bgFitMode, bgIsVideo, imgSrc, isBgHovered]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const analyser = analyserRef.current;
    let freqData: Uint8Array, timeData: Uint8Array;
    if (analyser) {
      const bufLen = analyser.frequencyBinCount;
      const freqBuf = new Uint8Array(new ArrayBuffer(bufLen));
      const timeBuf = new Uint8Array(new ArrayBuffer(bufLen));
      analyser.getByteFrequencyData(freqBuf);
      analyser.getByteTimeDomainData(timeBuf);
      freqData = freqBuf;
      timeData = timeBuf;
    } else {
      freqData = new Uint8Array(0);
      timeData = new Uint8Array(0);
    }
    const audio = audioRef.current;
    let audioTime: number;
    let displayDuration: number;
    if (audio && audio.src) {
      audioTime = audio.currentTime;
      displayDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    } else {
      const vc = virtualClockRef.current;
      let wrapped = false;
      if (vc.running) {
        const now = performance.now();
        const dt = vc.lastWall ? Math.min(0.25, (now - vc.lastWall) / 1000) : 0;
        vc.time += dt;
        vc.lastWall = now;
        const vdur = virtualDurationRef.current;
        if (vdur > 0 && vc.time >= vdur) {
          vc.time = 0;
          wrapped = true;
        }
      }
      audioTime = vc.time;
      displayDuration = virtualDurationRef.current;
      const segs = lyricsSegmentsRef.current;
      if (segs.length > 0) {
        const adjustedTime = audioTime + lyricsOffsetRef.current;
        const idx = segs.findIndex(s => adjustedTime >= s.startTime && adjustedTime < s.endTime);
        if (idx !== lastActiveLyricIdxRef.current || wrapped) {
          lastActiveLyricIdxRef.current = idx;
          setActiveLyricIdx(idx);
        }
      }
    }
    const showSelection = !rendering && (isVisHovered || isDraggingVis.current || !!isResizingVis.current);
    drawScene(canvas, freqData, timeData, audioTime, performance.now() * 0.001, showSelection, {
      waterfall: waterfallBuf.current,
      particles: particlesRef.current,
      galaxyAngle: galaxyAngleRef,
      turntableAngle: turntableAngleRef,
      turntableAngleR: turntableAngleRRef,
      dancerBeat: dancerBeatRef,
      djFader: djFaderRef,
    });

    const duration = displayDuration;
    const pct = duration > 0 ? Math.min(100, Math.max(0, (audioTime / duration) * 100)) : 0;
    if (scrubFillRef.current) scrubFillRef.current.style.width = `${pct}%`;
    if (scrubHandleRef.current) scrubHandleRef.current.style.left = `${pct}%`;
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = duration > 0 ? `${formatReadout(audioTime)} / ${formatReadout(duration)}` : "";
    }
    if (currentLyricElemRef.current) {
      const segs = lyricsSegmentsRef.current;
      if (segs.length > 0) {
        const adj = audioTime + lyricsOffsetRef.current;
        const active = segs.find(s => adj >= s.startTime && adj < s.endTime);
        currentLyricElemRef.current.textContent = active ? active.text : "";
        currentLyricElemRef.current.style.opacity = active ? "1" : "0.35";
      } else {
        currentLyricElemRef.current.textContent = "";
      }
    }
  }, [drawScene, rendering, isVisHovered]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const handleSize = 14;
  const getVisBounds = useCallback(() => {
    const canvas = canvasRef.current;
    const W = canvas ? canvas.width : CANVAS_W;
    const H = canvas ? canvas.height : CANVAS_H;
    const sizeMul = visSize / 50;
    const defaultPosY = position === "top" ? -H * 0.3 : position === "bottom" ? H * 0.3 : 0;
    const oY = visOffsetY !== null ? visOffsetY : defaultPosY;
    let bW: number, bH: number, bx: number, by: number;
    if (visStyle === "bars") {
      bW = W * 0.8 * sizeMul * visScaleW;
      bH = H * 0.5 * sizeMul * visScaleH;
      bx = (W - bW) / 2 + visOffsetX;
      by = H * 0.5 + oY + H * 0.25 * visScaleH - bH;
    } else if (visStyle === "circular" || visStyle === "pulse" || visStyle === "particles" || visStyle === "galaxy" || visStyle === "turntable" || visStyle === "dancer") {
      const rad = Math.min(W, H) * 0.4 * sizeMul * Math.min(visScaleW, visScaleH);
      bW = rad * 2;
      bH = rad * 2;
      bx = W / 2 + visOffsetX - rad;
      by = H / 2 + oY - rad;
    } else if (visStyle === "djbooth") {
      bW = W * 0.7 * sizeMul * visScaleW;
      bH = H * 0.5 * sizeMul * visScaleH;
      bx = W / 2 + visOffsetX - bW / 2;
      by = H / 2 + oY - bH / 2;
    } else if (visStyle === "waterfall") {
      bW = W * 0.8 * sizeMul * visScaleW;
      bH = H * 0.6 * visScaleH;
      bx = (W - bW) / 2 + visOffsetX;
      by = H * 0.2 + oY;
    } else if (visStyle === "helix") {
      bW = W * 0.7 * sizeMul * visScaleW;
      bH = H * 0.5 * sizeMul * visScaleH;
      bx = (W - bW) / 2 + visOffsetX;
      by = H / 2 + oY - bH / 2;
    } else if (visStyle === "gif") {
      bW = W * 0.5 * sizeMul * visScaleW;
      bH = H * 0.5 * sizeMul * visScaleH;
      bx = W / 2 + visOffsetX - bW / 2;
      by = H / 2 + oY - bH / 2;
    } else {
      bW = W * 0.8 * sizeMul * visScaleW;
      bH = H * 0.5 * sizeMul * visScaleH;
      bx = (W - bW) / 2 + visOffsetX;
      by = H / 2 + oY - bH / 2;
    }
    return { x: bx, y: by, w: bW, h: bH };
  }, [visStyle, visSize, position, visOffsetX, visOffsetY, visScaleW, visScaleH]);

  const hitCorner = useCallback((cx: number, cy: number) => {
    const b = getVisBounds();
    const hs = handleSize;
    const corners = [
      { id: "tl", x: b.x, y: b.y },
      { id: "tr", x: b.x + b.w, y: b.y },
      { id: "bl", x: b.x, y: b.y + b.h },
      { id: "br", x: b.x + b.w, y: b.y + b.h },
    ];
    for (const c of corners) {
      if (Math.abs(cx - c.x) < hs && Math.abs(cy - c.y) < hs) return c.id;
    }
    return null;
  }, [getVisBounds]);

  const hitInsideBounds = useCallback((cx: number, cy: number) => {
    const b = getVisBounds();
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }, [getVisBounds]);

  // ─── Lyrics hit testing (uses bounds last published by render loop) ───
  const hitLyricsCorner = useCallback((cx: number, cy: number) => {
    const b = lyricsBoundsRef.current;
    if (!b) return null;
    const hs = handleSize;
    const corners = [
      { id: "tl", x: b.x, y: b.y },
      { id: "tr", x: b.x + b.w, y: b.y },
      { id: "bl", x: b.x, y: b.y + b.h },
      { id: "br", x: b.x + b.w, y: b.y + b.h },
    ];
    for (const c of corners) {
      if (Math.abs(cx - c.x) < hs && Math.abs(cy - c.y) < hs) return c.id;
    }
    return null;
  }, []);

  const hitInsideLyrics = useCallback((cx: number, cy: number) => {
    const b = lyricsBoundsRef.current;
    if (!b) return false;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }, []);

  // ─── Background hit testing ────────────────────────────────────────────
  // The background always fills the entire canvas, so its "bounds" are the
  // canvas rect itself. Corner handles are drawn inset a few px from each
  // corner so they don't sit underneath the screen edge.
  const bgHandleInset = 12;
  const hasBg = useCallback(() => bgIsVideo || imgSrc !== null, [bgIsVideo, imgSrc]);
  const getBgBounds = useCallback(() => {
    const canvas = canvasRef.current;
    const W = canvas ? canvas.width : CANVAS_W;
    const H = canvas ? canvas.height : CANVAS_H;
    return { x: 0, y: 0, w: W, h: H };
  }, []);
  const hitBgCorner = useCallback((cx: number, cy: number) => {
    if (!hasBg()) return null;
    const b = getBgBounds();
    const inset = bgHandleInset;
    const hs = handleSize;
    const corners = [
      { id: "tl", x: b.x + inset, y: b.y + inset },
      { id: "tr", x: b.x + b.w - inset, y: b.y + inset },
      { id: "bl", x: b.x + inset, y: b.y + b.h - inset },
      { id: "br", x: b.x + b.w - inset, y: b.y + b.h - inset },
    ];
    for (const c of corners) {
      if (Math.abs(cx - c.x) < hs && Math.abs(cy - c.y) < hs) return c.id;
    }
    return null;
  }, [getBgBounds, hasBg]);
  const hitInsideBg = useCallback((cx: number, cy: number) => {
    if (!hasBg()) return false;
    const b = getBgBounds();
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  }, [getBgBounds, hasBg]);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    // Visualizer interactions take precedence over lyrics so the user can
    // still grab the visualizer when it overlaps the lyrics block.
    const visCorner = hitCorner(x, y);
    if (visCorner) {
      isResizingVis.current = visCorner;
      resizeStartPos.current = { x, y };
      resizeStartScale.current = { w: visScaleW, h: visScaleH };
      e.preventDefault();
      return;
    }
    if (hitInsideBounds(x, y)) {
      isDraggingVis.current = true;
      dragStartPos.current = { x, y };
      const cvs = canvasRef.current;
      const cvH = cvs ? cvs.height : CANVAS_H;
      dragStartOffset.current = { x: visOffsetX, y: visOffsetY !== null ? visOffsetY : (position === "top" ? -cvH * 0.3 : position === "bottom" ? cvH * 0.3 : 0) };
      e.preventDefault();
      return;
    }
    // Lyrics interactions
    const lyrCorner = hitLyricsCorner(x, y);
    if (lyrCorner) {
      isResizingLyrics.current = lyrCorner;
      resizeStartPos.current = { x, y };
      resizeStartLyricsScale.current = lyricsScale;
      const b = lyricsBoundsRef.current;
      if (b) resizeStartLyricsCenter.current = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      e.preventDefault();
      return;
    }
    if (hitInsideLyrics(x, y)) {
      isDraggingLyrics.current = true;
      dragStartPos.current = { x, y };
      dragStartLyricsOffset.current = { x: lyricsOffsetX, y: lyricsOffsetY };
      e.preventDefault();
      return;
    }
    // Background interactions are last so visualizer / lyrics always win
    // when they overlap (the bg covers the whole canvas).
    const bgCorner = hitBgCorner(x, y);
    if (bgCorner) {
      isResizingBg.current = bgCorner;
      resizeStartPos.current = { x, y };
      resizeStartBgScale.current = bgScale;
      const b = getBgBounds();
      resizeStartBgCenter.current = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      e.preventDefault();
      return;
    }
    if (hitInsideBg(x, y)) {
      isDraggingBg.current = true;
      dragStartPos.current = { x, y };
      dragStartBgOffset.current = { x: bgOffsetX, y: bgOffsetY };
      e.preventDefault();
    }
  }, [getCanvasCoords, hitCorner, hitInsideBounds, hitLyricsCorner, hitInsideLyrics, hitBgCorner, hitInsideBg, getBgBounds, visOffsetX, visOffsetY, visScaleW, visScaleH, position, lyricsOffsetX, lyricsOffsetY, lyricsScale, bgOffsetX, bgOffsetY, bgScale]);

  const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    if (isDraggingVis.current) {
      setVisOffsetX(dragStartOffset.current.x + (x - dragStartPos.current.x));
      setVisOffsetY(dragStartOffset.current.y + (y - dragStartPos.current.y));
      userMovedVisRef.current = true;
      return;
    }
    if (isResizingVis.current) {
      const dx = x - resizeStartPos.current.x;
      const dy = y - resizeStartPos.current.y;
      const corner = isResizingVis.current;
      let newW = resizeStartScale.current.w;
      let newH = resizeStartScale.current.h;
      const cvW = canvasRef.current ? canvasRef.current.width : CANVAS_W;
      const sens = 1 / (cvW * 0.4);
      if (corner.includes("r")) newW += dx * sens;
      if (corner.includes("l")) newW -= dx * sens;
      if (corner.includes("b")) newH += dy * sens;
      if (corner.includes("t")) newH -= dy * sens;
      setVisScaleW(Math.max(0.2, Math.min(3, newW)));
      setVisScaleH(Math.max(0.2, Math.min(3, newH)));
      userMovedVisRef.current = true;
      return;
    }
    if (isDraggingLyrics.current) {
      setLyricsOffsetX(dragStartLyricsOffset.current.x + (x - dragStartPos.current.x));
      setLyricsOffsetY(dragStartLyricsOffset.current.y + (y - dragStartPos.current.y));
      return;
    }
    if (isResizingLyrics.current) {
      // Use the diagonal distance from the bounds center to the cursor,
      // normalized against the start distance, as a uniform scale factor.
      const c = resizeStartLyricsCenter.current;
      const startDist = Math.hypot(resizeStartPos.current.x - c.x, resizeStartPos.current.y - c.y);
      const curDist = Math.hypot(x - c.x, y - c.y);
      if (startDist > 4) {
        const ratio = curDist / startDist;
        const next = resizeStartLyricsScale.current * ratio;
        setLyricsScale(Math.max(0.3, Math.min(3, next)));
      }
      return;
    }
    if (isDraggingBg.current) {
      setBgOffsetX(dragStartBgOffset.current.x + (x - dragStartPos.current.x));
      setBgOffsetY(dragStartBgOffset.current.y + (y - dragStartPos.current.y));
      return;
    }
    if (isResizingBg.current) {
      // Same diagonal-distance scaling as lyrics resize: gives uniform zoom
      // around the canvas center regardless of which corner is grabbed.
      const c = resizeStartBgCenter.current;
      const startDist = Math.hypot(resizeStartPos.current.x - c.x, resizeStartPos.current.y - c.y);
      const curDist = Math.hypot(x - c.x, y - c.y);
      if (startDist > 4) {
        const ratio = curDist / startDist;
        const next = resizeStartBgScale.current * ratio;
        setBgScale(Math.max(0.3, Math.min(5, next)));
      }
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visCorner = hitCorner(x, y);
    const insideVis = hitInsideBounds(x, y);
    const lyrCorner = !visCorner && !insideVis ? hitLyricsCorner(x, y) : null;
    const insideLyr = !visCorner && !insideVis && !lyrCorner ? hitInsideLyrics(x, y) : false;
    const bgCorner = !visCorner && !insideVis && !lyrCorner && !insideLyr ? hitBgCorner(x, y) : null;
    const insideBg = !visCorner && !insideVis && !lyrCorner && !insideLyr && !bgCorner ? hitInsideBg(x, y) : false;
    if (visCorner || lyrCorner || bgCorner) {
      const c = visCorner ?? lyrCorner ?? bgCorner!;
      canvas.style.cursor = c === "tl" || c === "br" ? "nwse-resize" : "nesw-resize";
      if (visCorner && !isVisHovered) setIsVisHovered(true);
      if (lyrCorner && !isLyricsHovered) setIsLyricsHovered(true);
      if (bgCorner && !isBgHovered) setIsBgHovered(true);
      if (!visCorner && isVisHovered) setIsVisHovered(false);
      if (!lyrCorner && isLyricsHovered && !insideLyr) setIsLyricsHovered(false);
      if (!bgCorner && isBgHovered && !insideBg) setIsBgHovered(false);
    } else if (insideVis) {
      canvas.style.cursor = "crosshair";
      if (!isVisHovered) setIsVisHovered(true);
      if (isLyricsHovered) setIsLyricsHovered(false);
      if (isBgHovered) setIsBgHovered(false);
    } else if (insideLyr) {
      canvas.style.cursor = "move";
      if (!isLyricsHovered) setIsLyricsHovered(true);
      if (isVisHovered) setIsVisHovered(false);
      if (isBgHovered) setIsBgHovered(false);
    } else if (insideBg) {
      canvas.style.cursor = "move";
      if (!isBgHovered) setIsBgHovered(true);
      if (isVisHovered) setIsVisHovered(false);
      if (isLyricsHovered) setIsLyricsHovered(false);
    } else {
      canvas.style.cursor = "default";
      if (isVisHovered) setIsVisHovered(false);
      if (isLyricsHovered) setIsLyricsHovered(false);
      if (isBgHovered) setIsBgHovered(false);
    }
  }, [getCanvasCoords, hitCorner, hitInsideBounds, hitLyricsCorner, hitInsideLyrics, hitBgCorner, hitInsideBg, isVisHovered, isLyricsHovered, isBgHovered]);

  const onCanvasMouseUp = useCallback(() => {
    isDraggingVis.current = false;
    isResizingVis.current = null;
    isDraggingLyrics.current = false;
    isResizingLyrics.current = null;
    isDraggingBg.current = false;
    isResizingBg.current = null;
  }, []);

  const onCanvasMouseLeave = useCallback(() => {
    isDraggingVis.current = false;
    isResizingVis.current = null;
    isDraggingLyrics.current = false;
    isResizingLyrics.current = null;
    isDraggingBg.current = false;
    isResizingBg.current = null;
    setIsVisHovered(false);
    setIsLyricsHovered(false);
    setIsBgHovered(false);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  }, []);

  const seekToRatio = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (audio && audioSrc && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, ratio * audio.duration));
      return;
    }
    const dur = virtualDurationRef.current;
    if (dur > 0) {
      const vc = virtualClockRef.current;
      vc.time = Math.max(0, Math.min(dur, ratio * dur));
      if (vc.running) vc.lastWall = performance.now();
    }
  }, [audioSrc]);

  const seekToLine = useCallback((seg: LyricSegment, idx: number) => {
    const audio = audioRef.current;
    if (audio && audioSrc && Number.isFinite(audio.duration) && audio.duration > 0) {
      const targetTime = Math.max(0, Math.min(audio.duration, seg.startTime - lyricsOffsetRef.current));
      audio.currentTime = targetTime;
      lastActiveLyricIdxRef.current = idx;
      setActiveLyricIdx(idx);
      if (!playing) {
        audio.play().then(() => setPlaying(true)).catch(() => {});
      }
      return;
    }
    const dur = virtualDurationRef.current;
    if (dur <= 0) return;
    const vc = virtualClockRef.current;
    vc.time = Math.max(0, Math.min(dur, seg.startTime - lyricsOffsetRef.current));
    lastActiveLyricIdxRef.current = idx;
    setActiveLyricIdx(idx);
    if (!playing) {
      vc.lastWall = performance.now();
      vc.running = true;
      setPlaying(true);
    } else if (vc.running) {
      vc.lastWall = performance.now();
    }
  }, [playing, audioSrc]);

  const handleSetTrimStart = useCallback((v: number) => {
    setTrimStart(v);
    setLoopSegIdx(null);
  }, []);

  const handleSetTrimEnd = useCallback((v: number) => {
    setTrimEnd(v);
    setLoopSegIdx(null);
  }, []);

  const clearLoop = useCallback(() => {
    const audio = audioRef.current;
    setLoopSegIdx(null);
    setTrimStart(0);
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      setTrimEnd(audio.duration);
    }
  }, []);

  const loopSegment = useCallback((seg: LyricSegment, idx: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    if (loopSegIdx === idx) {
      clearLoop();
      return;
    }
    const segStart = Math.max(0, seg.startTime - lyricsOffsetRef.current);
    const segEnd = Math.min(audio.duration, seg.endTime - lyricsOffsetRef.current);
    setTrimStart(segStart);
    setTrimEnd(segEnd);
    setLoopSegIdx(idx);
    audio.currentTime = segStart;
    ensureAudioGraph();
    if (!playing) {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [loopSegIdx, playing, ensureAudioGraph, clearLoop]);

  useEffect(() => {
    if (!showLyricTimeline) return;
    if (lyricDragRef.current) return;
    if (lyricTimelineScrollPaused) return;
    const container = lyricTimelineScrollRef.current;
    if (!container || activeLyricIdx < 0 || activeLyricIdx >= lyricsSegments.length) return;
    const rowTop = activeLyricIdx * TIMELINE_ROW_H + TIMELINE_ROW_TOP_OFFSET;
    const rowBottom = rowTop + TIMELINE_ROW_H;
    const visTop = container.scrollTop;
    const visBottom = visTop + container.clientHeight;
    if (rowTop < visTop || rowBottom > visBottom) {
      lyricTimelineProgrammaticScrollRef.current = true;
      const clearProgrammatic = () => { lyricTimelineProgrammaticScrollRef.current = false; };
      if ('onscrollend' in container) {
        container.addEventListener('scrollend', clearProgrammatic, { once: true });
      } else {
        setTimeout(clearProgrammatic, 600);
      }
      container.scrollTo({ top: rowTop - container.clientHeight / 2 + TIMELINE_ROW_H / 2, behavior: "smooth" });
    }
  }, [activeLyricIdx, lyricsSegments.length, showLyricTimeline, lyricTimelineScrollPaused]);

  useEffect(() => {
    const container = lyricTimelineScrollRef.current;
    if (!container || !showLyricTimeline) return;
    const handleScroll = () => {
      if (lyricTimelineProgrammaticScrollRef.current) return;
      setLyricTimelineScrollPaused(true);
      if (lyricTimelinePauseTimerRef.current) clearTimeout(lyricTimelinePauseTimerRef.current);
      lyricTimelinePauseTimerRef.current = setTimeout(() => {
        setLyricTimelineScrollPaused(false);
      }, TIMELINE_SCROLL_PAUSE_MS);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (lyricTimelinePauseTimerRef.current) clearTimeout(lyricTimelinePauseTimerRef.current);
      setLyricTimelineScrollPaused(false);
    };
  }, [showLyricTimeline]);

  const handleScrubPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!audioSrc && !playableLyricsRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isScrubDraggingRef.current = true;
    const track = scrubTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    seekToRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, [audioSrc, seekToRatio]);

  const handleScrubPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubDraggingRef.current) return;
    const track = scrubTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    seekToRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, [seekToRatio]);

  const handleScrubPointerUp = useCallback(() => {
    isScrubDraggingRef.current = false;
  }, []);

  const loop = useCallback(() => {
    drawFrame();
    rafRef.current = requestAnimationFrame(loop);
  }, [drawFrame]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [loop]);

  const cancelRender = useCallback(() => {
    renderCancelRef.current = true;
    renderWorkerRef.current?.postMessage({ type: "cancel" });
  }, []);

  // Shared low-level draw helper used by both single-frame preview and the export
  // loop. Callers supply their own canvas and sceneState so each context can
  // manage canvas lifetime and animation-state continuity independently.
  const renderFrameToCanvas = useCallback((
    offscreen: HTMLCanvasElement,
    freqData: Uint8Array,
    timeData: Uint8Array,
    targetSec: number,
    sceneTime: number,
    sceneState: SceneState,
    bgImg: HTMLImageElement | HTMLVideoElement | null,
  ): void => {
    drawScene(offscreen, freqData, timeData, targetSec, sceneTime, false, sceneState, bgImg);
  }, [drawScene]);

  const renderFrameToDataUrl = useCallback((
    ratioId: RatioId,
    freqData: Uint8Array,
    timeData: Uint8Array,
    targetSec: number,
    bgImg: HTMLImageElement | HTMLVideoElement | null,
    fallbackIndex = 0,
  ): string => {
    const ratioOpt = RATIO_OPTIONS.find(r => r.id === ratioId) ?? RATIO_OPTIONS[fallbackIndex];
    const offscreen = document.createElement("canvas");
    offscreen.width = ratioOpt.w;
    offscreen.height = ratioOpt.h;
    renderFrameToCanvas(offscreen, freqData, timeData, targetSec, 0, createSceneState(), bgImg);
    return offscreen.toDataURL("image/jpeg", 0.92);
  }, [renderFrameToCanvas]);

  const previewExportFrame = useCallback(async (timePct?: number) => {
    if (!audioSrc || rendering || isPreviewingFrame) return;
    const pct = timePct ?? previewTimePct;
    // Snapshot the current frame as the "previous" for the crossfade, then start loading.
    setPrevFramePreviewUrl(framePreviewUrlRef.current);
    setIsPreviewingFrame(true);
    try {
      // Pre-load background image (or reuse the live video element) with the
      // same path used in startExport. For video backgrounds we just snapshot
      // the current playhead — single-frame previews don't need the full
      // frame-extraction pipeline.
      let exportBgImg: HTMLImageElement | HTMLVideoElement | null = null;
      if (bgIsVideo && bgVideoRef.current) {
        exportBgImg = bgVideoRef.current;
      } else if (imgSrc) {
        exportBgImg = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = imgSrc;
        });
      }

      // Decode audio to determine actual duration and compute FFT at the chosen time.
      // Re-use cached channels if the audio source hasn't changed — makes jump-point
      // switching feel instant after the first click.
      let cached = previewAudioCacheRef.current;
      if (!cached || cached.src !== audioSrc) {
        const audioBytes = await fetchAudioAsArrayBuffer(audioSrc, uploadedAudioFileRef.current);
        const decodeCtx = new (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext)(1, 44100, 44100);
        const audioBuffer = await decodeCtx.decodeAudioData(audioBytes.slice(0));
        const channels: Float32Array[] = [];
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
        cached = { src: audioSrc, channels, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration };
        previewAudioCacheRef.current = cached;
      }
      const { channels, sampleRate, duration } = cached;

      // Compute target time from pct within the trimmed region.
      const startSec = Math.max(0, trimStart);
      const endSec = trimEnd > trimStart ? trimEnd : duration;
      const targetSec = startSec + (endSec - startSec) * (pct / 100);

      const frame = computeFrameAudio(channels, sampleRate, targetSec, null);

      setPreviewRenderedSec(targetSec);
      setPreviewTimePct(pct);
      setFramePreviewUrl(renderFrameToDataUrl(exportRatioRef.current, frame.freqData, frame.timeData, targetSec, exportBgImg));

      if (splitViewRef.current) {
        setFramePreviewUrl2(renderFrameToDataUrl(compareRatioIdRef.current, frame.freqData, frame.timeData, targetSec, exportBgImg, 1));
      } else {
        setFramePreviewUrl2(null);
      }
    } catch (err) {
      console.error("Preview frame failed:", err);
      toast({
        title: "Preview failed",
        description: "Could not generate the export preview. Try again or check your audio file.",
        variant: "destructive",
      });
    } finally {
      setIsPreviewingFrame(false);
    }
  }, [audioSrc, rendering, isPreviewingFrame, previewTimePct, imgSrc, bgIsVideo, exportRatioRef, trimStart, trimEnd, uploadedAudioFileRef, renderFrameToDataUrl, toast]);

  previewExportFrameRef.current = previewExportFrame;

  useEffect(() => {
    if (!framePreviewOpenRef.current) return;
    previewExportFrameRef.current?.(previewTimePctRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportRatio, visStyle]);

  useEffect(() => {
    if (!framePreviewOpenRef.current || !splitViewRef.current) return;
    previewExportFrameRef.current?.(previewTimePctRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareRatioId]);

  useEffect(() => {
    if (previewRenderedSec === null) return;
    const mins = Math.floor(previewRenderedSec / 60);
    const secs = Math.floor(previewRenderedSec % 60);
    setPreviewTimeInput(`${mins}:${String(secs).padStart(2, "0")}`);
  }, [previewRenderedSec]);

  const startExport = async () => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !audioSrc || rendering) return;

    if (typeof window === "undefined" || !("VideoEncoder" in window)) {
      setRenderError("Offline export needs WebCodecs (Chrome, Edge or Safari 16+).");
      toast({
        title: "Browser unsupported",
        description: "Export requires WebCodecs. Please use a recent Chromium-based browser or Safari 16+.",
        variant: "destructive",
      });
      return;
    }

    if (playing) {
      audio.pause();
      setPlaying(false);
    }

    const ratioOpt = RATIO_OPTIONS.find((r) => r.id === exportRatioRef.current) ?? RATIO_OPTIONS[0];
    const W = ratioOpt.w;
    const H = ratioOpt.h;
    const ratioLabel = ratioOpt.id.replace(":", "x");
    const bitrate = QUALITY_BITRATES[exportQualityRef.current];

    const fullDur = Number.isFinite(audio.duration) ? audio.duration : 0;
    const startSec = Math.max(0, trimStart);
    const endSec = trimEnd > trimStart ? trimEnd : fullDur;
    const durationSec = Math.max(0.1, endSec - startSec);
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(durationSec * fps));

    // Guard: browser must support OffscreenCanvas + VideoEncoder (Chrome/Edge only).
    if (typeof OffscreenCanvas === "undefined" || typeof VideoEncoder === "undefined") {
      setRenderError("Your browser doesn't support background video export. Please try Chrome or Edge 94+.");
      toast({
        title: "Browser not supported",
        description: "Video export requires Chrome or Edge 94+. Firefox and Safari are not supported yet.",
        variant: "destructive",
      });
      return;
    }

    setRendering(true);
    setRenderError(null);
    setRenderProgress({ done: 0, total: totalFrames });
    renderCancelRef.current = false;

    let videoBlobUrl: string | null = null;

    try {
      // 1. Decode audio for offline FFT.
      const audioBytes = await fetchAudioAsArrayBuffer(audioSrc, uploadedAudioFileRef.current);
      const decodeCtx = new (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext)(1, 44100, 44100);
      const audioBuffer = await decodeCtx.decodeAudioData(audioBytes.slice(0));
      const channels: Float32Array[] = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));

      // 1b. Extract interleaved PCM slice for in-browser AudioEncoder muxing.
      // This avoids uploading the rendered video to the server and waiting for
      // ffmpeg — the worker encodes audio + video in one pass, then the MP4 is
      // ready to download instantly (typically 2–5× faster overall).
      let audioPcmBuffer: ArrayBuffer | null = null;
      const audioPcmSampleRate = audioBuffer.sampleRate;
      const audioPcmChannels = Math.min(2, audioBuffer.numberOfChannels);
      try {
        const startSampleRaw = Math.floor(startSec * audioPcmSampleRate);
        const nSamples = Math.min(
          Math.floor(durationSec * audioPcmSampleRate),
          audioBuffer.length - startSampleRaw,
        );
        if (nSamples > 0) {
          const pcm = new Float32Array(nSamples * audioPcmChannels);
          for (let c = 0; c < audioPcmChannels; c++) {
            const src = audioBuffer.getChannelData(c);
            for (let i = 0; i < nSamples; i++) {
              pcm[i * audioPcmChannels + c] = src[startSampleRaw + i] ?? 0;
            }
          }
          audioPcmBuffer = pcm.buffer;
        }
      } catch {
        audioPcmBuffer = null;
      }

      // 2. Pre-load background image (or extract video frames) and convert to
      //    ImageBitmap(s) — both are transferable to the worker.
      let bgBitmap: ImageBitmap | null = null;
      let bgFrames: ImageBitmap[] | null = null;
      let bgDurations: number[] | null = null;
      // Raw MP4 bytes for the streaming WebCodecs path. When set, the worker
      // demuxes + decodes on demand instead of receiving pre-extracted frames.
      let bgVideoBuffer: ArrayBuffer | null = null;
      if (bgIsVideo && bgVideoRef.current) {
        // Preferred path: hand the worker the raw file bytes so it can
        // stream-decode with mp4box + VideoDecoder. This removes the
        // 8 fps / 180-frame cap from the legacy extractor and keeps memory
        // bounded regardless of source length. We only fall through to the
        // seek-based extractor when the source isn't available as bytes
        // (no File ref), isn't an MP4 (mp4box.js can't parse WebM), or the
        // codec isn't supported by this browser's WebCodecs build.
        try {
          const file = bgVideoFileRef.current;
          if (file) {
            const isMp4 = /mp4|m4v|quicktime/i.test(file.type)
              || /\.(mp4|m4v|mov)$/i.test(file.name);
            if (isMp4) {
              setRenderProgress({ done: 0, total: totalFrames, eta: "Loading background video…" });
              const buf = await file.arrayBuffer();
              const { canStreamMp4Buffer } = await import("../workers/bgVideoStream");
              if (await canStreamMp4Buffer(buf)) {
                bgVideoBuffer = buf;
              }
              // Otherwise leave bgVideoBuffer null so we fall through to
              // the seek-based extractor below — guarantees we never send
              // the worker an undecodable buffer that would silently
              // produce a black background.
            }
          }
        } catch {
          // Fall through to the seek-based extractor below.
          bgVideoBuffer = null;
        }
      }
      if (bgIsVideo && !bgVideoBuffer && bgVideoRef.current) {
        try {
          // Legacy fallback: seek through a hidden <video> element on the
          // main thread and snapshot frames with createImageBitmap. Used
          // only for WebM sources or when the raw file bytes aren't
          // available (e.g. video came from a remote URL we can't refetch).
          const liveSrc = bgVideoRef.current.src;
          const liveDur = Number.isFinite(bgVideoRef.current.duration)
            ? bgVideoRef.current.duration : 0;
          if (liveDur > 0 && liveSrc) {
            // Cap total frames so memory stays bounded for long source videos.
            // We also resize each extracted frame to the export resolution
            // (W×H) before turning it into an ImageBitmap, so memory is
            // proportional to the final output size, not the source video size.
            // E.g. 180 frames at 1280x720 RGBA ≈ ~660MB *if* held raw, but
            // ImageBitmaps are typically GPU-backed/compressed; in practice
            // this comfortably fits in real-world export budgets while still
            // giving smooth-looking loops.
            const maxFps = 8;
            const maxFrames = 180;
            let nFrames = Math.max(1, Math.floor(liveDur * maxFps));
            if (nFrames > maxFrames) nFrames = maxFrames;
            const stepDur = liveDur / nFrames;
            // Scale extracted frames to cover the export canvas (at least W×H)
            // so drawCoverImage can crop them correctly. Using Math.max (cover)
            // instead of Math.min (contain) prevents drawCoverImage from having
            // to upscale a smaller frame, which caused visible stretching.
            const srcW = (bgVideoRef.current as HTMLVideoElement).videoWidth || W;
            const srcH = (bgVideoRef.current as HTMLVideoElement).videoHeight || H;
            const fit = bgFitMode === "contain"
              ? Math.min(W / srcW, H / srcH)
              : Math.max(W / srcW, H / srcH);
            const tgtW = Math.max(2, Math.round(srcW * fit));
            const tgtH = Math.max(2, Math.round(srcH * fit));

            const extractor = document.createElement("video");
            extractor.muted = true;
            extractor.playsInline = true;
            extractor.crossOrigin = "anonymous";
            extractor.preload = "auto";
            extractor.src = liveSrc;
            await new Promise<void>((resolve, reject) => {
              const onReady = () => { cleanup(); resolve(); };
              const onErr = () => { cleanup(); reject(new Error("Failed to load background video")); };
              const cleanup = () => {
                extractor.removeEventListener("loadeddata", onReady);
                extractor.removeEventListener("error", onErr);
              };
              extractor.addEventListener("loadeddata", onReady);
              extractor.addEventListener("error", onErr);
            });

            const frames: ImageBitmap[] = [];
            const durations: number[] = [];
            for (let i = 0; i < nFrames; i++) {
              if (renderCancelRef.current) {
                for (const f of frames) { try { f.close(); } catch { /* ignore */ } }
                throw new Error("cancelled");
              }
              const t = Math.min(liveDur - 0.001, (i + 0.5) * stepDur);
              await new Promise<void>((resolve) => {
                const onSeeked = () => {
                  extractor.removeEventListener("seeked", onSeeked);
                  resolve();
                };
                extractor.addEventListener("seeked", onSeeked);
                try { extractor.currentTime = t; }
                catch { extractor.removeEventListener("seeked", onSeeked); resolve(); }
              });
              try {
                const bmp = await createImageBitmap(extractor, {
                  resizeWidth: tgtW,
                  resizeHeight: tgtH,
                  resizeQuality: "medium",
                });
                frames.push(bmp);
                durations.push(stepDur);
              } catch {
                // If a single frame fails, skip it but continue extracting.
              }
              if (i % 8 === 0) {
                const pct = Math.round((i / nFrames) * 100);
                setRenderProgress({ done: 0, total: totalFrames, eta: `Extracting video frames… ${pct}%` });
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
            }
            extractor.removeAttribute("src");
            try { extractor.load(); } catch { /* ignore */ }
            if (frames.length > 0) {
              bgFrames = frames;
              bgDurations = durations;
            } else {
              throw new Error(
                "Could not extract any frames from the background video. " +
                "Please try a different MP4 or WebM file."
              );
            }
          } else {
            throw new Error("Background video has no readable duration.");
          }
        } catch (err) {
          if (err instanceof Error && err.message === "cancelled") throw err;
          // Fail fast so the user knows their export wouldn't have matched
          // the live preview, instead of silently producing a black background.
          throw err instanceof Error
            ? err
            : new Error("Background video could not be prepared for export.");
        }
      } else if (imgSrc) {
        try {
          // Use fetch → blob → createImageBitmap so blob: URLs (from
          // URL.createObjectURL) load without CORS restrictions. The old
          // new Image() + crossOrigin="anonymous" path silently failed for
          // blob URLs, resulting in a black background in the exported video.
          const res = await fetch(imgSrc);
          if (res.ok) {
            const blob = await res.blob();
            bgBitmap = await createImageBitmap(blob);
          } else {
            console.warn("Export: failed to fetch background image, proceeding without it.");
          }
        } catch {
          console.warn("Export: could not create ImageBitmap for background.");
        }
      }

      // 3a. Pre-compute all FFT data upfront, writing directly into transferable
      //     ArrayBuffers so there is no intermediate per-frame object allocation.
      //     We sample one frame first to learn the FFT sizes, then allocate once.
      setRenderProgress({ done: 0, total: totalFrames, eta: "Analyzing audio…" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      let freqBuffer: ArrayBuffer;
      let timeBuffer: ArrayBuffer;
      let freqLen: number;
      let timeLen: number;
      {
        let prevSmoothed: Float32Array | null = null;

        // Sample frame 0 to determine sizes.
        const first = computeFrameAudio(channels, audioBuffer.sampleRate, startSec, null);
        freqLen = first.freqData.length;
        timeLen = first.timeData.length;
        freqBuffer = new ArrayBuffer(totalFrames * freqLen);
        timeBuffer = new ArrayBuffer(totalFrames * timeLen);
        const freqView = new Uint8Array(freqBuffer);
        const timeView = new Uint8Array(timeBuffer);
        freqView.set(first.freqData, 0);
        timeView.set(first.timeData, 0);
        prevSmoothed = first.smoothed;

        for (let i = 1; i < totalFrames; i++) {
          if (renderCancelRef.current) throw new Error("cancelled");
          const tAudio = startSec + i / fps;
          const frame = computeFrameAudio(channels, audioBuffer.sampleRate, tAudio, prevSmoothed);
          prevSmoothed = frame.smoothed;
          freqView.set(frame.freqData, i * freqLen);
          timeView.set(frame.timeData, i * timeLen);
          // Yield every 300 frames so the UI stays responsive and Cancel works.
          if (i % 300 === 0) {
            const pct = Math.round((i / totalFrames) * 100);
            setRenderProgress({ done: 0, total: totalFrames, eta: `Analyzing audio… ${pct}%` });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      }

      // 3b. Check codec support on the main thread (VideoEncoder.isConfigSupported must run here).
      // Try H.264 (avc1.*) first because it's the most universally playable in
      // an MP4 container. Fall back to VP9 / AV1 inside MP4 — these are
      // royalty-free and ship with the open-source Chromium build used by
      // automated tests, so the export still produces a real MP4 there even
      // when the proprietary H.264 encoder is unavailable.
      const codecsToTry = [
        "avc1.640033", "avc1.640028", "avc1.4d0033", "avc1.4d0028",
        "avc1.42E033", "avc1.42E01F",
        "vp09.00.51.08", "vp09.00.41.08", "vp09.00.10.08",
        "av01.0.08M.08", "av01.0.04M.08",
      ];
      let chosenCodec: string | null = null;
      for (const c of codecsToTry) {
        try {
          const support = await VideoEncoder.isConfigSupported({
            codec: c,
            width: W,
            height: H,
            bitrate,
            framerate: fps,
          });
          if (support.supported) { chosenCodec = c; break; }
        } catch { /* try next */ }
      }
      if (!chosenCodec) throw new Error("No supported video codec (H.264 / VP9 / AV1) for this resolution");

      // 5. Snapshot current scene + lyrics config for the worker.
      const visConfig = {
        visStyle, color, intensity, visSize, position,
        visOffsetX, visOffsetY, visScaleW, visScaleH,
      };
      const lyricsConfig: DrawLyricsConfig = {
        segments: lyricsSegmentsRef.current,
        fontSize: lyricsFontSizeRef.current,
        color: lyricsColorRef.current,
        highlightColor: lyricsHighlightColorRef.current,
        position: lyricsPositionRef.current,
        fontFamily: lyricsFontFamilyRef.current,
        bold: lyricsBoldRef.current,
        italic: lyricsItalicRef.current,
        outline: lyricsOutlineRef.current,
        glow: lyricsGlowRef.current,
        autoEmoji: autoEmojiRef.current,
        offset: lyricsOffsetRef.current,
        pace: lyricsPaceRef.current,
        highlightStyle: lyricsHighlightStyleRef.current,
        dropShadow: lyricsDropShadowRef.current,
        hardShadow: lyricsHardShadowRef.current,
        neon: lyricsNeonRef.current,
        threeD: lyrics3DRef.current,
        gradient: lyricsGradientRef.current,
        stroke: lyricsStrokeRef.current,
        underline: lyricsUnderlineRef.current,
        strikethrough: lyricsStrikethroughRef.current,
        uppercase: lyricsUppercaseRef.current,
        smallCaps: lyricsSmallCapsRef.current,
        bgPill: lyricsBgPillRef.current,
        sticker: lyricsStickerRef.current,
        comicPop: lyricsComicPopRef.current,
        subtitleBar: lyricsSubtitleBarRef.current,
        popActiveWord: lyricsPopActiveWordRef.current,
        popIntensity: lyricsPopIntensityRef.current,
        popAccentColor: lyricsPopAccentColorRef.current,
        letterSpacing: lyricsLetterSpacingRef.current,
        bgColor: lyricsBgColorRef.current,
        bgOpacity: lyricsBgOpacityRef.current,
        offsetX: lyricsOffsetXRef.current,
        offsetY: lyricsOffsetYRef.current,
        scale: lyricsScaleRef.current,
      };

      // 6. Dispatch rendering to a dedicated Web Worker (OffscreenCanvas + VideoEncoder
      //    run off the main thread so the UI stays fully interactive during export).
      setRenderProgress({ done: 0, total: totalFrames, eta: "Starting render…" });
      const { buffer, hasAudio: workerMuxedAudio } = await new Promise<{ buffer: ArrayBuffer; hasAudio: boolean }>((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/exportWorker.ts", import.meta.url),
          { type: "module" },
        );
        renderWorkerRef.current = worker;

        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data as { type: string; done?: number; total?: number; eta?: string; buffer?: ArrayBuffer; hasAudio?: boolean; message?: string };
          if (msg.type === "progress") {
            setRenderProgress({ done: msg.done!, total: msg.total!, eta: msg.eta });
          } else if (msg.type === "done") {
            renderWorkerRef.current = null;
            worker.terminate();
            resolve({ buffer: msg.buffer!, hasAudio: msg.hasAudio ?? false });
          } else if (msg.type === "error") {
            renderWorkerRef.current = null;
            worker.terminate();
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (err) => {
          renderWorkerRef.current = null;
          worker.terminate();
          reject(new Error(err.message ?? "Export worker crashed"));
        };

        const transferables: Transferable[] = [freqBuffer, timeBuffer];
        if (bgBitmap) transferables.push(bgBitmap);
        if (bgFrames) {
          for (const f of bgFrames) transferables.push(f);
        }
        if (bgVideoBuffer) transferables.push(bgVideoBuffer);
        if (audioPcmBuffer) transferables.push(audioPcmBuffer);
        // GIF frames: only forward when the active visualizer style is "gif".
        // ImageBitmap is structured-cloneable (passed by copy here so the live
        // preview keeps its references while the worker gets its own copies).
        const gifFrames = visStyle === "gif" && gifFramesRef.current
          ? gifFramesRef.current.frames
          : null;
        const gifDurations = visStyle === "gif" && gifFramesRef.current
          ? gifFramesRef.current.durations
          : null;
        worker.postMessage({
          type: "start",
          visConfig,
          lyricsConfig,
          W, H, fps,
          startSec,
          totalFrames,
          freqLen,
          timeLen,
          bitrate,
          chosenCodec,
          bgBitmap: bgBitmap ?? null,
          freqBuffer,
          timeBuffer,
          gifFrames,
          gifDurations,
          bgFrames,
          bgDurations,
          bgVideoBuffer,
          bgOffsetX,
          bgOffsetY,
          bgScale,
          bgFitMode,
          audioPcm: audioPcmBuffer ?? null,
          audioSampleRate: audioPcmSampleRate,
          audioChannels: audioPcmChannels,
        }, transferables);
      });

      setRenderProgress({ done: totalFrames, total: totalFrames });

      if (workerMuxedAudio) {
        // Fast path: audio was encoded directly into the MP4 by the worker —
        // no server roundtrip needed. Trigger download immediately.
        videoBlobUrl = URL.createObjectURL(new Blob([buffer], { type: "video/mp4" }));
        const a = document.createElement("a");
        a.href = videoBlobUrl;
        a.download = `song-visualizer-${visStyle}-${ratioLabel}.mp4`;
        a.click();
      } else {
        // Fallback: worker didn't encode audio (AudioEncoder unavailable).
        // Upload the silent video to the server for ffmpeg audio mux.
        setRenderProgress({ done: totalFrames, total: totalFrames, eta: "Muxing audio…" });
        const silentBlob = new Blob([buffer], { type: "video/mp4" });
        const fd = new FormData();
        fd.append("video", silentBlob, "render.mp4");
        try {
          const audioBlob = await fetchAudioAsBlob(audioSrc, uploadedAudioFileRef.current);
          const audioName = uploadedAudioFileRef.current?.name || "audio.bin";
          fd.append("audio", audioBlob, audioName);
          fd.append("audioStart", String(startSec));
          fd.append("audioDuration", String(durationSec));
        } catch {
          // No audio — server will just remux video.
        }

        const apiBase = ((import.meta as unknown as { env: Record<string, string> }).env.VITE_API_BASE_URL) || "";
        const muxRes = await fetch(`${apiBase}/api/media/render-mux?stream=1`, { method: "POST", body: fd });
        if (!muxRes.ok) {
          const txt = await muxRes.text().catch(() => "");
          throw new Error(`Mux failed: ${muxRes.status} ${txt}`);
        }
        const finalBlob = await muxRes.blob();
        videoBlobUrl = URL.createObjectURL(finalBlob);

        const a = document.createElement("a");
        a.href = videoBlobUrl;
        a.download = `song-visualizer-${visStyle}-${ratioLabel}.mp4`;
        a.click();
      }

      toast({ title: "Export complete", description: `${W}×${H} @ ${fps}fps` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Render failed";
      if (msg !== "cancelled") {
        setRenderError(msg);
        toast({ title: "Export failed", description: msg, variant: "destructive" });
      }
    } finally {
      if (videoBlobUrl) {
        // Defer so the download has time to start.
        setTimeout(() => { if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl); }, 60_000);
      }
      // Ensure any still-running worker is terminated on error/cancel.
      if (renderWorkerRef.current) {
        renderWorkerRef.current.terminate();
        renderWorkerRef.current = null;
      }
      setRendering(false);
      setRenderProgress(null);
      renderCancelRef.current = false;
    }
  };

  const imgSrcRef = useRef(imgSrc);
  imgSrcRef.current = imgSrc;
  const audioSrcRef = useRef(audioSrc);
  audioSrcRef.current = audioSrc;

  useEffect(() => {
    return () => {
      if (imgSrcRef.current) URL.revokeObjectURL(imgSrcRef.current);
      const v = bgVideoRef.current;
      if (v) {
        try { v.pause(); } catch { /* ignore */ }
        v.removeAttribute("src");
        try { v.load(); } catch { /* ignore */ }
        bgVideoRef.current = null;
      }
      if (audioSrcRef.current && audioSrcRef.current.startsWith("blob:")) URL.revokeObjectURL(audioSrcRef.current);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = lyricDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const secPerPx = drag.totalDuration / drag.containerWidth;
      const deltaSec = dx * secPerPx;
      setLyricsSegments(prev => {
        const segs = prev.map(s => ({ ...s }));
        const seg = segs[drag.segIdx];
        const minGap = 0.05;
        if (drag.part === 'start') {
          const prevEnd = drag.segIdx > 0 ? segs[drag.segIdx - 1].endTime : 0;
          seg.startTime = Math.min(
            seg.endTime - minGap,
            Math.max(prevEnd, drag.origStart + deltaSec)
          );
        } else if (drag.part === 'end') {
          const nextStart = drag.segIdx < segs.length - 1 ? segs[drag.segIdx + 1].startTime : drag.totalDuration;
          seg.endTime = Math.max(
            seg.startTime + minGap,
            Math.min(nextStart, drag.origEnd + deltaSec)
          );
        } else {
          const duration = drag.origEnd - drag.origStart;
          const prevEnd = drag.segIdx > 0 ? segs[drag.segIdx - 1].endTime : 0;
          const nextStart = drag.segIdx < segs.length - 1 ? segs[drag.segIdx + 1].startTime : drag.totalDuration;
          const newStart = Math.max(prevEnd, Math.min(nextStart - duration, drag.origStart + deltaSec));
          seg.startTime = newStart;
          seg.endTime = newStart + duration;
        }
        return segs;
      });
    };
    const onMouseUp = (e: MouseEvent) => {
      const drag = lyricDragRef.current;
      lyricDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (drag && drag.part === 'move') {
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);
        if (dx < 4 && dy < 4) {
          seekToRatio(drag.origStart / drag.totalDuration);
          setLyricTimelineScrollPaused(false);
        }
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [seekToRatio, setLyricTimelineScrollPaused]);

  const canExport = !!audioSrc;
  const progressPct = renderProgress && renderProgress.total > 0
    ? Math.min((renderProgress.done / renderProgress.total) * 100, 100)
    : 0;

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            <h1 className="font-semibold text-sm">Song Visualizer</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowPanel(p => !p)}
            className="lg:hidden">
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
          {canExport && (
            <>
              <select
                value={exportQuality}
                onChange={e => setExportQuality(e.target.value as ExportQuality)}
                disabled={rendering}
                title="Export quality"
                className="text-xs bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50">
                <option value="fast">Fast · 6 Mbps</option>
                <option value="standard">Standard · 10 Mbps</option>
                <option value="high">High · 16 Mbps</option>
              </select>
              <select
                value={exportRatio}
                onChange={e => setExportRatio(e.target.value as RatioId)}
                disabled={rendering}
                title="Export aspect ratio"
                className="text-xs bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50">
                {RATIO_OPTIONS.map(r => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={() => previewExportFrame()}
                disabled={rendering || isPreviewingFrame}
                title="Preview a mid-song frame at export resolution"
                className="gap-1.5">
                {isPreviewingFrame
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Eye className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Preview</span>
              </Button>
              <Button size="sm" onClick={rendering ? cancelRender : startExport}
                variant={rendering ? "destructive" : "default"}
                className="gap-1.5">
                <Download className="w-3.5 h-3.5" />
                {rendering ? "Cancel" : "Export"}
              </Button>
            </>
          )}
        </div>
      </div>


      {framePreviewUrl && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setFramePreviewUrl(null); setPrevFramePreviewUrl(null); setSplitView(false); setSplitViewSwapped(false); setFramePreviewUrl2(null); setPreviewTimeInput(""); setPreviewRenderedSec(null); } }}>
          <div className={`bg-card border border-border rounded-xl shadow-2xl flex flex-col w-full overflow-hidden transition-all duration-200 ease-in-out ${splitView ? "max-w-5xl" : "max-w-2xl"}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <Eye className="w-4 h-4 text-primary shrink-0" />
                <h2 className="font-semibold text-sm shrink-0">Export Frame Preview</h2>
                {!splitView && (
                  <span className="text-xs text-muted-foreground truncate">
                    {(RATIO_OPTIONS.find(r => r.id === exportRatio) ?? RATIO_OPTIONS[0]).label}
                    {" · "}{(RATIO_OPTIONS.find(r => r.id === exportRatio) ?? RATIO_OPTIONS[0]).w}
                    ×{(RATIO_OPTIONS.find(r => r.id === exportRatio) ?? RATIO_OPTIONS[0]).h}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {splitView && (
                  <select
                    value={compareRatioId}
                    onChange={e => setCompareRatioId(e.target.value as RatioId)}
                    className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                    title="Second ratio to compare"
                  >
                    {RATIO_OPTIONS.filter(r => r.id !== exportRatio).map(r => (
                      <option key={r.id} value={r.id}>{r.label} ({r.w}×{r.h})</option>
                    ))}
                  </select>
                )}
                <Button
                  variant={splitView ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7 px-2 gap-1"
                  onClick={() => {
                    const next = !splitView;
                    setSplitView(next);
                    if (next) {
                      const fallback = RATIO_OPTIONS.find(r => r.id !== exportRatio) ?? RATIO_OPTIONS[1];
                      setCompareRatioId(prev => prev === exportRatio ? fallback.id : prev);
                    } else {
                      setFramePreviewUrl2(null);
                      setSplitViewSwapped(false);
                    }
                    setTimeout(() => previewExportFrameRef.current?.(previewTimePctRef.current), 0);
                  }}
                >
                  Compare ratios
                </Button>
                <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => { setFramePreviewUrl(null); setPrevFramePreviewUrl(null); setSplitView(false); setSplitViewSwapped(false); setFramePreviewUrl2(null); setPreviewTimeInput(""); setPreviewRenderedSec(null); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="relative bg-black flex items-center justify-center" style={{ maxHeight: "60vh" }}>
              {prevFramePreviewUrl && (
                <img
                  src={prevFramePreviewUrl}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  style={{
                    maxHeight: "60vh",
                    opacity: isPreviewingFrame ? 0.55 : 0,
                    transition: "opacity 280ms ease-in-out",
                  }}
                />
              )}
              {splitView && framePreviewUrl2 ? (
                <div className={`flex w-full h-full bg-zinc-800${splitViewSwapped ? " flex-row-reverse" : ""}`}>
                  <div className="relative flex-1 flex flex-col items-center min-w-0">
                    <span className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 text-[10px] font-semibold bg-black/60 text-white px-2 py-0.5 rounded-full pointer-events-none select-none">
                      {(RATIO_OPTIONS.find(r => r.id === exportRatio) ?? RATIO_OPTIONS[0]).label}
                    </span>
                    <img
                      src={framePreviewUrl}
                      alt={`Export frame preview — ${exportRatio}`}
                      className="w-full object-contain"
                      style={{ maxHeight: "60vh" }}
                    />
                  </div>
                  <div className="relative flex items-center justify-center w-8 shrink-0 self-stretch">
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-white/20" />
                    <button
                      className="relative z-10 w-6 h-6 rounded-full bg-zinc-900 border border-white/20 hover:border-white/50 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      onClick={() => setSplitViewSwapped(s => !s)}
                      title="Swap panels"
                    >
                      <ArrowLeftRight className="w-3 h-3 text-white/70" />
                    </button>
                  </div>
                  <div className="relative flex-1 flex flex-col items-center min-w-0">
                    <span className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 text-[10px] font-semibold bg-black/60 text-white px-2 py-0.5 rounded-full pointer-events-none select-none">
                      {(RATIO_OPTIONS.find(r => r.id === compareRatioId) ?? RATIO_OPTIONS[1]).label}
                    </span>
                    <img
                      src={framePreviewUrl2}
                      alt={`Export frame preview — ${compareRatioId}`}
                      className="w-full object-contain"
                      style={{ maxHeight: "60vh" }}
                    />
                    <button
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-[10px] font-semibold bg-white/10 hover:bg-white/25 text-white border border-white/20 px-2.5 py-0.5 rounded-full transition-colors select-none"
                      onClick={() => {
                        const prevExport = exportRatio;
                        setExportRatio(compareRatioId);
                        setCompareRatioId(prevExport);
                        setSplitViewSwapped(false);
                        setTimeout(() => previewExportFrameRef.current?.(previewTimePctRef.current), 0);
                      }}
                    >
                      Use this ratio
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <img
                    src={framePreviewUrl!}
                    alt="Export frame preview"
                    className="w-full object-contain"
                    style={{
                      maxHeight: "60vh",
                      opacity: isPreviewingFrame ? 0 : 1,
                      transition: "opacity 280ms ease-in-out",
                    }}
                  />
                  {isPreviewingFrame && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                      <Loader2 className="w-8 h-8 animate-spin text-white/90 drop-shadow-lg" />
                    </div>
                  )}
                </>
              )}
            </div>
            {(() => {
              const commitTimeInput = () => {
                const raw = previewTimeInput.trim();
                if (!raw) return;
                const parts = raw.split(":");
                let secs: number;
                if (parts.length >= 2) {
                  const mins = parseInt(parts[parts.length - 2] ?? "0", 10);
                  const sec = parseFloat(parts[parts.length - 1] ?? "0");
                  secs = mins * 60 + sec;
                } else {
                  secs = parseFloat(parts[0] ?? "0");
                }
                if (!Number.isFinite(secs) || secs < 0) {
                  toast({ title: "Invalid time", description: 'Enter a time like "1:23" or "83".', variant: "destructive" });
                  return;
                }
                const audio = audioRef.current;
                const fullDur = audio && Number.isFinite(audio.duration)
                  ? audio.duration
                  : (previewRenderedSec !== null && previewTimePct > 0 ? previewRenderedSec / (previewTimePct / 100) : 0);
                const startSec = Math.max(0, trimStart);
                const endSec = trimEnd > trimStart ? trimEnd : fullDur;
                const regionDur = Math.max(1, endSec - startSec);
                const pct = Math.min(100, Math.max(0, ((secs - startSec) / regionDur) * 100));
                setPreviewTimePct(pct);
                previewExportFrame(pct);
              };
              return (
            <div className="px-3 pt-3 pb-1 space-y-2">
              {/* Scrubber slider */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-5 shrink-0">0%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={previewTimePct}
                  disabled={isPreviewingFrame}
                  onChange={e => setPreviewTimePct(Number(e.target.value))}
                  onMouseUp={e => {
                    const v = Number((e.target as HTMLInputElement).value);
                    previewExportFrame(v);
                  }}
                  onTouchEnd={e => {
                    const v = Number((e.currentTarget).value);
                    previewExportFrame(v);
                  }}
                  onKeyUp={e => {
                    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                      const v = Number((e.target as HTMLInputElement).value);
                      previewExportFrame(v);
                    }
                  }}
                  className="flex-1 accent-primary cursor-pointer disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">100%</span>
                {previewRenderedSec !== null && (
                  <span className="text-xs font-mono text-primary shrink-0 w-10 text-right">
                    {`${Math.floor(previewRenderedSec / 60)}:${String(Math.floor(previewRenderedSec % 60)).padStart(2, "0")}`}
                  </span>
                )}
              </div>
              {/* Custom time input */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Go to:</span>
                <input
                  type="text"
                  placeholder="m:ss"
                  value={previewTimeInput}
                  disabled={isPreviewingFrame}
                  onChange={e => setPreviewTimeInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") commitTimeInput(); }}
                  className="w-16 text-xs bg-background border border-border rounded px-2 py-1 font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-6 px-2"
                  disabled={isPreviewingFrame}
                  onClick={commitTimeInput}>
                  Go
                </Button>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">Quick:</span>
                {[10, 25, 50].map(pct => (
                  <Button
                    key={pct}
                    size="sm"
                    variant={previewTimePct === pct ? "default" : "outline"}
                    className="text-xs h-6 px-2"
                    disabled={isPreviewingFrame}
                    onClick={() => { setPreviewTimePct(pct); previewExportFrame(pct); }}>
                    {pct}%
                  </Button>
                ))}
              </div>
            </div>
              ); })()}
            <div className="flex gap-2 p-3 border-t border-border mt-2">
              <p className="flex-1 text-xs text-muted-foreground self-center">
                {splitView
                  ? `Comparing ${(RATIO_OPTIONS.find(r => r.id === exportRatio) ?? RATIO_OPTIONS[0]).label} vs ${(RATIO_OPTIONS.find(r => r.id === compareRatioId) ?? RATIO_OPTIONS[1]).label} at ${previewTimePct}%`
                  : `Showing frame at ${previewTimePct}% — drag the slider or type a time to preview any moment.`}
              </p>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => { setFramePreviewUrl(null); setPrevFramePreviewUrl(null); setSplitView(false); setSplitViewSwapped(false); setFramePreviewUrl2(null); setPreviewTimeInput(""); setPreviewRenderedSec(null); }}>
                Close
              </Button>
              <Button size="sm" className="text-xs gap-1.5" onClick={() => { setFramePreviewUrl(null); setPrevFramePreviewUrl(null); setSplitView(false); setSplitViewSwapped(false); setFramePreviewUrl2(null); setPreviewTimeInput(""); setPreviewRenderedSec(null); startExport(); }}>
                <Download className="w-3.5 h-3.5" />
                Export Now
              </Button>
            </div>
          </div>
        </div>
      )}


      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-4 bg-black/20 relative">
          {rendering && renderProgress && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 bg-black/80 backdrop-blur px-4 py-2 rounded-full">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="text-xs text-white font-medium">
                {renderProgress.eta && renderProgress.done === 0
                  ? renderProgress.eta
                  : `Rendering frame ${renderProgress.done} / ${renderProgress.total}`}
                {renderProgress.eta && renderProgress.done > 0 && (
                  <span className="text-white/60 ml-1.5">{renderProgress.eta}</span>
                )}
              </span>
              <div className="w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
          {renderError && !rendering && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-destructive/90 text-destructive-foreground text-xs px-3 py-1.5 rounded-full max-w-md truncate">
              {renderError}
            </div>
          )}

          <div className="relative" style={{ maxWidth: '640px', width: '100%' }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="rounded-lg shadow-2xl w-full"
              style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseLeave}
            />
            {loopSegIdx !== null ? (
              <button
                onClick={clearLoop}
                title="Click to exit loop mode"
                className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 cursor-pointer hover:bg-green-900/70 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-green-400" />
                <Repeat className="w-2.5 h-2.5 text-green-400" />
                <span className="text-[10px] text-green-300 font-medium tracking-wide">LOOPING</span>
                <span className="text-[10px] text-green-300/70 font-normal">{formatBadgeTime(trimStart)}–{formatBadgeTime(trimEnd)}</span>
                <X className="w-2.5 h-2.5 text-green-400/70" />
              </button>
            ) : (
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-red-500" />
                <span className="text-[10px] text-white/80 font-medium tracking-wide">LIVE PREVIEW</span>
              </div>
            )}
          </div>

          {(audioSrc || playableLyrics) && (
            <div className="mt-3 w-full" style={{ maxWidth: '640px' }}>
              <div
                ref={scrubTrackRef}
                className="relative h-2 bg-white/10 rounded-full cursor-pointer touch-none select-none"
                onPointerDown={handleScrubPointerDown}
                onPointerMove={handleScrubPointerMove}
                onPointerUp={handleScrubPointerUp}
                onPointerCancel={handleScrubPointerUp}
                onLostPointerCapture={handleScrubPointerUp}
              >
                <div ref={scrubFillRef} className="absolute top-0 left-0 h-full bg-primary rounded-full" style={{ width: '0%' }} />
                {loopSegIdx !== null && audioDuration > 0 && (() => {
                  const startPct = (trimStart / audioDuration) * 100;
                  const endPct = (trimEnd / audioDuration) * 100;
                  return (
                    <>
                      <div
                        className="absolute top-0 h-full bg-green-500/30 pointer-events-none"
                        style={{
                          left: `${startPct}%`,
                          width: `${endPct - startPct}%`,
                        }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 bg-green-400 rounded-full pointer-events-none"
                        style={{ left: `${startPct}%` }}
                      />
                      <span
                        className="absolute text-[9px] text-green-400 font-mono tabular-nums pointer-events-none leading-none"
                        style={{
                          top: '-14px',
                          left: `${startPct}%`,
                          transform: startPct < 20 ? 'none' : 'translateX(-50%)',
                        }}
                      >
                        {formatBadgeTime(trimStart)}
                      </span>
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 bg-green-400 rounded-full pointer-events-none"
                        style={{ left: `${endPct}%` }}
                      />
                      <span
                        className="absolute text-[9px] text-green-400 font-mono tabular-nums pointer-events-none leading-none"
                        style={{
                          top: '-14px',
                          ...(endPct > 80
                            ? { right: `${100 - endPct}%` }
                            : { left: `${endPct}%`, transform: 'translateX(-50%)' }),
                        }}
                      >
                        {formatBadgeTime(trimEnd)}
                      </span>
                    </>
                  );
                })()}
                <div
                  ref={scrubHandleRef}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md border border-primary/60 pointer-events-none"
                  style={{ left: '0%' }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span ref={timeDisplayRef} className="text-[11px] text-muted-foreground tabular-nums" />
                {lyricsSegments.length > 0 && (
                  <div
                    ref={currentLyricElemRef}
                    className="text-[11px] text-primary font-medium max-w-[60%] truncate text-right transition-opacity"
                    style={{ opacity: 0.35 }}
                  />
                )}
              </div>
            </div>
          )}

          {audioSrc && audioDuration > 0 && (
            <TimelineTrim
              audioDuration={audioDuration}
              trimStart={trimStart}
              trimEnd={trimEnd}
              setTrimStart={handleSetTrimStart}
              setTrimEnd={handleSetTrimEnd}
            />
          )}

          <div className="flex items-center gap-3 mt-4">
            {(audioSrc || playableLyrics) && (
              <Button variant="secondary" size="sm" onClick={togglePlay}
                disabled={rendering} className="gap-1.5">
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {playing ? "Pause" : "Play"}
              </Button>
            )}
            {!audioSrc && playableLyrics && (
              <span className="text-[11px] text-muted-foreground">
                Preview only — upload audio to export.
              </span>
            )}
          </div>
        </div>

        <div className={cn(
          "w-72 border-l border-border bg-card overflow-y-auto p-4 space-y-6",
          "hidden lg:block",
          showPanel && "!block fixed right-0 top-0 bottom-0 z-50 shadow-xl"
        )}>
          {showPanel && (
            <div className="flex justify-end lg:hidden">
              <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setShowPanel(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">
              Background Image / Video
            </Label>
            <input ref={imgInputRef} type="file"
              accept="image/*,video/mp4,video/webm"
              className="hidden"
              onChange={handleImageUpload} />
            {imgSrc ? (
              <div className="relative group">
                {bgIsVideo ? (
                  <video
                    src={imgSrc}
                    className="w-full h-28 object-cover rounded-lg bg-black"
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                ) : (
                  <img src={imgSrc} alt="Background" className="w-full h-28 object-cover rounded-lg" />
                )}
                {bgIsVideo && (
                  <span className="absolute bottom-1 left-1 text-[10px] uppercase tracking-wider bg-black/70 text-white px-1.5 py-0.5 rounded">
                    Video
                  </span>
                )}
                <Button variant="destructive" size="icon"
                  className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={clearImage}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <button onClick={() => imgInputRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-muted rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary/50 transition-colors">
                <ImageIcon className="w-6 h-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Upload image or video</span>
                <span className="text-[10px] text-muted-foreground/70">MP4 / WebM / image</span>
              </button>
            )}
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={aiImagePrompt}
                onChange={e => setAiImagePrompt(e.target.value)}
                placeholder="AI prompt (e.g. sunset mountains)"
                className="flex-1 text-xs bg-muted/50 border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => e.key === "Enter" && generateAiBackground()}
              />
              <Button size="sm" variant="secondary" onClick={generateAiBackground}
                disabled={isGeneratingImage || !aiImagePrompt.trim()} className="shrink-0 px-2.5 gap-1">
                {isGeneratingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paintbrush className="w-3 h-3" />}
              </Button>
            </div>
            {aiImageError && <p className="text-xs text-red-400 mt-1">{aiImageError}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                Song Cache
              </Label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await fetch("/api/media/song-cache/stats");
                    if (r.ok) setCacheStats(await r.json());
                  } catch {}
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                title="Refresh cache stats"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            {cacheStats === null ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await fetch("/api/media/song-cache/stats");
                    if (r.ok) setCacheStats(await r.json());
                  } catch {}
                }}
                className="w-full text-xs py-1.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground inline-flex items-center justify-center gap-1.5"
              >
                <HardDrive className="w-3 h-3" /> Show cache usage
              </button>
            ) : (
              <div className="text-[11px] space-y-1.5 bg-muted/30 rounded p-2 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> {cacheStats.entryCount} song{cacheStats.entryCount === 1 ? "" : "s"}
                  </span>
                  <span className="font-medium">{formatBytes(cacheStats.totalBytes)} / {formatBytes(cacheStats.maxBytes)}</span>
                </div>
                <div className="h-1 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${Math.min(100, (cacheStats.totalBytes / Math.max(1, cacheStats.maxBytes)) * 100)}%` }}
                  />
                </div>
                {cacheStats.oldestMtime && (
                  <div className="text-[10px] text-muted-foreground">
                    Oldest entry: {formatRelativeTime(cacheStats.oldestMtime)}
                  </div>
                )}
                <button
                  type="button"
                  disabled={isClearingCache || cacheStats.entryCount === 0}
                  onClick={async () => {
                    if (!confirm(`Clear ${cacheStats.entryCount} cached song${cacheStats.entryCount === 1 ? "" : "s"} (${formatBytes(cacheStats.totalBytes)})? Repeats will need to redownload.`)) return;
                    let adminToken = sessionStorage.getItem("cs_admin_token");
                    if (!adminToken) {
                      const entered = window.prompt("Admin password is required to clear the song cache. Enter your admin password:");
                      if (!entered) return;
                      adminToken = entered;
                    }
                    setIsClearingCache(true);
                    try {
                      const r = await fetch("/api/media/song-cache", {
                        method: "DELETE",
                        headers: { "x-admin-token": adminToken },
                      });
                      if (r.status === 401) {
                        sessionStorage.removeItem("cs_admin_token");
                        toast({
                          title: "Not authorized",
                          description: "Admin password is incorrect. Sign in via Settings and try again.",
                          variant: "destructive",
                        });
                        return;
                      }
                      if (r.ok) {
                        sessionStorage.setItem("cs_admin_token", adminToken);
                        const data = await r.json();
                        toast({
                          title: "Cache cleared",
                          description: `Removed ${data.removedCount} song${data.removedCount === 1 ? "" : "s"} (${formatBytes(data.freedBytes)}).`,
                        });
                        const s = await fetch("/api/media/song-cache/stats");
                        if (s.ok) setCacheStats(await s.json());
                      } else {
                        let msg = `Server returned ${r.status}.`;
                        try {
                          const errBody = await r.json();
                          if (errBody?.message) msg = String(errBody.message);
                        } catch {}
                        toast({
                          title: "Couldn't clear cache",
                          description: msg,
                          variant: "destructive",
                        });
                      }
                    } catch (err) {
                      toast({
                        title: "Couldn't clear cache",
                        description: err instanceof Error ? err.message : "Network error.",
                        variant: "destructive",
                      });
                    } finally {
                      setIsClearingCache(false);
                    }
                  }}
                  className="w-full text-xs py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 border border-red-500/20"
                >
                  {isClearingCache ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Clear cache
                </button>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">
              Audio Track
            </Label>
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden"
              onChange={handleAudioUpload} />
            {audioSrc ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg">
                  <Music className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-xs truncate flex-1">{audioName}</span>
                  <Button variant="ghost" size="icon" className="w-6 h-6 shrink-0" onClick={clearAudio}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <button onClick={() => audioInputRef.current?.click()}
                className="w-full h-16 border-2 border-dashed border-muted rounded-lg flex flex-col items-center justify-center gap-1 hover:border-primary/50 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Upload audio</span>
              </button>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">
              Visualization Style
            </Label>
            <div className="grid grid-cols-4 gap-1.5">
              {VIS_STYLES.map(s => {
                const Icon = s.icon;
                return (
                  <button key={s.id} onClick={() => { setVisStyle(s.id); waterfallBuf.current = []; particlesRef.current = []; }}
                    title={`${s.label} — ${s.desc}`}
                    className={cn(
                      "p-2.5 rounded-lg border flex items-center justify-center transition-all",
                      visStyle === s.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                    )}>
                    <Icon className="w-5 h-5" />
                  </button>
                );
              })}
            </div>
            {visStyle === "gif" && (
              <div className="mt-3 p-3 rounded-lg border border-muted bg-muted/30">
                <input
                  ref={gifInputRef}
                  type="file"
                  accept="image/gif,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleGifUpload(f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => gifInputRef.current?.click()}
                  disabled={gifLoading}
                  className="w-full px-3 py-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                >
                  {gifLoading ? "Decoding…" : gifSrc ? "Replace GIF / WebP" : "Upload animated GIF or WebP"}
                </button>
                {gifName && (
                  <div className="mt-2 text-[11px] text-muted-foreground truncate" title={gifName}>
                    {gifName}
                    {gifFramesRef.current && (
                      <span className="ml-2 opacity-70">
                        · {gifFramesRef.current.frames.length} frame{gifFramesRef.current.frames.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
                {!gifSrc && (
                  <p className="mt-2 text-[11px] text-muted-foreground/80">
                    Upload an animated image to use as your visualizer. Drag the corners to resize.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
              Settings
            </Label>
            <div>
              <div className="flex justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">Color</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="color" value={color} onChange={e => setColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                <span className="text-xs text-muted-foreground font-mono">{color}</span>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Position</Label>
              <div className="flex gap-1">
                {POSITION_OPTIONS.map(p => (
                  <button key={p.id} onClick={() => { setPosition(p.id); setVisOffsetX(0); setVisOffsetY(null); }}
                    className={cn(
                      "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                      position === p.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    )}>
                    {p.label}
                  </button>
                ))}
              </div>
              {userMovedVisRef.current && (
                <button onClick={resetVisToTopLeft}
                  className="text-[10px] text-primary hover:underline mt-1">
                  Reset position &amp; size
                </button>
              )}
            </div>
            {(lyricsOffsetX !== 0 || lyricsOffsetY !== 0 || lyricsScale !== 1) && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Lyrics</Label>
                <button onClick={() => { setLyricsOffsetX(0); setLyricsOffsetY(0); setLyricsScale(1); }}
                  className="text-[10px] text-primary hover:underline">
                  Reset position &amp; size
                </button>
              </div>
            )}
            {(bgIsVideo || imgSrc !== null) && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Background</Label>
                <div className="flex gap-1 mb-1.5">
                  {(["cover", "contain"] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setBgFitMode(mode)}
                      className={cn(
                        "flex-1 py-1 rounded text-xs font-medium transition-all capitalize",
                        bgFitMode === mode
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}>
                      {mode}
                    </button>
                  ))}
                </div>
                {(bgOffsetX !== 0 || bgOffsetY !== 0 || bgScale !== 1) && (
                  <button onClick={resetBgTransform}
                    className="text-[10px] text-primary hover:underline">
                    Reset position &amp; size
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-muted-foreground" />
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Lyrics
              </Label>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={songTitle}
                onChange={e => setSongTitle(e.target.value)}
                placeholder="Song title (e.g. Shape of You)"
                className="w-full text-xs bg-muted/50 border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => e.key === "Enter" && fetchLyricsFromAPI()}
              />
              <input
                type="text"
                value={songArtist}
                onChange={e => setSongArtist(e.target.value)}
                placeholder="Artist (optional)"
                className="w-full text-xs bg-muted/50 border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => e.key === "Enter" && fetchLyricsFromAPI()}
              />
              <Button
                size="sm"
                variant="default"
                className="w-full gap-1.5 text-xs"
                disabled={!songTitle.trim() || isFetchingLyrics}
                onClick={fetchLyricsFromAPI}
              >
                {isFetchingLyrics ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Search className="w-3 h-3" />
                )}
                {isFetchingLyrics ? "Fetching..." : "Fetch Lyrics"}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
              <span className="relative bg-card px-2 text-[10px] text-muted-foreground block w-fit mx-auto">or paste manually</span>
            </div>

            {lyricsMismatch && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5 space-y-1.5">
                <p className="text-xs font-medium text-yellow-300">
                  The fetched lyrics don't seem to match this audio.
                </p>
                {lyricsMismatch.heard && (
                  <p className="text-[11px] text-yellow-100/90">
                    <span className="text-yellow-300/80">Heard:</span> "
                    {lyricsMismatch.heard.slice(0, 140)}
                    {lyricsMismatch.heard.length > 140 ? "…" : ""}"
                  </p>
                )}
                {lyricsMismatch.firstLyricLine && (
                  <p className="text-[11px] text-yellow-100/90">
                    <span className="text-yellow-300/80">First lyric line:</span> "
                    {lyricsMismatch.firstLyricLine.slice(0, 140)}
                    {lyricsMismatch.firstLyricLine.length > 140 ? "…" : ""}"
                  </p>
                )}
                <p className="text-[11px] text-yellow-100/80">
                  Try a different title/artist or paste your own lyrics.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] border-yellow-500/40 text-yellow-100 hover:bg-yellow-500/20"
                  onClick={clearLyrics}
                >
                  Clear lyrics
                </Button>
              </div>
            )}

            <div>
              <textarea
                value={manualLyrics}
                onChange={e => setManualLyrics(e.target.value)}
                placeholder="Paste lyrics here (one line per lyric line)..."
                className="w-full h-24 text-xs bg-muted/50 border border-border rounded-lg p-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Line gap sensitivity</Label>
                <span className="text-xs text-muted-foreground tabular-nums">{whisperGapThreshold.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.0"
                step="0.1"
                value={whisperGapThreshold}
                onChange={e => setWhisperGapThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-primary cursor-pointer"
              />
              <p className="text-[10px] text-muted-foreground/60">
                Lower = more lines (fast lyrics) · Higher = fewer lines (slow / spacious)
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 gap-1.5 text-xs"
                disabled={!audioSrc || isTranscribing}
                onClick={handleTranscribe}
              >
                {isTranscribing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3" />
                )}
                {isTranscribing ? "Transcribing..." : "AI Transcribe"}
              </Button>
              {manualLyrics.trim() && (
                <Button
                  size="sm"
                  variant="default"
                  className="flex-1 gap-1.5 text-xs"
                  disabled={!audioSrc || isAutoSyncing}
                  onClick={applyManualLyricsAndSync}
                >
                  {isAutoSyncing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Zap className="w-3 h-3" />
                  )}
                  {isAutoSyncing ? "Syncing..." : "Apply & Auto-Sync"}
                </Button>
              )}
            </div>

            {manualLyrics.trim() && (
              <div className="space-y-2 p-2.5 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <Label className="text-xs text-muted-foreground">Translate Lyrics</Label>
                </div>
                <div className="flex gap-1.5">
                  <select
                    value={translateLang}
                    onChange={e => setTranslateLang(e.target.value)}
                    className="flex-1 text-xs bg-muted/50 border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {TRANSLATE_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="secondary" onClick={translateLyrics}
                    disabled={isTranslating} className="shrink-0 gap-1 text-xs">
                    {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                    Translate
                  </Button>
                </div>
                {translatedLyrics && (
                  <div className="space-y-1.5">
                    <textarea
                      readOnly
                      value={translatedLyrics}
                      className="w-full h-20 text-xs bg-muted/50 border border-border rounded-lg p-2 resize-none"
                    />
                    <Button size="sm" variant="ghost" className="text-xs h-6 px-2"
                      onClick={() => {
                        setManualLyrics(translatedLyrics);
                        const lines = translatedLyrics.split("\n").filter((l: string) => l.trim());
                        if (lines.length > 0) {
                          const origSegments = lyricsSegments;
                          if (origSegments.length > 0) {
                            const origCount = origSegments.length;
                            const newCount = lines.length;
                            if (newCount === origCount) {
                              const remapped = origSegments.map((seg, i) => ({
                                text: lines[i].trim(),
                                startTime: seg.startTime,
                                endTime: seg.endTime,
                              }));
                              setLyricsSegments(remapped);
                              if (fullSyncedSegments.length === origCount) {
                                const remappedFull = fullSyncedSegments.map((seg, i) => ({
                                  text: lines[i].trim(),
                                  startTime: seg.startTime,
                                  endTime: seg.endTime,
                                }));
                                setFullSyncedSegments(remappedFull);
                              }
                            } else {
                              const remapped = lines.map((line, i) => {
                                const srcIdx = Math.min(
                                  origCount - 1,
                                  Math.max(0, Math.round((i * origCount) / newCount)),
                                );
                                const src = origSegments[srcIdx];
                                return { text: line.trim(), startTime: src.startTime, endTime: src.endTime };
                              });
                              setLyricsSegments(remapped);
                              if (fullSyncedSegments.length > 0) {
                                const fullCount = fullSyncedSegments.length;
                                const remappedFull = lines.map((line, i) => {
                                  const srcIdx = Math.min(
                                    fullCount - 1,
                                    Math.max(0, Math.round((i * fullCount) / newCount)),
                                  );
                                  const src = fullSyncedSegments[srcIdx];
                                  return { text: line.trim(), startTime: src.startTime, endTime: src.endTime };
                                });
                                setFullSyncedSegments(remappedFull);
                              }
                            }
                          } else {
                            distributeWhenReady(lines);
                          }
                        }
                        setTranslatedLyrics(null);
                      }}>
                      Use as lyrics
                    </Button>
                  </div>
                )}
              </div>
            )}

            {detectionStatus && (
              <div className="flex items-center gap-2">
                {(isFetchingLyrics || isTranscribing || isRefiningSync) && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                <p className="text-xs text-primary">{detectionStatus}</p>
              </div>
            )}

            {transcribeError && (
              <p className="text-xs text-red-400">{transcribeError}</p>
            )}

            {whisperNote && (
              <div className="flex items-start gap-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-300 flex-1">Transcribed by on-device AI — accuracy may be lower than usual</p>
                <button
                  onClick={() => setWhisperNote(false)}
                  className="text-blue-400/60 hover:text-blue-300 transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {lyricsSegments.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground flex-1 min-w-0">
                  {(() => {
                    const hasAlignment = lyricsSegments.some((s) => s.matched !== undefined);
                    const sourceLabel = lyricsSource ? {
                      "lrclib": "LrcLib",
                      "sylvatech": "Sylva Technologies",
                      "lyrics.ovh": "Lyrics.ovh",
                      "xcasper": "xcasper",
                      "musixmatch": "Musixmatch",
                      "youtube": "YouTube",
                    }[lyricsSource] ?? lyricsSource : null;
                    if (!hasAlignment) return (
                      <>
                        {`${lyricsSegments.length} line${lyricsSegments.length !== 1 ? "s" : ""} loaded`}
                        {sourceLabel && <span className="ml-1 opacity-60">· Lyrics from {sourceLabel}</span>}
                      </>
                    );
                    const matchedCount = lyricsSegments.filter((s) => s.matched).length;
                    const estimatedCount = lyricsSegments.length - matchedCount;
                    return (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          {matchedCount} matched
                        </span>
                        {estimatedCount > 0 && (
                          <span className="inline-flex items-center gap-1 ml-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500/60 inline-block" />
                            {estimatedCount} estimated
                          </span>
                        )}
                        {sourceLabel && <span className="ml-2 opacity-60">· Lyrics from {sourceLabel}</span>}
                      </>
                    );
                  })()}
                </span>
                {(() => {
                  const hasAlignment = lyricsSegments.some((s) => s.matched !== undefined);
                  if (!hasAlignment) return null;
                  const estimatedIndices = lyricsSegments
                    .map((_, i) => i)
                    .filter((i) => lyricsSegments[i].matched === false);
                  if (estimatedIndices.length === 0) return null;
                  return (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 px-2 text-yellow-400 hover:text-yellow-300 shrink-0"
                      title="Jump to next estimated line"
                      onClick={() => {
                        const next = estimatedIndices.find((i) => i > activeLyricIdx) ?? estimatedIndices[0];
                        seekToLine(lyricsSegments[next], next);
                      }}
                    >
                      Next unmatched ↓
                    </Button>
                  );
                })()}
                <Button variant="ghost" size="sm" className="text-xs h-6 px-2 shrink-0" onClick={clearLyrics}>
                  Clear
                </Button>
              </div>
            )}

            {lyricsSegments.length > 0 && audioSrc && (
              <div
                ref={lyricListScrollRef}
                tabIndex={0}
                className="max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/20 divide-y divide-border/50 outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  const nextIdx =
                    e.key === "ArrowUp"
                      ? Math.max(0, activeLyricIdx - 1)
                      : Math.min(lyricsSegments.length - 1, activeLyricIdx + 1);
                  if (nextIdx !== activeLyricIdx) {
                    seekToLine(lyricsSegments[nextIdx], nextIdx);
                  }
                }}
              >
                {(() => {
                  const hasAlignmentData = lyricsSegments.some((s) => s.matched !== undefined);
                  return lyricsSegments.map((seg, idx) => {
                    const isActive = idx === activeLyricIdx;
                    const isLooping = idx === loopSegIdx;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "group relative flex items-center",
                          isActive
                            ? "bg-primary/15"
                            : "hover:bg-muted/60"
                        )}
                      >
                        {hasAlignmentData && (
                          <span
                            title={seg.matched ? "Matched — timing found in audio" : "Estimated — interpolated between matched lines"}
                            className={cn(
                              "ml-2 flex-shrink-0 w-1.5 h-1.5 rounded-full",
                              seg.matched ? "bg-green-500" : "bg-yellow-500/60"
                            )}
                          />
                        )}
                        <button
                          onClick={() => { seekToLine(seg, idx); lyricListScrollRef.current?.focus({ preventScroll: true }); }}
                          className={cn(
                            "flex-1 text-left px-3 py-1.5 text-xs transition-colors pr-8",
                            isActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {seg.text}
                        </button>
                        <span
                          aria-hidden
                          className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-mono tabular-nums text-[10px] text-muted-foreground"
                        >
                          {`${formatBadgeTime(seg.startTime)} – ${formatBadgeTime(seg.endTime)}`}
                        </span>
                        <button
                          title={isLooping ? "Stop looping this line" : "Loop this line"}
                          onClick={() => loopSegment(seg, idx)}
                          className={cn(
                            "absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-all",
                            isLooping
                              ? "opacity-100 text-green-400 hover:text-green-300"
                              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Repeat className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {lyricsSegments.length > 0 && (fullSyncedSegments.length > 0 || isAutoSyncing || autoSyncMessage) && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground block">Lyrics Timing (offset: {lyricsOffset}s)</Label>
                    <button
                      onClick={() => handleAutoSync()}
                      disabled={isAutoSyncing}
                      title="Listen to the audio and snap lyrics to the first sung word"
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all shrink-0",
                        isAutoSyncing
                          ? "bg-primary/50 text-primary-foreground cursor-wait"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}
                    >
                      {isAutoSyncing ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Aligning...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-3 h-3" />
                          <span id="lyrics-resync-anchor">Re-sync to vocals</span>
                        </>
                      )}
                    </button>
                  </div>
                  {lyricsAreDistributed && !isAutoSyncing && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                        Estimated timing — click Re-sync to align to vocals
                      </span>
                    </div>
                  )}
                  {detectedIntroInfo && detectedIntroInfo.audioSrc === audioSrc && !introHintDismissed && !lyricsAreDistributed && (
                    <div className="flex items-center justify-between gap-1.5 mb-1 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/25">
                      <span className="text-[10px] text-blue-300 leading-snug">
                        <span className="font-medium">{detectedIntroInfo.vocalOnset.toFixed(1)}s intro detected</span>
                        {" "}— first lyric at {Math.floor(detectedIntroInfo.vocalOnset / 60)}:{String((detectedIntroInfo.vocalOnset % 60).toFixed(0)).padStart(2, "0")}
                        {" "}
                        <span className="opacity-60">via {
                          detectedIntroInfo.source === "whisper" ? "Whisper"
                          : detectedIntroInfo.source === "consensus" ? "Whisper + AI"
                          : detectedIntroInfo.source === "consensus-acoustic" ? "acoustic + AI"
                          : detectedIntroInfo.source === "gemini" ? "AI"
                          : detectedIntroInfo.source === "python" ? "Whisper"
                          : detectedIntroInfo.source === "acoustic-fallback" ? "acoustic"
                          : detectedIntroInfo.source === "manual" ? "manual"
                          : detectedIntroInfo.source
                        }</span>
                      </span>
                      <button
                        onClick={() => setIntroHintDismissed(true)}
                        className="text-[10px] text-blue-400/60 hover:text-blue-300 shrink-0 leading-none"
                        title="Dismiss"
                      >✕</button>
                    </div>
                  )}
                  {lineByLineSync && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-300 border border-green-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        Line-by-line sync active
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {lineByLineSync.matched}/{lineByLineSync.total} lines matched
                      </span>
                    </div>
                  )}
                  {autoSyncMessage && (
                    <p className={cn(
                      "text-[10px] mb-1 whitespace-pre-line",
                      (autoSyncMessage.startsWith("Synced") || autoSyncMessage.startsWith("Aligned") || autoSyncMessage.includes("intro detected")) ? "text-green-400" : "text-yellow-400"
                    )}>{autoSyncMessage}</p>
                  )}
                  <div id="lyrics-offset-anchor" className="flex items-center gap-1 flex-wrap">
                    <button onClick={() => handleManualOffsetChange(lyricsOffset - 5)}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">-5s</button>
                    <button onClick={() => handleManualOffsetChange(lyricsOffset - 1)}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">-1s</button>
                    <button onClick={() => handleManualOffsetChange(Number((lyricsOffset - 0.5).toFixed(1)))}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">-.5s</button>
                    <button onClick={() => handleManualOffsetChange(Number((lyricsOffset - 0.1).toFixed(1)))}
                      className="px-1.5 py-1 rounded text-xs bg-primary/20 hover:bg-primary/30 text-primary shrink-0">-.1s</button>
                    <input type="range"
                      min={-60} max={60}
                      step={0.1} value={lyricsOffset}
                      onChange={e => handleManualOffsetChange(Number(e.target.value))}
                      className="flex-1 min-w-[60px] h-1.5 accent-primary" />
                    <button onClick={() => handleManualOffsetChange(Number((lyricsOffset + 0.1).toFixed(1)))}
                      className="px-1.5 py-1 rounded text-xs bg-primary/20 hover:bg-primary/30 text-primary shrink-0">+.1s</button>
                    <button onClick={() => handleManualOffsetChange(Number((lyricsOffset + 0.5).toFixed(1)))}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">+.5s</button>
                    <button onClick={() => handleManualOffsetChange(lyricsOffset + 1)}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">+1s</button>
                    <button onClick={() => handleManualOffsetChange(lyricsOffset + 5)}
                      className="px-1.5 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-foreground shrink-0">+5s</button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">If lyrics appear <span className="text-yellow-400">too late</span>, tap <span className="font-mono text-primary">+.1s</span> or <span className="font-mono text-primary">+1s</span> to bring them earlier. If <span className="text-yellow-400">too early</span>, tap the minus buttons.</p>
                </div>

                <div className="pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs text-muted-foreground">Tap to Sync</Label>
                    <button
                      onClick={() => {
                        if (!tapSyncMode) {
                          setTapSyncIdx(0);
                          setTapSyncMode(true);
                        } else {
                          setTapSyncMode(false);
                        }
                      }}
                      className={cn(
                        "px-2 py-1 rounded text-xs font-medium transition-all",
                        tapSyncMode ? "bg-red-500/80 text-white hover:bg-red-500" : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}
                    >
                      {tapSyncMode ? "Stop" : "Start"}
                    </button>
                  </div>
                  {tapSyncMode ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        Play the audio and tap the button exactly when each line starts being sung.
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {tapSyncIdx + 1}/{lyricsSegments.length}
                        </span>
                        <button
                          onClick={() => {
                            const audio = audioRef.current;
                            if (!audio || tapSyncIdx >= lyricsSegments.length) return;
                            const t = audio.currentTime;
                            setLyricsSegments(prev => {
                              const next = prev.map((s, i) => {
                                if (i === tapSyncIdx) {
                                  // Ensure endTime stays ahead of the new startTime so
                                  // the line is visible until the next tap arrives.
                                  // Keep the original duration when it's still valid,
                                  // otherwise use a 4s placeholder that the next tap
                                  // will replace with the real value.
                                  const origDuration = s.endTime - s.startTime;
                                  const minEnd = t + (origDuration > 0.1 ? origDuration : 4.0);
                                  return { ...s, startTime: t, endTime: Math.max(minEnd, t + 0.5) };
                                }
                                if (i === tapSyncIdx - 1) return { ...s, endTime: t };
                                return s;
                              });
                              return next;
                            });
                            if (tapSyncIdx + 1 >= lyricsSegments.length) {
                              setTapSyncMode(false);
                            } else {
                              setTapSyncIdx(i => i + 1);
                            }
                          }}
                          className="flex-1 py-2 rounded text-xs font-bold bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 active:scale-95 transition-all truncate text-left px-2"
                        >
                          ▶ {lyricsSegments[tapSyncIdx]?.text ?? "Done"}
                        </button>
                      </div>
                      {tapSyncIdx > 0 && (
                        <button
                          onClick={() => setTapSyncIdx(i => Math.max(0, i - 1))}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline"
                        >
                          ← Undo last tap
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Play the audio and tap each lyric line in real time to set its exact start time.
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">
                      Highlight Speed ({lyricsPace.toFixed(2)}×)
                    </Label>
                    <button
                      onClick={() => setLyricsPace(1)}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    >
                      Reset
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] text-primary shrink-0">Faster</span>
                    <input
                      type="range"
                      min={0.2} max={2} step={0.05}
                      value={lyricsPace}
                      onChange={e => setLyricsPace(Number(e.target.value))}
                      className="flex-1 h-1.5 accent-primary"
                    />
                    <span className="text-[10px] text-muted-foreground shrink-0">Slower</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Controls how fast the karaoke highlight sweeps across each line. If the highlight lags behind the singing, drag left toward <span className="text-primary">Faster</span>. Try{" "}
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("lyrics-resync-anchor");
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Re-sync to vocals
                    </button>
                    {" "}first, then adjust offset and speed.
                  </p>
                </div>

                <div>
                  <button
                    onClick={() => setShowLyricTimeline(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Sliders className="w-3 h-3" />
                    {showLyricTimeline ? 'Hide' : 'Fine-tune'} individual line timing
                  </button>
                  {showLyricTimeline && audioDuration > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] text-muted-foreground">Drag a block to shift it. Drag its edges to adjust start/end. Changes apply instantly.</p>
                      <div className="relative">
                      <div
                        ref={lyricTimelineScrollRef}
                        className="w-full bg-muted/40 rounded border border-border select-none overflow-y-auto overflow-x-hidden"
                        style={{ maxHeight: '220px' }}
                      >
                        <div className="flex">
                        {/* Sticky left label gutter */}
                        <div
                          className="sticky left-0 shrink-0 z-10 bg-muted/90 border-r border-border"
                          style={{ width: '32px', minHeight: `${Math.max(TIMELINE_ROW_H * 2, lyricsSegments.length * TIMELINE_ROW_H)}px` }}
                        >
                          {/* Spacer aligns with the first row (ruler area is 0-height in the gutter) */}
                          {lyricsSegments.map((seg, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-center"
                              style={{ height: `${TIMELINE_ROW_H}px`, marginTop: idx === 0 ? `${TIMELINE_ROW_TOP_OFFSET}px` : '0' }}
                              title={seg.text}
                            >
                              <span className="text-[8px] text-muted-foreground leading-none select-none font-mono">
                                {idx + 1}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div
                          ref={lyricTimelineRef}
                          className="relative flex-1 min-w-0"
                          style={{ height: `${Math.max(TIMELINE_ROW_H * 2, lyricsSegments.length * TIMELINE_ROW_H)}px` }}
                        >
                        {/* Time ruler ticks */}
                        {Array.from({ length: Math.ceil(audioDuration / 10) + 1 }, (_, i) => i * 10).filter(t => t <= audioDuration).map(t => (
                          <div key={t} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${(t / audioDuration) * 100}%` }}>
                            <div className="w-px h-full bg-border/60" />
                            <span className="absolute top-0.5 text-[8px] text-muted-foreground pl-0.5">{t}s</span>
                          </div>
                        ))}
                        {/* Lyric segment blocks — one lane per line */}
                        {lyricsSegments.map((seg, idx) => {
                          const left = (seg.startTime / audioDuration) * 100;
                          const width = Math.max(0.5, ((seg.endTime - seg.startTime) / audioDuration) * 100);
                          const isActive = activeLyricIdx === idx;
                          const isEstimated = seg.matched === false;
                          const isEditing = editingLyricIdx === idx;
                          const blockColor = idx % 2 === 0 ? 'bg-primary/70 border-primary/80' : 'bg-blue-500/60 border-blue-400/80';
                          return (
                            <div
                              key={idx}
                              className={cn(
                                'absolute border rounded-sm flex items-center overflow-hidden transition-opacity',
                                blockColor,
                                isEstimated && !isEditing ? 'border-dashed border-yellow-400/80' : '',
                                isEditing ? 'opacity-100 ring-1 ring-white/60 overflow-visible' : isActive ? 'opacity-100 ring-1 ring-white/40' : 'opacity-70 hover:opacity-90'
                              )}
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                top: `${idx * TIMELINE_ROW_H + TIMELINE_ROW_TOP_OFFSET}px`,
                                height: `${TIMELINE_BLOCK_H}px`,
                                cursor: isEditing ? 'text' : 'grab',
                              }}
                              title={isEditing ? undefined : `${seg.text} (${seg.startTime.toFixed(2)}s – ${seg.endTime.toFixed(2)}s)${isEstimated ? " · estimated timing — drag to adjust" : ""}`}
                              onDoubleClick={e => {
                                e.stopPropagation();
                                setEditingLyricIdx(idx);
                                setEditingLyricText(seg.text);
                              }}
                              onMouseDown={e => {
                                if (isEditing) return;
                                e.preventDefault();
                                const container = lyricTimelineRef.current;
                                if (!container) return;
                                const rect = container.getBoundingClientRect();
                                const relX = e.clientX - rect.left;
                                const blockLeft = (seg.startTime / audioDuration) * rect.width;
                                const blockRight = (seg.endTime / audioDuration) * rect.width;
                                const HANDLE = 6;
                                let part: 'start' | 'end' | 'move' = 'move';
                                if (relX - blockLeft <= HANDLE) part = 'start';
                                else if (blockRight - relX <= HANDLE) part = 'end';
                                lyricDragRef.current = {
                                  segIdx: idx,
                                  part,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                  origStart: seg.startTime,
                                  origEnd: seg.endTime,
                                  containerWidth: rect.width,
                                  totalDuration: audioDuration,
                                };
                                document.body.style.cursor = part === 'move' ? 'grabbing' : 'ew-resize';
                                document.body.style.userSelect = 'none';
                              }}
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  value={editingLyricText}
                                  onChange={e => setEditingLyricText(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      lyricEditKeyClosedRef.current = true;
                                      const trimmed = editingLyricText.trim();
                                      setLyricsSegments(segs => segs.map((s, i) => i === idx ? { ...s, text: trimmed || s.text } : s));
                                      setEditingLyricIdx(null);
                                    } else if (e.key === 'Escape') {
                                      lyricEditKeyClosedRef.current = true;
                                      setEditingLyricIdx(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    if (lyricEditKeyClosedRef.current) {
                                      lyricEditKeyClosedRef.current = false;
                                      return;
                                    }
                                    const trimmed = editingLyricText.trim();
                                    setLyricsSegments(segs => segs.map((s, i) => i === idx ? { ...s, text: trimmed || s.text } : s));
                                    setEditingLyricIdx(null);
                                  }}
                                  onMouseDown={e => e.stopPropagation()}
                                  className="w-full px-1 text-[7px] text-white font-medium leading-none bg-transparent outline-none border-none min-w-0"
                                  style={{ caretColor: 'white' }}
                                />
                              ) : (
                                <>
                                  {/* Left edge handle */}
                                  <div
                                    className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40"
                                    onMouseDown={e => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const container = lyricTimelineRef.current;
                                      if (!container) return;
                                      const rect = container.getBoundingClientRect();
                                      lyricDragRef.current = {
                                        segIdx: idx, part: 'start',
                                        startX: e.clientX, startY: e.clientY,
                                        origStart: seg.startTime, origEnd: seg.endTime,
                                        containerWidth: rect.width, totalDuration: audioDuration,
                                      };
                                      document.body.style.cursor = 'ew-resize';
                                      document.body.style.userSelect = 'none';
                                    }}
                                  />
                                  <span className="px-1 text-[7px] text-white font-medium truncate leading-none pointer-events-none">
                                    {seg.text}
                                  </span>
                                  {/* Right edge handle */}
                                  <div
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 hover:bg-white/40"
                                    onMouseDown={e => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const container = lyricTimelineRef.current;
                                      if (!container) return;
                                      const rect = container.getBoundingClientRect();
                                      lyricDragRef.current = {
                                        segIdx: idx, part: 'end',
                                        startX: e.clientX, startY: e.clientY,
                                        origStart: seg.startTime, origEnd: seg.endTime,
                                        containerWidth: rect.width, totalDuration: audioDuration,
                                      };
                                      document.body.style.cursor = 'ew-resize';
                                      document.body.style.userSelect = 'none';
                                    }}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                        </div>
                        </div>
                      </div>
                      {lyricTimelineScrollPaused && (
                        <div className="absolute bottom-2 right-2 z-20">
                          <button
                            onClick={() => {
                              if (lyricTimelinePauseTimerRef.current) clearTimeout(lyricTimelinePauseTimerRef.current);
                              setLyricTimelineScrollPaused(false);
                            }}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-background/90 border border-border text-muted-foreground hover:text-foreground shadow-sm transition-colors"
                          >
                            ↓ Resume scroll
                          </button>
                        </div>
                      )}
                      </div>
                      <button
                        onClick={() => setLyricsSegments(lyricsSegments.map((s, i) => {
                          const orig = fullSyncedSegments[i];
                          return orig ? { ...s, startTime: orig.startTime, endTime: orig.endTime } : s;
                        }))}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                      >
                        Reset to auto-sync timing
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {lyricsSegments.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Bookmark className="w-3.5 h-3.5" /> Style Presets
                    </Label>
                    <button
                      onClick={() => setSavePresetOpen(v => !v)}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      data-testid="button-toggle-save-preset"
                    >
                      <BookmarkPlus className="w-3 h-3" />
                      {savePresetOpen ? "Cancel" : "Save current"}
                    </button>
                  </div>
                  {savePresetOpen && (
                    <div className="flex gap-1 mb-1.5">
                      <input
                        autoFocus
                        value={savePresetName}
                        onChange={e => setSavePresetName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveCurrentAsLyricStylePreset(); }}
                        placeholder="Preset name (e.g. My TikTok)"
                        className="flex-1 text-xs bg-muted/50 border border-border rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                        data-testid="input-preset-name"
                      />
                      <button
                        onClick={saveCurrentAsLyricStylePreset}
                        className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                        data-testid="button-save-preset"
                      >
                        Save
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {DEFAULT_LYRIC_STYLE_PRESETS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => applyLyricStylePreset(p)}
                        className="pl-1 pr-2 py-1 inline-flex items-center gap-1.5 text-[10px] rounded-full bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                        data-testid={`button-apply-preset-${p.id}`}
                        title={`Apply ${p.name}`}
                      >
                        <LyricStylePresetPreview preset={p} />
                        <span>{p.name}</span>
                      </button>
                    ))}
                    {lyricStylePresets.map(p => (
                      <span
                        key={p.id}
                        className="group inline-flex items-center rounded-full bg-muted text-muted-foreground hover:bg-primary/80 hover:text-primary-foreground transition-colors"
                      >
                        <button
                          onClick={() => applyLyricStylePreset(p)}
                          className="pl-1 pr-1 py-1 text-[10px] inline-flex items-center gap-1.5"
                          data-testid={`button-apply-preset-${p.id}`}
                          title={`Apply ${p.name}`}
                        >
                          <LyricStylePresetPreview preset={p} />
                          <span>{p.name}</span>
                        </button>
                        <button
                          onClick={() => deleteLyricStylePreset(p.id)}
                          className="pl-0.5 pr-1.5 py-1 opacity-60 hover:opacity-100"
                          aria-label={`Delete ${p.name}`}
                          data-testid={`button-delete-preset-${p.id}`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <RangeSlider label="Font Size" value={lyricsFontSize} min={16} max={72} step={2}
                  unit="px" onChange={setLyricsFontSize} />

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Font Family</Label>
                  <select value={lyricsFontFamily} onChange={e => setLyricsFontFamily(e.target.value as LyricsFontFamily)}
                    className="w-full text-xs bg-muted/50 border border-border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-primary">
                    {FONT_OPTIONS.map(f => (
                      <option key={f.id} value={f.id} style={{ fontFamily: f.id }}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Highlight Style</Label>
                  <select
                    value={lyricsHighlightStyle}
                    onChange={e => setLyricsHighlightStyle(e.target.value as LyricsHighlightStyle)}
                    className="w-full text-xs bg-muted/50 border border-border rounded-lg p-2 mb-1 focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {LYRICS_HIGHLIGHT_STYLES.map(s => (
                      <option key={s.id} value={s.id}>{s.label} — {s.desc}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Text Style</Label>
                  <div className="flex gap-1">
                    <button onClick={() => setLyricsBold(!lyricsBold)}
                      className={cn(
                        "flex-1 py-1.5 rounded text-xs font-medium transition-all flex items-center justify-center gap-1",
                        lyricsBold ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                      )}>
                      <Bold className="w-3 h-3" /> B
                    </button>
                    <button onClick={() => setLyricsItalic(!lyricsItalic)}
                      className={cn(
                        "flex-1 py-1.5 rounded text-xs font-medium transition-all flex items-center justify-center gap-1",
                        lyricsItalic ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                      )}>
                      <Italic className="w-3 h-3" /> I
                    </button>
                    <button onClick={() => setLyricsOutline(!lyricsOutline)}
                      className={cn(
                        "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                        lyricsOutline ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                      )}>
                      Outline
                    </button>
                    <button onClick={() => setLyricsGlow(!lyricsGlow)}
                      className={cn(
                        "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                        lyricsGlow ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                      )}>
                      Glow
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1 mt-1.5">
                    {([
                      ["Drop Shadow", lyricsDropShadow, setLyricsDropShadow],
                      ["Hard Shadow", lyricsHardShadow, setLyricsHardShadow],
                      ["Neon", lyricsNeon, setLyricsNeon],
                      ["3D", lyrics3D, setLyrics3D],
                      ["Gradient", lyricsGradient, setLyricsGradient],
                      ["Stroke", lyricsStroke, setLyricsStroke],
                      ["Underline", lyricsUnderline, setLyricsUnderline],
                      ["Strike", lyricsStrikethrough, setLyricsStrikethrough],
                      ["UPPERCASE", lyricsUppercase, setLyricsUppercase],
                      ["Small Caps", lyricsSmallCaps, setLyricsSmallCaps],
                      ["BG Pill", lyricsBgPill, setLyricsBgPill],
                      ["Sticker", lyricsSticker, setLyricsSticker],
                      ["Comic Pop", lyricsComicPop, setLyricsComicPop],
                      ["Subtitle Bar", lyricsSubtitleBar, setLyricsSubtitleBar],
                      ["Pop Active Word", lyricsPopActiveWord, setLyricsPopActiveWord],
                    ] as [string, boolean, (v: boolean) => void][]).map(([label, val, set]) => (
                      <button
                        key={label}
                        onClick={() => set(!val)}
                        className={cn(
                          "py-1 rounded text-[10px] font-medium transition-all",
                          val ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {lyricsPopActiveWord && (
                    <div className="mt-2 space-y-2">
                      <div>
                        <div className="flex justify-between mb-1">
                          <Label className="text-[10px] text-muted-foreground">
                            Pop Intensity
                          </Label>
                          <span className="text-[10px] text-muted-foreground">{lyricsPopIntensity}%</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={100} step={1}
                          value={lyricsPopIntensity}
                          onChange={e => setLyricsPopIntensity(Number(e.target.value))}
                          className="w-full h-1.5 accent-primary"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-[10px] text-muted-foreground">
                          Pop Accent Color
                        </Label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={lyricsPopAccentColor || lyricsHighlightColor}
                            onChange={e => setLyricsPopAccentColor(e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                            title="Defaults to highlight color"
                          />
                          {lyricsPopAccentColor && (
                            <button
                              type="button"
                              onClick={() => setLyricsPopAccentColor("")}
                              className="text-[10px] text-muted-foreground hover:text-foreground underline"
                              title="Reset to highlight color"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-2">
                    <div className="flex justify-between mb-1">
                      <Label className="text-[10px] text-muted-foreground">
                        Letter Spacing
                      </Label>
                      <span className="text-[10px] text-muted-foreground">{lyricsLetterSpacing}px</span>
                    </div>
                    <input
                      type="range"
                      min={-2} max={20} step={1}
                      value={lyricsLetterSpacing}
                      onChange={e => setLyricsLetterSpacing(Number(e.target.value))}
                      className="w-full h-1.5 accent-primary"
                    />
                  </div>

                  {(lyricsBgPill || lyricsSubtitleBar) && (
                    <div className="mt-2 space-y-2 pt-2 border-t border-border/50">
                      <Label className="text-[10px] text-muted-foreground block">Background Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={lyricsBgColor}
                          onChange={e => setLyricsBgColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                          title="Background color"
                        />
                        <span className="text-[10px] text-muted-foreground font-mono">{lyricsBgColor}</span>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <Label className="text-[10px] text-muted-foreground">Opacity</Label>
                          <span className="text-[10px] text-muted-foreground">{Math.round(lyricsBgOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0} max={1} step={0.05}
                          value={lyricsBgOpacity}
                          onChange={e => setLyricsBgOpacity(Number(e.target.value))}
                          className="w-full h-1.5 accent-primary"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
                    <Label className="text-xs text-muted-foreground">Auto Emoji</Label>
                  </div>
                  <button
                    onClick={() => setAutoEmoji(!autoEmoji)}
                    className={cn(
                      "w-8 h-4 rounded-full transition-colors relative",
                      autoEmoji ? "bg-primary" : "bg-muted"
                    )}>
                    <div className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all"
                      style={{ left: autoEmoji ? "18px" : "2px" }} />
                  </button>
                </div>

                <div>
                  <div className="flex justify-between mb-1.5">
                    <Label className="text-xs text-muted-foreground">Text Color</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={lyricsColor} onChange={e => setLyricsColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                    <span className="text-xs text-muted-foreground font-mono">{lyricsColor}</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1.5">
                    <Label className="text-xs text-muted-foreground">Highlight Color</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={lyricsHighlightColor} onChange={e => setLyricsHighlightColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                    <span className="text-xs text-muted-foreground font-mono">{lyricsHighlightColor}</span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Lyrics Position</Label>
                  <div className="flex gap-1">
                    {LYRICS_POSITION_OPTIONS.map(p => (
                      <button key={p.id} onClick={() => setLyricsPosition(p.id)}
                        className={cn(
                          "flex-1 py-1.5 rounded text-xs font-medium transition-all",
                          lyricsPosition === p.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        )}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
