import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response } from "express";
import { translate as gTranslate } from "@vitalets/google-translate-api";
import { ADMIN_PASSWORD } from "../config/admin-config.js";
import { sendOpsAlert } from "../lib/ops-alert.js";
import { buildAuroraFluxOverlayFilter } from "../lib/video-overlay.js";
import {
  enqueueVideoExport,
  getVideoExportChunkSeconds,
  getVideoExportStatus,
  isVideoExportQueueEnabled,
  shouldQueueVideoExport,
} from "../lib/video-export-queue.js";

const router: IRouter = Router();

const uploadDir = path.join(process.cwd(), "tmp_uploads");
const outputDir = path.join(process.cwd(), "tmp_outputs");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, _file, cb) => cb(null, `${uuidv4()}.tmp`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error(`Only image and video files are supported`));
    }
  },
});

function scheduleCleanup(filePath: string, delayMs = 30 * 60 * 1000) {
  setTimeout(() => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }, delayMs);
}

const QUOTA_RETRY_DELAYS_MS = [2000, 4000, 8000];

function isQuotaError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function withQuotaRetry(
  fn: () => Promise<string | null>,
  log: { warn: (obj: object, msg?: string) => void },
  onRetry?: (attempt: number, total: number) => void,
): Promise<{ text: string | null; quota: boolean }> {
  for (let attempt = 0; attempt <= QUOTA_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const text = await fn();
      return { text, quota: false };
    } catch (err) {
      if (isQuotaError(err)) {
        if (attempt < QUOTA_RETRY_DELAYS_MS.length) {
          log.warn({ attempt: attempt + 1, delay: QUOTA_RETRY_DELAYS_MS[attempt] }, "Gemini quota error, retrying after delay");
          await sleep(QUOTA_RETRY_DELAYS_MS[attempt]);
          onRetry?.(attempt + 1, QUOTA_RETRY_DELAYS_MS.length);
        } else {
          log.warn({ err }, "Gemini quota error after all retries exhausted");
          return { text: null, quota: true };
        }
      } else {
        throw err;
      }
    }
  }
  return { text: null, quota: false };
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    proc.on("error", reject);
  });
}

function runProcessCaptureStderr(cmd: string, args: string[]): Promise<{ stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stderr, code: code ?? -1 }));
    proc.on("error", () => resolve({ stderr, code: -1 }));
  });
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface PythonVocalResult {
  vocalOnset: number | null;
  method?: string;
  allOnsets?: number[];
  harmonicRmsMax?: number;
  firstWordTime?: number | null;
  firstWord?: string | null;
  matchedTime?: number | null;
  matchedWord?: string | null;
  transcript?: string;
  wordCount?: number;
  words?: WhisperWord[];
  language?: string | null;
  librosaFallback?: { vocalOnset: number | null };
  whisperAttempt?: { error?: string };
  error?: string;
}

// Tokenize lyric / transcript text for alignment (lowercase, strip punctuation,
// drop very short tokens that don't carry meaning).
function tokenizeForAlign(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(t => t.length >= 2);
}

interface AlignedLine {
  text: string;
  startTime: number;
  endTime: number;
  matched: boolean;
  // Per-word timings inside this line (only populated when the line was
  // confidently matched against Whisper words). Undefined for unmatched /
  // interpolated lines so the client falls back to linear timing.
  words?: { text: string; start: number; end: number }[];
}

/**
 * Force-align user lyric lines to whisper word timestamps.
 *
 * For each LRC line, we slide a window over the next chunk of whisper words
 * and pick the contiguous run whose tokens overlap the line's tokens the most.
 * The cursor advances after each match so lines stay monotonic. Lines that
 * can't be matched confidently are interpolated linearly between their
 * neighbors so timing never goes backwards.
 *
 * Returns the per-line timings plus how many lines were confidently matched
 * (the caller decides whether the confidence is high enough to use the result).
 */
function forceAlignLyricsToWords(
  lyrics: { text: string }[],
  words: WhisperWord[],
): { aligned: AlignedLine[]; matched: number } {
  if (!Array.isArray(words) || words.length === 0 || lyrics.length === 0) {
    return { aligned: [], matched: 0 };
  }

  const cleanWords = words
    .map(w => ({
      tok: tokenizeForAlign(w.word).join(""),
      text: (w.word || "").trim(),
      start: Number(w.start),
      end: Number(w.end),
    }))
    .filter(w => w.tok && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);

  if (cleanWords.length === 0) return { aligned: [], matched: 0 };

  type Slot = {
    idx: number;
    matched: boolean;
    startTime: number;
    endTime: number;
    words?: { text: string; start: number; end: number }[];
  };
  const slots: Slot[] = lyrics.map((_, idx) => ({ idx, matched: false, startTime: -1, endTime: -1 }));

  let cursor = 0;
  let matched = 0;

  for (let li = 0; li < lyrics.length; li++) {
    const lineTokens = tokenizeForAlign(lyrics[li].text);
    if (lineTokens.length === 0) continue;
    const lineSet = new Set(lineTokens);
    const lineLen = lineTokens.length;

    // Bounded look-ahead window: enough to skip an instrumental break
    // (~lineLen * 8 words, minimum 60). Long instrumentals between verses
    // produce no whisper words, so this still works — the next vocal line
    // starts wherever whisper picks up singing again.
    const lookEnd = Math.min(cleanWords.length, cursor + Math.max(60, lineLen * 8));
    if (lookEnd <= cursor) break;

    const minLen = Math.max(1, Math.floor(lineLen * 0.5));
    const maxLen = Math.max(lineLen + 3, Math.ceil(lineLen * 2));

    let best = { score: -Infinity, start: -1, end: -1, hits: 0 };
    for (let s = cursor; s < lookEnd; s++) {
      const maxL = Math.min(maxLen, lookEnd - s);
      let hits = 0;
      // Incrementally extend the window from length 1 → maxL so we don't
      // re-scan tokens for every (s, L) pair.
      for (let L = 1; L <= maxL; L++) {
        if (lineSet.has(cleanWords[s + L - 1].tok)) hits++;
        if (L < minLen) continue;
        // F1-style score so windows are penalized for padding with non-
        // matching words (precision) AND for missing the line's content
        // (recall). Pure hit-count rewarded extending the window past
        // matched tokens whenever a later word happened to repeat one of
        // the line's tokens (e.g. "verse" in chorus repeats).
        const precision = hits / L;
        const recall = hits / lineLen;
        const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        // Tiny proximity penalty so equally-good later windows don't beat
        // an in-place match. (Scale << f1 so it can't override real signal.)
        const proximityPenalty = (s - cursor) * 0.001;
        const score = f1 - proximityPenalty;
        if (score > best.score) {
          best = { score, start: s, end: s + L - 1, hits };
        }
      }
    }

    // Need to match at least 40% of the line's content tokens (and at least 1).
    const minMatch = Math.max(1, Math.ceil(lineLen * 0.4));
    if (best.start >= 0 && best.hits >= minMatch) {
      slots[li].matched = true;
      slots[li].startTime = cleanWords[best.start].start;
      slots[li].endTime = cleanWords[best.end].end;
      const matchedWords = cleanWords
        .slice(best.start, best.end + 1)
        .map(w => ({ text: w.text, start: w.start, end: w.end }));
      // Smooth held notes: Whisper word_timestamps occasionally end a
      // sustained vowel (e.g. "Aaaaah") at the syllable boundary instead of
      // the actual sung release, leaving a noticeable gap before the next
      // word. The karaoke highlight would then race ahead and pause. Extend
      // each interior word's end up to the next word's start when the gap
      // is short enough to be a held note rather than a real instrumental
      // break. 2.0 s comfortably covers typical sustained vowels while
      // staying short enough that real in-line silences (which line
      // splitting upstream tends to break with the 0.8 s gap threshold)
      // generally fall on a line boundary, not inside a single line.
      const HELD_NOTE_BRIDGE_S = 2.0;
      for (let k = 0; k < matchedWords.length - 1; k++) {
        const gap = matchedWords[k + 1].start - matchedWords[k].end;
        if (gap > 0 && gap <= HELD_NOTE_BRIDGE_S) {
          matchedWords[k].end = matchedWords[k + 1].start;
        }
      }
      slots[li].words = matchedWords;
      cursor = best.end + 1;
      matched++;
    }
  }

  // Interpolate unmatched lines linearly between their nearest matched neighbors
  // so the timeline stays monotonic and every line has a real start/end.
  const transcriptStart = cleanWords[0].start;
  const transcriptEnd = cleanWords[cleanWords.length - 1].end;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].matched) continue;
    let pi = i - 1;
    while (pi >= 0 && !slots[pi].matched) pi--;
    let ni = i + 1;
    while (ni < slots.length && !slots[ni].matched) ni++;

    const prevEnd = pi >= 0 ? slots[pi].endTime : Math.max(0, transcriptStart - 0.5);
    const nextStart = ni < slots.length ? slots[ni].startTime : transcriptEnd + 1.5;
    const span = Math.max(0.1, nextStart - prevEnd);
    const totalSlots = (ni < slots.length ? ni : slots.length) - (pi >= 0 ? pi : -1);
    const offset = i - (pi >= 0 ? pi : -1);
    const t = prevEnd + (span * offset) / Math.max(1, totalSlots);
    const tEnd = prevEnd + (span * (offset + 0.95)) / Math.max(1, totalSlots);
    slots[i].startTime = Math.max(prevEnd, t);
    slots[i].endTime = Math.max(slots[i].startTime + 0.2, tEnd);
  }

  // Final monotonicity pass — never let a line start before the previous ended.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].startTime < slots[i - 1].endTime) {
      slots[i].startTime = slots[i - 1].endTime;
      if (slots[i].endTime < slots[i].startTime + 0.2) {
        slots[i].endTime = slots[i].startTime + 0.5;
      }
    }
  }

  // Smooth held notes across line boundaries: when the singer holds the last
  // word of a line and the next line follows after only a short gap, Whisper
  // ends the held word at its syllable boundary, leaving the karaoke wipe to
  // complete early and pause until the next line begins. Mirror the in-line
  // HELD_NOTE_BRIDGE_S behavior at the line boundary by extending the slot's
  // endTime (and the last matched word's end) up to the next slot's start.
  // Threshold matches drawScene's GAP_HOLD_THRESHOLD (2.0 s) — anything
  // longer is treated as a real instrumental break and keeps the existing
  // gap-fade behavior in the renderer.
  const HELD_NOTE_LINE_BRIDGE_S = 2.0;
  for (let i = 0; i < slots.length - 1; i++) {
    const cur = slots[i];
    const next = slots[i + 1];
    const gap = next.startTime - cur.endTime;
    if (gap > 0 && gap < HELD_NOTE_LINE_BRIDGE_S) {
      cur.endTime = next.startTime;
      if (cur.words && cur.words.length > 0) {
        const lastWord = cur.words[cur.words.length - 1];
        if (lastWord.end < next.startTime) {
          lastWord.end = next.startTime;
        }
      }
    }
  }

  const aligned: AlignedLine[] = slots.map((s, idx) => ({
    text: lyrics[idx].text,
    startTime: s.startTime,
    endTime: s.endTime,
    matched: s.matched,
    words: s.words,
  }));
  return { aligned, matched };
}

/**
 * Groups Whisper word-level timestamps into display-ready lyric lines.
 *
 * Heuristics (in priority order):
 *  1. Hard sentence boundary — word ends with '.', '?' or '!' → always flush.
 *     This ensures natural lyric phrasing and avoids splitting mid-sentence.
 *  2. Silence gap — gap to the next word exceeds PAUSE_BREAK seconds.
 *     Tunable via the WHISPER_GAP_THRESHOLD env var (default 0.8 s).
 *     0.8 s is conservative enough to survive long held notes ("Aaaaaah")
 *     without creating spurious splits on normal in-phrase breathing.
 *     Non-numeric or non-positive values fall back to the 0.8 s default.
 *  3. Safety caps — MAX_WORDS_PER_LINE words or MAX_LINE_DURATION seconds
 *     prevent run-on lines when none of the above triggers fire.
 */
/**
 * @param gapThreshold - Optional per-request override for the silence gap that
 *   triggers a line break (seconds). When omitted, falls back to the
 *   WHISPER_GAP_THRESHOLD env var and then to 0.8 s.
 */
function buildSegmentsFromWhisperWords(
  words: WhisperWord[],
  gapThreshold?: number,
): { text: string; startTime: number; endTime: number; words: { text: string; start: number; end: number }[] }[] {
  if (!Array.isArray(words) || words.length === 0) return [];
  const cleaned = words
    .map(w => ({ word: (w.word || "").trim(), start: Number(w.start), end: Number(w.end) }))
    .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  if (cleaned.length === 0) return [];

  const segments: { text: string; startTime: number; endTime: number; words: { text: string; start: number; end: number }[] }[] = [];
  let buf: typeof cleaned = [];

  const MAX_WORDS_PER_LINE = 10;
  const MAX_LINE_DURATION = 5.0;
  // Gap threshold: raise this value if long held notes cause unwanted splits.
  // Lower it if consecutive lines bleed into each other.
  // Per-request value takes priority; falls back to env var and then 0.8 s.
  const _envGap = Number(process.env.WHISPER_GAP_THRESHOLD);
  const _envDefault = Number.isFinite(_envGap) && _envGap > 0 ? _envGap : 0.8;
  const PAUSE_BREAK = (gapThreshold !== undefined && Number.isFinite(gapThreshold) && gapThreshold > 0)
    ? gapThreshold
    : _envDefault;

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.map(w => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim();
    if (text) {
      segments.push({
        text,
        startTime: buf[0].start,
        endTime: buf[buf.length - 1].end,
        words: buf.map(w => ({ text: w.word, start: w.start, end: w.end })),
      });
    }
    buf = [];
  };

  for (let i = 0; i < cleaned.length; i++) {
    const w = cleaned[i];
    buf.push(w);
    const next = cleaned[i + 1];
    const lineDur = w.end - buf[0].start;
    const pauseToNext = next ? next.start - w.end : 0;
    // Hard break on sentence-ending punctuation — always flush regardless of gap size.
    const endsOnPunct = /[.!?]$/.test(w.word);
    if (
      !next ||
      buf.length >= MAX_WORDS_PER_LINE ||
      lineDur >= MAX_LINE_DURATION ||
      pauseToNext >= PAUSE_BREAK ||
      endsOnPunct
    ) {
      flush();
    }
  }
  flush();
  return segments;
}

function tryRunPython(bin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; spawnError: boolean }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin, args);
    } catch {
      resolve({ ok: false, stdout: "", spawnError: true });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (val: { ok: boolean; stdout: string; spawnError: boolean }) => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGKILL"); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish({ ok: false, stdout, spawnError: false }), timeoutMs);
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const isMissing = err && (err.code === "ENOENT" || err.code === "EACCES");
      finish({ ok: false, stdout, spawnError: !!isMissing });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, spawnError: false });
    });
  });
}

async function detectVocalOnsetPython(wavPath: string, capSec = 60, timeoutMs = 30000, lyricsFirst?: string, language?: string): Promise<PythonVocalResult | null> {
  const scriptPath = path.join(process.cwd(), "scripts", "vocal_onset.py");
  const candidates = [
    process.env.PYTHON_BIN,
    path.join(process.cwd(), "..", "..", ".pythonlibs", "bin", "python3"),
    "python3",
    "python",
  ].filter((b): b is string => !!b);

  const args = [scriptPath, wavPath, String(capSec)];
  if (lyricsFirst && lyricsFirst.trim()) {
    args.push("--lyrics-first", lyricsFirst.trim().slice(0, 200));
  }
  if (language && /^[a-z]{2,3}$/.test(language.trim())) {
    args.push("--language", language.trim());
  }
  for (const bin of candidates) {
    const { ok, stdout, spawnError } = await tryRunPython(bin, args, timeoutMs);
    if (spawnError) continue; // missing binary — try next candidate
    if (!ok && !stdout.trim()) return null;
    try {
      const parsed = JSON.parse(stdout.trim()) as PythonVocalResult;
      if (parsed.error) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

async function detectAcousticOnset(wavPath: string, vocalBand = false): Promise<number | null> {
  try {
    // When vocalBand=true, pre-filter to the singing frequency range (~200 Hz–4 kHz)
    // so kick drums, sub-bass, and 808s don't register as the vocal onset.
    // When false, detect any sound (used to validate Gemini estimates).
    const afFilter = vocalBand
      ? "highpass=f=200,lowpass=f=4000,silencedetect=noise=-30dB:d=0.3"
      : "silencedetect=noise=-30dB:d=0.3";
    const { stderr, code } = await runProcessCaptureStderr("ffmpeg", [
      "-i", wavPath,
      "-af", afFilter,
      "-f", "null", "-",
    ]);
    if (code !== 0 && !/silencedetect/.test(stderr)) return null;

    const startMatches = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)];
    const endMatches = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)];

    // If audio starts with sound (no silence_start near 0), onset is 0.
    const firstSilenceStart = startMatches.length > 0 ? parseFloat(startMatches[0][1]) : null;
    if (firstSilenceStart === null || !Number.isFinite(firstSilenceStart) || firstSilenceStart > 0.1) {
      return 0;
    }

    // Audio starts silent; first silence_end is when sound first appears.
    if (endMatches.length === 0) return null;
    const firstEnd = parseFloat(endMatches[0][1]);
    if (!Number.isFinite(firstEnd)) return null;
    return Math.max(0, firstEnd);
  } catch {
    return null;
  }
}

// ── GIF size helpers ──────────────────────────────────────────────────────────

/** Pick a width that keeps the GIF under ~1 MB (LZW ≈ 3× raw compression). */
function targetGifWidth(durationSec: number, fps: number): number {
  const frames = Math.max(1, durationSec * fps);
  // budget: 1 MB after ~3× compression → ~3 MB raw
  // raw bytes ≈ width * height * frames; assume 16:9 so height = width * 0.5625
  // width² * 0.5625 * frames < 3_000_000
  const w = Math.floor(Math.sqrt(3_000_000 / (0.5625 * frames)));
  return Math.max(120, Math.min(360, w));
}

async function makeGif(
  inputPath: string,
  outputPath: string,
  palettePath: string,
  startTime: number,
  duration: number,
  fps: number,
  width: number,
): Promise<void> {
  const scale = `scale=${width}:-2:flags=lanczos`;
  const dither = "dither=bayer:bayer_scale=5:diff_mode=rectangle";

  const paletteArgs: string[] = ["-y"];
  if (startTime > 0) paletteArgs.push("-ss", String(startTime));
  paletteArgs.push("-t", String(duration));
  paletteArgs.push(
    "-i", inputPath,
    "-vf", `fps=${fps},${scale},palettegen=max_colors=128:stats_mode=diff`,
    palettePath,
  );
  await runProcess("ffmpeg", paletteArgs);

  const gifArgs: string[] = ["-y"];
  if (startTime > 0) gifArgs.push("-ss", String(startTime));
  gifArgs.push("-t", String(duration));
  gifArgs.push(
    "-i", inputPath,
    "-i", palettePath,
    "-lavfi", `fps=${fps},${scale} [x]; [x][1:v] paletteuse=${dither}`,
    outputPath,
  );
  await runProcess("ffmpeg", gifArgs);
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/gif-convert", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }

  const inputPath = req.file.path;
  const startTime = parseFloat((req.body.startTime as string) || "0");
  const rawEnd = parseFloat((req.body.endTime as string) || "999999");

  // Hard caps: max 10 s, max 10 fps for file-size budget
  const MAX_DURATION = 10;
  const fps = Math.min(Math.max(parseInt((req.body.fps as string) || "10", 10), 1), 10);
  const duration = Math.min(rawEnd - startTime, MAX_DURATION);

  if (duration <= 0) {
    scheduleCleanup(inputPath, 0);
    res.status(400).json({ error: "Bad Request", message: "Clip duration must be > 0 seconds" });
    return;
  }

  const outputId = uuidv4();
  const outputPath = path.join(outputDir, `${outputId}.gif`);
  const palettePath = path.join(outputDir, `${outputId}_palette.png`);

  const TARGET_BYTES = 1 * 1024 * 1024; // 1 MB

  try {
    // Pass 1 — adaptive width
    let width = targetGifWidth(duration, fps);
    await makeGif(inputPath, outputPath, palettePath, startTime, duration, fps, width);

    // Pass 2 — if still > 1 MB, cut width in half and retry
    if (fs.statSync(outputPath).size > TARGET_BYTES) {
      try { fs.unlinkSync(palettePath); } catch {}
      width = Math.max(120, Math.floor(width * 0.6));
      await makeGif(inputPath, outputPath, palettePath, startTime, duration, fps, width);
    }

    // Pass 3 — last resort: drop to 120px, 6fps
    if (fs.statSync(outputPath).size > TARGET_BYTES) {
      try { fs.unlinkSync(palettePath); } catch {}
      await makeGif(inputPath, outputPath, palettePath, startTime, duration, 6, 120);
    }

    const stat = fs.statSync(outputPath);
    scheduleCleanup(inputPath);
    scheduleCleanup(palettePath, 5000);
    scheduleCleanup(outputPath);

    res.json({
      fileId: `${outputId}.gif`,
      filename: "converted.gif",
      size: stat.size,
      mimeType: "image/gif",
      width,
      fps,
    });
  } catch (err: unknown) {
    scheduleCleanup(inputPath, 0);
    try { if (fs.existsSync(palettePath)) fs.unlinkSync(palettePath); } catch {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "GIF conversion failed");
    res.status(500).json({ error: "Processing Error", message });
  }
});

