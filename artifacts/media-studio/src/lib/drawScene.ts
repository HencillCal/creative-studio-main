// Shared drawing module — imported by both the live canvas (SongVisualizer.tsx)
// and the export worker (exportWorker.ts). All functions are pure: they accept
// explicit parameters rather than closing over React refs or component state.
// Adding or fixing a vis style here automatically fixes both the preview and
// the exported video.

// ─── Shared types ───────────────────────────────────────────────────────────

export interface LyricSegment {
  text: string;
  startTime: number;
  endTime: number;
  matched?: boolean;
  // Optional per-word timings (Whisper word_timestamps). When present,
  // highlight effects (karaoke/scale/bounce/shutter/typewriter/etc.) lock
  // to actual vocal pace within the line instead of interpolating linearly
  // between startTime and endTime. Omitted for unmatched / interpolated
  // lines so the renderer falls back to line-level timing.
  words?: { text: string; start: number; end: number }[];
}

export type VisStyle =
  | "bars" | "circular" | "waveform" | "pulse" | "waterfall"
  | "helix" | "particles" | "galaxy" | "turntable" | "dancer" | "djbooth"
  | "gif";

export type VisPosition = "top" | "center" | "bottom";
export type LyricsPosition = "top" | "center" | "bottom";
export type LyricsFontFamily =
  | "Arial" | "Georgia" | "Impact" | "Comic Sans MS"
  | "Courier New" | "Brush Script MT, cursive";

// Active-line highlight effect. "karaoke" preserves the original color-swipe
// fill so existing projects render exactly the same.
export type LyricsHighlightStyle =
  | "karaoke"
  | "scale"
  | "weightBump"
  | "slideIn"
  | "bounce"
  | "shutterWipe"
  | "neonFlash"
  | "gradientSweep"
  | "typewriter";

export const LYRICS_HIGHLIGHT_STYLES: { id: LyricsHighlightStyle; label: string; desc: string }[] = [
  { id: "karaoke", label: "Karaoke Fill", desc: "Color sweeps left → right" },
  { id: "scale", label: "Scale Up", desc: "Active line grows bigger" },
  { id: "weightBump", label: "Weight Bump", desc: "Active line goes bold" },
  { id: "slideIn", label: "Slide In", desc: "Active line slides from the side" },
  { id: "bounce", label: "Bounce", desc: "Active line bounces up & down" },
  { id: "shutterWipe", label: "Shutter Wipe", desc: "Color wipes top → bottom" },
  { id: "neonFlash", label: "Neon Flash", desc: "Pulsing neon glow" },
  { id: "gradientSweep", label: "Gradient Sweep", desc: "Multi-color gradient sweeps" },
  { id: "typewriter", label: "Typewriter", desc: "Letters appear one by one" },
];

export type SceneState = {
  waterfall: number[][];
  particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[];
  galaxyAngle: { current: number };
  turntableAngle: { current: number };
  turntableAngleR: { current: number };
  dancerBeat: { current: { lastBass: number; beatPhase: number; lastBeatT: number } };
  djFader: { current: number };
};

export interface DrawVisConfig {
  visStyle: VisStyle;
  color: string;
  intensity: number;
  visSize: number;
  position: VisPosition;
  visOffsetX: number;
  visOffsetY: number | null;
  visScaleW: number;
  visScaleH: number;
}

export interface DrawLyricsConfig {
  segments: LyricSegment[];
  fontSize: number;
  color: string;
  highlightColor: string;
  position: LyricsPosition;
  fontFamily: LyricsFontFamily;
  bold: boolean;
  italic: boolean;
  outline: boolean;
  glow: boolean;
  autoEmoji: boolean;
  offset: number;
  // Pace multiplier for the highlight progress on the active line.
  // 1.0 = match segment duration exactly. 0.5 = finish in half the time
  // (snappier). 2.0 = take twice as long (more relaxed). Clamped to [0,1]
  // so the sweep still ends at the segment boundary.
  pace?: number;
  highlightStyle?: LyricsHighlightStyle;
  // Extended text styles. All optional so older callers and saved projects
  // continue to render exactly as before.
  dropShadow?: boolean;
  hardShadow?: boolean;
  neon?: boolean;
  threeD?: boolean;
  gradient?: boolean;
  stroke?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  uppercase?: boolean;
  smallCaps?: boolean;
  bgPill?: boolean;
  sticker?: boolean;
  comicPop?: boolean;
  subtitleBar?: boolean;
  // Custom background color for bgPill and subtitleBar. Defaults to black.
  bgColor?: string;
  // Opacity for bgPill/subtitleBar background, 0–1. Defaults to 0.6.
  bgOpacity?: number;
  letterSpacing?: number;
  // When true and per-word timings exist, the currently-sung word inside the
  // active line gets a brief scale + color "pop" overlay. No-op when only
  // line-level timings are available.
  popActiveWord?: boolean;
  popIntensity?: number;
  // Optional accent color for the popped word. When empty/undefined the pop
  // overlay falls back to the line's highlightColor — preserving legacy
  // behavior. Set to a distinct color to make the active-word pop visually
  // separate from the karaoke wipe.
  popAccentColor?: string;
  // Canvas-space offset and uniform scale applied to the lyrics block.
  // Allows the user to drag and resize lyrics interactively. Defaults
  // (0/0/1) preserve the original behaviour.
  offsetX?: number;
  offsetY?: number;
  scale?: number;
}

// ─── Canvas context union ────────────────────────────────────────────────────

