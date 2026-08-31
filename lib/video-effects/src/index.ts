export type RgbColor = Readonly<{
  hex: string;
  rgb: readonly [number, number, number];
  css: string;
}>;

/**
 * Aurora Flux's effect palette. Keep these values as the only source of truth
 * for both the CSS preview and the FFmpeg renderer.
 */
export const AURORA_FLUX_COLORS = {
  cyan: { hex: "#49EBFF", rgb: [73, 235, 255], css: "73 235 255" },
  violet: { hex: "#9A5FFF", rgb: [154, 95, 255], css: "154 95 255" },
  mint: { hex: "#57FFCF", rgb: [87, 255, 207], css: "87 255 207" },
  magenta: { hex: "#DD66FF", rgb: [221, 102, 255], css: "221 102 255" },
} as const satisfies Record<string, RgbColor>;

export type AuroraFluxColorName = keyof typeof AURORA_FLUX_COLORS;

export type AuroraFluxGradientStop = Readonly<{
  at: number;
  color: AuroraFluxColorName | null;
  opacity: number;
}>;

/** The two animated ribbon gradients used by the live preview. */
export const AURORA_FLUX_GRADIENTS = [
  {
    angleDeg: 115,
    stops: [
      { at: 0.08, color: null, opacity: 0 },
      { at: 0.26, color: "cyan", opacity: 0.30 },
      { at: 0.43, color: "violet", opacity: 0.26 },
      { at: 0.58, color: null, opacity: 0 },
    ],
  },
  {
    angleDeg: 70,
    stops: [
      { at: 0.36, color: null, opacity: 0 },
      { at: 0.50, color: "mint", opacity: 0.24 },
      { at: 0.64, color: "magenta", opacity: 0.20 },
      { at: 0.82, color: null, opacity: 0 },
    ],
  },
] as const satisfies ReadonlyArray<{
  angleDeg: number;
  stops: readonly AuroraFluxGradientStop[];
}>;

export const AURORA_FLUX_BLEND_MODE = "screen" as const;

/** Base overlay opacity before the user-controlled effect strength multiplier. */
export const AURORA_FLUX_OVERLAY_OPACITY = 0.82;
export const AURORA_FLUX_BLUR_PX = 8;
export const AURORA_FLUX_SATURATION = 1.3;

/** Shared mapping used by CSS animation and FFmpeg's T-based animation phase. */
export const AURORA_FLUX_SPEED_BASE_SECONDS = 12;
export const AURORA_FLUX_SPEED_STEP_SECONDS = 0.08;

export function auroraFluxDurationSeconds(speedPct: number): number {
  const speed = Math.max(0, Math.min(100, speedPct));
  return AURORA_FLUX_SPEED_BASE_SECONDS - speed * AURORA_FLUX_SPEED_STEP_SECONDS;
}

function cssColor(color: AuroraFluxColorName | null, opacity: number): string {
  if (!color || opacity <= 0) return "transparent";
  const [r, g, b] = AURORA_FLUX_COLORS[color].rgb;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const AURORA_FLUX_CSS_BACKGROUND = AURORA_FLUX_GRADIENTS
  .map(({ angleDeg, stops }) =>
    `linear-gradient(${angleDeg}deg, ${stops.map(stop => `${cssColor(stop.color, stop.opacity)} ${stop.at * 100}%`).join(", ")})`
  )
  .join(", ");

/** CSS values consumed by .video-effect-aurora-flux. */
export const AURORA_FLUX_CSS_VARIABLES = {
  "--aurora-flux-background": AURORA_FLUX_CSS_BACKGROUND,
  "--aurora-flux-cyan": AURORA_FLUX_COLORS.cyan.css,
  "--aurora-flux-violet": AURORA_FLUX_COLORS.violet.css,
  "--aurora-flux-mint": AURORA_FLUX_COLORS.mint.css,
  "--aurora-flux-magenta": AURORA_FLUX_COLORS.magenta.css,
  "--aurora-flux-blend-mode": AURORA_FLUX_BLEND_MODE,
  "--aurora-flux-blur": `${AURORA_FLUX_BLUR_PX}px`,
  "--aurora-flux-saturation": String(AURORA_FLUX_SATURATION),
  "--aurora-flux-opacity": String(AURORA_FLUX_OVERLAY_OPACITY),
} as const;

export type AuroraFluxCssVariable = keyof typeof AURORA_FLUX_CSS_VARIABLES;