const PLATFORM_DIMS: Record<string, { w: number; h: number }> = {
  // Social
  youtube:   { w: 1920, h: 1080 },
  tiktok:    { w: 1080, h: 1920 },
  instagram: { w: 1080, h: 1080 },
  twitter:   { w: 1280, h: 720  },
  facebook:  { w: 1080, h: 1350 },
  // Desktop
  desktop_fhd: { w: 1920, h: 1080 },
  desktop_4k:  { w: 3840, h: 2160 },
  // Tablet
  tablet_landscape: { w: 2048, h: 1536 },
  tablet_portrait:  { w: 1536, h: 2048 },
  // Phone
  phone_portrait:  { w: 1170, h: 2532 },
  phone_landscape: { w: 2532, h: 1170 },
};

router.post("/resize", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }

  const {
    platform,
    mode,
    cropX = "center",
    cropY = "center",
    padColor = "black",
  } = req.body as {
    platform: string;
    mode: string;
    cropX?: "left" | "center" | "right";
    cropY?: "top" | "center" | "bottom";
    padColor?: "black" | "white";
  };

  let dims: { w: number; h: number } | undefined;

  if (platform === "custom") {
    const cw = parseInt((req.body.customWidth as string) || "0", 10);
    const ch = parseInt((req.body.customHeight as string) || "0", 10);
    if (!cw || !ch || cw < 1 || ch < 1 || cw > 8000 || ch > 8000) {
      res.status(400).json({ error: "Bad Request", message: "Custom dimensions must be between 1 and 8000 px" });
      return;
    }
    dims = { w: cw, h: ch };
  } else {
    dims = PLATFORM_DIMS[platform];
  }

  if (!dims) {
    res.status(400).json({ error: "Bad Request", message: `Unknown platform: ${platform}` });
    return;
  }

  const inputPath = req.file.path;
  const mimeType = req.file.mimetype;
  const isVideo = mimeType.startsWith("video/");
  const outputId = uuidv4();
  const ext = isVideo ? ".mp4" : ".jpg";
  const outputPath = path.join(outputDir, `${outputId}${ext}`);

  try {
    const { w, h } = dims;

    if (isVideo) {
      let filter: string;
      if (mode === "crop") {
        const cx = cropX === "left" ? "0" : cropX === "right" ? "iw-ow" : "(iw-ow)/2";
        const cy = cropY === "top"  ? "0" : cropY === "bottom" ? "ih-oh" : "(ih-oh)/2";
        filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${cx}:${cy}`;
      } else {
        const pc = padColor === "white" ? "white" : "black";
        filter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${pc}`;
      }
      await runProcess("ffmpeg", ["-y", "-i", inputPath, "-vf", filter, "-c:a", "copy", outputPath]);
    } else {
      const sharp = (await import("sharp")).default;
      const inputSize = fs.statSync(inputPath).size;

      const posMap: Record<string, string> = {
        "left-top": "left top", "center-top": "top", "right-top": "right top",
        "left-center": "left",  "center-center": "centre", "right-center": "right",
        "left-bottom": "left bottom", "center-bottom": "bottom", "right-bottom": "right bottom",
      };
      const position = posMap[`${cropX}-${cropY}`] ?? "centre";
      const bg = padColor === "white"
        ? { r: 255, g: 255, b: 255, alpha: 1 as const }
        : { r: 0,   g: 0,   b: 0,   alpha: 1 as const };

      // Helper: resize and write at a given JPEG quality
      const renderJpeg = (quality: number) => {
        const pipeline = sharp(inputPath);
        if (mode === "crop") {
          return pipeline.resize(w, h, { fit: "cover", position }).jpeg({ quality }).toFile(outputPath);
        } else {
          return pipeline.resize(w, h, { fit: "contain", background: bg }).jpeg({ quality }).toFile(outputPath);
        }
      };

      // Start at quality 95, step down until output ≤ input size (min quality 40)
      let quality = 95;
      await renderJpeg(quality);
      while (fs.statSync(outputPath).size > inputSize && quality > 40) {
        quality -= 10;
        await renderJpeg(quality);
      }
    }

    const stat = fs.statSync(outputPath);
    scheduleCleanup(inputPath);
    scheduleCleanup(outputPath);

    res.json({
      fileId: `${outputId}${ext}`,
      filename: `resized-${platform}${ext}`,
      size: stat.size,
      mimeType: isVideo ? "video/mp4" : "image/jpeg",
    });
  } catch (err: unknown) {
    scheduleCleanup(inputPath, 0);
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Resize failed");
    res.status(500).json({ error: "Processing Error", message });
  }
});

// ── OCR multi-engine dispatcher ───────────────────────────────────────────────

router.get("/ocr/status", async (_req: Request, res: Response) => {
  const { OCR_CONFIG } = await import("../config/ocr-config.js");
  const replitAvailable = !!(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
  const envGeminiKeys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  const geminiKeys = [...new Set([...OCR_CONFIG.gemini.keys, ...envGeminiKeys])];
  const engines = {
    gemini: replitAvailable || geminiKeys.length > 0,
    openai: !!OCR_CONFIG.openai.key,
    azure: !!(OCR_CONFIG.azure.key && OCR_CONFIG.azure.endpoint),
    aws: !!(OCR_CONFIG.aws.accessKeyId && OCR_CONFIG.aws.secretAccessKey),
    ocrSpace: !!OCR_CONFIG.ocrSpace.key,
    tesseract: true,
  };
  res.json({ geminiAvailable: engines.gemini, engines, replitManaged: replitAvailable });
});

router.post("/ocr", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }

  const inputPath = req.file.path;
  const mimeType = req.file.mimetype || "image/jpeg";

  const {
    runGemini, runOpenAI, runAimlApi, runAzure, runAwsTextract, runOcrSpace, runGoogleVision, runTesseract,
    scoreOcrResult,
  } = await import("../ocr/engines.js");

  try {
    // Priority: Gemini first (most accurate, preserves document structure).
    // Only fall through to other engines if Gemini is unavailable or fails.
    let engineResult = await runGemini(inputPath, mimeType).catch(() => null);

    if (!engineResult || !engineResult.text.trim()) {
      req.log.info("Gemini unavailable — trying secondary engines one at a time");
      const secondaryEngines = [
        () => runGoogleVision(inputPath, mimeType),
        () => runAimlApi(inputPath, mimeType),
        () => runOpenAI(inputPath, mimeType),
        () => runAzure(inputPath, mimeType),
        () => runAwsTextract(inputPath),
        () => runOcrSpace(inputPath, mimeType),
      ];
      for (const tryEngine of secondaryEngines) {
        const result = await tryEngine().catch(() => null);
        if (result && result.text.trim()) {
          engineResult = result;
          break; // stop as soon as one engine succeeds
        }
      }
    }

    if (!engineResult || !engineResult.text.trim()) {
      req.log.info("All AI engines unavailable — using Tesseract.js");
      engineResult = await runTesseract(inputPath);
      res.set("x-ocr-fallback", "tesseract");
    }

    scheduleCleanup(inputPath);

    const qualityScore = scoreOcrResult(engineResult.text);
    const confidence = Math.min(99, Math.round(50 + qualityScore * 0.8));
    req.log.info({ engine: engineResult.engine, score: qualityScore }, "OCR engine used");

    res.json({
      text: engineResult.text,
      confidence,
      engine: engineResult.engine,
    });
  } catch (err: unknown) {
    scheduleCleanup(inputPath, 0);
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "OCR failed");
    res.status(500).json({ error: "Processing Error", message });
  }
});

// ── Thumbnail fetch: extract video metadata from social links ─────────────────
router.post("/thumbnail/fetch", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "URL required" });
    return;
  }

  let platform: "youtube" | "tiktok" | "instagram" | "facebook" | null = null;
  if (/youtube\.com|youtu\.be/.test(url)) platform = "youtube";
  else if (/tiktok\.com/.test(url)) platform = "tiktok";
  else if (/instagram\.com/.test(url)) platform = "instagram";
  else if (/facebook\.com|fb\.com/.test(url)) platform = "facebook";

  if (!platform) {
    res.status(400).json({ error: "Unsupported URL. Paste a YouTube or TikTok video link." });
    return;
  }

  if (platform === "instagram" || platform === "facebook") {
    res.status(422).json({
      error: `${platform === "instagram" ? "Instagram" : "Facebook"} requires API authentication. Use a YouTube or TikTok link instead.`,
    });
    return;
  }

  try {
    if (platform === "youtube") {
      const ytId = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
      const oEmbedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (!oEmbedRes.ok) throw new Error("Could not fetch YouTube video info. Check the URL and try again.");
      const oEmbed = await oEmbedRes.json() as { title: string; author_name: string; thumbnail_url: string };

      let thumbnailUrl = oEmbed.thumbnail_url;
      if (ytId) {
        const maxres = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
        const hq    = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
        try {
          const check = await fetch(maxres, { method: "HEAD" });
          thumbnailUrl = check.ok ? maxres : hq;
        } catch { thumbnailUrl = hq; }
      }

      res.json({ platform, title: oEmbed.title, creator: oEmbed.author_name, thumbnailUrl });
    } else if (platform === "tiktok") {
      const oEmbedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      if (!oEmbedRes.ok) throw new Error("Could not fetch TikTok video info. Check the URL and try again.");
      const oEmbed = await oEmbedRes.json() as { title: string; author_name: string; thumbnail_url: string };
      res.json({ platform, title: oEmbed.title, creator: oEmbed.author_name, thumbnailUrl: oEmbed.thumbnail_url });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch video info";
    res.status(500).json({ error: message });
  }
});

// ── Thumbnail image proxy (handles CORS for canvas) ───────────────────────────
router.get("/thumbnail/proxy", async (req: Request, res: Response) => {
  const { url } = req.query as { url?: string };
  if (!url) { res.status(400).send("URL required"); return; }

  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) { res.status(imgRes.status).send("Image fetch failed"); return; }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = await imgRes.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).send("Failed to proxy image");
  }
});

// ── Bulk OCR (TextScan-compatible) — POST /api/media/extract ─────────────────
router.post("/extract", upload.array("images", 20), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "Bad Request", message: "No images uploaded" });
    return;
  }

  const {
    runGemini, runOpenAI, runAimlApi, runAzure, runAwsTextract, runOcrSpace, runGoogleVision, runTesseract,
    scoreOcrResult,
  } = await import("../ocr/engines.js");

  const results: Array<{ name: string; text: string; confidence: number; success: boolean; error?: string }> = [];

  for (const file of files) {
    const inputPath = file.path;
    const mimeType = file.mimetype || "image/jpeg";
    try {
      // Priority: Gemini first — only use secondary engines if Gemini fails
      let engineResult = await runGemini(inputPath, mimeType).catch(() => null);

      if (!engineResult || !engineResult.text.trim()) {
        const secondaryEngines = [
          () => runGoogleVision(inputPath, mimeType),
          () => runAimlApi(inputPath, mimeType),
          () => runOpenAI(inputPath, mimeType),
          () => runAzure(inputPath, mimeType),
          () => runAwsTextract(inputPath),
          () => runOcrSpace(inputPath, mimeType),
        ];
        for (const tryEngine of secondaryEngines) {
          const result = await tryEngine().catch(() => null);
          if (result && result.text.trim()) {
            engineResult = result;
            break; // stop as soon as one engine succeeds
          }
        }
      }

      if (!engineResult || !engineResult.text.trim()) {
        engineResult = await runTesseract(inputPath);
      }

      const qualityScore = scoreOcrResult(engineResult.text);
      const confidence = Math.min(99, Math.round(50 + qualityScore * 0.8));
      results.push({
        name: file.originalname,
        text: engineResult.text,
        confidence,
        success: !!engineResult.text,
      });
    } catch (err: unknown) {
      results.push({
        name: file.originalname,
        text: "",
        confidence: 0,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      scheduleCleanup(inputPath, 0);
    }
  }

  res.json({ results });
});

// ── Render Mux — POST /api/media/render-mux ──────────────────────────────────
// Receives a silent video (rendered offline in the browser) plus the original
// audio file and trim markers, then muxes them with ffmpeg so output audio is
// at source quality (no realtime re-encoding).

const renderMuxUpload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/") || file.mimetype === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(new Error("Only video and audio files are supported"));
    }
  },
});

router.post(
  "/render-mux",
  renderMuxUpload.fields([{ name: "video", maxCount: 1 }, { name: "audio", maxCount: 1 }]),
  async (req: Request, res: Response) => {
    const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.video?.[0];
    const audioFile = files?.audio?.[0];

    if (!videoFile) {
      if (audioFile) scheduleCleanup(audioFile.path, 0);
      res.status(400).json({ error: "Bad Request", message: "Missing video file" });
      return;
    }

    const audioStart = Math.max(0, parseFloat((req.body.audioStart as string) || "0"));
    const rawDuration = parseFloat((req.body.audioDuration as string) || "0");
    const audioDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;

    const outputId = `${uuidv4()}.mp4`;
    const outputPath = path.join(outputDir, outputId);

    try {
      if (audioFile && audioDuration > 0) {
        // Trim original audio first so ffmpeg only re-encodes the slice we need.
        const args: string[] = [
          "-y",
          "-i", videoFile.path,
          "-ss", String(audioStart),
          "-t", String(audioDuration),
          "-i", audioFile.path,
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-c:v", "copy",
          "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
          "-shortest",
          "-movflags", "+faststart",
          outputPath,
        ];
        await runProcess("ffmpeg", args);
      } else {
        // No audio — just remux video to ensure faststart for streaming.
        await runProcess("ffmpeg", [
          "-y",
          "-i", videoFile.path,
          "-c:v", "copy",
          "-an",
          "-movflags", "+faststart",
          outputPath,
        ]);
      }

      // When ?stream=1 is set, stream the muxed MP4 directly back so the
      // client can save it without a second round-trip. Otherwise return the
      // fileId for the legacy two-step download flow.
      if (req.query.stream === "1") {
        try {
          const stat = fs.statSync(outputPath);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Content-Length", String(stat.size));
          res.setHeader("Content-Disposition", `attachment; filename="${outputId}"`);
          res.setHeader("Cache-Control", "no-store");
          const stream = fs.createReadStream(outputPath);
          stream.on("error", () => {
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
          });
          stream.on("close", () => {
            scheduleCleanup(outputPath, 0);
          });
          stream.pipe(res);
        } catch {
          scheduleCleanup(outputPath, 0);
          if (!res.headersSent) {
            res.status(500).json({ error: "Stream failed", message: "Could not stream output" });
          }
        }
      } else {
        scheduleCleanup(outputPath, 30 * 60 * 1000);
        res.json({ fileId: outputId });
      }
    } catch (err) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      res.status(500).json({ error: "Mux failed", message: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      scheduleCleanup(videoFile.path, 0);
      if (audioFile) scheduleCleanup(audioFile.path, 0);
    }
  },
);

// ── Video Merger — POST /api/media/merge ──────────────────────────────────────

const videoMergeUpload = multer({
  storage,
  limits: {
    // 4K source uploads can exceed 150 MB; keep the limit high enough for
    // native-resolution processing while still preventing unbounded uploads.
    fileSize: 500 * 1024 * 1024,
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(null, false);
  },
});

function ffprobe(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => { resolve(parseFloat(out.trim()) || 0); });
    proc.on("error", () => resolve(0));
  });
}

function ffprobeVideoDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", filePath,
    ]);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => {
      const match = out.trim().match(/^(\d+)x(\d+)$/);
      if (!match) { resolve(null); return; }
      const width = Number(match[1]);
      const height = Number(match[2]);
      resolve(width > 0 && height > 0 ? { width, height } : null);
    });
    proc.on("error", () => resolve(null));
  });
}

function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => { resolve(out.trim().length > 0); });
    proc.on("error", () => resolve(false));
  });
}

type ClipSpec = {
  id: string;
  startTime: number;
  endTime: number;
  transition: "none" | "fade" | "wipe" | "slide" | "zoom";
  motion: "none" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right";
  panX?: number;
  panY?: number;
};

type OverlaySpec = {
  id: string;
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  offsetTime: number;
  panX?: number;
  panY?: number;
};

type CompositionSpec = {
  mainClips: ClipSpec[];
  overlays: OverlaySpec[];
  cropMode?: "fit" | "crop";
  canvasW?: number;
  canvasH?: number;
  audioFileId?: string;
  muteOriginal?: boolean;
};

const XFADE_MAP: Record<string, string> = {
  none: "fade",
  fade: "fade",
  wipe: "wipeleft",
  slide: "slideleft",
  zoom: "zoom",
};

function buildMotionFilter(motion: string, w = 1280, h = 720): string | null {
  const s = `${w}x${h}`;
  switch (motion) {
    case "zoom_in":
      return `zoompan=z='if(eq(pzoom,0),1.0,min(pzoom+0.0015,1.5))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${s}:fps=30`;
    case "zoom_out":
      return `zoompan=z='if(eq(pzoom,0),1.5,max(1.001,pzoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${s}:fps=30`;
    case "pan_left":
      return `zoompan=z=1.3:x='if(eq(pzoom,0),iw-iw/zoom,max(0,px-0.7))':y='(ih-ih/zoom)/2':d=1:s=${s}:fps=30`;
    case "pan_right":
      return `zoompan=z=1.3:x='min(iw-iw/zoom,px+0.7)':y='(ih-ih/zoom)/2':d=1:s=${s}:fps=30`;
    default:
      return null;
  }
}