export type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ─── Constants ───────────────────────────────────────────────────────────────

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export const EMOJI_MAP: [RegExp, string][] = [
  [/\blove\b/i, "❤️"],
  [/\bheart\b/i, "💕"],
  [/\bfire\b/i, "🔥"],
  [/\bstar\b/i, "⭐"],
  [/\bsun\b/i, "☀️"],
  [/\bcry\b/i, "😢"],
  [/\btear/i, "😢"],
  [/\bdance\b/i, "💃"],
  [/\bdancing\b/i, "💃"],
  [/\bmoney\b/i, "💰"],
  [/\bnight\b/i, "🌙"],
  [/\brain\b/i, "🌧️"],
  [/\bsmile\b/i, "😊"],
  [/\bhappy\b/i, "😊"],
  [/\bsad\b/i, "😢"],
  [/\bkiss\b/i, "💋"],
  [/\bbaby\b/i, "👶"],
  [/\bworld\b/i, "🌍"],
  [/\bmusic\b/i, "🎵"],
  [/\bsing\b/i, "🎤"],
  [/\bdream\b/i, "💭"],
  [/\bfly\b/i, "✈️"],
  [/\bking\b/i, "👑"],
  [/\bqueen\b/i, "👑"],
  [/\brose\b/i, "🌹"],
  [/\bflower\b/i, "🌸"],
  [/\bparty\b/i, "🎉"],
  [/\bdiamon/i, "💎"],
  [/\bangel\b/i, "😇"],
  [/\bdevil\b/i, "😈"],
  [/\bcrazy\b/i, "🤪"],
  [/\bforever\b/i, "♾️"],
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function bandEnergies(freqData: Uint8Array): { bass: number; mid: number; high: number; avg: number } {
  const n = freqData.length;
  const third = Math.max(1, Math.floor(n / 3));
  let bass = 0, mid = 0, high = 0, sum = 0;
  for (let i = 0; i < third; i++) bass += freqData[i];
  for (let i = third; i < third * 2; i++) mid += freqData[i];
  for (let i = third * 2; i < n; i++) high += freqData[i];
  for (let i = 0; i < n; i++) sum += freqData[i];
  return {
    bass: (bass / third) / 255,
    mid: (mid / third) / 255,
    high: (high / Math.max(1, n - third * 2)) / 255,
    avg: (sum / n) / 255,
  };
}

export function addEmojis(text: string): string {
  const emojis: string[] = [];
  for (const [pattern, emoji] of EMOJI_MAP) {
    if (pattern.test(text) && !emojis.includes(emoji)) emojis.push(emoji);
  }
  return emojis.length > 0 ? `${text} ${emojis.join("")}` : text;
}

export function createSceneState(): SceneState {
  return {
    waterfall: [],
    particles: [],
    galaxyAngle: { current: 0 },
    turntableAngle: { current: 0 },
    turntableAngleR: { current: 0 },
    dancerBeat: { current: { lastBass: 0, beatPhase: 0, lastBeatT: 0 } },
    djFader: { current: 0 },
  };
}

// ─── Background image drawing ─────────────────────────────────────────────────
// Accepts both HTMLImageElement (main thread) and ImageBitmap (export worker).

export interface BgTransform {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  /** "cover" (default) crops to fill the destination; "contain" letterboxes. */
  fitMode?: "cover" | "contain";
}

export function drawCoverImage(
  ctx: DrawCtx,
  img: ImageBitmap | HTMLImageElement | HTMLVideoElement | VideoFrame,
  dx: number, dy: number, dw: number, dh: number,
  transform?: BgTransform,
) {
  const isHtmlImg = typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement;
  const isHtmlVid = typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement;
  // VideoFrame (WebCodecs) is the natural input for the streaming MP4
  // export path; it exposes displayWidth/displayHeight rather than the
  // width/height naturalWidth/etc fields used by HTMLImageElement.
  const isVideoFrame = typeof VideoFrame !== "undefined" && img instanceof VideoFrame;
  const iw = isHtmlImg ? ((img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width)
    : isHtmlVid ? ((img as HTMLVideoElement).videoWidth || (img as HTMLVideoElement).width)
    : isVideoFrame ? (img as VideoFrame).displayWidth
    : (img as ImageBitmap).width;
  const ih = isHtmlImg ? ((img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height)
    : isHtmlVid ? ((img as HTMLVideoElement).videoHeight || (img as HTMLVideoElement).height)
    : isVideoFrame ? (img as VideoFrame).displayHeight
    : (img as ImageBitmap).height;
  if (!iw || !ih) return;
  const ox = transform?.offsetX ?? 0;
  const oy = transform?.offsetY ?? 0;
  const sc = transform?.scale ?? 1;
  const transformActive = ox !== 0 || oy !== 0 || sc !== 1;

  if (transform?.fitMode === "contain") {
    // Contain-fit: scale image to fit entirely within the destination rect,
    // preserving aspect ratio. Letterbox/pillarbox bars are left as-is
    // (caller is responsible for clearing the canvas to the desired bg color).
    const fitScale = Math.min(dw / iw, dh / ih);
    const fW = iw * fitScale;
    const fH = ih * fitScale;
    const fx = dx + (dw - fW) / 2;
    const fy = dy + (dh - fH) / 2;
    if (transformActive) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      const cx = dx + dw / 2;
      const cy = dy + dh / 2;
      ctx.translate(cx + ox, cy + oy);
      ctx.scale(sc, sc);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img as CanvasImageSource, 0, 0, iw, ih, fx, fy, fW, fH);
    if (transformActive) ctx.restore();
    return;
  }

  // Default: cover-fit (crops source to fill destination).
  const srcAspect = iw / ih;
  const dstAspect = dw / dh;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (srcAspect > dstAspect) {
    sw = ih * dstAspect;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / dstAspect;
    sy = (ih - sh) / 2;
  }

  // User-controllable pan + zoom around the destination rect's center, with
  // the destination rect clipped so panning never bleeds outside the canvas.
  // The cover-fit math above is preserved exactly when offset=0 / scale=1.
  if (transformActive) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    const cx = dx + dw / 2;
    const cy = dy + dh / 2;
    ctx.translate(cx + ox, cy + oy);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, dx, dy, dw, dh);
  if (transformActive) ctx.restore();
}

// ─── Scene-specific helpers ───────────────────────────────────────────────────

interface TurntableOpts {
  cx: number; cy: number; radius: number;
  r: number; g: number; b: number;
  intensityMul: number;
  withTonearm: boolean;
  rotationRef: { current: number };
  drivenBy?: "bass" | "mid";
}

export function drawTurntableScene(ctx: DrawCtx, freqData: Uint8Array, time: number, opts: TurntableOpts) {
  const { cx, cy, radius, r, g, b, intensityMul, withTonearm, rotationRef } = opts;
  const e = bandEnergies(freqData);
  const driver = opts.drivenBy === "mid" ? e.mid : e.bass;
  rotationRef.current += (0.01 + driver * 0.08 * intensityMul);
  const angle = rotationRef.current;

  ctx.save();
  const aura = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius * 1.4);
  aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.25 + driver * 0.35 * intensityMul})`);
  aura.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.4, 0, Math.PI * 2);
  ctx.fill();

  const discGrad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
  discGrad.addColorStop(0, "#1a1a1a");
  discGrad.addColorStop(0.85, "#0a0a0a");
  discGrad.addColorStop(1, "#000");
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 14; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.3 + i * 0.05), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const sweep = ctx.createLinearGradient(-radius, 0, radius, 0);
  sweep.addColorStop(0, "rgba(255,255,255,0)");
  sweep.addColorStop(0.5, `rgba(255,255,255,${0.06 + driver * 0.18})`);
  sweep.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const labelR = radius * 0.32;
  const labelGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, labelR);
  labelGrad.addColorStop(0, `rgba(${Math.min(255, r + 80)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)}, 1)`);
  labelGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
  ctx.fillStyle = labelGrad;
  ctx.beginPath();
  ctx.arc(0, 0, labelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * labelR * 0.4, Math.sin(a) * labelR * 0.4);
    ctx.lineTo(Math.cos(a) * labelR * 0.85, Math.sin(a) * labelR * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = "#d8d8d8";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (withTonearm) {
    const armPivotX = cx + radius * 1.05;
    const armPivotY = cy - radius * 0.95;
    const armBob = Math.sin(time * 6) * 0.06 * (0.4 + e.mid);
    const armAngle = Math.PI * 0.78 + armBob;
    const armLen = radius * 1.35;
    const armEndX = armPivotX + Math.cos(armAngle) * armLen;
    const armEndY = armPivotY + Math.sin(armAngle) * armLen;
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.arc(armPivotX, armPivotY, radius * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(armPivotX, armPivotY, radius * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#bbb";
    ctx.lineWidth = Math.max(2, radius * 0.025);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(armPivotX, armPivotY);
    ctx.lineTo(armEndX, armEndY);
    ctx.stroke();
    ctx.fillStyle = "#444";
    ctx.fillRect(armEndX - radius * 0.05, armEndY - radius * 0.03, radius * 0.1, radius * 0.06);
  }
  ctx.restore();
}

interface DancerOpts {
  cx: number; cy: number; size: number;
  r: number; g: number; b: number;
  intensityMul: number;
  beatRef: { current: { lastBass: number; beatPhase: number; lastBeatT: number } };
}

export function drawDancerScene(ctx: DrawCtx, freqData: Uint8Array, time: number, opts: DancerOpts) {
  const { cx, cy, size, r, g, b, intensityMul, beatRef } = opts;
  const e = bandEnergies(freqData);
  const state = beatRef.current;
  if (e.bass > 0.55 && state.lastBass < 0.45 && time - state.lastBeatT > 0.18) {
    state.beatPhase = state.beatPhase === 0 ? 1 : 0;
    state.lastBeatT = time;
  }
  state.lastBass = e.bass;

  const yOffset = -e.bass * size * 0.08 * intensityMul;
  const headR = size * 0.08;
  const torsoTop = cy + yOffset - size * 0.20;
  const torsoBottom = cy + yOffset + size * 0.10;
  const headCx = cx;
  const headCy = torsoTop - headR * 1.4;
  const hipY = torsoBottom;
  const shoulderY = torsoTop;

  const auraR = size * 0.55;
  const aura = ctx.createRadialGradient(cx, cy + yOffset, 0, cx, cy + yOffset, auraR);
  aura.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.25 + e.avg * 0.35 * intensityMul})`);
  aura.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy + yOffset, auraR, 0, Math.PI * 2);
  ctx.fill();

  const fill = `rgba(${r}, ${g}, ${b}, 0.95)`;
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.035);

  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, (torsoTop + torsoBottom) / 2, size * 0.07, (torsoBottom - torsoTop) / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const armBase = 0.4 + e.mid * 1.0 * intensityMul;
  const armSwing = Math.sin(time * 4) * armBase;
  const armLen = size * 0.22;
  const lShoX = cx - size * 0.07;
  const lEx = lShoX + Math.cos(Math.PI * 0.85 + armSwing) * armLen;
  const lEy = shoulderY + Math.sin(Math.PI * 0.85 + armSwing) * armLen;
  ctx.beginPath();
  ctx.moveTo(lShoX, shoulderY);
  ctx.lineTo(lEx, lEy);
  ctx.stroke();
  const rShoX = cx + size * 0.07;
  const rEx = rShoX + Math.cos(Math.PI * 0.15 - armSwing) * armLen;
  const rEy = shoulderY + Math.sin(Math.PI * 0.15 - armSwing) * armLen;
  ctx.beginPath();
  ctx.moveTo(rShoX, shoulderY);
  ctx.lineTo(rEx, rEy);
  ctx.stroke();

  const phase = state.beatPhase === 0 ? 1 : -1;
  const legSpread = size * 0.07;
  const legLen = size * 0.27;
  const lHipX = cx - size * 0.04;
  const rHipX = cx + size * 0.04;
  const lFootX = lHipX - legSpread + phase * size * 0.04;
  const lFootY = hipY + legLen;
  const rFootX = rHipX + legSpread - phase * size * 0.04;
  const rFootY = hipY + legLen;
  ctx.beginPath();
  ctx.moveTo(lHipX, hipY);
  ctx.lineTo(lFootX, lFootY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rHipX, hipY);
  ctx.lineTo(rFootX, rFootY);
  ctx.stroke();
}