router.post("/merge", videoMergeUpload.any(), async (req: Request, res: Response) => {
  const allFiles = (req.files as Express.Multer.File[]) || [];

  if (allFiles.length === 0) {
    res.status(400).json({ error: "Bad Request", message: "No files uploaded" });
    return;
  }

  const fileMap = new Map<string, string>(allFiles.map(f => [f.fieldname, f.path]));

  let spec: CompositionSpec | null = null;
  try {
    if (req.body.spec) spec = JSON.parse(req.body.spec as string) as CompositionSpec;
  } catch {
    spec = null;
  }

  if (!spec || !spec.mainClips || spec.mainClips.length < 1) {
    allFiles.forEach(f => scheduleCleanup(f.path, 0));
    res.status(400).json({ error: "Bad Request", message: "Provide a spec with at least 1 main clip" });
    return;
  }

  if (spec.mainClips.length > 10) {
    allFiles.forEach(f => scheduleCleanup(f.path, 0));
    res.status(400).json({ error: "Bad Request", message: "Maximum 10 main clips per merge" });
    return;
  }

  if ((spec.overlays || []).length > 10) {
    allFiles.forEach(f => scheduleCleanup(f.path, 0));
    res.status(400).json({ error: "Bad Request", message: "Maximum 10 overlay clips per merge" });
    return;
  }

  const { mainClips, overlays = [] } = spec;
  const canvasW = (Number(spec.canvasW) > 0 && Number(spec.canvasW) <= 3840) ? Number(spec.canvasW) : 1280;
  const canvasH = (Number(spec.canvasH) > 0 && Number(spec.canvasH) <= 3840) ? Number(spec.canvasH) : 720;
  const cropMode = spec.cropMode === "crop" ? "crop" : "fit";

  // ── Spec field validation ────────────────────────────────────────────────
  const VALID_TRANSITIONS = new Set(["none", "fade", "wipe", "slide", "zoom"]);
  const VALID_MOTIONS = new Set(["none", "zoom_in", "zoom_out", "pan_left", "pan_right"]);

  for (const c of mainClips) {
    if (typeof c.id !== "string") { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: "Each clip must have a string id" }); return; }
    const trimIn = Number(c.startTime ?? 0);
    const trimOut = Number(c.endTime ?? 0);
    if (!isFinite(trimIn) || trimIn < 0) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Clip ${c.id}: trimIn must be >= 0` }); return; }
    if (!isFinite(trimOut) || trimOut <= trimIn) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Clip ${c.id}: trimOut must be > trimIn` }); return; }
    if (!VALID_TRANSITIONS.has(c.transition)) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Clip ${c.id}: invalid transition "${c.transition}"` }); return; }
    if (!VALID_MOTIONS.has(c.motion)) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Clip ${c.id}: invalid motion "${c.motion}"` }); return; }
  }

  for (const o of overlays) {
    if (typeof o.id !== "string") { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: "Each overlay must have a string id" }); return; }
    const scale = Number(o.scale ?? 0.3);
    if (!isFinite(scale) || scale < 0.05 || scale > 1.0) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Overlay ${o.id}: scale must be 0.05–1.0` }); return; }
    const offsetTime = Number(o.offsetTime ?? 0);
    if (!isFinite(offsetTime) || offsetTime < 0) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Overlay ${o.id}: offsetTime must be >= 0` }); return; }
    const ox = Number(o.x ?? 0);
    const oy = Number(o.y ?? 0);
    if (!isFinite(ox)) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Overlay ${o.id}: x must be a number` }); return; }
    if (!isFinite(oy)) { allFiles.forEach(f => scheduleCleanup(f.path, 0)); res.status(400).json({ error: "Bad Request", message: `Overlay ${o.id}: y must be a number` }); return; }
    o.x = Math.max(0, ox);
    o.y = Math.max(0, oy);
  }

  const outputId = `${uuidv4()}.mp4`;
  const outputPath = path.join(outputDir, outputId);
  const tempFiles: string[] = [];

  try {
    // ── Step 1: Normalize + trim + apply motion to each main clip ────────────
    const normalized: { path: string; transition: string }[] = [];

    for (const clipSpec of mainClips) {
      const srcPath = fileMap.get(`file_${clipSpec.id}`);
      if (!srcPath) throw new Error(`Missing file for clip ${clipSpec.id}`);

      const trimStart = Math.max(0, clipSpec.startTime || 0);
      const trimEnd = clipSpec.endTime > trimStart ? clipSpec.endTime : undefined;
      const trimDur = trimEnd !== undefined ? trimEnd - trimStart : undefined;

      const normPath = path.join(uploadDir, `${uuidv4()}_norm.mp4`);
      tempFiles.push(normPath);

      const motionFilter = buildMotionFilter(clipSpec.motion, canvasW, canvasH);

      const cpx = Math.max(0, Math.min(100, clipSpec.panX ?? 50));
      const cpy = Math.max(0, Math.min(100, clipSpec.panY ?? 50));
      const cropX = `(iw-ow)*${(cpx / 100).toFixed(4)}`;
      const cropY = `(ih-oh)*${(cpy / 100).toFixed(4)}`;
      const baseScale = cropMode === "crop"
        ? `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH}:${cropX}:${cropY},setsar=1,fps=30`
        : `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`;
      const vf = motionFilter ? `${baseScale},${motionFilter}` : baseScale;

      const args: string[] = ["-y"];
      if (trimStart > 0) args.push("-ss", String(trimStart));
      if (trimEnd !== undefined) args.push("-to", String(trimEnd));
      args.push(
        "-i", srcPath,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-r", "30", normPath,
      );

      await runProcess("ffmpeg", args);
      normalized.push({ path: normPath, transition: clipSpec.transition });
    }

    // ── Step 2: Chain main clips with transitions ─────────────────────────────
    // ── Build segments separated by "none" (cut) transitions ────────────────
    // A "none" transition means a hard cut; consecutive non-"none" transitions
    // within the same group are chained with xfade.
    const XFADE_DUR = 0.5;

    interface Segment {
      clipIndices: number[];        // indices into `normalized`
      innerTransitions: string[];   // transitions[i] = between clipIndices[i] and [i+1]
    }

    const segments: Segment[] = [];
    {
      let seg: Segment = { clipIndices: [], innerTransitions: [] };
      for (let i = 0; i < normalized.length; i++) {
        seg.clipIndices.push(i);
        if (i === normalized.length - 1 || normalized[i].transition === "none") {
          segments.push(seg);
          seg = { clipIndices: [], innerTransitions: [] };
        } else {
          seg.innerTransitions.push(normalized[i].transition);
        }
      }
    }

    const hasAnyXfade = segments.some(s => s.clipIndices.length > 1);
    let mergedMain: string;

    if (!hasAnyXfade && segments.length === 1) {
      // Pure-cut, single-segment fast path: concat copy
      mergedMain = path.join(uploadDir, `${uuidv4()}_merged.mp4`);
      tempFiles.push(mergedMain);
      const listPath = path.join(uploadDir, `${uuidv4()}_list.txt`);
      tempFiles.push(listPath);
      fs.writeFileSync(listPath, normalized.map(n => `file '${n.path}'`).join("\n"));
      await runProcess("ffmpeg", ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", mergedMain]);
    } else {
      // Mixed or all-xfade path: build filter_complex with per-segment xfade chains
      // plus a final concat across segments.
      const durations = await Promise.all(normalized.map(n => ffprobe(n.path)));

      const filterParts: string[] = [];
      const segVLabels: string[] = [];
      const segALabels: string[] = [];

      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const { clipIndices, innerTransitions } = seg;

        if (clipIndices.length === 1) {
          // Single-clip segment — pass through stream labels directly.
          // Use split to rename into distinct labels for the concat filter.
          const vl = `[seg${si}v]`;
          const al = `[seg${si}a]`;
          filterParts.push(`[${clipIndices[0]}:v]null${vl}`);
          filterParts.push(`[${clipIndices[0]}:a]anull${al}`);
          segVLabels.push(vl);
          segALabels.push(al);
        } else {
          // Multi-clip segment: chain xfade filters.
          let lastV = `[${clipIndices[0]}:v]`;
          let lastA = `[${clipIndices[0]}:a]`;
          let cumulativeOffset = 0;

          for (let k = 0; k < innerTransitions.length; k++) {
            const nextIdx = clipIndices[k + 1];
            const xfadeType = XFADE_MAP[innerTransitions[k]] || "fade";
            cumulativeOffset += durations[clipIndices[k]] - XFADE_DUR;
            const isLast = k === innerTransitions.length - 1;
            const vl = isLast ? `[seg${si}v]` : `[seg${si}t${k}v]`;
            const al = isLast ? `[seg${si}a]` : `[seg${si}t${k}a]`;
            filterParts.push(
              `${lastV}[${nextIdx}:v]xfade=transition=${xfadeType}:duration=${XFADE_DUR}:offset=${cumulativeOffset.toFixed(3)}${vl}`
            );
            filterParts.push(`${lastA}[${nextIdx}:a]acrossfade=d=${XFADE_DUR}${al}`);
            lastV = vl; lastA = al;
          }
          segVLabels.push(`[seg${si}v]`);
          segALabels.push(`[seg${si}a]`);
        }
      }

      // Final concat across all segments
      const concatInputs = segVLabels.map((v, i) => `${v}${segALabels[i]}`).join("");
      filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`);

      mergedMain = path.join(uploadDir, `${uuidv4()}_merged.mp4`);
      tempFiles.push(mergedMain);
      const inputArgs = normalized.flatMap(n => ["-i", n.path]);
      await runProcess("ffmpeg", [
        ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-y", mergedMain,
      ]);
    }

    // ── Step 3: Normalize + trim overlay clips, composite them ───────────────
    if (overlays.length === 0) {
      fs.copyFileSync(mergedMain, outputPath);
    } else {
      const processedOverlays: { path: string; spec: OverlaySpec }[] = [];

      for (const ov of overlays) {
        const srcPath = fileMap.get(`overlay_${ov.id}`);
        if (!srcPath) continue;

        const trimStart = Math.max(0, ov.startTime || 0);
        const trimEnd = ov.endTime > trimStart ? ov.endTime : undefined;

        const scaleW = Math.round(canvasW * (ov.scaleX ?? ov.scale));
        const scaleH = Math.round(canvasH * (ov.scaleY ?? ov.scale));
        const ovNormPath = path.join(uploadDir, `${uuidv4()}_ov.mp4`);
        tempFiles.push(ovNormPath);

        const ovPanX = Math.max(0, Math.min(100, ov.panX ?? 50));
        const ovPanY = Math.max(0, Math.min(100, ov.panY ?? 50));
        const ovCropX = `(iw-ow)*${(ovPanX / 100).toFixed(4)}`;
        const ovCropY = `(ih-oh)*${(ovPanY / 100).toFixed(4)}`;

        const ovArgs: string[] = ["-y"];
        if (trimStart > 0) ovArgs.push("-ss", String(trimStart));
        if (trimEnd !== undefined) ovArgs.push("-to", String(trimEnd));
        ovArgs.push(
          "-i", srcPath,
          "-vf", `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH}:${ovCropX}:${ovCropY}`,
          "-c:v", "libx264", "-preset", "medium", "-crf", "18",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          ovNormPath,
        );
        await runProcess("ffmpeg", ovArgs);
        processedOverlays.push({ path: ovNormPath, spec: ov });
      }

      if (processedOverlays.length === 0) {
        fs.copyFileSync(mergedMain, outputPath);
      } else {
        const mergedDuration = await ffprobe(mergedMain);

        const ovInputArgs = [
          "-i", mergedMain,
          ...processedOverlays.flatMap(o => ["-stream_loop", "-1", "-i", o.path]),
        ];
        let compositeFilter = "";

        for (let i = 0; i < processedOverlays.length; i++) {
          const { spec: ovSpec } = processedOverlays[i];
          const scaleW = Math.round(canvasW * (ovSpec.scaleX ?? ovSpec.scale));
          const scaleH = Math.round(canvasH * (ovSpec.scaleY ?? ovSpec.scale));
          const x = Math.max(0, Math.min(canvasW - scaleW, Math.round(ovSpec.x)));
          const y = Math.max(0, Math.min(canvasH - scaleH, Math.round(ovSpec.y)));
          const startT = ovSpec.offsetTime || 0;
          const endT = mergedDuration > 0 ? mergedDuration : 9999;
          const enable = `enable='between(t,${startT.toFixed(2)},${endT.toFixed(2)})'`;
          const inLabel = i === 0 ? "[0:v]" : `[ov${i - 1}]`;
          const outLabel = i === processedOverlays.length - 1 ? "[outv]" : `[ov${i}]`;
          compositeFilter += `${inLabel}[${i + 1}:v]overlay=${x}:${y}:${enable}:shortest=1${outLabel}`;
          if (i < processedOverlays.length - 1) compositeFilter += ";";
        }

        await runProcess("ffmpeg", [
          ...ovInputArgs,
          "-filter_complex", compositeFilter,
          "-map", "[outv]", "-map", "0:a",
          "-c:v", "libx264", "-preset", "medium", "-crf", "18",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          "-shortest",
          "-y", outputPath,
        ]);
      }
    }

    const audioSrcPath = spec.audioFileId ? fileMap.get(spec.audioFileId) : undefined;
    if (audioSrcPath && fs.existsSync(audioSrcPath)) {
      const withAudioPath = path.join(uploadDir, `${uuidv4()}_audio.mp4`);
      tempFiles.push(withAudioPath);
      const origHasAudio = await hasAudioStream(outputPath);
      const bgVolume = Math.max(0, Math.min(2, Number(spec.audioVolume ?? 1) || 0));
      const originalVolume = Math.max(0, Math.min(2, Number(spec.originalVolume ?? 1) || 0));
      const fadeIn = Math.max(0, Math.min(30, Number(spec.audioFadeIn ?? 0) || 0));
      const fadeOut = Math.max(0, Math.min(30, Number(spec.audioFadeOut ?? 0) || 0));
      const totalDuration = Math.max(0, Number(spec.totalDuration ?? 0) || 0);
      const bgFilters = [`volume=${bgVolume.toFixed(3)}`];
      if (fadeIn > 0) bgFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      if (fadeOut > 0 && totalDuration > fadeOut) {
        bgFilters.push(`afade=t=out:st=${Math.max(0, totalDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
      }
      const audioArgs: string[] = ["-y", "-i", outputPath, "-stream_loop", "-1", "-i", audioSrcPath];
      if (spec.muteOriginal || !origHasAudio) {
        audioArgs.push(
          "-filter_complex", `[1:a]${bgFilters.join(",")} [aout]`,
          "-map", "0:v",
          "-map", "[aout]",
          "-c:v", "copy",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          "-shortest",
          withAudioPath,
        );
      } else {
        audioArgs.push(
          "-filter_complex", `[0:a]volume=${(spec.muteOriginal ? 0 : originalVolume).toFixed(3)}[orig];[1:a]${bgFilters.join(",")} [bg];[orig][bg]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
          "-map", "0:v",
          "-map", "[aout]",
          "-c:v", "copy",
          "-c:a", "aac", "-ar", "44100", "-ac", "2",
          "-shortest",
          withAudioPath,
        );
      }
      await runProcess("ffmpeg", audioArgs);
      fs.copyFileSync(withAudioPath, outputPath);
    }

    scheduleCleanup(outputPath, 30 * 60 * 1000);
    res.json({ fileId: outputId, clipCount: mainClips.length, overlayCount: overlays.length });
  } catch (err) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    res.status(500).json({ error: "Merge failed", message: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    allFiles.forEach(f => scheduleCleanup(f.path, 0));
    tempFiles.forEach(p => scheduleCleanup(p, 0));
  }
});

function parseCssFilter(cssFilter: string, intensityPct: number): string {
  const t = intensityPct / 100;
  const filters: string[] = [];
  const re = /(brightness|contrast|saturate|sepia|hue-rotate|grayscale|blur)\(([^)]+)\)/g;
  let match;

  const eqParts: Record<string, string> = {};

  while ((match = re.exec(cssFilter)) !== null) {
    const fn = match[1];
    const rawVal = match[2].trim();

    if (fn === "brightness") {
      const v = parseFloat(rawVal);
      const scaled = 1 + (v - 1) * t;
      eqParts["brightness"] = (scaled - 1).toFixed(4);
    } else if (fn === "contrast") {
      const v = parseFloat(rawVal);
      const scaled = 1 + (v - 1) * t;
      eqParts["contrast"] = scaled.toFixed(4);
    } else if (fn === "saturate") {
      const v = parseFloat(rawVal);
      const scaled = 1 + (v - 1) * t;
      eqParts["saturation"] = scaled.toFixed(4);
    } else if (fn === "sepia") {
      const v = parseFloat(rawVal) * t;
      const r1 = (0.393 * v + (1 - v)).toFixed(4);
      const r2 = (0.769 * v).toFixed(4);
      const r3 = (0.189 * v).toFixed(4);
      const g1 = (0.349 * v).toFixed(4);
      const g2 = (0.686 * v + (1 - v)).toFixed(4);
      const g3 = (0.168 * v).toFixed(4);
      const b1 = (0.272 * v).toFixed(4);
      const b2 = (0.534 * v).toFixed(4);
      const b3 = (0.131 * v + (1 - v)).toFixed(4);
      filters.push(`colorchannelmixer=${r1}:${r2}:${r3}:0:${g1}:${g2}:${g3}:0:${b1}:${b2}:${b3}:0`);
    } else if (fn === "hue-rotate") {
      const deg = parseFloat(rawVal) * t;
      filters.push(`hue=h=${deg.toFixed(2)}`);
    } else if (fn === "grayscale") {
      const v = parseFloat(rawVal) * t;
      const sat = 1 - v;
      filters.push(`hue=s=${sat.toFixed(4)}`);
    } else if (fn === "blur") {
      const px = parseFloat(rawVal) * t;
      if (px > 0.1) {
        filters.push(`boxblur=${Math.max(1, Math.round(px))}`);
      }
    }
  }

  if (Object.keys(eqParts).length > 0) {
    const eqStr = Object.entries(eqParts).map(([k, v]) => `${k}=${v}`).join(":");
    filters.unshift(`eq=${eqStr}`);
  }

  return filters.length > 0 ? filters.join(",") : "";
}

type VideoOverlayEffect = "liquid-glass" | "wet-shine" | "mirror-water" | "water-ripple" | "bloom-bokeh" | "god-rays" | "spring-petals" | "chromatic-dream" | "crystal-refraction" | "aqua-prism" | "glass-shimmer" | "caustic-water" | "aurora-flux";

function parseVideoOverlay(effect: string, intensityPct: number, speedPct: number): string {
  const supported = new Set<VideoOverlayEffect>([
    "liquid-glass", "wet-shine", "mirror-water", "water-ripple", "bloom-bokeh", "god-rays", "spring-petals", "chromatic-dream", "crystal-refraction", "aqua-prism", "glass-shimmer", "caustic-water", "aurora-flux",
  ]);
  if (!supported.has(effect as VideoOverlayEffect)) return "";

  const strength = 0.06 + (Math.max(0, Math.min(100, intensityPct)) / 100) * 0.32;
  const period = 14 - (Math.max(0, Math.min(100, speedPct)) / 100) * 11;
  const blur = 1 + (Math.max(0, Math.min(100, intensityPct)) / 100) * 5;
  const s = strength.toFixed(3);
  const p = period.toFixed(2);
  const b = blur.toFixed(2);

  switch (effect as VideoOverlayEffect) {
    case "liquid-glass":
      return `split=2[base][soft];[soft]gblur=sigma=${b},eq=saturation=1.35:brightness=0.04[glow];[base][glow]blend=all_mode=screen:all_opacity=${s}`;
    case "wet-shine":
      return `eq=brightness=${(strength * 0.16).toFixed(3)}:contrast=1.04:saturation=1.08`;
    case "mirror-water":
      return `split=2[top][reflection];[reflection]vflip,scale=iw:ih*0.5,crop=iw:ih*0.5:0:ih*0.5,gblur=sigma=${b}[reflectionBlur];[top][reflectionBlur]overlay=0:H*0.5`;
    case "water-ripple":
      return `split=2[base][ripple];[ripple]scale=iw:ih,gblur=sigma=${Math.max(1, blur / 2).toFixed(2)},hue=h='sin(t*${(2 / p).toFixed(3)})*8':s=1.15[rippleSoft];[base][rippleSoft]blend=all_mode=screen:all_opacity=${(strength * 0.9).toFixed(3)}`;
    case "bloom-bokeh":
      return `split=2[base][bloom];[bloom]gblur=sigma=${(blur * 2).toFixed(2)},eq=brightness=0.08:saturation=1.2[bloomSoft];[base][bloomSoft]blend=all_mode=screen:all_opacity=${s}`;
    case "god-rays":
      return `eq=brightness=${(strength * 0.22).toFixed(3)}:contrast=1.06:saturation=1.12,vignette=PI/5`;
    case "spring-petals":
      return `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='*':fontcolor=0xffd9eaff@${(strength * 2).toFixed(3)}:fontsize=24:x='(sin(t*${(18 / period).toFixed(3)})+1)*w*0.5':y='(cos(t*${(11 / period).toFixed(3)})+1)*h*0.5',drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='o':fontcolor=0xfff2c5d8@${(strength * 2.2).toFixed(3)}:fontsize=28:x='(cos(t*${(9 / period).toFixed(3)})+1)*w*0.5':y='(sin(t*${(15 / period).toFixed(3)})+1)*h*0.5'`;
    case "chromatic-dream":
      return `rgbashift=rh=${Math.max(1, Math.round(strength * 10))}:bh=-${Math.max(1, Math.round(strength * 8))},split=2[base][soft];[soft]gblur=sigma=${b}[glow];[base][glow]blend=all_mode=screen:all_opacity=${s}`;
    case "crystal-refraction":
      return `split=2[base][prism];[prism]gblur=sigma=${b},hue=h='${(speedPct / 10).toFixed(2)}*t':s=1.35[prismSoft];[base][prismSoft]blend=all_mode=screen:all_opacity=${s}`;
    case "aqua-prism":
      return `eq=brightness=${(strength * 0.12).toFixed(3)}:contrast=1.08:saturation=1.25,hue=h='sin(t*${(2 / p).toFixed(3)})*6'`;
    case "glass-shimmer":
      return `split=2[base][shimmer];[shimmer]gblur=sigma=${Math.max(1, blur / 2).toFixed(3)},eq=brightness=${(strength * 0.28).toFixed(3)}:saturation=1.18[shimmerSoft];[base][shimmerSoft]blend=all_mode=screen:all_opacity=${(strength * 1.25).toFixed(3)}`;
    case "caustic-water":
      return `split=2[base][caustic];[caustic]gblur=sigma=${Math.max(1, blur / 1.5).toFixed(2)},eq=brightness=0.06:saturation=1.4[causticSoft];[base][causticSoft]blend=all_mode=screen:all_opacity=${(strength * 1.15).toFixed(3)}`;
    case "aurora-flux":
      return buildAuroraFluxOverlayFilter(intensityPct, speedPct);
  }
}

function parseVideoDimension(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 64 || parsed > 7680) return null;
  return Math.floor(parsed / 2) * 2;
}

function parseVideoOffset(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 7680) return null;
  return Math.floor(parsed);
}

function bitrateFloorForDimensions(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  if (longEdge <= 854) return 2_500_000;
  if (longEdge <= 1280) return 5_000_000;
  if (longEdge <= 1920) return 8_000_000;
  if (longEdge <= 2560) return 16_000_000;
  // Target slightly above the documented floor because measured stream bitrate
  // can land a little below the nominal rate after container/audio overhead.
  return 36_000_000;
}

router.post("/stylize-video", videoMergeUpload.single("video"), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Bad Request", message: "No video file provided" });
    return;
  }

  if (!file.mimetype.startsWith("video/")) {
    scheduleCleanup(file.path, 0);
    res.status(400).json({ error: "Bad Request", message: "Only video files are supported for stylization" });
    return;
  }

  const cssFilter = typeof req.body.cssFilter === "string" ? req.body.cssFilter : "";
  const intensity = Math.max(0, Math.min(100, parseInt(req.body.intensity) || 100));
  const videoEffect = typeof req.body.videoEffect === "string" ? req.body.videoEffect : "none";
  const overlayIntensity = Math.max(0, Math.min(100, parseInt(req.body.overlayIntensity) || 70));
  const overlaySpeed = Math.max(0, Math.min(100, parseInt(req.body.overlaySpeed) || 50));
  const outputWidth = parseVideoDimension(req.body.outputWidth);
  const outputHeight = parseVideoDimension(req.body.outputHeight);
  const qualityTier = req.body.qualityTier === "high" || req.body.qualityTier === "original" ? req.body.qualityTier : "social";
  const codec = req.body.codec === "hevc" ? "hevc" : "h264";
  const framing = req.body.framing === "fit" || req.body.framing === "fill" ? req.body.framing : "original";
  const enhance = req.body.enhance === "1" || req.body.enhance === "true";
  const cropX = parseVideoOffset(req.body.cropX);
  const cropY = parseVideoOffset(req.body.cropY);
  const cropWidth = parseVideoDimension(req.body.cropWidth);
  const cropHeight = parseVideoDimension(req.body.cropHeight);
  const mirror = req.body.mirror === "1" || req.body.mirror === "true";

  const hasFilter = cssFilter && cssFilter !== "none";
  const overlayFilter = parseVideoOverlay(videoEffect, overlayIntensity, overlaySpeed);
  const cropFilter = cropWidth && cropHeight
    ? `crop=min(${cropWidth}\\,iw):min(${cropHeight}\\,ih):min(max(${cropX ?? 0}\\,0)\\,iw-min(${cropWidth}\\,iw)):min(max(${cropY ?? 0}\\,0)\\,ih-min(${cropHeight}\\,ih))`
    : "";
  const resizeFilter = outputWidth && outputHeight
    ? framing === "fit"
      ? `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black`
      : framing === "fill"
        ? `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputWidth}:${outputHeight}:(iw-ow)/2:(ih-oh)/2`
        : ""
    : "";
  const enhancementFilter = enhance ? "unsharp=5:5:0.35:5:5:0" : "";
  if (!hasFilter && !overlayFilter && !mirror && !resizeFilter && !cropFilter && !enhancementFilter) {
    scheduleCleanup(file.path, 0);
    res.status(400).json({ error: "Bad Request", message: "No style filter specified" });
    return;
  }

  let ffmpegFilter = hasFilter ? parseCssFilter(cssFilter, intensity) : "";
  if (overlayFilter) {
    ffmpegFilter = ffmpegFilter
      ? `${ffmpegFilter},${overlayFilter}`
      : overlayFilter;
  }
  if (hasFilter && !ffmpegFilter) {
    scheduleCleanup(file.path, 0);
    res.status(400).json({ error: "Bad Request", message: "Could not parse CSS filter" });
    return;
  }

  if (cropFilter) {
    ffmpegFilter = ffmpegFilter ? `${ffmpegFilter},${cropFilter}` : cropFilter;
  }
  if (resizeFilter) {
    ffmpegFilter = ffmpegFilter ? `${ffmpegFilter},${resizeFilter}` : resizeFilter;
  }
  if (qualityTier !== "original" && !(outputWidth && outputHeight && framing !== "original")) {
    const capLongEdge = qualityTier === "social" ? 1920 : 2560;
    const qualityScaleFilter = `scale='min(${capLongEdge},iw)':'min(${capLongEdge},iw)/a':force_original_aspect_ratio=decrease:flags=lanczos`;
    ffmpegFilter = ffmpegFilter ? `${ffmpegFilter},${qualityScaleFilter}` : qualityScaleFilter;
  }
  if (mirror) {
    ffmpegFilter = ffmpegFilter ? `hflip,${ffmpegFilter}` : "hflip";
  }
  if (enhancementFilter) {
    ffmpegFilter = ffmpegFilter ? `${ffmpegFilter},${enhancementFilter}` : enhancementFilter;
  }

  // H.264 with yuv420p requires even dimensions. Normalize odd source/crop sizes
  // at the very end so FFmpeg never silently pads an extra gray row or column.
  ffmpegFilter = `${ffmpegFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos`;

  const outputId = `${uuidv4()}.mp4`;
  const outputPath = path.join(outputDir, outputId);
  let handedToQueue = false;

  try {
    const audioPresent = await hasAudioStream(file.path);
    const durationSeconds = await ffprobe(file.path);
    const sourceDimensions = await ffprobeVideoDimensions(file.path);
    const sourceWidth = cropWidth ?? sourceDimensions?.width ?? 1920;
    const sourceHeight = cropHeight ?? sourceDimensions?.height ?? 1080;
    const tierLongEdge = qualityTier === "social" ? 1920 : qualityTier === "high" ? 2560 : Math.max(sourceWidth, sourceHeight);
    const tierScale = Math.min(1, tierLongEdge / Math.max(sourceWidth, sourceHeight));
    const tierWidth = Math.max(64, Math.floor((sourceWidth * tierScale) / 2) * 2);
    const tierHeight = Math.max(64, Math.floor((sourceHeight * tierScale) / 2) * 2);
    const qualityWidth = outputWidth && outputHeight && framing !== "original" ? outputWidth : tierWidth;
    const qualityHeight = outputWidth && outputHeight && framing !== "original" ? outputHeight : tierHeight;
    // Use quality-based encoding instead of forcing a fixed 4K CBR floor. A
    // rigid 36 Mbps min/max rate made long 4K exports unnecessarily large and
    // increased CPU/memory pressure, which could make the dev service appear to
    // disappear during a heavy request.
    const crf = codec === "hevc"
      ? (qualityTier === "social" ? 24 : qualityTier === "high" ? 22 : 20)
      : (qualityTier === "social" ? 22 : qualityTier === "high" ? 20 : 18);
    // Fast preset is materially quicker for delivery tiers while Original
    // retains medium for the best compression efficiency on 4K masters.
    const encodePreset = qualityTier === "original" ? "medium" : "fast";
    const encodeArgs = [
      "-vf", ffmpegFilter,
      ...(audioPresent ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
      "-c:v", codec === "hevc" ? "libx265" : "libx264",
      "-preset", encodePreset,
      "-crf", String(crf),
      ...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
      // Allow FFmpeg to use the VPS CPU cores. The previous forced
      // single-thread configuration made 4K exports unnecessarily slow.
      "-threads", "0",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ];

    if (isVideoExportQueueEnabled() && shouldQueueVideoExport(durationSeconds)) {
      const job = await enqueueVideoExport({
        inputPath: file.path,
        outputPath,
        outputDir,
        durationSeconds,
        encodeArgs,
        chunkSeconds: getVideoExportChunkSeconds(),
      });
      handedToQueue = true;
      res.status(202).json({ queued: true, jobId: job.id });
      return;
    }

    await runProcess("ffmpeg", ["-i", file.path, ...encodeArgs, "-y", outputPath]);

    scheduleCleanup(outputPath, 30 * 60 * 1000);
    res.json({ fileId: outputId });
  } catch (err) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    res.status(500).json({ error: "Video stylization failed", message: err instanceof Error ? err.message : "Unknown error" });
  } finally {
    if (!handedToQueue) scheduleCleanup(file.path, 0);
  }
});

router.get("/stylize-video/jobs/:jobId", async (req: Request, res: Response) => {
  if (!isVideoExportQueueEnabled()) {
    res.status(503).json({ error: "Video export queue is unavailable", message: "Set REDIS_URL to enable long-video processing." });
    return;
  }
  try {
    const jobId = typeof req.params.jobId === "string" ? req.params.jobId : req.params.jobId[0];
    const status = await getVideoExportStatus(jobId);
    if (!status) {
      res.status(404).json({ error: "Not Found", message: "Video export job not found" });
      return;
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Could not read video export status", message: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/download/:fileId", (req: Request, res: Response) => {
  const fileId = typeof req.params.fileId === "string" ? req.params.fileId : req.params.fileId[0];

  if (!fileId || fileId.includes("..") || fileId.includes("/") || fileId.includes("\\")) {
    res.status(400).json({ error: "Bad Request", message: "Invalid file ID" });
    return;
  }

  const allowedExt = new Set([".gif", ".mp4", ".jpg", ".jpeg", ".png", ".webm"]);
  const ext = path.extname(fileId).toLowerCase();
  if (!allowedExt.has(ext)) {
    res.status(400).json({ error: "Bad Request", message: "Invalid file type" });
    return;
  }

  const filePath = path.join(outputDir, fileId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not Found", message: "File not found or expired" });
    return;
  }

  const mimeTypes: Record<string, string> = {
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webm": "video/webm",
  };

  const mimeType = mimeTypes[ext] ?? "application/octet-stream";
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  const requestedName = typeof req.query.filename === "string" ? req.query.filename : fileId;
  const safeName = requestedName
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 180) || fileId;
  const downloadName = safeName.toLowerCase().endsWith(ext) ? safeName : `${safeName}${ext}`;
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!range) {
    res.setHeader("Content-Length", total);
    res.status(200).sendFile(filePath);
    return;
  }

  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    res.setHeader("Content-Range", `bytes */${total}`);
    res.status(416).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2] || 0));
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  const end = Math.min(requestedEnd, total - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
    res.setHeader("Content-Range", `bytes */${total}`);
    res.status(416).end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

// ── Audio Transcription — POST /api/media/transcribe ─────────────────────────

const transcribeUpload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only video and audio files are supported"));
  },
});

router.post("/transcribe", transcribeUpload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }

  // Stream progress events back to the client so it can show real-time retry status.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  const sendEvent = (event: string, data: unknown) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (writeErr) {
      req.log.warn({ err: writeErr }, "SSE write failed — client likely disconnected");
      clientGone = true;
    }
  };

  const inputPath = req.file.path;
  const audioPath = path.join(uploadDir, `${uuidv4()}.wav`);
  const _rawBodyGap = Number((req.body as Record<string, unknown>)?.gapThreshold);
  const userGapThreshold = Number.isFinite(_rawBodyGap) && _rawBodyGap > 0 ? _rawBodyGap : undefined;

  try {
    await runProcess("ffmpeg", [
      "-y", "-i", inputPath,
      "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
      "-t", "300",
      audioPath,
    ]);

    const audioStats = fs.statSync(audioPath);
    if (audioStats.size < 1000) {
      scheduleCleanup(inputPath, 0);
      scheduleCleanup(audioPath, 0);
      sendEvent("result", { segments: [], message: "No audio detected in the video" });
      if (!res.writableEnded) res.end();
      return;
    }

    const { GoogleGenAI } = await import("@google/genai");

    const audioBase64 = fs.readFileSync(audioPath).toString("base64");

    const TRANSCRIPTION_PROMPT =
      "Transcribe the audio in this file. If the audio is a song, identify the song title and artist. " +
      "Return ONLY a JSON object with these fields: " +
      '"songTitle" (the identified song title, or null if unknown), ' +
      '"songArtist" (the identified artist, or null if unknown), ' +
      '"segments" (an array of segments, each with "text", "startTime" in seconds, and "endTime" in seconds). ' +
      "Group words into natural phrases or lines of 5-12 words each. " +
      'Example: {"songTitle": "Yesterday", "songArtist": "The Beatles", "segments": [{"text": "Yesterday", "startTime": 0.0, "endTime": 1.5}]}. ' +
      "If no speech is detected, return segments as an empty array []. " +
      "Output ONLY the JSON object, no markdown, no explanation.";

    let responseText: string | null = null;
    let quotaExceeded = false;

    const onRetry = (attempt: number, total: number) => sendEvent("retry", { attempt, total });

    const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (replitBase && replitKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: replitKey, httpOptions: { apiVersion: "", baseUrl: replitBase } });
        const result = await withQuotaRetry(() => ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
              { text: TRANSCRIPTION_PROMPT },
            ],
          }],
        }).then(r => r.text ?? null), req.log, onRetry);
        if (result.quota) quotaExceeded = true;
        responseText = result.text;
      } catch (err) {
        req.log.warn({ err }, "Replit-managed Gemini transcription failed, trying user keys");
      }
    }

    if (!responseText) {
      const { API_KEYS, clean } = await import("../config/api-keys.js");
      const { getGeminiKeys } = await import("../routes/settings.js");
      const envKeys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
      const allKeys = [...new Set([...clean(API_KEYS.gemini), ...getGeminiKeys(), ...envKeys])];

      for (const key of allKeys) {
        try {
          const ai = new GoogleGenAI({ apiKey: key });
          const result = await withQuotaRetry(() => ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
                { text: TRANSCRIPTION_PROMPT },
              ],
            }],
          }).then(r => r.text ?? null), req.log, onRetry);
          if (result.quota) quotaExceeded = true;
          responseText = result.text;
          if (responseText) break;
        } catch (err) {
          req.log.warn({ err }, "Gemini key failed for transcription");
        }
      }
    }

    scheduleCleanup(inputPath);

    if (!responseText) {
      // Gemini unavailable — try the bundled Whisper model as a fallback.
      req.log.info("All Gemini keys exhausted; attempting Whisper local transcription");
      const whisperResult = await detectVocalOnsetPython(audioPath, 9999, 120_000);
      scheduleCleanup(audioPath, 0);

      if (whisperResult && Array.isArray(whisperResult.words) && whisperResult.words.length > 0) {
        const segments = buildSegmentsFromWhisperWords(whisperResult.words, userGapThreshold);
        sendEvent("result", { segments, source: "whisper" });
        if (!res.writableEnded) res.end();
        return;
      }

      if (quotaExceeded) {
        sendEvent("result", { segments: [], message: "AI quota limit reached", reason: "quota_exceeded" });
      } else {
        sendEvent("result", { segments: [], message: "Transcription unavailable — no AI keys configured" });
      }
      if (!res.writableEnded) res.end();
      return;
    }

    scheduleCleanup(audioPath, 5000);

    let segments: Array<{ text: string; startTime: number; endTime: number }> = [];
    let songTitle: string | null = null;
    let songArtist: string | null = null;
    try {
      const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.segments))
          ? parsed.segments
          : null;
      if (arr) {
        segments = arr
          .filter((s: Record<string, unknown>) => s && typeof s.text === "string" && s.text.trim())
          .map((s: Record<string, unknown>) => {
            const startTime = Math.max(0, Number(s.startTime) || 0);
            const endTime = Math.max(startTime + 0.1, Number(s.endTime) || startTime + 1);
            return { text: String(s.text).trim(), startTime, endTime };
          })
          .sort((a: { startTime: number }, b: { startTime: number }) => a.startTime - b.startTime);
      }
      if (!Array.isArray(parsed) && parsed) {
        if (typeof parsed.songTitle === "string" && parsed.songTitle.trim()) {
          songTitle = parsed.songTitle.trim();
        }
        if (typeof parsed.songArtist === "string" && parsed.songArtist.trim()) {
          songArtist = parsed.songArtist.trim();
        }
      }
    } catch {
      req.log.warn("Failed to parse Gemini transcription response");
    }

    sendEvent("result", { segments, songTitle, songArtist });
    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    scheduleCleanup(inputPath, 0);
    scheduleCleanup(audioPath, 0);
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Transcription failed");
    sendEvent("error", { message });
    if (!res.writableEnded) res.end();
  }
});

function parseLrcTimestamp(tag: string): number {
  const match = tag.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
  if (!match) return -1;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

function parseLrcToSegments(lrc: string): { text: string; startTime: number; endTime: number }[] {
  const lines = lrc.split("\n").filter((l) => l.trim());
  const parsed: { time: number; text: string }[] = [];
  const tagRegex = /\[(\d+:\d+(?:\.\d+)?)\]/g;

  for (const line of lines) {
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;

    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(line)) !== null) {
      const time = parseLrcTimestamp(match[0]);
      if (time >= 0) timestamps.push(time);
    }

    if (timestamps.length === 0) continue;

    const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
    if (!text) continue;

    for (const time of timestamps) {
      parsed.push({ time, text });
    }
  }

  parsed.sort((a, b) => a.time - b.time);

  return parsed.map((item, i) => ({
    text: item.text,
    startTime: item.time,
    endTime: i < parsed.length - 1 ? parsed[i + 1].time : item.time + 5,
  }));
}

async function fetchSilvaTechLyrics(title: string, artist?: string): Promise<{
  syncedSegments?: { text: string; startTime: number; endTime: number }[];
  plainLyrics?: string;
} | null> {
  try {
    const query = artist ? `${title} ${artist}` : title;
    const url = `https://api.silvatech.co.ke/search/lyrics?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await response.json();

    // Try {status, results: [...]} shape — the actual silvatech API response format.
    const candidateArray: any[] = json?.results && Array.isArray(json.results)
      ? json.results
      : Array.isArray(json) ? json : [];

    if (candidateArray.length > 0) {
      const withSynced = candidateArray.find((r: any) => r?.syncedLyrics);
      if (withSynced && typeof withSynced.syncedLyrics === "string") {
        const segments = parseLrcToSegments(withSynced.syncedLyrics);
        if (segments.length > 0) return { syncedSegments: segments };
      }
      const withPlain = candidateArray.find((r: any) => r?.plainLyrics);
      if (withPlain && typeof withPlain.plainLyrics === "string" && withPlain.plainLyrics.trim()) {
        return { plainLyrics: withPlain.plainLyrics.trim() };
      }
    }

    // Flat root-object shape (older API versions).
    if (json?.syncedLyrics && typeof json.syncedLyrics === "string") {
      const segments = parseLrcToSegments(json.syncedLyrics);
      if (segments.length > 0) return { syncedSegments: segments };
    }
    if (json?.plainLyrics && typeof json.plainLyrics === "string" && json.plainLyrics.trim()) {
      return { plainLyrics: json.plainLyrics.trim() };
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchLyricsOvh(title: string, artist?: string): Promise<string | null> {
  if (!artist || !artist.trim()) return null; // lyrics.ovh requires both fields
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist.trim())}/${encodeURIComponent(title.trim())}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await response.json();
    if (json?.lyrics && typeof json.lyrics === "string" && json.lyrics.trim()) {
      return json.lyrics.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLrclib(title: string, artist?: string, duration?: number): Promise<{
  syncedSegments?: { text: string; startTime: number; endTime: number }[];
  plainLyrics?: string;
} | null> {
  const headers = { "Accept": "application/json", "User-Agent": "CreativeStudio/1.0" };

  // 1. Exact-get path: lrclib's /api/get matches by title + artist (+ optional duration).
  if (artist && artist.trim()) {
    try {
      const exactParams = new URLSearchParams({
        track_name: title,
        artist_name: artist,
      });
      if (duration && Number.isFinite(duration) && duration > 0) {
        exactParams.set("duration", String(Math.round(duration)));
      }
      const exactUrl = `https://lrclib.net/api/get?${exactParams.toString()}`;
      const exactRes = await fetch(exactUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (exactRes.ok) {
        const exact = await exactRes.json();
        if (exact?.syncedLyrics && typeof exact.syncedLyrics === "string") {
          const segments = parseLrcToSegments(exact.syncedLyrics);
          if (segments.length > 0) return { syncedSegments: segments };
        }
        if (exact?.plainLyrics && typeof exact.plainLyrics === "string" && exact.plainLyrics.trim()) {
          return { plainLyrics: exact.plainLyrics.trim() };
        }
      }
    } catch {
      // fall through to fuzzy search
    }
  }

  // 2. Fuzzy search fallback: prefer the candidate whose artist string best matches.
  try {
    const query = artist ? `${title} ${artist}` : title;
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const artistLower = artist ? artist.toLowerCase().trim() : "";
    const isArtistMatch = (r: any) => {
      if (!artistLower) return false;
      const a = (r?.artistName || "").toLowerCase().trim();
      if (!a) return false;
      return a.includes(artistLower) || artistLower.includes(a);
    };

    const matched = artistLower ? results.filter(isArtistMatch) : [];
    const others = artistLower ? results.filter((r: any) => !isArtistMatch(r)) : results;

    const syncedCandidates = [
      ...matched.filter((r: any) => r.syncedLyrics),
      ...others.filter((r: any) => r.syncedLyrics),
    ];
    for (const cand of syncedCandidates) {
      const segments = parseLrcToSegments(cand.syncedLyrics);
      if (segments.length > 0) return { syncedSegments: segments };
    }

    const plainCandidates = [
      ...matched.filter((r: any) => r.plainLyrics),
      ...others.filter((r: any) => r.plainLyrics),
    ];
    if (plainCandidates[0]?.plainLyrics) {
      return { plainLyrics: plainCandidates[0].plainLyrics };
    }

    return null;
  } catch {
    return null;
  }
}

router.get("/music-search", async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Bad Request", message: "q query parameter is required" });
    return;
  }

  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      res.status(502).json({ error: "Upstream Error", message: "Deezer API unavailable" });
      return;
    }

    const json = await response.json();
    const results = (json.data || []).map((item: any) => ({
      id: item.id,
      title: item.title,
      artist: item.artist?.name || "Unknown",
      album: item.album?.title || "",
      albumArt: item.album?.cover_medium || item.album?.cover || "",
      preview: item.preview || "",
      duration: item.duration || 0,
    })).filter((item: any) => item.preview);

    res.json({ results });
  } catch {
    res.status(502).json({ error: "Upstream Error", message: "Failed to search music" });
  }
});

async function fetchXcasperGoogleLyrics(title: string, artist?: string): Promise<string | null> {
  try {
    const query = artist ? `${title} ${artist}` : title;
    const url = `https://apis.xcasper.space/api/search/google-lyrics?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    if (json?.lyrics && typeof json.lyrics === "string" && json.lyrics.trim().length > 0) {
      return json.lyrics.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchXcasperLyricsSearch(title: string): Promise<{ lyrics: string; synced: boolean } | null> {
  try {
    const url = `https://apis.xcasper.space/api/search/lyrics?title=${encodeURIComponent(title)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const json = await response.json();
    if (json?.tracks && Array.isArray(json.tracks) && json.tracks.length > 0) {
      const track = json.tracks[0];
      if (track.plainLyrics && typeof track.plainLyrics === "string" && track.plainLyrics.trim().length > 0) {
        return { lyrics: track.plainLyrics.trim(), synced: false };
      }
      if (track.syncedLyrics && typeof track.syncedLyrics === "string" && track.syncedLyrics.trim().length > 0) {
        return { lyrics: track.syncedLyrics.trim(), synced: false };
      }
    }
    return null;
  } catch {
    return null;
  }
}