interface DjBoothOpts {
  cx: number; cy: number; width: number; height: number;
  r: number; g: number; b: number;
  intensityMul: number;
  leftRef: { current: number };
  rightRef: { current: number };
  faderRef: { current: number };
}

export function drawDjBoothScene(ctx: DrawCtx, freqData: Uint8Array, time: number, opts: DjBoothOpts) {
  const { cx, cy, width, height, r, g, b, intensityMul, leftRef, rightRef, faderRef } = opts;
  const e = bandEnergies(freqData);

  const lightCount = 8;
  const lightW = width / lightCount;
  const lightY = cy - height / 2;
  for (let i = 0; i < lightCount; i++) {
    const idx = Math.floor((i / lightCount) * (freqData.length * 0.7) + freqData.length * 0.2);
    const v = (freqData[idx] || 0) / 255;
    const lx = cx - width / 2 + (i + 0.5) * lightW;
    const ly = lightY + height * 0.05;
    const beamR = lightW * 0.55 * (0.4 + v * 1.2);
    const hue = (i / lightCount) * 360;
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, beamR);
    grad.addColorStop(0, `hsla(${hue}, 90%, 60%, ${0.5 * v + 0.1})`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, beamR, 0, Math.PI * 2);
    ctx.fill();
  }

  const deckRadius = Math.min(width, height) * 0.18;
  const deckY = cy + height * 0.05;
  const leftCx = cx - width * 0.30;
  const rightCx = cx + width * 0.30;
  drawTurntableScene(ctx, freqData, time, {
    cx: leftCx, cy: deckY, radius: deckRadius,
    r, g, b, intensityMul, withTonearm: false,
    rotationRef: leftRef, drivenBy: "bass",
  });
  drawTurntableScene(ctx, freqData, time, {
    cx: rightCx, cy: deckY, radius: deckRadius,
    r, g, b, intensityMul, withTonearm: false,
    rotationRef: rightRef, drivenBy: "mid",
  });

  const mixW = width * 0.22;
  const mixH = height * 0.45;
  const mixX = cx - mixW / 2;
  const mixY = cy - mixH * 0.3;
  ctx.fillStyle = "rgba(20, 20, 28, 0.85)";
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const rad = 8;
  ctx.moveTo(mixX + rad, mixY);
  ctx.lineTo(mixX + mixW - rad, mixY);
  ctx.quadraticCurveTo(mixX + mixW, mixY, mixX + mixW, mixY + rad);
  ctx.lineTo(mixX + mixW, mixY + mixH - rad);
  ctx.quadraticCurveTo(mixX + mixW, mixY + mixH, mixX + mixW - rad, mixY + mixH);
  ctx.lineTo(mixX + rad, mixY + mixH);
  ctx.quadraticCurveTo(mixX, mixY + mixH, mixX, mixY + mixH - rad);
  ctx.lineTo(mixX, mixY + rad);
  ctx.quadraticCurveTo(mixX, mixY, mixX + rad, mixY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const barCount = 5;
  const barAreaW = mixW * 0.78;
  const barAreaH = mixH * 0.55;
  const barAreaX = mixX + (mixW - barAreaW) / 2;
  const barAreaY = mixY + mixH * 0.10;
  const bw = barAreaW / barCount;
  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor((i / barCount) * (freqData.length * 0.6));
    const v = (freqData[idx] || 0) / 255;
    const bx = barAreaX + i * bw + bw * 0.15;
    const actualW = bw * 0.70;
    const actualH = v * barAreaH * intensityMul;
    const by = barAreaY + barAreaH - actualH;
    const grad = ctx.createLinearGradient(bx, by, bx, barAreaY + barAreaH);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${b}, 0.95)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.4)`);
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, actualW, actualH);
  }

  const fadeY = mixY + mixH * 0.80;
  const fadeW = mixW * 0.78;
  const fadeX = mixX + (mixW - fadeW) / 2;
  ctx.fillStyle = "rgba(80,80,80,0.7)";
  ctx.fillRect(fadeX, fadeY - 2, fadeW, 4);
  faderRef.current = faderRef.current * 0.85 + Math.sin(time * 1.2) * (0.3 + e.avg * 0.7) * 0.5 * 0.15;
  const knobX = fadeX + fadeW / 2 + faderRef.current * fadeW;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
  ctx.fillRect(knobX - 8, fadeY - 10, 16, 20);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(knobX - 8, fadeY - 10, 16, 20);
}

// ─── Lyrics rendering ────────────────────────────────────────────────────────

// Build the CSS font string for a given weight/italic combination at fs px.
function buildFont(fs: number, family: string, bold: boolean, italic: boolean): string {
  const fontFamilyStr = family.includes(",") ? family : `"${family}"`;
  const weight = bold ? "bold" : "normal";
  const style = italic ? "italic" : "normal";
  return `${style} ${weight} ${fs}px ${fontFamilyStr}, sans-serif`;
}

// Measure text taking letter-spacing into account.
/**
 * Synthesize per-word timings for a lyric line that doesn't have them
 * (e.g. lines coming from a plain LRC file, manual paste, or tap-sync).
 *
 * Most LRC providers only stamp the START of each line. We then set
 * `endTime = nextLine.startTime`, which makes the karaoke wipe interpolate
 * linearly across the whole line — but real singing is rarely linear:
 *   • Pop / soul: the last word of a phrase is held (e.g. "no tiiiime").
 *   • Rap: words flow at a steady pace until the bar ends.
 *
 * Linear interpolation makes the wipe race past the singer when LRC's
 * line window is short relative to a held final syllable, and it lags
 * when the line window is long relative to a quick delivery. By splitting
 * the line into character-weighted words and reserving a fixed fraction
 * of the window for the last word, the wipe paces through the bulk of
 * the line at the singer's natural rate then HOLDS on the final word —
 * matching the dominant cadence of pop, R&B, rap, and singer-songwriter
 * phrasing without needing per-word ground truth.
 */
function synthesizeWordTimings(
  text: string,
  startTime: number,
  endTime: number,
): { text: string; start: number; end: number }[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];
  const lineDur = Math.max(0.001, endTime - startTime);
  if (words.length === 1) {
    return [{ text: words[0], start: startTime, end: endTime }];
  }
  // Reserve ~30% of the line window for the last word. Empirically this
  // matches the held final syllable in pop/R&B; for rap the last word is
  // shorter and the highlight just lingers on it briefly, which still
  // looks correct (no racing past the singer).
  const HOLD_FRACTION = 0.30;
  const lastDur = lineDur * HOLD_FRACTION;
  const restDur = lineDur - lastDur;
  const restWords = words.slice(0, -1);
  let totalRestChars = 0;
  for (const w of restWords) totalRestChars += Math.max(1, w.length);
  const out: { text: string; start: number; end: number }[] = [];
  let t = startTime;
  for (const w of restWords) {
    const dur = restDur * Math.max(1, w.length) / totalRestChars;
    out.push({ text: w, start: t, end: t + dur });
    t += dur;
  }
  out.push({ text: words[words.length - 1], start: t, end: endTime });
  return out;
}

// Per-segment cache for synthesized word timings, keyed on the segment
// object so we don't re-split the same line on every animation frame.
// WeakMap lets old segments (replaced by a new sync) get GC'd naturally.
const synthesizedWordsCache = new WeakMap<LyricSegment, { text: string; start: number; end: number }[]>();
function getOrSynthesizeWords(seg: LyricSegment): { text: string; start: number; end: number }[] {
  if (seg.words && seg.words.length > 0) return seg.words;
  const cached = synthesizedWordsCache.get(seg);
  if (cached) return cached;
  const synth = synthesizeWordTimings(seg.text, seg.startTime, seg.endTime);
  synthesizedWordsCache.set(seg, synth);
  return synth;
}

/**
 * Compute highlight progress (0..1) within an active lyric line using per-word
 * timings instead of linear interpolation. Weighted by each word's character
 * count so the karaoke wipe and other progress-driven effects line up with
 * where the singer actually is in the text.
 *
 * Returns -1 when no usable word data is available — caller should fall back
 * to line-level (linear) timing.
 */
function wordBasedProgress(
  words: { text: string; start: number; end: number }[],
  t: number,
): number {
  if (!words || words.length === 0) return -1;
  let totalChars = 0;
  for (const w of words) {
    totalChars += Math.max(1, (w.text || "").replace(/\s+/g, "").length);
  }
  if (totalChars <= 0) return -1;
  // Bridge short held-note gaps client-side too. Whisper sometimes ends a
  // sustained vowel at the syllable boundary, leaving a gap before the next
  // word. Without this, the wipe would race to the end of the held word and
  // then sit waiting. The server-side aligner already smooths newly imported
  // songs; this keeps older saved projects (whose stored words weren't
  // bridged) looking smooth without re-importing. 2.0 s matches the server.
  const HELD_NOTE_BRIDGE_S = 2.0;
  let consumed = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 0;
    const effectiveEnd = next && gap > 0 && gap <= HELD_NOTE_BRIDGE_S
      ? next.start
      : w.end;
    const wChars = Math.max(1, (w.text || "").replace(/\s+/g, "").length);
    if (t >= effectiveEnd) {
      consumed += wChars;
    } else if (t > w.start) {
      const wDur = Math.max(0.0001, effectiveEnd - w.start);
      consumed += wChars * (t - w.start) / wDur;
      break;
    } else {
      break;
    }
  }
  return Math.max(0, Math.min(1, consumed / totalChars));
}

/**
 * Returns the per-word x-offset ranges (relative to the line's left edge) of
 * each whitespace-separated run in `text`, computed using the same character
 * walk that `drawSpacedText` uses. Caller must have already set ctx.font to
 * the base font.
 */
export function computeWordRanges(
  ctx: DrawCtx,
  text: string,
  letterSpacing: number,
): { left: number; right: number }[] {
  const ranges: { left: number; right: number }[] = [];
  const chars = Array.from(text);
  let x = 0;
  let wordStart = -1;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isSpace = /\s/.test(ch);
    if (!isSpace && wordStart < 0) wordStart = x;
    const w = ctx.measureText(ch).width;
    x += w;
    // Letter spacing is applied between characters (not after the last char),
    // matching drawSpacedText's total computation.
    if (i < chars.length - 1) x += letterSpacing;
    if (isSpace && wordStart >= 0) {
      // Word ended just before this space — capture its right edge.
      ranges.push({ left: wordStart, right: x - w - (i < chars.length - 1 ? letterSpacing : 0) });
      wordStart = -1;
    }
  }
  if (wordStart >= 0) ranges.push({ left: wordStart, right: x });
  return ranges;
}

/**
 * Picks the currently-sung word in `words` for time `t`. Returns `null` when
 * `t` is outside any word (between words or before/after the line).
 */
export function findActiveWord(
  words: { text: string; start: number; end: number }[],
  t: number,
): { idx: number; sub: number } | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (t >= w.start && t < w.end) {
      const dur = Math.max(0.0001, w.end - w.start);
      return { idx: i, sub: Math.max(0, Math.min(1, (t - w.start) / dur)) };
    }
  }
  return null;
}

function measureWidthSpaced(ctx: DrawCtx, text: string, letterSpacing: number): number {
  if (!letterSpacing) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + letterSpacing;
  return Math.max(0, w - letterSpacing);
}

// Draw text centered at (cx, baselineY) with optional letter spacing and
// optional small-caps emulation (lowercase rendered at smaller-but-uppercase).
// Uses the currently-set ctx.font / fillStyle. Returns the rendered width.
function drawSpacedText(
  ctx: DrawCtx,
  text: string,
  cx: number,
  baselineY: number,
  fs: number,
  family: string,
  bold: boolean,
  italic: boolean,
  letterSpacing: number,
  smallCaps: boolean,
  fillStyle: string | CanvasGradient,
  strokeFn: ((x: number, y: number, ch: string, font: string) => void) | null,
): number {
  const baseFont = buildFont(fs, family, bold, italic);
  const smallFont = buildFont(fs * 0.78, family, bold, italic);
  ctx.font = baseFont;

  // Pre-compute per-character widths.
  const chars = Array.from(text);
  const widths: number[] = [];
  let total = 0;
  for (const raw of chars) {
    const isLower = smallCaps && raw.toLowerCase() === raw && raw.toUpperCase() !== raw;
    ctx.font = isLower ? smallFont : baseFont;
    const ch = isLower ? raw.toUpperCase() : raw;
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w;
  }
  if (chars.length > 1) total += letterSpacing * (chars.length - 1);
  if (total < 0) total = 0;

  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let i = 0; i < chars.length; i++) {
    const raw = chars[i];
    const isLower = smallCaps && raw.toLowerCase() === raw && raw.toUpperCase() !== raw;
    const ch = isLower ? raw.toUpperCase() : raw;
    const font = isLower ? smallFont : baseFont;
    ctx.font = font;
    if (strokeFn) strokeFn(x, baselineY, ch, font);
    ctx.fillStyle = fillStyle;
    ctx.fillText(ch, x, baselineY);
    x += widths[i] + letterSpacing;
  }
  ctx.textAlign = "center";
  return total;
}

export function drawLyrics(
  ctx: DrawCtx,
  time: number,
  cW: number,
  cH: number,
  cfg: DrawLyricsConfig,
): { x: number; y: number; w: number; h: number } | null {
  const segs = cfg.segments;
  if (segs.length === 0) return null;

  const scale = cW / 1280;
  const fs = cfg.fontSize * scale;
  const letterSpacing = (cfg.letterSpacing ?? 0) * scale;

  // User-controllable transform (drag + resize on the canvas).
  const userOffsetX = cfg.offsetX ?? 0;
  const userOffsetY = cfg.offsetY ?? 0;
  const userScale = cfg.scale ?? 1;
  const transformActive = userOffsetX !== 0 || userOffsetY !== 0 || userScale !== 1;
  if (transformActive) {
    ctx.save();
    // Pivot the scale around the canvas center so the lyrics scale in
    // place rather than drifting toward (0,0). Drag offset is applied
    // afterward and is independent of the scale.
    ctx.translate(userOffsetX, userOffsetY);
    ctx.translate(cW / 2, cH / 2);
    ctx.scale(userScale, userScale);
    ctx.translate(-cW / 2, -cH / 2);
  }
  const pace = Math.max(0.1, Math.min(5, cfg.pace ?? 1));
  const highlightStyle: LyricsHighlightStyle = cfg.highlightStyle ?? "karaoke";
  const family = cfg.fontFamily;
  const bold = cfg.bold;
  const italic = cfg.italic;

  // Default font for measureText calls outside drawSpacedText.
  ctx.font = buildFont(fs, family, bold, italic);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const adjustedTime = time + cfg.offset;
  const activeIdx = segs.findIndex(s => adjustedTime >= s.startTime && adjustedTime < s.endTime);

  // How long (seconds) to hold the last visible segment after it ends before
  // clearing the canvas. Gaps shorter than this will show a fade-out instead
  // of a jarring snap-to-blank (or snap-to-next-segment).
  const GAP_HOLD_THRESHOLD = 2.0;

  const windowSize = 3;
  let startIdx: number;
  // Fraction [0, 1] that dims the visible block during a fade-out gap.
  // 1 = full-brightness inactive opacity; 0 = invisible.
  let gapFadeFraction = 1.0;

  const earlyExit = (): null => { if (transformActive) ctx.restore(); return null; };

  if (activeIdx >= 0) {
    startIdx = activeIdx;
  } else if (segs.length === 0) {
    return earlyExit();
  } else {
    const nextIdx = segs.findIndex(s => s.startTime > adjustedTime);

    if (nextIdx === -1) {
      // We are past the end of the last segment.
      const lastSeg = segs[segs.length - 1];
      const timeSinceEnd = adjustedTime - lastSeg.endTime;
      if (timeSinceEnd < GAP_HOLD_THRESHOLD) {
        startIdx = Math.max(0, segs.length - windowSize);
        gapFadeFraction = Math.max(0, 1 - timeSinceEnd / GAP_HOLD_THRESHOLD);
      } else {
        // Long gap after the final segment — clear cleanly.
        return earlyExit();
      }
    } else if (nextIdx === 0) {
      // Before the very first segment — show it as an upcoming preview.
      startIdx = 0;
    } else {
      // We are in a gap between segments[nextIdx-1] and segments[nextIdx].
      const prevSeg = segs[nextIdx - 1];
      const nextSeg = segs[nextIdx];
      const gapDuration = nextSeg.startTime - prevSeg.endTime;
      const timeSinceEnd = adjustedTime - prevSeg.endTime;

      if (gapDuration < GAP_HOLD_THRESHOLD) {
        // Short gap — hold the previous segment, fading linearly to 0.
        startIdx = Math.max(0, nextIdx - 1);
        gapFadeFraction = gapDuration > 0
          ? Math.max(0, 1 - timeSinceEnd / gapDuration)
          : 0;
      } else {
        // Long instrumental gap — clear the canvas cleanly.
        return earlyExit();
      }
    }
  }
  const visibleSegments = segs.slice(startIdx, startIdx + windowSize);

  const lineHeight = fs * 1.6;
  const blockHeight = visibleSegments.length * lineHeight;
  let baseY: number;
  if (cfg.position === "top") {
    baseY = cH * 0.1 + lineHeight;
  } else if (cfg.position === "center") {
    baseY = (cH - blockHeight) / 2 + lineHeight;
  } else {
    baseY = cH - cH * 0.1 - blockHeight + lineHeight;
  }

  const txtColor = cfg.color;
  const hlColor = cfg.highlightColor;

  visibleSegments.forEach((seg, i) => {
    const y = baseY + i * lineHeight;
    const isActive = adjustedTime >= seg.startTime && adjustedTime < seg.endTime;
    const segLen = seg.endTime - seg.startTime;
    // Prefer per-word timings when present so the highlight follows the
    // singer's actual pace within the line. When real word data isn't
    // available (LRC files, manual paste, tap sync) we synthesize per-word
    // timings on the fly with a held-final-word cadence so the karaoke
    // wipe doesn't race past the singer in linear-interpolation mode.
    // See synthesizeWordTimings for the rationale.
    const wordsForProgress = isActive ? getOrSynthesizeWords(seg) : null;
    const wordProg = wordsForProgress && wordsForProgress.length > 0
      ? wordBasedProgress(wordsForProgress, adjustedTime)
      : -1;
    const rawProgress = wordProg >= 0
      ? wordProg
      : (isActive && segLen > 0 ? (adjustedTime - seg.startTime) / segLen : 0);
    // Apply pace: pace<1 → snappier (highlight finishes early then holds);
    // pace>1 → more relaxed (highlight lingers).
    const progress = Math.max(0, Math.min(1, rawProgress / pace));
    // During a gap fade-out, dim all lines by gapFadeFraction so the hold
    // dissolves smoothly rather than snapping off.
    const lineOpacity = (isActive ? 1 : 0.5) * gapFadeFraction;

    let displayText = cfg.autoEmoji ? addEmojis(seg.text) : seg.text;
    if (cfg.uppercase) displayText = displayText.toUpperCase();

    // Per-line render is wrapped in save/restore so transforms (slideIn,
    // bounce, scale) stay scoped to this segment.
    ctx.save();

    // Effect-driven transforms (only on active line).
    let effectiveBold = bold;
    let extraGlowMul = 0;
    let clipFromTop = false;
    let typewriterReveal = 1;
    let karaokeFill = false;
    let gradientSweepActive = false;
    if (isActive) {
      switch (highlightStyle) {
        case "scale": {
          const s = 1 + 0.18 * progress;
          ctx.translate(cW / 2, y);
          ctx.scale(s, s);
          ctx.translate(-cW / 2, -y);
          break;
        }
        case "weightBump":
          effectiveBold = true;
          break;
        case "slideIn": {
          const dx = (1 - progress) * fs * 4;
          ctx.translate(dx, 0);
          break;
        }
        case "bounce": {
          const phase = Math.min(1, progress * 1.2);
          const dy = -Math.sin(phase * Math.PI) * fs * 0.18;
          ctx.translate(0, dy);
          break;
        }
        case "shutterWipe":
          clipFromTop = true;
          break;
        case "neonFlash":
          extraGlowMul = 1.2 + 0.6 * Math.sin(adjustedTime * 12);
          break;
        case "gradientSweep":
          gradientSweepActive = true;
          break;
        case "typewriter":
          typewriterReveal = progress;
          break;
        case "karaoke":
        default:
          karaokeFill = true;
          break;
      }
    }

    // Pre-compute the rendered width (using a temporary font) so we can
    // size backgrounds / clip rects.
    ctx.font = buildFont(fs, family, effectiveBold, italic);
    const padX = fs * 0.4;
    const renderText = (typewriterReveal < 1)
      ? displayText.slice(0, Math.max(1, Math.ceil(Array.from(displayText).length * typewriterReveal)))
      : displayText;
    const measureWidth = measureWidthSpaced(ctx, displayText, letterSpacing);

    // ─── Backgrounds (drawn before text) ────────────────────────────────────
    ctx.globalAlpha = lineOpacity;
    const customBgBase = cfg.bgColor ?? "#000000";
    const customBgOpacity = cfg.bgOpacity ?? 0.6;
    const hexToRgba = (hex: string, alpha: number) => {
      const h = hex.replace("#", "");
      const r2 = parseInt(h.slice(0, 2), 16);
      const g2 = parseInt(h.slice(2, 4), 16);
      const b2 = parseInt(h.slice(4, 6), 16);
      return `rgba(${r2},${g2},${b2},${alpha})`;
    };
    if (cfg.subtitleBar) {
      ctx.fillStyle = hexToRgba(customBgBase, customBgOpacity);
      ctx.fillRect(0, y - fs * 0.95, cW, fs * 1.4);
    }
    const bgX = cW / 2 - measureWidth / 2 - padX;
    const bgY = y - fs * 0.9;
    const bgW = measureWidth + padX * 2;
    const bgH = fs * 1.3;
    if (cfg.bgPill) {
      const r = bgH / 2;
      ctx.fillStyle = hexToRgba(customBgBase, customBgOpacity);
      roundRect(ctx, bgX, bgY, bgW, bgH, r);
      ctx.fill();
    }
    if (cfg.sticker) {
      const r = fs * 0.25;
      ctx.fillStyle = isActive ? hlColor : txtColor;
      roundRect(ctx, bgX, bgY, bgW, bgH, r);
      ctx.fill();
    }
    if (cfg.comicPop) {
      // Yellow burst card with thick black border.
      const r = fs * 0.18;
      ctx.fillStyle = "#fde047";
      roundRect(ctx, bgX, bgY, bgW, bgH, r);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = Math.max(2, fs * 0.06);
      roundRect(ctx, bgX, bgY, bgW, bgH, r);
      ctx.stroke();
    }

    // ─── Shadow / glow setup ────────────────────────────────────────────────
    if (cfg.neon || extraGlowMul > 0) {
      const blur = fs * (0.6 + 0.4 * Math.max(extraGlowMul, cfg.neon ? 1 : 0));
      ctx.shadowColor = isActive ? hlColor : txtColor;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (cfg.glow) {
      ctx.shadowColor = isActive ? hlColor : txtColor;
      ctx.shadowBlur = fs * 0.6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    } else if (cfg.dropShadow) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = fs * 0.5;
      ctx.shadowOffsetX = fs * 0.06;
      ctx.shadowOffsetY = fs * 0.08;
    } else if (cfg.hardShadow) {
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = fs * 0.08;
      ctx.shadowOffsetY = fs * 0.08;
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = fs * 0.4;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    // 3D extrude — draw multiple offset layers behind the text.
    if (cfg.threeD) {
      const layers = 6;
      const ox = fs * 0.04;
      const oy = fs * 0.04;
      // Save shadow state — extrude layers shouldn't carry the main shadow.
      const sC = ctx.shadowColor, sB = ctx.shadowBlur, sX = ctx.shadowOffsetX, sY = ctx.shadowOffsetY;
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      for (let k = layers; k >= 1; k--) {
        const ext = "#1f1f1f";
        const bx = cW / 2 + ox * k;
        const by = y + oy * k;
        drawSpacedText(
          ctx, displayText, bx, by, fs, family, effectiveBold, italic,
          letterSpacing, !!cfg.smallCaps, ext, null,
        );
      }
      ctx.shadowColor = sC; ctx.shadowBlur = sB; ctx.shadowOffsetX = sX; ctx.shadowOffsetY = sY;
    }

    // Stroke painter — used both for cfg.outline and cfg.stroke.
    const strokeFn = (cfg.outline || cfg.stroke)
      ? (x: number, by: number, ch: string, font: string) => {
          ctx.font = font;
          ctx.strokeStyle = cfg.stroke ? "#000" : "rgba(0,0,0,0.6)";
          ctx.lineWidth = cfg.stroke ? Math.max(2, fs * 0.12) : Math.max(1, fs * 0.06);
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          ctx.strokeText(ch, x, by);
        }
      : null;

    // Determine fill style for the base (inactive-color) layer.
    const baseFill: string | CanvasGradient = (() => {
      if (cfg.gradient) {
        const grad = ctx.createLinearGradient(cW / 2 - measureWidth / 2, y - fs, cW / 2 + measureWidth / 2, y);
        grad.addColorStop(0, hlColor);
        grad.addColorStop(0.5, txtColor);
        grad.addColorStop(1, hlColor);
        return grad;
      }
      if (cfg.sticker) return "#000";
      return isActive && !karaokeFill && !gradientSweepActive && !clipFromTop ? hlColor : txtColor;
    })();

    // ─── Base text layer ────────────────────────────────────────────────────
    drawSpacedText(
      ctx, renderText, cW / 2, y, fs, family, effectiveBold, italic,
      letterSpacing, !!cfg.smallCaps, baseFill, strokeFn,
    );

    // ─── Active-line highlight overlay ──────────────────────────────────────
    if (isActive && progress > 0) {
      ctx.save();
      let highlightFill: string | CanvasGradient = hlColor;

      if (gradientSweepActive) {
        const grad = ctx.createLinearGradient(cW / 2 - measureWidth / 2, y, cW / 2 + measureWidth / 2, y);
        const p = progress;
        grad.addColorStop(Math.max(0, p - 0.25), txtColor);
        grad.addColorStop(p, hlColor);
        grad.addColorStop(Math.min(1, p + 0.25), txtColor);
        highlightFill = grad;
        // Draw the sweep across the whole line — no clip needed.
        drawSpacedText(
          ctx, displayText, cW / 2, y, fs, family, effectiveBold, italic,
          letterSpacing, !!cfg.smallCaps, highlightFill, strokeFn,
        );
      } else if (karaokeFill) {
        const clipW = (measureWidth + padX) * progress;
        ctx.beginPath();
        ctx.rect(cW / 2 - measureWidth / 2 - padX / 2, y - fs, clipW, fs * 2);
        ctx.clip();
        drawSpacedText(
          ctx, displayText, cW / 2, y, fs, family, effectiveBold, italic,
          letterSpacing, !!cfg.smallCaps, hlColor, strokeFn,
        );
      } else if (clipFromTop) {
        const clipH = fs * 1.6 * progress;
        ctx.beginPath();
        ctx.rect(0, y - fs, cW, clipH);
        ctx.clip();
        drawSpacedText(
          ctx, displayText, cW / 2, y, fs, family, effectiveBold, italic,
          letterSpacing, !!cfg.smallCaps, hlColor, strokeFn,
        );
      }
      ctx.restore();
    }

    // ─── Pop active word overlay (per-word timings only) ───────────────────
    // Layered on top of whatever highlight style is active so it composes with
    // karaoke / shutter / etc. Skipped silently when word data is unavailable
    // or when the displayed word count doesn't match the timed word count
    // (e.g. autoEmoji injected an extra token).
    if (
      cfg.popActiveWord &&
      isActive &&
      seg.words &&
      seg.words.length > 0 &&
      typewriterReveal >= 1
    ) {
      const displayedWords = displayText.match(/\S+/g) ?? [];
      if (displayedWords.length === seg.words.length) {
        const active = findActiveWord(seg.words, adjustedTime);
        if (active) {
          ctx.font = buildFont(fs, family, effectiveBold, italic);
          const ranges = computeWordRanges(ctx, displayText, letterSpacing);
          const range = ranges[active.idx];
          if (range) {
            const leftEdge = cW / 2 - measureWidth / 2;
            const wordCx = leftEdge + (range.left + range.right) / 2;
            // Attack/decay envelope: peaks at sub=0.5, returns to 1 by end.
            // Peak scale interpolates 1.04× (intensity 0) → 1.40× (intensity 100).
            // Default 40 preserves the original 1.18× look for legacy projects.
            const intensity = Math.max(0, Math.min(100,
              cfg.popIntensity ?? 40));
            const peakDelta = 0.04 + (intensity / 100) * 0.36;
            const popScale = 1 + peakDelta * Math.sin(Math.PI * active.sub);
            ctx.save();
            ctx.translate(wordCx, y);
            ctx.scale(popScale, popScale);
            ctx.translate(-wordCx, -y);
            const accent = cfg.popAccentColor && cfg.popAccentColor.length > 0
              ? cfg.popAccentColor
              : hlColor;
            drawSpacedText(
              ctx, displayedWords[active.idx], wordCx, y, fs, family,
              effectiveBold, italic, letterSpacing, !!cfg.smallCaps,
              accent, strokeFn,
            );
            ctx.restore();
          }
        }
      }
    }

    // ─── Underline / strikethrough overlays ────────────────────────────────
    if (cfg.underline || cfg.strikethrough) {
      const lineW = Math.max(1, fs * 0.06);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isActive ? hlColor : txtColor;
      ctx.lineWidth = lineW;
      const lx = cW / 2 - measureWidth / 2;
      const rx = cW / 2 + measureWidth / 2;
      if (cfg.underline) {
        const ly = y + fs * 0.12;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ly);
        ctx.stroke();
      }
      if (cfg.strikethrough) {
        const ly = y - fs * 0.32;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ly);
        ctx.stroke();
      }
    }

    ctx.restore();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
  });

  // Compute the rendered bounds in canvas-space (post user transform) so
  // callers can hit-test against draggable handles. We use a generous
  // approximation (full canvas width fraction) rather than measuring
  // every line, since the on-canvas selection rect is meant as a
  // bounding box rather than a tight glyph-fit.
  const rawW = cW * 0.85;
  const rawX = (cW - rawW) / 2;
  const rawY = baseY - lineHeight * 0.85;
  const rawH = blockHeight + lineHeight * 0.2;
  // Apply the same transform the drawing used: scale around (cW/2, cH/2)
  // then translate by (userOffsetX, userOffsetY).
  const cxRaw = rawX + rawW / 2;
  const cyRaw = rawY + rawH / 2;
  const cxOut = (cxRaw - cW / 2) * userScale + cW / 2 + userOffsetX;
  const cyOut = (cyRaw - cH / 2) * userScale + cH / 2 + userOffsetY;
  const wOut = rawW * userScale;
  const hOut = rawH * userScale;
  if (transformActive) ctx.restore();
  return { x: cxOut - wOut / 2, y: cyOut - hOut / 2, w: wOut, h: hOut };
}

function roundRect(ctx: DrawCtx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ─── Main scene render ────────────────────────────────────────────────────────

export function drawScene(
  ctx: DrawCtx,
  W: number,
  H: number,
  freqData: Uint8Array,
  timeData: Uint8Array,
  audioTime: number,
  sceneTime: number,
  sceneState: SceneState,
  bgImage: ImageBitmap | HTMLImageElement | HTMLVideoElement | VideoFrame | null,
  vc: DrawVisConfig,
  lc: DrawLyricsConfig,
  gifFrame?: ImageBitmap | HTMLImageElement | HTMLCanvasElement | null,
  bgTransform?: BgTransform,
): { x: number; y: number; w: number; h: number } | null {
  const { visStyle, color, intensity, visSize, position, visOffsetX, visOffsetY, visScaleW, visScaleH } = vc;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (bgImage) drawCoverImage(ctx, bgImage, 0, 0, W, H, bgTransform);

  // The "gif" style replaces the procedural visualizer with a user-uploaded
  // animated image (GIF / animated WebP). Honor the same offset/size/scale
  // controls so it can be dragged + resized like any other visualizer.
  if (visStyle === "gif") {
    if (gifFrame) {
      const sizeMul = visSize / 50;
      const offScaleX = W / CANVAS_W;
      const offScaleY = H / CANVAS_H;
      const defaultPosY = position === "top" ? -H * 0.3 : position === "bottom" ? H * 0.3 : 0;
      const oX = visOffsetX * offScaleX;
      const oY = visOffsetY !== null ? visOffsetY * offScaleY : defaultPosY;
      const bW = W * 0.5 * sizeMul * visScaleW;
      const bH = H * 0.5 * sizeMul * visScaleH;
      const bx = W / 2 + oX - bW / 2;
      const by = H / 2 + oY - bH / 2;
      // Preserve the GIF's aspect ratio inside the bounds.
      const fW = (gifFrame as { width?: number }).width ?? bW;
      const fH = (gifFrame as { height?: number }).height ?? bH;
      const ar = fW / Math.max(1, fH);
      let drawW = bW;
      let drawH = bW / ar;
      if (drawH > bH) { drawH = bH; drawW = bH * ar; }
      const drawX = bx + (bW - drawW) / 2;
      const drawY = by + (bH - drawH) / 2;
      try {
        ctx.drawImage(gifFrame as CanvasImageSource, drawX, drawY, drawW, drawH);
      } catch {
        // Frame might have been closed by the decoder; skip silently.
      }
    }
    return drawLyrics(ctx, audioTime, W, H, lc);
  }

  const bufLen = freqData.length;
  if (bufLen === 0) {
    return drawLyrics(ctx, audioTime, W, H, lc);
  }

  const intensityMul = intensity / 50;
  const sizeMul = visSize / 50;
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  ctx.save();

  const defaultPosY = position === "top" ? -H * 0.3 : position === "bottom" ? H * 0.3 : 0;
  const offScaleX = W / CANVAS_W;
  const offScaleY = H / CANVAS_H;
  const oX = visOffsetX * offScaleX;
  const oY = visOffsetY !== null ? visOffsetY * offScaleY : defaultPosY;
  const sW = visScaleW;
  const sH = visScaleH;

  if (visStyle === "bars") {
    const barCount = Math.min(bufLen, 64);
    const totalWidth = W * 0.8 * sizeMul * sW;
    const barW = totalWidth / barCount;
    const gap = barW * 0.2;
    const actualBarW = barW - gap;
    const startX = (W - totalWidth) / 2 + oX;
    const baseY = H * 0.5 + oY + H * 0.25 * sH;
    for (let i = 0; i < barCount; i++) {
      const val = freqData[i] / 255;
      const barH = val * H * 0.5 * intensityMul * sH;
      const x = startX + i * barW;
      const y = baseY - barH;
      const hue = (i / barCount) * 60;
      const rr = Math.min(255, r + hue * 0.5);
      const gg = Math.min(255, g + hue * 0.3);
      const grad = ctx.createLinearGradient(x, y, x, baseY);
      grad.addColorStop(0, `rgba(${rr}, ${gg}, ${b}, 0.95)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.3)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, actualBarW, barH);
      ctx.fillStyle = `rgba(${rr}, ${gg}, ${b}, 0.6)`;
      ctx.fillRect(x, y - 3, actualBarW, 3);
    }
  } else if (visStyle === "circular") {
    const cx = W / 2 + oX;
    const cy = H / 2 + oY;
    const baseRadius = Math.min(W, H) * 0.15 * sizeMul * Math.min(sW, sH);
    const barCount = Math.min(bufLen, 64);
    let avg = 0;
    for (let i = 0; i < barCount; i++) avg += freqData[i];
    avg /= barCount * 255;
    const glowR = baseRadius + avg * 80 * intensityMul;
    const glow = ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, glowR);
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.15 * avg * intensityMul})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const val = freqData[i] / 255;
      const barLen = val * baseRadius * 1.5 * intensityMul;
      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
      const y2 = cy + Math.sin(angle) * (baseRadius + barLen);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + val * 0.6})`;
      ctx.lineWidth = (Math.PI * 2 * baseRadius / barCount) * 0.6;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (visStyle === "waveform") {
    const startY = H * 0.5 + oY;
    const amplitude = H * 0.3 * intensityMul * sizeMul * sH;
    const wW = W * sW;
    const wStartX = (W - wW) / 2 + oX;
    ctx.beginPath();
    for (let i = 0; i < bufLen; i++) {
      const x = wStartX + (i / bufLen) * wW;
      const val = (timeData[i] / 128.0) - 1.0;
      const y = startY + val * amplitude;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
    ctx.lineWidth = 3 * sizeMul;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    for (let i = 0; i < bufLen; i++) {
      const x = wStartX + (i / bufLen) * wW;
      const val = (timeData[i] / 128.0) - 1.0;
      const y = startY - val * amplitude * 0.5;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
    ctx.lineWidth = 1.5 * sizeMul;
    ctx.stroke();
  } else if (visStyle === "pulse") {
    const cx = W / 2 + oX;
    const cy = H / 2 + oY;
    let bass = 0, mid = 0, high = 0;
    const third = Math.floor(bufLen / 3);
    for (let i = 0; i < third; i++) bass += freqData[i];
    for (let i = third; i < third * 2; i++) mid += freqData[i];
    for (let i = third * 2; i < bufLen; i++) high += freqData[i];
    bass = (bass / third) / 255;
    mid = (mid / third) / 255;
    high = (high / (bufLen - third * 2)) / 255;
    const maxR = Math.min(W, H) * 0.4 * sizeMul * Math.min(sW, sH);
    const rings = [
      { val: bass, alpha: 0.3, radiusMul: 1.0 },
      { val: mid, alpha: 0.2, radiusMul: 0.7 },
      { val: high, alpha: 0.15, radiusMul: 0.4 },
    ];
    for (const ring of rings) {
      const radius = ring.val * maxR * intensityMul + maxR * 0.1;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${ring.alpha * ring.val * intensityMul})`);
      grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${ring.alpha * 0.5 * ring.val})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    const pulseR = bass * maxR * 0.3 * intensityMul + 20;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + bass * 0.5})`;
    ctx.lineWidth = 2 + bass * 4;
    ctx.stroke();
  } else if (visStyle === "waterfall") {
    const colCount = Math.min(bufLen, 64);
    const row: number[] = [];
    for (let i = 0; i < colCount; i++) row.push(freqData[i] / 255);
    const maxRows = Math.floor(H * 0.6 * sH);
    sceneState.waterfall.unshift(row);
    if (sceneState.waterfall.length > maxRows) sceneState.waterfall.length = maxRows;
    const totalW = W * 0.8 * sizeMul * sW;
    const colW = totalW / colCount;
    const startX = (W - totalW) / 2 + oX;
    const startY = H * 0.2 + oY;
    const rowH = Math.max(1, (H * 0.6 * sH) / maxRows);
    for (let ri = 0; ri < sceneState.waterfall.length; ri++) {
      const rowData = sceneState.waterfall[ri];
      const fade = 1 - ri / sceneState.waterfall.length;
      for (let ci = 0; ci < rowData.length; ci++) {
        const val = rowData[ci];
        const hue = (ci / colCount) * 60;
        const rr = Math.min(255, r + hue * 0.5);
        const gg = Math.min(255, g + hue * 0.3);
        ctx.fillStyle = `rgba(${rr}, ${gg}, ${b}, ${val * fade * intensityMul * 0.8})`;
        ctx.fillRect(startX + ci * colW, startY + ri * rowH, colW - 0.5, rowH);
      }
    }
  } else if (visStyle === "helix") {
    const cx = W / 2 + oX;
    const cy = H / 2 + oY;
    const helixW = W * 0.7 * sizeMul * sW;
    const helixH = H * 0.5 * sizeMul * sH;
    const points = Math.min(bufLen, 128);
    const t = sceneTime;
    for (let strand = 0; strand < 2; strand++) {
      ctx.beginPath();
      const phase = strand * Math.PI;
      for (let i = 0; i < points; i++) {
        const frac = i / points;
        const x = cx - helixW / 2 + frac * helixW;
        const val = freqData[Math.floor(frac * (bufLen - 1))] / 255;
        const wave = Math.sin(frac * Math.PI * 4 + t * 2 + phase) * helixH * 0.4;
        const y = cy + wave * (0.5 + val * intensityMul * 0.5);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strand === 0 ? 0.9 : 0.5})`;
      ctx.lineWidth = (strand === 0 ? 3 : 2) * sizeMul;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.4)`;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    for (let i = 0; i < points; i += 8) {
      const frac = i / points;
      const x = cx - helixW / 2 + frac * helixW;
      const val = freqData[Math.floor(frac * (bufLen - 1))] / 255;
      const y1 = cy + Math.sin(frac * Math.PI * 4 + t * 2) * helixH * 0.4 * (0.5 + val * intensityMul * 0.5);
      const y2 = cy + Math.sin(frac * Math.PI * 4 + t * 2 + Math.PI) * helixH * 0.4 * (0.5 + val * intensityMul * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + val * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else if (visStyle === "particles") {
    const cx = W / 2 + oX;
    const cy = H / 2 + oY;
    let avgEnergy = 0;
    for (let i = 0; i < bufLen; i++) avgEnergy += freqData[i];
    avgEnergy = (avgEnergy / bufLen) / 255;
    const spawnCount = Math.floor(avgEnergy * 5 * intensityMul);
    const maxParticles = 200;
    const spread = Math.min(W, H) * 0.4 * sizeMul * Math.min(sW, sH);
    for (let s = 0; s < spawnCount && sceneState.particles.length < maxParticles; s++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.5 + Math.random() * 2) * intensityMul;
      sceneState.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed * sW,
        vy: Math.sin(angle) * speed * sH,
        life: 0, maxLife: 40 + Math.random() * 60,
        size: 1 + Math.random() * 3 * sizeMul,
      });
    }
    for (let i = sceneState.particles.length - 1; i >= 0; i--) {
      const p = sceneState.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life > p.maxLife || Math.abs(p.x - cx) > spread || Math.abs(p.y - cy) > spread) {
        sceneState.particles.splice(i, 1);
        continue;
      }
      const alpha = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.8})`;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else if (visStyle === "galaxy") {
    const cx = W / 2 + oX;
    const cy = H / 2 + oY;
    let avgEnergy = 0;
    for (let i = 0; i < bufLen; i++) avgEnergy += freqData[i];
    avgEnergy = (avgEnergy / bufLen) / 255;
    sceneState.galaxyAngle.current += 0.005 + avgEnergy * 0.02 * intensityMul;
    const arms = 4;
    const maxR2 = Math.min(W, H) * 0.35 * sizeMul * Math.min(sW, sH);
    const pointsPerArm = 60;
    for (let a = 0; a < arms; a++) {
      const armOffset = (a / arms) * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i < pointsPerArm; i++) {
        const frac = i / pointsPerArm;
        const freqIdx = Math.floor(frac * Math.min(bufLen - 1, 63));
        const val = freqData[freqIdx] / 255;
        const spiralR = frac * maxR2 * (0.3 + val * intensityMul * 0.7);
        const spiralAngle = armOffset + frac * Math.PI * 3 + sceneState.galaxyAngle.current;
        const x = cx + Math.cos(spiralAngle) * spiralR;
        const y = cy + Math.sin(spiralAngle) * spiralR * 0.6;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + avgEnergy * 0.4})`;
      ctx.lineWidth = 2 + avgEnergy * 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.3)`;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      for (let i = 0; i < pointsPerArm; i += 3) {
        const frac = i / pointsPerArm;
        const freqIdx = Math.floor(frac * Math.min(bufLen - 1, 63));
        const val = freqData[freqIdx] / 255;
        const spiralR = frac * maxR2 * (0.3 + val * intensityMul * 0.7);
        const spiralAngle = armOffset + frac * Math.PI * 3 + sceneState.galaxyAngle.current;
        const x = cx + Math.cos(spiralAngle) * spiralR;
        const y = cy + Math.sin(spiralAngle) * spiralR * 0.6;
        const dotSize = 1 + val * 3 * sizeMul;
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)}, ${0.3 + val * 0.6})`;
        ctx.fill();
      }
    }
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR2 * 0.15);
    coreGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.2 + avgEnergy * 0.3})`);
    coreGlow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = coreGlow;
    ctx.fillRect(cx - maxR2 * 0.15, cy - maxR2 * 0.15, maxR2 * 0.3, maxR2 * 0.3);
  } else if (visStyle === "turntable") {
    drawTurntableScene(ctx, freqData, sceneTime, {
      cx: W / 2 + oX,
      cy: H / 2 + oY,
      radius: Math.min(W, H) * 0.32 * sizeMul * Math.min(sW, sH),
      r, g, b, intensityMul, withTonearm: true,
      rotationRef: sceneState.turntableAngle,
    });
  } else if (visStyle === "dancer") {
    drawDancerScene(ctx, freqData, sceneTime, {
      cx: W / 2 + oX,
      cy: H / 2 + oY,
      size: Math.min(W, H) * 0.45 * sizeMul * Math.min(sW, sH),
      r, g, b, intensityMul, beatRef: sceneState.dancerBeat,
    });
  } else if (visStyle === "djbooth") {
    drawDjBoothScene(ctx, freqData, sceneTime, {
      cx: W / 2 + oX,
      cy: H / 2 + oY,
      width: W * 0.7 * sizeMul * sW,
      height: H * 0.5 * sizeMul * sH,
      r, g, b, intensityMul,
      leftRef: sceneState.turntableAngle,
      rightRef: sceneState.turntableAngleR,
      faderRef: sceneState.djFader,
    });
  }

  ctx.restore();

  return drawLyrics(ctx, audioTime, W, H, lc);
}