type LyricsResolved = {
  synced: boolean;
  segments?: { text: string; startTime: number; endTime: number }[];
  plainLyrics?: string;
  source: string;
};

const LYRICS_CACHE_MAX = 200;
const LYRICS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const lyricsCache = new Map<string, { value: LyricsResolved; expiresAt: number }>();

function lyricsCacheKey(title: string, artist?: string, duration?: number): string {
  const t = title.toLowerCase().trim().replace(/\s+/g, " ");
  const a = (artist || "").toLowerCase().trim().replace(/\s+/g, " ");
  const d = duration && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  return `${t}|${a}|${d}`;
}

let _dbModulePromise: Promise<typeof import("@workspace/db") | null> | null = null;
async function getDbModule(): Promise<typeof import("@workspace/db") | null> {
  if (!process.env.DATABASE_URL) return null;
  if (!_dbModulePromise) {
    _dbModulePromise = import("@workspace/db").catch(() => null);
  }
  return _dbModulePromise;
}

async function getDbCachedLyrics(
  key: string,
): Promise<{ value: LyricsResolved; expiresAt: number } | null> {
  const mod = await getDbModule();
  if (!mod) return null;
  try {
    const { db, lyricsCacheTable } = mod;
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(lyricsCacheTable)
      .where(eq(lyricsCacheTable.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const expiresAt = new Date(row.expiresAt).getTime();
    if (expiresAt <= Date.now()) {
      // Expired — best-effort delete; ignore failures
      db.delete(lyricsCacheTable).where(eq(lyricsCacheTable.key, key)).catch(() => {});
      return null;
    }
    return { value: row.value as LyricsResolved, expiresAt };
  } catch {
    return null;
  }
}

async function setDbCachedLyrics(key: string, value: LyricsResolved): Promise<void> {
  const mod = await getDbModule();
  if (!mod) return;
  try {
    const { db, lyricsCacheTable } = mod;
    const expiresAt = new Date(Date.now() + LYRICS_CACHE_TTL_MS);
    await db
      .insert(lyricsCacheTable)
      .values({ key, value: value as unknown as Record<string, unknown>, expiresAt })
      .onConflictDoUpdate({
        target: lyricsCacheTable.key,
        set: { value: value as unknown as Record<string, unknown>, expiresAt },
      });
    ensureLyricsCacheSweeper();
    // Probabilistically enforce the row cap on writes so a sudden burst of
    // unique lookups can't grow the table unbounded between hourly sweeps.
    // ~1-in-50 sampling keeps the overhead negligible while still firing
    // many times per minute under heavy traffic.
    if (Math.random() < 0.02) {
      const sampleStartedAt = Date.now();
      enforceLyricsDbCap()
        .then((capEvicted) => {
          // Only log/record when the write-path enforcement actually evicted
          // rows, so this stays quiet under normal traffic but surfaces cap
          // hits that happen between hourly sweeps.
          if (capEvicted > 0) {
            console.warn(
              JSON.stringify({
                event: "lyrics_cache_sweep",
                reason: "write_sample",
                ttl_evicted: 0,
                cap_evicted: capEvicted,
                row_count: null,
                max: getLyricsDbCacheMax(),
                fill_ratio: null,
                duration_ms: null,
              }),
            );
            recordLyricsSweepEvent({
              ts: sampleStartedAt,
              reason: "write_sample",
              ttlEvicted: 0,
              capEvicted,
              rowCount: null,
              fillRatio: null,
              durationMs: Date.now() - sampleStartedAt,
            });
          }
        })
        .catch(() => {});
    }
  } catch {
    // Persistent cache is best-effort; in-memory cache still serves the request.
  }
}

// Periodic sweeper for the persistent lyrics cache. Without this, rows whose
// keys are never looked up again sit in `lyrics_cache` forever even after their
// TTL has passed (the on-read delete in getDbCachedLyrics only fires for keys
// that someone happens to request again). The sweeper is started lazily after
// the first successful DB write so environments without DATABASE_URL don't pay
// for an idle timer, and the timer is unref'd so it never blocks shutdown.
const LYRICS_CACHE_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// Hard cap on persisted rows. Even with a 24h TTL, a sudden burst of unique
// song lookups could grow the table to millions of rows in a day; this caps
// it at a sane size by evicting the rows whose TTL is closest to expiring
// (i.e. those that were inserted/refreshed least recently). Tunable via env
// for ops to bump up/down without a code change.
const LYRICS_DB_CACHE_DEFAULT_MAX = 10_000;
function getLyricsDbCacheMax(): number {
  const raw = Number(process.env.LYRICS_DB_CACHE_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : LYRICS_DB_CACHE_DEFAULT_MAX;
}
let _lyricsSweepTimer: NodeJS.Timeout | null = null;

// In-memory ring buffer of recent sweep events so the status endpoint can
// surface cache health without re-running a sweep on every request. Capped
// at LYRICS_SWEEP_HISTORY_MAX entries so this never grows unbounded.
const LYRICS_SWEEP_HISTORY_MAX = 24;
interface LyricsSweepEvent {
  ts: number;
  reason: "interval" | "startup" | "write_sample";
  ttlEvicted: number;
  capEvicted: number;
  rowCount: number | null;
  fillRatio: number | null;
  durationMs: number | null;
}
const _lyricsSweepHistory: LyricsSweepEvent[] = [];
function recordLyricsSweepEvent(ev: LyricsSweepEvent): void {
  _lyricsSweepHistory.push(ev);
  if (_lyricsSweepHistory.length > LYRICS_SWEEP_HISTORY_MAX) {
    _lyricsSweepHistory.splice(0, _lyricsSweepHistory.length - LYRICS_SWEEP_HISTORY_MAX);
  }
}

export interface LyricsCacheStatus {
  enabled: boolean;
  rowCount: number | null;
  max: number;
  fillRatio: number | null;
  sweepIntervalMs: number;
  lastSweep: LyricsSweepEvent | null;
  nextSweepEta: number | null;
  recent: {
    sweeps: number;
    ttlEvicted: number;
    capEvicted: number;
    history: LyricsSweepEvent[];
  };
}

/**
 * Snapshot of lyrics_cache health for the status endpoint. Performs a single
 * live row-count query; the rest is read from the in-memory sweep history so
 * this is cheap to call frequently.
 */
export async function getLyricsCacheStatus(): Promise<LyricsCacheStatus> {
  const max = getLyricsDbCacheMax();
  const enabled = !!process.env.DATABASE_URL;
  const rowCount = enabled ? await getLyricsDbRowCount() : null;
  const fillRatio = rowCount != null && max > 0 ? Number((rowCount / max).toFixed(3)) : null;
  const history = _lyricsSweepHistory.slice();
  const lastSweep = history.length > 0 ? history[history.length - 1] : null;
  const nextSweepEta = lastSweep && _lyricsSweepTimer
    ? lastSweep.ts + LYRICS_CACHE_SWEEP_INTERVAL_MS
    : null;
  const recent = history.reduce(
    (acc, ev) => {
      acc.sweeps += 1;
      acc.ttlEvicted += ev.ttlEvicted;
      acc.capEvicted += ev.capEvicted;
      return acc;
    },
    { sweeps: 0, ttlEvicted: 0, capEvicted: 0, history },
  );
  return {
    enabled,
    rowCount,
    max,
    fillRatio,
    sweepIntervalMs: LYRICS_CACHE_SWEEP_INTERVAL_MS,
    lastSweep,
    nextSweepEta,
    recent,
  };
}

async function sweepExpiredDbLyrics(): Promise<number> {
  const mod = await getDbModule();
  if (!mod) return 0;
  try {
    const { db, lyricsCacheTable } = mod;
    const { lt } = await import("drizzle-orm");
    const result: unknown = await db
      .delete(lyricsCacheTable)
      .where(lt(lyricsCacheTable.expiresAt, new Date()));
    return extractRowCount(result);
  } catch {
    // best-effort
    return 0;
  }
}

// Enforce a hard upper bound on the lyrics_cache row count by evicting the
// rows with the soonest-to-expire deadlines once we exceed the cap. Because
// expiresAt is set/refreshed on every insert (and on conflict update), this
// is effectively a least-recently-written eviction policy.
async function enforceLyricsDbCap(): Promise<number> {
  const mod = await getDbModule();
  if (!mod) return 0;
  const max = getLyricsDbCacheMax();
  try {
    const { db, lyricsCacheTable } = mod;
    const { sql } = await import("drizzle-orm");
    // Use a single SQL statement so the read & delete happen atomically
    // relative to other writers. Postgres allows referencing the same
    // table in a subquery of DELETE.
    //
    // Order by expires_at DESC so the freshest `max` rows (those most
    // recently inserted/upserted, since every write resets expires_at to
    // now+TTL) are kept via OFFSET, and everything older is deleted.
    const result: unknown = await db.execute(sql`
      DELETE FROM ${lyricsCacheTable}
      WHERE ${lyricsCacheTable.key} IN (
        SELECT ${lyricsCacheTable.key} FROM ${lyricsCacheTable}
        ORDER BY ${lyricsCacheTable.expiresAt} DESC
        OFFSET ${max}
      )
    `);
    return extractRowCount(result);
  } catch {
    // best-effort
    return 0;
  }
}

// Best-effort extraction of an affected-row count from a drizzle/pg result.
// Different drivers return slightly different shapes (`rowCount`, `count`,
// or an array of rows); we just try the common ones and fall back to 0.
function extractRowCount(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const r = result as Record<string, unknown>;
  if (typeof r.rowCount === "number") return r.rowCount;
  if (typeof r.count === "number") return r.count;
  if (Array.isArray(r.rows)) return r.rows.length;
  if (Array.isArray(result)) return (result as unknown[]).length;
  return 0;
}

async function getLyricsDbRowCount(): Promise<number | null> {
  const mod = await getDbModule();
  if (!mod) return null;
  try {
    const { db, lyricsCacheTable } = mod;
    const { sql } = await import("drizzle-orm");
    const res: unknown = await db.execute(
      sql`SELECT COUNT(*)::int AS count FROM ${lyricsCacheTable}`,
    );
    // pg drivers expose rows on `.rows`; drizzle's neon http driver may
    // return the array directly. Handle both.
    const rows: unknown = (res as { rows?: unknown }).rows ?? res;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const first = rows[0] as Record<string, unknown>;
    const c = first.count;
    if (typeof c === "number") return c;
    if (typeof c === "string") {
      const n = Number(c);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Run one full sweep cycle: expire-by-TTL, then enforce cap, then read the
// post-sweep row count. Emits a single structured log line so operators can
// see how often the cap is hit and how close to it the table normally sits.
// Logged unconditionally (even when nothing was evicted) so a steady stream
// of "everything is fine" data points is available for tuning the cap.
async function runLyricsCacheSweep(reason: "interval" | "startup"): Promise<void> {
  const startedAt = Date.now();
  const ttlEvicted = await sweepExpiredDbLyrics();
  const capEvicted = await enforceLyricsDbCap();
  const rowCount = await getLyricsDbRowCount();
  const max = getLyricsDbCacheMax();
  const fillRatio = rowCount != null && max > 0 ? Number((rowCount / max).toFixed(3)) : null;
  const durationMs = Date.now() - startedAt;
  const event = {
    event: "lyrics_cache_sweep",
    reason,
    ttl_evicted: ttlEvicted,
    cap_evicted: capEvicted,
    row_count: rowCount,
    max,
    fill_ratio: fillRatio,
    duration_ms: durationMs,
  };
  recordLyricsSweepEvent({
    ts: startedAt,
    reason,
    ttlEvicted,
    capEvicted,
    rowCount,
    fillRatio,
    durationMs,
  });
  // Warn when the cap actively evicted rows so it stands out in log search;
  // otherwise just info-log the heartbeat for trend analysis.
  if (capEvicted > 0) {
    console.warn(JSON.stringify(event));
  } else {
    console.log(JSON.stringify(event));
  }
}

function ensureLyricsCacheSweeper(): void {
  if (_lyricsSweepTimer) return;
  _lyricsSweepTimer = setInterval(() => {
    runLyricsCacheSweep("interval").catch(() => {});
  }, LYRICS_CACHE_SWEEP_INTERVAL_MS);
  _lyricsSweepTimer.unref?.();
  // Kick off an initial sweep shortly after startup so a process that just
  // came online doesn't have to wait a full interval to clean up backlog.
  const initial = setTimeout(() => {
    runLyricsCacheSweep("startup").catch(() => {});
  }, 5000);
  initial.unref?.();
}

function getMemCachedLyrics(key: string): LyricsResolved | null {
  const entry = lyricsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    lyricsCache.delete(key);
    return null;
  }
  lyricsCache.delete(key);
  lyricsCache.set(key, entry);
  return entry.value;
}

function setMemCachedLyrics(key: string, value: LyricsResolved, expiresAt: number): void {
  if (lyricsCache.has(key)) lyricsCache.delete(key);
  lyricsCache.set(key, { value, expiresAt });
  while (lyricsCache.size > LYRICS_CACHE_MAX) {
    const oldest = lyricsCache.keys().next().value;
    if (oldest === undefined) break;
    lyricsCache.delete(oldest);
  }
}

async function getCachedLyrics(key: string): Promise<LyricsResolved | null> {
  const mem = getMemCachedLyrics(key);
  if (mem) return mem;
  const dbHit = await getDbCachedLyrics(key);
  if (dbHit) {
    // Hydrate memory using the DB row's original deadline so we don't
    // accidentally extend a near-expiry entry by another full TTL.
    setMemCachedLyrics(key, dbHit.value, dbHit.expiresAt);
    return dbHit.value;
  }
  return null;
}

function setCachedLyrics(key: string, value: LyricsResolved): void {
  setMemCachedLyrics(key, value, Date.now() + LYRICS_CACHE_TTL_MS);
  // Fire-and-forget DB write so the request path stays fast.
  setDbCachedLyrics(key, value).catch(() => {});
}

function withSoftTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    p.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
      .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
  });
}

async function fetchLewdhutaoLyrics(title: string, artist?: string): Promise<{ plainLyrics: string; source: string } | null> {
  const params = new URLSearchParams({ title });
  if (artist) params.set("artist", artist);
  for (const platform of ["musixmatch", "youtube"]) {
    try {
      const url = `https://lyrics.lewdhutao.my.eu.org/v2/${platform}/lyrics?${params.toString()}`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const json = await response.json();
        if (json?.data?.lyrics) {
          return { plainLyrics: String(json.data.lyrics), source: platform };
        }
      }
    } catch {
      // try next platform
    }
  }
  return null;
}

async function raceLyricsProviders(
  title: string,
  artist: string | undefined,
  duration: number | undefined,
): Promise<LyricsResolved | null> {
  const PER_PROVIDER_MS = 5000;
  const TOTAL_BUDGET_MS = 7000;
  const SYNCED_GRACE_MS = 2500;

  type Tagged = { source: string; result: { syncedSegments?: { text: string; startTime: number; endTime: number }[]; plainLyrics?: string } | null };

  const providers: Promise<Tagged>[] = [
    withSoftTimeout(fetchLrclib(title, artist, duration), PER_PROVIDER_MS).then(r => ({ source: "lrclib", result: r })),
    withSoftTimeout(fetchSilvaTechLyrics(title, artist), PER_PROVIDER_MS).then(r => ({ source: "sylvatech", result: r })),
    withSoftTimeout(fetchLyricsOvh(title, artist), PER_PROVIDER_MS).then(s => ({ source: "lyrics.ovh", result: s ? { plainLyrics: s } : null })),
    withSoftTimeout(fetchXcasperGoogleLyrics(title, artist), PER_PROVIDER_MS).then(s => ({ source: "xcasper", result: s ? { plainLyrics: s } : null })),
    withSoftTimeout(fetchXcasperLyricsSearch(title), PER_PROVIDER_MS).then(s => ({ source: "xcasper", result: s ? { plainLyrics: s.lyrics } : null })),
    withSoftTimeout(fetchLewdhutaoLyrics(title, artist), PER_PROVIDER_MS).then(r => ({ source: r?.source ?? "lewdhutao", result: r ? { plainLyrics: r.plainLyrics } : null })),
  ];

  return new Promise<LyricsResolved | null>(resolve => {
    let firstPlain: LyricsResolved | null = null;
    let pending = providers.length;
    let resolved = false;
    let graceTimer: NodeJS.Timeout | null = null;
    const totalTimer = setTimeout(() => finalize(), TOTAL_BUDGET_MS);

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(totalTimer);
      resolve(firstPlain);
    };

    const startGrace = () => {
      if (graceTimer || resolved) return;
      graceTimer = setTimeout(() => finalize(), SYNCED_GRACE_MS);
    };

    providers.forEach(p => {
      p.then(({ source, result }) => {
        if (resolved) return;
        if (result?.syncedSegments && result.syncedSegments.length > 0) {
          resolved = true;
          if (graceTimer) clearTimeout(graceTimer);
          clearTimeout(totalTimer);
          resolve({ synced: true, segments: result.syncedSegments, source });
          return;
        }
        if (result?.plainLyrics && !firstPlain) {
          firstPlain = { synced: false, plainLyrics: result.plainLyrics, source };
          startGrace();
        }
        pending--;
        if (pending === 0) finalize();
      }).catch(() => {
        if (resolved) return;
        pending--;
        if (pending === 0) finalize();
      });
    });
  });
}

async function fetchAILyricsFallback(
  title: string,
  artist: string | undefined,
  log: { warn: (obj: object, msg?: string) => void },
): Promise<LyricsResolved | null> {
  const AI_TIMEOUT_MS = 4000;
  const AI_TOTAL_BUDGET_MS = 8000;
  const deadline = Date.now() + AI_TOTAL_BUDGET_MS;
  const remaining = () => Math.max(0, deadline - Date.now());
  const prompt =
    `Provide the complete lyrics for the song "${title}"${artist ? ` by ${artist}` : ""}.` +
    ` Output ONLY the lyrics text, one line per line. Do NOT include section labels like [Verse] or [Chorus],` +
    ` no markdown, no commentary, no chord names. If you do not know the full lyrics with high confidence, output exactly the single word: UNKNOWN`;

  const callGemini = async (apiKey: string, baseUrl: string | undefined, model: string): Promise<string | null> => {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = baseUrl
      ? new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } })
      : new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return result.text ?? null;
  };

  const tryAttempt = (fn: () => Promise<string | null>): Promise<string | null> => {
    const budget = Math.min(AI_TIMEOUT_MS, remaining());
    if (budget <= 0) return Promise.resolve(null);
    return withSoftTimeout(fn().catch(() => null), budget);
  };

  let text: string | null = null;
  const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (replitBase && replitKey && remaining() > 0) {
    text = await tryAttempt(() => callGemini(replitKey, replitBase, "gemini-2.5-flash"));
  }

  if (!text && remaining() > 0) {
    try {
      const { API_KEYS, clean } = await import("../config/api-keys.js");
      const { getGeminiKeys } = await import("../routes/settings.js");
      const envKeys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
      const allKeys = [...new Set([...clean(API_KEYS.gemini), ...getGeminiKeys(), ...envKeys])];
      for (const key of allKeys) {
        if (remaining() <= 0) break;
        text = await tryAttempt(() => callGemini(key, undefined, "gemini-2.0-flash"));
        if (text) break;
      }
    } catch (err) {
      log.warn({ err }, "AI lyrics fallback: failed to load Gemini keys");
    }
  }

  const validate = (raw: string | null): string | null => {
    if (!raw) return null;
    const cleaned = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
    if (!cleaned) return null;
    if (/^unknown$/i.test(cleaned)) return null;
    const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 3 || cleaned.length < 60) return null;
    return cleaned;
  };

  const geminiText = validate(text);
  if (geminiText) return { synced: false, plainLyrics: geminiText, source: "ai-gemini" };

  // Secondary AI fallback: OpenAI (Replit-managed proxy first, then user/env keys).
  const callOpenAI = async (apiKey: string, baseURL: string | undefined, model: string): Promise<string | null> => {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2048,
    });
    return response.choices[0]?.message?.content ?? null;
  };

  let openaiText: string | null = null;
  const replitOpenaiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const replitOpenaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (replitOpenaiBase && replitOpenaiKey && remaining() > 0) {
    openaiText = await tryAttempt(() => callOpenAI(replitOpenaiKey, replitOpenaiBase, "gpt-5-mini"));
  }
  if (!openaiText && remaining() > 0) {
    try {
      const { API_KEYS, clean } = await import("../config/api-keys.js");
      const envKey = process.env.OPENAI_API_KEY;
      const allKeys = [...new Set([...clean(API_KEYS.openai), ...(envKey ? [envKey] : [])])];
      for (const key of allKeys) {
        if (remaining() <= 0) break;
        openaiText = await tryAttempt(() => callOpenAI(key, undefined, "gpt-4o-mini"));
        if (openaiText) break;
      }
    } catch (err) {
      log.warn({ err }, "AI lyrics fallback: failed to load OpenAI keys");
    }
  }

  const validatedOpenAI = validate(openaiText);
  if (validatedOpenAI) return { synced: false, plainLyrics: validatedOpenAI, source: "ai-openai" };

  return null;
}

async function resolveLyrics(
  title: string,
  artist: string | undefined,
  duration: number | undefined,
  log: { warn: (obj: object, msg?: string) => void },
): Promise<LyricsResolved | null> {
  const key = lyricsCacheKey(title, artist, duration);
  const cached = await getCachedLyrics(key);
  if (cached) return cached;

  const raceResult = await raceLyricsProviders(title, artist, duration);
  if (raceResult) {
    setCachedLyrics(key, raceResult);
    return raceResult;
  }

  const aiResult = await fetchAILyricsFallback(title, artist, log);
  if (aiResult) {
    setCachedLyrics(key, aiResult);
    return aiResult;
  }
  return null;
}

router.get("/lyrics-synced", async (req: Request, res: Response) => {
  const { title, artist, duration } = req.query;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "Bad Request", message: "title query parameter is required" });
    return;
  }

  const artistStr = artist && typeof artist === "string" ? artist : undefined;
  const durationNum = duration && typeof duration === "string" ? Number(duration) : undefined;
  const dur = Number.isFinite(durationNum) ? durationNum : undefined;

  const result = await resolveLyrics(title, artistStr, dur, req.log);
  if (!result) {
    res.status(404).json({ error: "Not Found", message: "No lyrics found for that song. Try a different title or spelling." });
    return;
  }

  if (result.synced && result.segments) {
    res.json({ synced: true, segments: result.segments, source: result.source });
    return;
  }
  if (result.plainLyrics) {
    res.json({ synced: false, plainLyrics: result.plainLyrics, source: result.source });
    return;
  }
  res.status(404).json({ error: "Not Found", message: "No lyrics found for that song. Try a different title or spelling." });
});

router.get("/lyrics", async (req: Request, res: Response) => {
  const { title, artist, duration } = req.query;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "Bad Request", message: "title query parameter is required" });
    return;
  }

  const artistStr = artist && typeof artist === "string" ? artist : undefined;
  const durationNum = duration && typeof duration === "string" ? Number(duration) : undefined;
  const dur = Number.isFinite(durationNum) ? durationNum : undefined;

  const result = await resolveLyrics(title, artistStr, dur, req.log);
  if (!result) {
    res.status(404).json({ error: "Not Found", message: "No lyrics found for that song. Try a different title or spelling." });
    return;
  }

  if (result.synced && result.segments) {
    const lyricsText = result.segments.map(s => s.text).join("\n");
    res.json({ data: { lyrics: lyricsText }, synced: true, segments: result.segments, source: result.source });
    return;
  }
  if (result.plainLyrics) {
    res.json({ data: { lyrics: result.plainLyrics }, source: result.source });
    return;
  }
  res.status(404).json({ error: "Not Found", message: "No lyrics found for that song. Try a different title or spelling." });
});

// ── YouTube full-song search via SilvaTech ────────────────────────────────────
router.get("/music-search-full", async (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Bad Request", message: "q query parameter is required" });
    return;
  }

  try {
    const url = `https://api.silvatech.co.ke/search/youtube?q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(502).json({ error: "Upstream Error", message: "YouTube search unavailable" });
      return;
    }

    const json = await response.json();
    const items = Array.isArray(json) ? json : (json?.results || json?.data || []);
    const results = items.slice(0, 10).map((item: any, idx: number) => ({
      id: item.id || item.videoId || `yt-${idx}`,
      title: item.title || "Unknown",
      artist: typeof item.artist === "string" ? item.artist : (item.artist?.name || (typeof item.channel === "string" ? item.channel : item.channel?.name) || item.author || item.uploader || ""),
      thumbnail: item.thumbnail || item.thumbnails?.[0]?.url || "",
      duration: item.duration || item.durationSec || 0,
      url: item.url || (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : ""),
    })).filter((r: any) => r.url);

    res.json({ results });
  } catch {
    res.status(502).json({ error: "Upstream Error", message: "Failed to search YouTube" });
  }
});

// ── Full YouTube audio download via yt-dlp ──────────────────────────────────
function ytDlpCandidates(): string[] {
  return [
    process.env.YTDLP_BIN,
    path.join(process.cwd(), "..", "..", ".pythonlibs", "bin", "yt-dlp"),
    "yt-dlp",
  ].filter((b): b is string => !!b);
}

// Browser User-Agent that yt-dlp will impersonate for variants that need it.
const YT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Player-client variants tried in order. Many of these bypass the
// "Sign in to confirm you're not a bot" check without cookies.
const YT_PLAYER_CLIENTS: string[] = [
  "ios",
  "mweb",
  "android",
  "tv_embedded",
  "web_safari",
];

// True when stderr looks like YouTube's bot/sign-in challenge or any of the
// near-equivalent age/login gates. Used both to drive variant retries and to
// remember failed video IDs so we don't keep retrying for the next few minutes.
function isBotBlockStderr(stderr: string): boolean {
  if (!stderr) return false;
  const s = stderr.toLowerCase();
  return (
    s.includes("sign in to confirm") ||
    s.includes("confirm you're not a bot") ||
    s.includes("confirm you’re not a bot") ||
    s.includes("confirm your age") ||
    s.includes("video is age restricted") ||
    s.includes("requires authentication") ||
    s.includes("login required")
  );
}

// Build the per-attempt extra args for a given player client and optional
// cookies file. Returned as a flat array to splice into the base args list.
function ytDlpExtraArgsForVariant(playerClient: string | null, cookiesFile: string | null): string[] {
  const extra: string[] = ["--user-agent", YT_USER_AGENT];
  if (playerClient) {
    extra.push("--extractor-args", `youtube:player_client=${playerClient}`);
  }
  if (cookiesFile) {
    extra.push("--cookies", cookiesFile);
  }
  return extra;
}

// Ordered list of (label, extraArgs) variants to try for a single video.
// The last entry is the optional cookies-file fallback when YT_COOKIES_FILE
// is set and points at a readable file.
function ytDlpAttemptVariants(): { label: string; extra: string[] }[] {
  const variants: { label: string; extra: string[] }[] = [];
  for (const client of YT_PLAYER_CLIENTS) {
    variants.push({ label: client, extra: ytDlpExtraArgsForVariant(client, null) });
  }
  const cookiesFile = process.env.YT_COOKIES_FILE;
  if (cookiesFile) {
    try {
      if (fs.existsSync(cookiesFile) && fs.statSync(cookiesFile).isFile()) {
        variants.push({
          label: "cookies",
          extra: ytDlpExtraArgsForVariant("web", cookiesFile),
        });
      }
    } catch {}
  }
  return variants;
}

// In-memory TTL cache of video IDs that recently failed with the bot/sign-in
// challenge. We bail out immediately on subsequent picks within the window so
// the background upgrade doesn't burn 30+ seconds re-running every variant.
const BOT_BLOCK_TTL_MS = 5 * 60 * 1000;
const recentlyBotBlocked = new Map<string, number>();

function rememberBotBlocked(videoId: string): void {
  if (!isValidVideoIdSafe(videoId)) return;
  recentlyBotBlocked.set(videoId, Date.now() + BOT_BLOCK_TTL_MS);
}

function wasRecentlyBotBlocked(videoId: string): boolean {
  const expiresAt = recentlyBotBlocked.get(videoId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    recentlyBotBlocked.delete(videoId);
    return false;
  }
  return true;
}

// Local helper so the bot-block map can be populated before isValidVideoId
// is declared further below.
function isValidVideoIdSafe(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (/(?:^|\.)youtu\.be$/.test(u.hostname)) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (/(?:^|\.)youtube\.com$/.test(u.hostname) || u.hostname === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function tryRunYtDlp(bin: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string; spawnError: boolean }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin, args);
    } catch {
      resolve({ ok: false, stdout: "", stderr: "", spawnError: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (val: { ok: boolean; stdout: string; stderr: string; spawnError: boolean }) => {
      if (done) return;
      done = true;
      try { proc.kill("SIGKILL"); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish({ ok: false, stdout, stderr, spawnError: false }), timeoutMs);
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      finish({ ok: false, stdout, stderr, spawnError: !!isMissing });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr, spawnError: false });
    });
  });
}

async function downloadYouTubeAudio(req: Request, videoId: string): Promise<{ filepath: string; ext: string } | { error: string; status: number; detail?: string; botBlocked?: boolean }> {
  if (wasRecentlyBotBlocked(videoId)) {
    return {
      error: "Upstream Error",
      status: 502,
      detail: "YouTube blocked this download (recent bot challenge).",
      botBlocked: true,
    };
  }

  const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const baseId = uuidv4();
  const outputTemplate = path.join(outputDir, `${baseId}.%(ext)s`);

  const baseArgs = [
    "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--restrict-filenames",
    "--match-filter", "duration < 1800",
    "--print", "after_move:filepath",
    "-o", outputTemplate,
  ];

  let lastStderr = "";
  let lastBotBlocked = false;
  let triedAny = false;
  const variants = ytDlpAttemptVariants();
  outer: for (const bin of ytDlpCandidates()) {
    for (const variant of variants) {
      const args = [...baseArgs, ...variant.extra, fullUrl];
      const { ok, stdout, stderr, spawnError } = await tryRunYtDlp(bin, args, 90000);
      if (spawnError) continue outer; // bin missing; next bin
      triedAny = true;
      lastStderr = stderr || lastStderr;
      if (!ok) {
        const botBlocked = isBotBlockStderr(stderr);
        lastBotBlocked = botBlocked;
        req.log.warn(
          { bin, variant: variant.label, botBlocked, stderr: stderr.slice(0, 300) },
          "yt-dlp variant failed for full audio download",
        );
        continue;
      }
      const filepath = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      if (!filepath || !fs.existsSync(filepath)) {
        req.log.warn({ filepath, stdout: stdout.slice(0, 200) }, "yt-dlp succeeded but file not found");
        continue;
      }
      return { filepath, ext: path.extname(filepath).toLowerCase() };
    }
  }

  if (lastBotBlocked) rememberBotBlocked(videoId);

  return {
    error: "Upstream Error",
    status: triedAny ? 502 : 500,
    detail: lastStderr ? lastStderr.slice(0, 200) : (triedAny ? undefined : "yt-dlp not available"),
    botBlocked: lastBotBlocked,
  };
}

// In-flight download coalescing: when two requests miss the cache for the same
// videoId within the ~10–30s yt-dlp window, share a single download promise so
// we don't run yt-dlp twice (and so the second run doesn't overwrite the first
// cache entry mid-stream). Entries are removed once the shared promise settles
// (success or failure), so a later failed download can be retried fresh.
interface SharedDownload {
  filepath: string;
  ext: string;
  cachedToDisk: boolean;
  // True when the coalesced promise served the file from cache via its
  // internal recheck (no fresh yt-dlp run happened on this path).
  fromCacheRecheck: boolean;
}
interface DownloadFailure {
  error: string;
  status: number;
  detail?: string;
  botBlocked?: boolean;
}
const inFlightDownloads = new Map<string, Promise<SharedDownload>>();

function getOrStartDownload(req: Request, videoId: string): Promise<SharedDownload> {
  const existing = inFlightDownloads.get(videoId);
  if (existing) return existing;

  const promise: Promise<SharedDownload> = (async () => {
    // Recheck cache: a previous coalesced download may have just finished
    // between this caller's first miss and us acquiring the slot.
    const cached = findCachedAudio(videoId);
    if (cached) {
      return { filepath: cached.filepath, ext: cached.ext, cachedToDisk: true, fromCacheRecheck: true };
    }
    const result = await downloadYouTubeAudio(req, videoId);
    if ("error" in result) {
      const err = new Error(result.error) as Error & { _download?: DownloadFailure };
      err._download = {
        error: result.error,
        status: result.status,
        detail: result.detail,
        botBlocked: result.botBlocked,
      };
      throw err;
    }
    const stored = storeInCache(videoId, result.filepath, result.ext);
    if (stored) {
      setImmediate(() => safeBackgroundRun("evictCache", evictCache));
      return { filepath: stored, ext: result.ext, cachedToDisk: true, fromCacheRecheck: false };
    }
    return { filepath: result.filepath, ext: result.ext, cachedToDisk: false, fromCacheRecheck: false };
  })();

  // Remove from map regardless of outcome so failures don't poison future
  // retries and so successful entries don't accumulate forever.
  promise.finally(() => {
    if (inFlightDownloads.get(videoId) === promise) {
      inFlightDownloads.delete(videoId);
    }
  }).catch(() => { /* swallow: real handler observes via the original promise */ });

  inFlightDownloads.set(videoId, promise);
  return promise;
}

function audioContentTypeFromExt(ext: string): string {
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
  if (ext === ".webm" || ext === ".opus") return "audio/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

// ── YouTube audio cache ──────────────────────────────────────────────────────
// Caches downloaded full-song audio by 11-char YouTube videoId so that repeat
// picks of the same song serve instantly instead of re-running yt-dlp (10–30s).
// Eviction: TTL (entries older than CACHE_TTL_MS by mtime) + LRU (when total
// size exceeds CACHE_MAX_BYTES, oldest-mtime entries are removed first).

const CACHE_DIR = path.join(outputDir, "yt_cache");
const CACHE_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Partial-download staging directory. Files here are kept on disk between
// download attempts so yt-dlp can `--continue` from where it left off when
// a user cancels or the connection drops mid-download.
const PARTIAL_DIR = path.join(outputDir, "yt_partial");
const PARTIAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(PARTIAL_DIR)) fs.mkdirSync(PARTIAL_DIR, { recursive: true });

function prunePartials(): void {
  let names: string[];
  try {
    names = fs.readdirSync(PARTIAL_DIR);
  } catch (err) {
    void sendOpsAlert(
      "yt-dlp partial-download cleanup failed: cannot read PARTIAL_DIR. Disk may be missing or unreadable.",
      {
        key: "media-prune-partials-readdir",
        context: { dir: PARTIAL_DIR, err: err instanceof Error ? err.message : String(err) },
      },
    );
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const fp = path.join(PARTIAL_DIR, name);
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs > PARTIAL_TTL_MS) {
        try { fs.unlinkSync(fp); } catch {}
      }
    } catch {}
  }
}

function findPartialBytes(videoId: string): number {
  // Sum sizes of any partial fragments for this videoId (foo.m4a, foo.m4a.part,
  // foo.webm, etc) so we can log how much we're resuming. Useful for debugging
  // and for the eventual "real download speed" task — but harmless on its own.
  if (!isValidVideoId(videoId)) return 0;
  let names: string[];
  try {
    names = fs.readdirSync(PARTIAL_DIR);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    if (!name.startsWith(`${videoId}.`)) continue;
    try {
      const st = fs.statSync(path.join(PARTIAL_DIR, name));
      if (st.isFile()) total += st.size;
    } catch {}
  }
  return total;
}

// Run partial cleanup at startup AND periodically (every hour) so abandoned
// attempts don't accumulate on long-running servers without a restart.
function safeBackgroundRun(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    void sendOpsAlert(
      `Background task "${label}" threw an unexpected error.`,
      {
        key: `media-bg-${label}`,
        context: { err: err instanceof Error ? err.message : String(err) },
      },
    );
  }
}

setImmediate(() => safeBackgroundRun("prunePartials", prunePartials));
setInterval(() => safeBackgroundRun("prunePartials", prunePartials), 60 * 60 * 1000).unref();

function isValidVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

function findCachedAudio(videoId: string): { filepath: string; ext: string } | null {
  if (!isValidVideoId(videoId)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.startsWith(`${videoId}.`)) continue;
    const filepath = path.join(CACHE_DIR, name);
    try {
      const stat = fs.statSync(filepath);
      if (!stat.isFile()) continue;
      if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
        try { fs.unlinkSync(filepath); } catch {}
        continue;
      }
      // Touch mtime so this entry counts as recently used (LRU)
      try {
        const now = new Date();
        fs.utimesSync(filepath, now, now);
      } catch {}
      return { filepath, ext: path.extname(filepath).toLowerCase() };
    } catch {
      continue;
    }
  }
  return null;
}

function removeCacheSiblings(videoId: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(`${videoId}.`)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, name)); } catch {}
    }
  }
}

function storeInCache(videoId: string, srcPath: string, ext: string): string | null {
  if (!isValidVideoId(videoId)) return null;
  const dest = path.join(CACHE_DIR, `${videoId}${ext}`);
  // Ensure only one canonical cache entry per video id (handles codec/ext changes).
  removeCacheSiblings(videoId);
  try {
    fs.renameSync(srcPath, dest);
    return dest;
  } catch {
    try {
      fs.copyFileSync(srcPath, dest);
      try { fs.unlinkSync(srcPath); } catch {}
      return dest;
    } catch {
      return null;
    }
  }
}

function evictCache(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch (err) {
    void sendOpsAlert(
      "yt-dlp cache eviction failed: cannot read CACHE_DIR. Disk may be missing or unreadable.",
      {
        key: "media-evict-cache-readdir",
        context: { dir: CACHE_DIR, err: err instanceof Error ? err.message : String(err) },
      },
    );
    return;
  }
  const files: { path: string; size: number; mtime: number }[] = [];
  const now = Date.now();
  for (const name of entries) {
    const fp = path.join(CACHE_DIR, name);
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs > CACHE_TTL_MS) {
        try { fs.unlinkSync(fp); } catch {}
        continue;
      }
      files.push({ path: fp, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  let total = files.reduce((s, f) => s + f.size, 0);
  if (total <= CACHE_MAX_BYTES) return;
  files.sort((a, b) => a.mtime - b.mtime); // oldest first
  for (const f of files) {
    if (total <= CACHE_MAX_BYTES) break;
    try { fs.unlinkSync(f.path); total -= f.size; } catch {}
  }
}

function readCacheStats(): {
  totalBytes: number;
  entryCount: number;
  oldestMtime: number | null;
  newestMtime: number | null;
  maxBytes: number;
  ttlMs: number;
  entries: { videoId: string; sizeBytes: number; lastUsedMs: number }[];
} {
  let names: string[];
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch {
    return { totalBytes: 0, entryCount: 0, oldestMtime: null, newestMtime: null, maxBytes: CACHE_MAX_BYTES, ttlMs: CACHE_TTL_MS, entries: [] };
  }
  const entries: { videoId: string; sizeBytes: number; lastUsedMs: number }[] = [];
  let total = 0;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const name of names) {
    const fp = path.join(CACHE_DIR, name);
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      const videoId = name.replace(/\.[^.]+$/, "");
      entries.push({ videoId, sizeBytes: st.size, lastUsedMs: st.mtimeMs });
      total += st.size;
      if (oldest === null || st.mtimeMs < oldest) oldest = st.mtimeMs;
      if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {}
  }
  entries.sort((a, b) => b.lastUsedMs - a.lastUsedMs);
  return { totalBytes: total, entryCount: entries.length, oldestMtime: oldest, newestMtime: newest, maxBytes: CACHE_MAX_BYTES, ttlMs: CACHE_TTL_MS, entries };
}

router.get("/song-cache/stats", (_req: Request, res: Response) => {
  res.json(readCacheStats());
});

router.delete("/song-cache", (req: Request, res: Response) => {
  // Destructive admin-only action. Reuse the same x-admin-token /
  // ADMIN_PASSWORD scheme as routes/settings.ts so any caller that
  // hasn't authenticated through Settings can't wipe the cache.
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized", message: "Admin token required to clear the song cache." });
    return;
  }
  let names: string[];
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch {
    res.json({ removedCount: 0, freedBytes: 0 });
    return;
  }
  let removed = 0;
  let freed = 0;
  for (const name of names) {
    const fp = path.join(CACHE_DIR, name);
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) continue;
      fs.unlinkSync(fp);
      removed++;
      freed += st.size;
    } catch {}
  }
  res.json({ removedCount: removed, freedBytes: freed });
});

function parseYtDlpSize(num: string, unit: string): number {
  const n = parseFloat(num);
  if (!Number.isFinite(n)) return 0;
  const u = unit.toUpperCase();
  if (u.startsWith("K")) return n * 1024;
  if (u.startsWith("M")) return n * 1024 * 1024;
  if (u.startsWith("G")) return n * 1024 * 1024 * 1024;
  if (u.startsWith("T")) return n * 1024 * 1024 * 1024 * 1024;
  return n;
}

// SSE endpoint: streams real-time progress while yt-dlp downloads, then emits
// a `done` event with the fileId so the client can fetch the audio bytes.
// Checks the YouTube audio cache first — on hit we emit `done` immediately.
router.get("/music-download-full-progress", (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const rawId = typeof req.query.videoId === "string" ? req.query.videoId : "";
  const videoId = extractYouTubeId(rawUrl) || extractYouTubeId(rawId);

  if (!videoId) {
    res.status(400).json({ error: "Bad Request", message: "A valid YouTube url or videoId is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Cache hit — skip yt-dlp entirely and tell the client the file is ready.
  const cached = findCachedAudio(videoId);
  if (cached) {
    try {
      const size = fs.statSync(cached.filepath).size;
      send("progress", { percent: 100, downloaded: size, total: size });
      send("done", { fileId: path.basename(cached.filepath), ext: cached.ext, size, cached: true });
    } catch {
      send("error", { message: "Cached file vanished" });
    }
    try { res.end(); } catch {}
    return;
  }

  // Bail out fast if this video just hit YouTube's bot challenge — no point
  // re-running every yt-dlp variant for 30+ seconds.
  if (wasRecentlyBotBlocked(videoId)) {
    send("error", {
      message: "YouTube blocked this download. Upload your own audio file to use the full song.",
      reason: "bot_block",
    });
    try { res.end(); } catch {}
    return;
  }

  const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Stable per-videoId path so a previous partial (.part) on disk lets
  // yt-dlp resume from where it left off instead of redownloading from 0.
  const outputTemplate = path.join(PARTIAL_DIR, `${videoId}.%(ext)s`);
  const resumingFromBytes = findPartialBytes(videoId);
  if (resumingFromBytes > 0) {
    req.log.info({ videoId, resumingFromBytes }, "Resuming partial yt-dlp download");
  }

  const baseArgs = [
    "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--restrict-filenames",
    "--match-filter", "duration < 1800",
    "--continue",   // resume any existing .part file for this videoId
    "--no-mtime",   // keep our own mtime so partial-TTL pruning is accurate
    "--print", "after_move:filepath",
    "-o", outputTemplate,
  ];

  const bins = ytDlpCandidates();
  const variants = ytDlpAttemptVariants();
  // Build a flat (bin, variant) attempt list so a bot-blocked variant can
  // fall through to the next without restarting bin enumeration.
  const attempts: { bin: string; variant: { label: string; extra: string[] } }[] = [];
  for (const bin of bins) {
    for (const variant of variants) {
      attempts.push({ bin, variant });
    }
  }
  let proc: ReturnType<typeof spawn> | null = null;
  let aborted = false;
  let finished = false;
  let lastBotBlocked = false;
  let lastStderr = "";

  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch {}
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (proc) {
      try { proc.kill("SIGKILL"); } catch {}
      proc = null;
    }
  };

  req.on("close", () => {
    if (finished) return;
    aborted = true;
    cleanup();
  });

  const tryRun = (idx: number): void => {
    if (aborted || finished) return;
    if (idx >= attempts.length) {
      // Differentiate "no binary" from "every variant tried and failed".
      if (attempts.length === 0) {
        send("error", { message: "yt-dlp not available" });
      } else if (lastBotBlocked) {
        rememberBotBlocked(videoId);
        send("error", {
          message: "YouTube blocked this download. Upload your own audio file to use the full song.",
          reason: "bot_block",
          detail: lastStderr.slice(-200),
        });
      } else {
        send("error", { message: "Download failed", detail: lastStderr.slice(-200) });
      }
      cleanup();
      try { res.end(); } catch {}
      finished = true;
      return;
    }

    const { bin, variant } = attempts[idx];
    const args = [...baseArgs, ...variant.extra, fullUrl];
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(bin, args);
    } catch {
      tryRun(idx + 1);
      return;
    }
    proc = p;

    let stdout = "";
    let stderr = "";
    let resolvedBin = false;
    let lastEmit = 0;

    p.stdout?.on("data", (d: Buffer) => {
      resolvedBin = true;
      stdout += d.toString();
    });

    p.stderr?.on("data", (d: Buffer) => {
      resolvedBin = true;
      const text = d.toString();
      stderr += text;
      // Parse lines like: "[download]  12.3% of  4.50MiB at  500.00KiB/s ETA 00:08"
      // or "[download]  12.3% of ~  4.50MiB ..."
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)\s*([KMGT]i?B)/i);
        if (m) {
          const percent = Math.min(100, Math.max(0, parseFloat(m[1])));
          const total = parseYtDlpSize(m[2], m[3]);
          const downloaded = total > 0 ? Math.round((percent / 100) * total) : 0;

          // Optional speed: "at  500.00KiB/s" — yt-dlp prints "Unknown B/s"
          // before it has a sample, so we only emit a number when present.
          let speed: number | null = null;
          const sm = line.match(/\bat\s+([\d.]+)\s*([KMGT]i?B)\/s/i);
          if (sm) {
            const s = parseYtDlpSize(sm[1], sm[2]);
            if (s > 0) speed = s;
          }

          // Optional ETA: "ETA 00:08" or "ETA 01:02:03". yt-dlp prints
          // "ETA Unknown" before it has an estimate.
          let etaSec: number | null = null;
          const em = line.match(/\bETA\s+(\d+):(\d+)(?::(\d+))?/i);
          if (em) {
            const a = parseInt(em[1], 10);
            const b = parseInt(em[2], 10);
            const c = em[3] !== undefined ? parseInt(em[3], 10) : null;
            const eta = c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
            if (Number.isFinite(eta) && eta >= 0) etaSec = eta;
          }

          const now = Date.now();
          if (now - lastEmit > 200 || percent >= 100) {
            lastEmit = now;
            send("progress", { percent, downloaded, total, speed, etaSec });
          }
        }
      }
    });

    p.on("error", (err: NodeJS.ErrnoException) => {
      if (!resolvedBin && err.code === "ENOENT") {
        proc = null;
        // Skip remaining attempts that use the same missing bin.
        let next = idx + 1;
        while (next < attempts.length && attempts[next].bin === bin) next++;
        tryRun(next);
        return;
      }
      if (finished) return;
      lastStderr = stderr || lastStderr;
      proc = null;
      tryRun(idx + 1);
    });

    p.on("close", (code) => {
      if (finished || aborted) {
        finished = true;
        return;
      }
      if (code === 0) {
        const tmpPath = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
        if (tmpPath && fs.existsSync(tmpPath)) {
          const ext = path.extname(tmpPath).toLowerCase();
          // Promote temp file into the per-videoId cache so future requests are
          // instant. If caching fails, fall back to serving from outputDir
          // with a scheduled cleanup.
          const stored = storeInCache(videoId, tmpPath, ext);
          const finalPath = stored ?? tmpPath;
          if (stored) {
            setImmediate(() => safeBackgroundRun("evictCache", evictCache));
          } else {
            scheduleCleanup(tmpPath, 5 * 60 * 1000);
          }
          const size = fs.statSync(finalPath).size;
          send("done", { fileId: path.basename(finalPath), ext, size, cached: !!stored });
          finished = true;
          cleanup();
          try { res.end(); } catch {}
        } else {
          req.log.warn({ filepath: tmpPath, stdout: stdout.slice(0, 200) }, "yt-dlp succeeded but file not found");
          lastStderr = stderr || lastStderr;
          proc = null;
          tryRun(idx + 1);
        }
      } else {
        const botBlocked = isBotBlockStderr(stderr);
        if (botBlocked) lastBotBlocked = true;
        lastStderr = stderr || lastStderr;
        req.log.warn(
          { variant: variant.label, botBlocked, stderr: stderr.slice(0, 300) },
          "yt-dlp variant failed during streaming download",
        );
        proc = null;
        tryRun(idx + 1);
      }
    });
  };

  tryRun(0);
});

// Serves a file previously produced by /music-download-full-progress. The
// fileId is either a UUID-shaped temp file in outputDir or an 11-char
// videoId-shaped entry in the cache dir.
router.get("/music-download-full-file", (req: Request, res: Response) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : "";
  const isUuid = /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(fileId);
  const isCached = /^[a-zA-Z0-9_-]{11}\.[a-z0-9]+$/.test(fileId);
  if (!isUuid && !isCached) {
    res.status(400).json({ error: "Bad Request", message: "Invalid fileId" });
    return;
  }
  // Resolve the file. A videoId-shaped fileId can live in either CACHE_DIR
  // (the happy path: storeInCache succeeded) or PARTIAL_DIR (fallback path
  // when caching failed and we're serving directly from the partial-staging
  // dir). Try cache first, then fall back to partials. UUID-shaped ids only
  // come from outputDir.
  const candidates: { dir: string; cached: boolean }[] = isCached
    ? [{ dir: CACHE_DIR, cached: true }, { dir: PARTIAL_DIR, cached: false }]
    : [{ dir: outputDir, cached: false }];
  let filepath = "";
  let fromCache = false;
  for (const c of candidates) {
    const fp = path.join(c.dir, fileId);
    if (fp.startsWith(c.dir + path.sep) && fs.existsSync(fp)) {
      filepath = fp;
      fromCache = c.cached;
      break;
    }
  }
  if (!filepath) {
    res.status(404).json({ error: "Not Found", message: "File expired or missing" });
    return;
  }
  const ext = path.extname(filepath).toLowerCase();
  const stat = fs.statSync(filepath);
  res.setHeader("Content-Type", audioContentTypeFromExt(ext));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Audio-Source", "youtube");
  res.setHeader("X-Audio-Cache", fromCache ? "HIT" : "MISS");

  if (fromCache) {
    // Touch mtime so cache eviction treats this as recently used.
    try { const now = new Date(); fs.utimesSync(filepath, now, now); } catch {}
  }

  const stream = fs.createReadStream(filepath);
  stream.on("error", () => { try { res.end(); } catch {} });
  // Only schedule cleanup for non-cached temp files; cached files are managed
  // by the TTL/LRU eviction policy. Partial-dir files (cache-write failure
  // fallback) are also cleaned up here so we don't double-store them.
  if (!fromCache) {
    stream.on("close", () => { scheduleCleanup(filepath, 10_000); });
  }
  stream.pipe(res);
});

router.get("/music-download-full", async (req: Request, res: Response) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const rawId = typeof req.query.videoId === "string" ? req.query.videoId : "";
  const videoId = extractYouTubeId(rawUrl) || extractYouTubeId(rawId);

  if (!videoId) {
    res.status(400).json({ error: "Bad Request", message: "A valid YouTube url or videoId is required" });
    return;
  }

  let filepath: string;
  let ext: string;
  let cacheHit = false;
  let cached_to_disk = true;

  const cached = findCachedAudio(videoId);
  if (cached) {
    filepath = cached.filepath;
    ext = cached.ext;
    cacheHit = true;
  } else {
    try {
      const shared = await getOrStartDownload(req, videoId);
      filepath = shared.filepath;
      ext = shared.ext;
      cached_to_disk = shared.cachedToDisk;
      // If the coalesced download's internal cache re-check hit (race window
      // between the route's first miss and acquiring the in-flight slot),
      // the file came from cache — surface that to telemetry headers.
      if (shared.fromCacheRecheck) cacheHit = true;
    } catch (err) {
      const failure = (err as Error & { _download?: DownloadFailure })._download;
      if (failure) {
        res.status(failure.status).json({
          error: failure.error,
          message: failure.botBlocked
            ? "YouTube blocked this download. Upload your own audio file to use the full song."
            : "Could not download full audio for that song.",
          detail: failure.detail,
          reason: failure.botBlocked ? "bot_block" : undefined,
        });
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      req.log.error({ err }, "Coalesced YouTube download failed");
      res.status(500).json({ error: "Server Error", message });
      return;
    }
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filepath);
  } catch {
    res.status(500).json({ error: "Server Error", message: "Cached audio file vanished" });
    return;
  }
  res.setHeader("Content-Type", audioContentTypeFromExt(ext));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Audio-Source", "youtube");
  res.setHeader("X-Audio-VideoId", videoId);
  res.setHeader("X-Audio-Cache", cacheHit ? "HIT" : "MISS");

  const stream = fs.createReadStream(filepath);
  stream.on("error", () => { try { res.end(); } catch {} });
  if (!cached_to_disk) {
    const tmpPath = filepath;
    stream.on("close", () => { scheduleCleanup(tmpPath, 10_000); });
  }
  stream.pipe(res);
});

// ── Find Deezer preview for a YouTube result ────────────────────────────────
router.get("/music-preview", async (req: Request, res: Response) => {
  const { title, artist } = req.query;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "Bad Request", message: "title query parameter is required" });
    return;
  }

  const artistStr = artist && typeof artist === "string" ? artist : "";
  const query = artistStr ? `${title} ${artistStr}` : title;

  try {
    const xcasperRes = await fetch(`https://apis.xcasper.space/api/search/deezer?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (xcasperRes.ok) {
      const json = await xcasperRes.json();
      const results = (json?.results || [])
        .filter((r: any) => r.preview_url && typeof r.preview_url === "string" && /^https?:\/\//i.test(r.preview_url))
        .slice(0, 5);
      if (results.length > 0) {
        res.json({
          results: results.map((r: any) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            album: r.album,
            albumArt: r.thumbnail,
            preview: r.preview_url,
            duration: r.duration_secs || 0,
          })),
        });
        return;
      }
    }

    const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`, {
      signal: AbortSignal.timeout(10000),
    });
    if (deezerRes.ok) {
      const json = await deezerRes.json();
      const results = (json.data || []).filter((item: any) => item.preview && typeof item.preview === "string" && /^https?:\/\//i.test(item.preview)).map((item: any) => ({
        id: item.id,
        title: item.title,
        artist: item.artist?.name || "",
        album: item.album?.title || "",
        albumArt: item.album?.cover_medium || "",
        preview: item.preview,
        duration: item.duration || 0,
      }));
      if (results.length > 0) {
        res.json({ results });
        return;
      }
    }

    res.json({ results: [] });
  } catch {
    res.json({ results: [] });
  }
});

// ── Text translation via @vitalets/google-translate-api ───────────────────────
// Uses the free Google Translate web endpoint. Chunks long inputs (~4500 chars)
// to stay under the upstream URL length cap, preserving line breaks so LRC
// timestamps line up after rejoining.
router.post("/translate", async (req: Request, res: Response) => {
  const { q, lang } = req.body as { q?: string; lang?: string };
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Bad Request", message: "q (text) is required" });
    return;
  }
  const targetLang = (lang && typeof lang === "string") ? lang : "en";

  // Pack lines into chunks under CHUNK_LIMIT chars, AND hard-slice any single
  // line that itself exceeds the limit so we never send an oversized payload.
  const CHUNK_LIMIT = 4500;
  const safeLines: string[] = [];
  for (const line of q.split("\n")) {
    if (line.length <= CHUNK_LIMIT) {
      safeLines.push(line);
    } else {
      for (let i = 0; i < line.length; i += CHUNK_LIMIT) {
        safeLines.push(line.slice(i, i + CHUNK_LIMIT));
      }
    }
  }
  const chunks: string[] = [];
  let current = "";
  for (const line of safeLines) {
    if (current.length + line.length + 1 > CHUNK_LIMIT && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);

  try {
    const results: string[] = [];
    const sourceLangs: string[] = [];
    for (const chunk of chunks) {
      const out = await gTranslate(chunk, {
        to: targetLang,
        fetchOptions: { signal: AbortSignal.timeout(15000) },
      });
      results.push(out.text);
      const from = (out.raw as { src?: string } | undefined)?.src;
      if (typeof from === "string") sourceLangs.push(from.toLowerCase());
    }

    // Only flag "same language" when EVERY detected chunk source matches the
    // target — mixed-language inputs (e.g. bilingual lyrics) still translate.
    const target = targetLang.toLowerCase();
    const allSame = sourceLangs.length > 0 && sourceLangs.every(s => s === target);
    if (allSame) {
      res.status(400).json({
        error: "Same Language",
        message: `The text is already in ${targetLang.toUpperCase()}. Pick a different target language.`,
      });
      return;
    }

    res.json({
      translatedText: results.join("\n"),
      detectedSourceLang: sourceLangs[0] ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Bad/unknown target language → 400 so the client can correct the request.
    if (/invalid|unsupported|target language|language code/i.test(msg)) {
      res.status(400).json({ error: "Bad Request", message: `Invalid target language: ${targetLang}` });
      return;
    }
    res.status(502).json({ error: "Upstream Error", message: `Translation failed: ${msg}` });
  }
});

// ── AI image generation via SilvaTech ─────────────────────────────────────────
router.post("/ai-image", async (req: Request, res: Response) => {
  const { prompt } = req.body as { prompt?: string };
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "Bad Request", message: "prompt is required" });
    return;
  }

  try {
    const url = `https://api.silvatech.co.ke/ai/imagine?q=${encodeURIComponent(prompt.trim())}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const url2 = `https://api.silvatech.co.ke/ai/photoleap?q=${encodeURIComponent(prompt.trim())}`;
      const response2 = await fetch(url2, { signal: AbortSignal.timeout(30000) });
      if (!response2.ok) {
        res.status(502).json({ error: "Upstream Error", message: "AI image generation failed" });
        return;
      }
      const ct2 = response2.headers.get("content-type") || "";
      if (ct2.includes("image")) {
        const buffer = await response2.arrayBuffer();
        res.setHeader("Content-Type", ct2);
        res.send(Buffer.from(buffer));
        return;
      }
      const json2 = await response2.json();
      const imgUrl2 = json2?.result?.image_url || json2?.url || json2?.image || (typeof json2?.result === "string" ? json2.result : "") || "";
      res.json({ imageUrl: imgUrl2 });
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("image")) {
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.send(Buffer.from(buffer));
      return;
    }

    const json = await response.json();
    const imgUrl = json?.result?.image_url || json?.url || json?.image || (typeof json?.result === "string" ? json.result : "") || "";
    res.json({ imageUrl: imgUrl });
  } catch {
    res.status(502).json({ error: "Upstream Error", message: "AI image generation failed" });
  }
});

// ── Auto-Sync Lyrics — POST /api/media/auto-sync-lyrics ─────────────────────

const autoSyncUpload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only video and audio files are supported"));
  },
});

const ALLOWED_AUDIO_URL_PATTERNS = [
  /^https?:\/\/[^/]*\.deezer\.com\//i,
  /^https?:\/\/[^/]*\.dzcdn\.net\//i,
];

function isAllowedAudioUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("172.")) return false;
    if (hostname === "169.254.169.254" || hostname.endsWith(".internal")) return false;
    return ALLOWED_AUDIO_URL_PATTERNS.some(p => p.test(url));
  } catch {
    return false;
  }
}

router.post("/auto-sync-lyrics", autoSyncUpload.single("file"), async (req: Request, res: Response) => {
  const lyricsJson = req.body?.lyrics;
  let lyrics: Array<{ text: string; startTime: number; endTime: number }> = [];
  try {
    lyrics = typeof lyricsJson === "string" ? JSON.parse(lyricsJson) : lyricsJson;
  } catch {
    res.status(400).json({ error: "Bad Request", message: "Invalid lyrics JSON" });
    return;
  }

  if (!Array.isArray(lyrics) || lyrics.length === 0) {
    res.status(400).json({ error: "Bad Request", message: "Lyrics segments are required" });
    return;
  }

  // Stream progress events back to the client so it can show real-time retry status.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  const sendEvent = (event: string, data: unknown) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (writeErr) {
      req.log.warn({ err: writeErr }, "SSE write failed — client likely disconnected");
      clientGone = true;
    }
  };

  const onRetry = (attempt: number, total: number) => sendEvent("retry", { attempt, total });

  const isPreviewClip = req.body?.isPreviewClip === "true" || req.body?.isPreviewClip === true;
  const _rawAutoSyncGap = Number((req.body as Record<string, unknown>)?.gapThreshold);
  const userAutoSyncGapThreshold: number | undefined =
    Number.isFinite(_rawAutoSyncGap) && _rawAutoSyncGap > 0 ? _rawAutoSyncGap : undefined;
  const firstLyricTime = lyrics.reduce((min, s) => Math.min(min, s.startTime), Infinity);

  // Detect whether incoming lyrics are "plain distributed" (evenly-spaced
  // from t=0). When this is true, a flat global offset is wrong — we should
  // redistribute lines from the detected vocal onset instead.
  const lyricsAreDistributed = (() => {
    if (lyrics.length < 2 || firstLyricTime > 0.5) return false;
    const sorted = [...lyrics].sort((a, b) => a.startTime - b.startTime);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].startTime - sorted[i - 1].startTime);
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    // All gaps must be within 5% of the average to count as evenly distributed
    const allEven = gaps.every(g => Math.abs(g - avgGap) < avgGap * 0.05 + 0.01);
    return allEven;
  })();
  // Optional language hint (ISO 639-1 code, e.g. "en", "fr") forwarded to
  // Whisper so it doesn't have to auto-detect the language, improving accuracy
  // for non-English lyrics.
  const _rawLang = String((req.body as Record<string, unknown>)?.language ?? "").trim();
  const languageHint: string | undefined = /^[a-z]{2,3}$/.test(_rawLang) ? _rawLang : undefined;

  let audioBase64: string | null = null;
  let inputPath: string | null = null;
  let audioPath: string | null = null;
  // For full-song audio (uploaded files / non-preview clips) we extract a
  // separate longer-cap WAV so whisper can transcribe the WHOLE song for
  // line-by-line forced alignment. The 60s `audioPath` above is still used
  // for Gemini (avoids huge base64 payloads) and acoustic onset.
  let alignAudioPath: string | null = null;
  const ALIGN_DURATION_CAP = 600; // seconds — covers up to a 10 min track

  try {
    if (req.file) {
      inputPath = req.file.path;
      audioPath = path.join(uploadDir, `${uuidv4()}.wav`);
      await runProcess("ffmpeg", [
        "-y", "-i", inputPath,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "-t", "60",
        audioPath,
      ]);
      const audioStats = fs.statSync(audioPath);
      if (audioStats.size < 1000) {
        scheduleCleanup(inputPath, 0);
        scheduleCleanup(audioPath, 0);
        sendEvent("result", { offset: null, message: "No audio detected in the file" });
        if (!res.writableEnded) res.end();
        return;
      }
      audioBase64 = fs.readFileSync(audioPath).toString("base64");
      if (!isPreviewClip) {
        alignAudioPath = path.join(uploadDir, `${uuidv4()}.wav`);
        try {
          await runProcess("ffmpeg", [
            "-y", "-i", inputPath,
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            "-t", String(ALIGN_DURATION_CAP),
            alignAudioPath,
          ]);
        } catch (err) {
          req.log.warn({ err }, "Failed to extract full-length WAV for alignment");
          alignAudioPath = null;
        }
      }
    } else if (req.body?.audioUrl) {
      const audioUrl = req.body.audioUrl;
      if (!isAllowedAudioUrl(audioUrl)) {
        sendEvent("error", { message: "Audio URL not allowed" });
        if (!res.writableEnded) res.end();
        return;
      }
      const tmpPath = path.join(uploadDir, `${uuidv4()}.tmp`);
      audioPath = path.join(uploadDir, `${uuidv4()}.wav`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const audioRes = await fetch(audioUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        clearTimeout(timeout);
        if (!audioRes.ok) {
          req.log.warn({ status: audioRes.status, url: audioUrl }, "Audio URL fetch failed");
          sendEvent("result", { offset: null, message: "Failed to fetch audio from URL" });
          if (!res.writableEnded) res.end();
          return;
        }
        const arrayBuf = await audioRes.arrayBuffer();
        if (arrayBuf.byteLength > 50 * 1024 * 1024) {
          sendEvent("result", { offset: null, message: "Audio file too large" });
          if (!res.writableEnded) res.end();
          return;
        }
        fs.writeFileSync(tmpPath, Buffer.from(arrayBuf));
      } catch (fetchErr) {
        clearTimeout(timeout);
        req.log.warn({ err: fetchErr, url: audioUrl }, "Audio URL fetch error");
        sendEvent("result", { offset: null, message: "Failed to fetch audio from URL" });
        if (!res.writableEnded) res.end();
        return;
      }
      inputPath = tmpPath;
      await runProcess("ffmpeg", [
        "-y", "-i", tmpPath,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "-t", "60",
        audioPath,
      ]);
      const audioStats = fs.statSync(audioPath);
      if (audioStats.size < 1000) {
        scheduleCleanup(tmpPath, 0);
        scheduleCleanup(audioPath, 0);
        sendEvent("result", { offset: null, message: "No audio detected" });
        if (!res.writableEnded) res.end();
        return;
      }
      audioBase64 = fs.readFileSync(audioPath).toString("base64");
    } else {
      sendEvent("error", { message: "No audio file or URL provided" });
      if (!res.writableEnded) res.end();
      return;
    }

    const sortedLyricsForHint = [...lyrics].sort((a, b) => a.startTime - b.startTime);
    const firstLyricLine = sortedLyricsForHint[0]?.text || "";
    const firstTwoLyricLines = sortedLyricsForHint.slice(0, 2).map(s => s.text).join(" ");

    // Use the longer-cap WAV for whisper when we have it (full songs only),
    // so we get word timestamps across the whole track for line-by-line
    // forced alignment. Allow up to 3 min for whisper-tiny on a long song.
    const whisperAudio = alignAudioPath ?? audioPath;
    const whisperCap = alignAudioPath ? ALIGN_DURATION_CAP : 60;
    const whisperTimeout = alignAudioPath ? 180000 : 60000;
    const [acousticOnset, vocalBandAcousticOnset, pythonResult] = await Promise.all([
      // Unfiltered — detects any sound; used to validate Gemini estimates.
      audioPath ? detectAcousticOnset(audioPath, false) : Promise.resolve(null),
      // Vocal-band filtered (200 Hz–4 kHz) — ignores kick drums, sub-bass, 808s.
      // Used as the acoustic fallback for firstVocalTime, so beat-only intros
      // don't incorrectly push vocals to t=0.
      audioPath ? detectAcousticOnset(audioPath, true) : Promise.resolve(null),
      whisperAudio ? detectVocalOnsetPython(whisperAudio, whisperCap, whisperTimeout, firstLyricLine, languageHint) : Promise.resolve(null),
    ]);
    const pythonVocalOnset = pythonResult?.vocalOnset ?? null;
    const pythonMethod = pythonResult?.method ?? null;
    const pythonMatchedWord = pythonResult?.matchedWord ?? null;
    const pythonFirstWord = pythonResult?.firstWord ?? null;
    const pythonTranscript = pythonResult?.transcript ?? null;
    req.log.info(
      { pythonVocalOnset, pythonMethod, pythonMatchedWord, pythonFirstWord, pythonTranscript, acousticOnset, vocalBandAcousticOnset },
      "Python vocal-onset analysis complete",
    );

    // Detect lyrics/audio mismatch by comparing whisper transcript against the
    // first ~2 LRC lines. If shared content-words are too few, the LRC almost
    // certainly belongs to a different song and any computed offset is meaningless.
    const STOPWORDS = new Set([
      "the","and","you","are","for","but","not","with","that","this","have","from",
      "they","your","what","when","were","was","yes","its","all","any","into","just",
      "like","there","then","than","them","our","out","off","ill","ive","got","get",
      "yeah","oooh","ooh","ohh","aah","hey","mmm","whoa","woah","gonna","wanna",
    ]);
    const tokenize = (s: string): string[] =>
      s.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
    const transcriptText = (pythonTranscript || "").trim();
    let lyricsMismatch = false;
    // For preview clips the audio starts mid-song, so comparing the transcript
    // against the song's *first* LRC lines is unreliable. We only run the
    // mismatch check on full-song audio (uploaded files / non-preview clips).
    let mismatchReason: string | null = null;
    if (!isPreviewClip && transcriptText && firstTwoLyricLines.trim()) {
      const tTokens = tokenize(transcriptText).slice(0, 12).filter(w => !STOPWORDS.has(w));
      const lTokens = new Set(tokenize(firstTwoLyricLines).filter(w => !STOPWORDS.has(w)));
      if (tTokens.length > 0 && lTokens.size > 0) {
        const shared = tTokens.filter(t => lTokens.has(t)).length;
        if (shared < 2) {
          lyricsMismatch = true;
          mismatchReason = "The fetched lyrics don't seem to match this audio.";
        }
      }
    }
    // For preview clips we can't compare against the song's first lyrics
    // (the preview starts mid-song), but we can still detect the case where
    // the transcript is too short / generic to reliably match anything in
    // the LRC. Without enough unique content words, any computed offset is
    // a guess and the user is better off knowing.
    if (!lyricsMismatch && isPreviewClip && transcriptText) {
      const tContent = tokenize(transcriptText).filter(w => !STOPWORDS.has(w));
      if (tContent.length < 3) {
        lyricsMismatch = true;
        mismatchReason = "Couldn't hear enough lyrics in this 30s preview clip to sync reliably. Try uploading the full song, or paste your own lyrics.";
      } else {
        // Transcript is substantial — verify those words actually appear
        // somewhere in the fetched LRC. If almost none of the heard content
        // words show up anywhere in the lyrics, the LRC is for a different
        // song and any computed offset would put the wrong words on top of
        // the right music.
        const fullLyricsText = sortedLyricsForHint.map(s => s.text).join(" ");
        const allLyricTokens = new Set(tokenize(fullLyricsText).filter(w => !STOPWORDS.has(w)));
        if (allLyricTokens.size > 0) {
          const tTokens = tContent.slice(0, 20);
          const shared = tTokens.filter(t => allLyricTokens.has(t)).length;
          if (shared < 2) {
            lyricsMismatch = true;
            mismatchReason = "The fetched lyrics don't match the audio in this preview. Try a different title/artist or paste your own lyrics.";
          }
        }
      }
    }
    if (lyricsMismatch) {
      req.log.warn(
        { transcriptText, firstTwoLyricLines, isPreviewClip },
        "Detected lyrics/audio mismatch — refusing to apply offset",
      );
      if (inputPath) scheduleCleanup(inputPath);
      if (audioPath) scheduleCleanup(audioPath, 5000);
      if (alignAudioPath) scheduleCleanup(alignAudioPath, 5000);
      const transcribedSegments = pythonResult?.words
        ? buildSegmentsFromWhisperWords(pythonResult.words, userAutoSyncGapThreshold)
        : [];
      sendEvent("result", {
        offset: null,
        lyricsMismatch: true,
        pythonTranscript: transcriptText,
        firstLyricLine,
        transcribedSegments: transcribedSegments.length > 0 ? transcribedSegments : undefined,
        message: mismatchReason ?? "The fetched lyrics don't seem to match this audio.",
      });
      if (!res.writableEnded) res.end();
      return;
    }

    // Force-align user lyrics to whisper word timestamps for real per-line
    // timing throughout the song. Only useful when we have a meaningful set
    // of whisper words AND enough lyric lines to align. Confidence threshold
    // is intentionally moderate — if alignment fails to match a strong
    // majority, we fall through to the legacy single-offset response.
    let alignedSegments: AlignedLine[] | null = null;
    let matchedLineCount = 0;
    let totalLineCount = 0;
    if (pythonResult?.words && pythonResult.words.length >= 8 && lyrics.length >= 4) {
      const sortedForAlign = [...lyrics].sort((a, b) => a.startTime - b.startTime);
      const { aligned, matched } = forceAlignLyricsToWords(sortedForAlign, pythonResult.words);
      totalLineCount = sortedForAlign.length;
      matchedLineCount = matched;
      const matchRatio = totalLineCount > 0 ? matched / totalLineCount : 0;
      // Accept per-line alignment when at least 3 lines are matched and the
      // match ratio is ≥ 45 %.  Unmatched lines are interpolated between the
      // matched anchor points, which is always better than a flat global
      // offset — even at moderate confidence.  The previous 60 % threshold
      // was too strict for rap / fast-delivery / non-English songs where
      // Whisper may only capture a fraction of lines as distinct word tokens.
      const confident = matched >= 3 && matchRatio >= 0.45;
      req.log.info(
        { matched, totalLineCount, matchRatio, whisperWords: pythonResult.words.length, confident },
        "Forced alignment result",
      );
      if (confident) alignedSegments = aligned;
    }

    const onsetHint = pythonVocalOnset !== null
      ? `Python audio analysis detected the first likely vocal onset around ${pythonVocalOnset.toFixed(2)} seconds. ` +
        "Confirm or refine this estimate using the audio. "
      : acousticOnset !== null
        ? `Audio analysis suggests sound first appears around ${acousticOnset.toFixed(2)} seconds. ` +
          "Use this as a reference but identify the actual first VOCAL time " +
          "(which may be later if there is an instrumental intro). "
        : "";

    const sortedLyrics = [...lyrics].sort((a, b) => a.startTime - b.startTime);
    const firstFewLyrics = sortedLyrics.slice(0, 5).map(s => s.text).join(" / ");
    const SYNC_PROMPT = isPreviewClip
      ? "Listen to this audio clip carefully. It is a short preview clip of a song. " +
        "Some known lyrics from this song include: \"" + firstFewLyrics + "\". " +
        onsetHint +
        "Identify the exact timestamp (in seconds, with decimal precision like 2.5 or 14.3) " +
        "when the first sung or spoken vocal words begin in this audio clip. " +
        "The clip may start at any point in the song, not necessarily the beginning. " +
        "Ignore any instrumental sounds, silence, or non-vocal audio. " +
        "Return ONLY a JSON object with these fields: " +
        '"firstVocalTime" (number, the timestamp in seconds when the first vocal begins in this clip), ' +
        '"firstWords" (string, the first few words you hear sung in this clip). ' +
        "If there are no vocals detected at all, return {\"firstVocalTime\": null, \"firstWords\": null}. " +
        "Output ONLY the JSON object, no markdown, no explanation."
      : "Listen to this audio carefully. The first lyrics of this song are: \"" + firstFewLyrics + "\". " +
        onsetHint +
        "Identify the exact timestamp (in seconds, with decimal precision like 2.5 or 14.3) " +
        "when these first sung or spoken words begin in the audio. " +
        "Ignore any instrumental intro, silence, or non-vocal sounds. " +
        "Return ONLY a JSON object with these fields: " +
        '"firstVocalTime" (number, the timestamp in seconds when the first word/vocal begins), ' +
        '"firstWords" (string, the first few words you hear sung). ' +
        "If there are no vocals detected at all, return {\"firstVocalTime\": null, \"firstWords\": null}. " +
        "Output ONLY the JSON object, no markdown, no explanation.";

    const { GoogleGenAI } = await import("@google/genai");
    let responseText: string | null = null;
    let syncQuotaExceeded = false;

    const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (replitBase && replitKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: replitKey, httpOptions: { apiVersion: "", baseUrl: replitBase } });
        const result = await withQuotaRetry(() => ai.models.generateContent({
          model: "gemini-2.5-pro",
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
              { text: SYNC_PROMPT },
            ],
          }],
        }).then(r => r.text ?? null), req.log, onRetry);
        if (result.quota) syncQuotaExceeded = true;
        responseText = result.text;
      } catch (err) {
        req.log.warn({ err }, "Replit-managed Gemini auto-sync failed, trying user keys");
      }
    }

    if (!responseText) {
      const { API_KEYS, clean } = await import("../config/api-keys.js");
      const { getGeminiKeys } = await import("../routes/settings.js");
      const envKeys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
      const allKeys = [...new Set([...clean(API_KEYS.gemini), ...getGeminiKeys(), ...envKeys])];

      for (const key of allKeys) {
        try {
          const ai = new GoogleGenAI({ apiKey: key });
          const result = await withQuotaRetry(() => ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
                { text: SYNC_PROMPT },
              ],
            }],
          }).then(r => r.text ?? null), req.log, onRetry);
          if (result.quota) syncQuotaExceeded = true;
          responseText = result.text;
          if (responseText) break;
        } catch (err) {
          req.log.warn({ err }, "Gemini key failed for auto-sync");
        }
      }
    }

    if (inputPath) scheduleCleanup(inputPath);
    if (audioPath) scheduleCleanup(audioPath, 5000);
    if (alignAudioPath) scheduleCleanup(alignAudioPath, 5000);

    if (!responseText && pythonVocalOnset === null && acousticOnset === null && vocalBandAcousticOnset === null && !alignedSegments) {
      const message = syncQuotaExceeded
        ? "AI quota limit reached — auto-sync unavailable"
        : "Auto-sync unavailable — no AI keys configured";
      sendEvent("result", { offset: null, message, reason: syncQuotaExceeded ? "quota_exceeded" : undefined });
      if (!res.writableEnded) res.end();
      return;
    }

    let geminiVocalTime: number | null = null;
    let firstWords: string | null = null;
    if (responseText) {
      try {
        const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed.firstVocalTime === "number") {
          geminiVocalTime = parsed.firstVocalTime;
        }
        if (parsed && typeof parsed.firstWords === "string") {
          firstWords = parsed.firstWords;
        }
      } catch {
        req.log.warn("Failed to parse Gemini auto-sync response");
      }
    }

    // Validate Gemini estimate against the best available acoustic reference.
    // When the vocal-band onset is available, use it as the lower bound —
    // any Gemini time before the first detected vocal-frequency sound is
    // definitely wrong (e.g. Gemini reports 0s because drums start at 0s).
    if (geminiVocalTime !== null) {
      const outOfRange = geminiVocalTime < 0 || geminiVocalTime > 55;
      // Use vocal-band onset as reference if available (ignores kick/bass),
      // otherwise fall back to raw acoustic onset.
      const referenceOnset = vocalBandAcousticOnset ?? acousticOnset;
      const beforeAnySound = referenceOnset !== null && geminiVocalTime < referenceOnset - 0.5;
      if (outOfRange || beforeAnySound) {
        req.log.warn({ geminiVocalTime, vocalBandAcousticOnset, acousticOnset },
          "Discarding implausible Gemini vocal time (before vocal-band onset or out of range)");
        geminiVocalTime = null;
      }
    }

    // Decide which signal to use as `firstVocalTime`.
    // Precedence:
    //   1. python + gemini consensus  (both agree ± 1s)
    //   2. python alone               (Whisper is authoritative)
    //   3. vocalBandAcousticOnset     (vocal-freq filtered — beats unchecked Gemini)
    //   4. gemini alone               (only if no acoustic signal at all)
    //   5. unfiltered acoustic        (last resort)
    let firstVocalTime: number | null = null;
    // "consensus" = Whisper + Gemini agree; "consensus-acoustic" = vocal-band + Gemini agree.
    let source: "python" | "gemini" | "consensus" | "consensus-acoustic" | "acoustic-fallback" | null = null;
    let validationNote: string | null = null;

    if (pythonVocalOnset !== null && geminiVocalTime !== null) {
      if (Math.abs(pythonVocalOnset - geminiVocalTime) <= 1.0) {
        firstVocalTime = (pythonVocalOnset + geminiVocalTime) / 2;
        source = "consensus";
      } else {
        firstVocalTime = pythonVocalOnset;
        source = "python";
        validationNote = `Gemini estimate (${geminiVocalTime.toFixed(2)}s) disagreed with Whisper — using Whisper`;
      }
    } else if (pythonVocalOnset !== null) {
      firstVocalTime = pythonVocalOnset;
      source = "python";
    } else if (vocalBandAcousticOnset !== null) {
      // No Whisper result — use the vocal-band acoustic onset, optionally
      // blended with a validated Gemini estimate if they agree closely.
      if (geminiVocalTime !== null && Math.abs(vocalBandAcousticOnset - geminiVocalTime) <= 1.5) {
        firstVocalTime = (vocalBandAcousticOnset + geminiVocalTime) / 2;
        source = "consensus-acoustic";
        validationNote = "Vocal-band acoustic + Gemini consensus (Whisper unavailable)";
      } else {
        firstVocalTime = vocalBandAcousticOnset;
        source = "acoustic-fallback";
        validationNote = geminiVocalTime !== null
          ? `Gemini (${geminiVocalTime.toFixed(2)}s) disagreed with vocal-band acoustic (${vocalBandAcousticOnset.toFixed(2)}s) — using acoustic`
          : "Used vocal-band acoustic onset (Whisper/Gemini unavailable)";
      }
    } else if (geminiVocalTime !== null) {
      // Gemini without any acoustic reference — only reached when FFmpeg
      // silence-detection produced no result at all (e.g. very quiet audio or
      // FFmpeg unavailable). Unfiltered acoustic (below) is still preferred
      // over raw Gemini when it exists, because unfiltered at least anchors a
      // "first-sound" lower bound, whereas Gemini has no audio grounding at
      // this point.
      // NOTE: full intended precedence from task spec (Step 2) is:
      //   Python (Whisper) → vocal-band acoustic → gemini → unfiltered acoustic
      // This `else if` branch only fires when vocalBandAcousticOnset is null.
      firstVocalTime = geminiVocalTime;
      source = "gemini";
    } else if (acousticOnset !== null) {
      // Unfiltered acoustic onset: may be fooled by drums/bass intros, but
      // anchors a sound-start lower bound when all other methods failed.
      firstVocalTime = acousticOnset;
      source = "acoustic-fallback";
      validationNote = "Used unfiltered acoustic onset (all vocal detection failed)";
    }

    if (firstVocalTime === null) {
      sendEvent("result", {
        offset: null,
        acousticOnset,
        pythonVocalOnset,
        geminiVocalTime,
        source: null,
        message: "Could not detect vocals reliably in the audio",
      });
      if (!res.writableEnded) res.end();
      return;
    }

    let computedOffset: number;
    if (isPreviewClip) {
      let matchedLyricTime = firstLyricTime;
      if (firstWords && firstWords.trim().length > 0) {
        const normalizedDetected = firstWords.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        if (normalizedDetected.length > 0) {
          for (const seg of sortedLyrics) {
            const normalizedSeg = seg.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
            if (normalizedSeg.length > 0 && (normalizedSeg.includes(normalizedDetected) || normalizedDetected.includes(normalizedSeg))) {
              matchedLyricTime = seg.startTime;
              break;
            }
          }
          if (matchedLyricTime === firstLyricTime) {
            const words = normalizedDetected.split(/\s+/).filter(Boolean);
            if (words.length >= 2) {
              const firstTwoWords = words.slice(0, 2).join(" ");
              for (const seg of sortedLyrics) {
                const normalizedSeg = seg.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
                if (normalizedSeg.length > 0 && normalizedSeg.startsWith(firstTwoWords)) {
                  matchedLyricTime = seg.startTime;
                  break;
                }
              }
            }
          }
        }
      }
      computedOffset = matchedLyricTime - firstVocalTime;
    } else {
      computedOffset = firstLyricTime - firstVocalTime;
    }

    computedOffset = Math.round(computedOffset * 10) / 10;

    // When lyrics were plain-distributed and alignment didn't produce per-line
    // segments, tell the frontend to redistribute from the vocal onset instead
    // of applying the (large negative) flat offset. This corrects the case
    // where beat-only intros push the first lyric line to appear at t=0.
    const redistribute = lyricsAreDistributed && !alignedSegments && firstVocalTime !== null && firstVocalTime > 0.5;

    sendEvent("result", {
      offset: computedOffset,
      firstVocalTime,
      firstLyricTime,
      firstWords,
      acousticOnset,
      vocalBandAcousticOnset,
      pythonVocalOnset,
      pythonMethod,
      pythonFirstWord,
      pythonMatchedWord,
      pythonTranscript,
      geminiVocalTime,
      source,
      validationNote,
      redistribute,
      lyricsWereDistributed: lyricsAreDistributed,
      alignedSegments: alignedSegments ?? undefined,
      matchedLineCount: alignedSegments ? matchedLineCount : undefined,
      totalLineCount: alignedSegments ? totalLineCount : undefined,
    });
    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    if (inputPath) scheduleCleanup(inputPath, 0);
    if (audioPath) scheduleCleanup(audioPath, 0);
    if (alignAudioPath) scheduleCleanup(alignAudioPath, 0);
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Auto-sync failed");
    sendEvent("error", { message });
    if (!res.writableEnded) res.end();
  }
});

export default router;
