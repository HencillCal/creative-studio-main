import type { LyricsHighlightStyle, LyricsFontFamily, LyricsPosition } from "./drawScene";

export interface LyricStylePreset {
  id: string;
  name: string;
  builtIn?: boolean;
  lyricsFontSize: number;
  lyricsFontFamily: LyricsFontFamily;
  lyricsColor: string;
  lyricsHighlightColor: string;
  lyricsPosition: LyricsPosition;
  lyricsHighlightStyle: LyricsHighlightStyle;
  lyricsPace: number;
  lyricsLetterSpacing: number;
  lyricsBold: boolean;
  lyricsItalic: boolean;
  lyricsOutline: boolean;
  lyricsGlow: boolean;
  lyricsDropShadow: boolean;
  lyricsHardShadow: boolean;
  lyricsNeon: boolean;
  lyrics3D: boolean;
  lyricsGradient: boolean;
  lyricsStroke: boolean;
  lyricsUnderline: boolean;
  lyricsStrikethrough: boolean;
  lyricsUppercase: boolean;
  lyricsSmallCaps: boolean;
  lyricsBgPill: boolean;
  lyricsSticker: boolean;
  lyricsComicPop: boolean;
  lyricsSubtitleBar: boolean;
  lyricsPopActiveWord: boolean;
  lyricsPopIntensity: number;
  // Empty string = use lyricsHighlightColor (legacy behavior).
  lyricsPopAccentColor: string;
  // Background color for BG Pill and Subtitle Bar. Defaults to "#000000".
  lyricsBgColor: string;
  // Opacity for the background (0–1). Defaults to 0.6.
  lyricsBgOpacity: number;
}

export const LYRIC_STYLE_PRESETS_KEY = "cs_lyric_style_presets";

const baseDefaults = {
  lyricsBold: false,
  lyricsItalic: false,
  lyricsOutline: false,
  lyricsGlow: false,
  lyricsDropShadow: false,
  lyricsHardShadow: false,
  lyricsNeon: false,
  lyrics3D: false,
  lyricsGradient: false,
  lyricsStroke: false,
  lyricsUnderline: false,
  lyricsStrikethrough: false,
  lyricsUppercase: false,
  lyricsSmallCaps: false,
  lyricsBgPill: false,
  lyricsSticker: false,
  lyricsComicPop: false,
  lyricsSubtitleBar: false,
  lyricsPopActiveWord: false,
  lyricsPopIntensity: 40,
  lyricsPopAccentColor: "",
  lyricsBgColor: "#000000",
  lyricsBgOpacity: 0.6,
};

export const DEFAULT_LYRIC_STYLE_PRESETS: LyricStylePreset[] = [
  {
    ...baseDefaults,
    id: "builtin-tiktok",
    name: "TikTok Caption",
    builtIn: true,
    lyricsFontSize: 44,
    lyricsFontFamily: "Impact",
    lyricsColor: "#ffffff",
    lyricsHighlightColor: "#fef08a",
    lyricsPosition: "center",
    lyricsHighlightStyle: "scale",
    lyricsPace: 1,
    lyricsLetterSpacing: 1,
    lyricsBold: true,
    lyricsUppercase: true,
    lyricsDropShadow: true,
    lyricsBgPill: true,
  },
  {
    ...baseDefaults,
    id: "builtin-neon",
    name: "Neon Karaoke",
    builtIn: true,
    lyricsFontSize: 40,
    lyricsFontFamily: "Impact",
    lyricsColor: "#22d3ee",
    lyricsHighlightColor: "#f472b6",
    lyricsPosition: "bottom",
    lyricsHighlightStyle: "neonFlash",
    lyricsPace: 1,
    lyricsLetterSpacing: 3,
    lyricsBold: true,
    lyricsNeon: true,
    lyricsGlow: true,
  },
  {
    ...baseDefaults,
    id: "builtin-comic",
    name: "Comic Pop",
    builtIn: true,
    lyricsFontSize: 42,
    lyricsFontFamily: "Comic Sans MS",
    lyricsColor: "#fde047",
    lyricsHighlightColor: "#ef4444",
    lyricsPosition: "center",
    lyricsHighlightStyle: "bounce",
    lyricsPace: 1,
    lyricsLetterSpacing: 0,
    lyricsBold: true,
    lyricsStroke: true,
    lyricsComicPop: true,
    lyricsHardShadow: true,
  },
  {
    ...baseDefaults,
    id: "builtin-subtitle",
    name: "Classic Subtitle",
    builtIn: true,
    lyricsFontSize: 32,
    lyricsFontFamily: "Arial",
    lyricsColor: "#ffffff",
    lyricsHighlightColor: "#ffd700",
    lyricsPosition: "bottom",
    lyricsHighlightStyle: "karaoke",
    lyricsPace: 1,
    lyricsLetterSpacing: 0,
    lyricsBold: true,
    lyricsSubtitleBar: true,
  },
  {
    ...baseDefaults,
    id: "builtin-cinematic",
    name: "Cinematic",
    builtIn: true,
    lyricsFontSize: 38,
    lyricsFontFamily: "Georgia",
    lyricsColor: "#f5f5f4",
    lyricsHighlightColor: "#eab308",
    lyricsPosition: "bottom",
    lyricsHighlightStyle: "gradientSweep",
    lyricsPace: 1,
    lyricsLetterSpacing: 2,
    lyricsItalic: true,
    lyricsDropShadow: true,
    lyricsGradient: true,
  },
  {
    ...baseDefaults,
    id: "builtin-typewriter",
    name: "Typewriter",
    builtIn: true,
    lyricsFontSize: 34,
    lyricsFontFamily: "Courier New",
    lyricsColor: "#ffffff",
    lyricsHighlightColor: "#22d3ee",
    lyricsPosition: "center",
    lyricsHighlightStyle: "typewriter",
    lyricsPace: 1,
    lyricsLetterSpacing: 1,
    lyricsBold: true,
    lyricsDropShadow: true,
  },
];

export function normaliseLyricStylePreset(p: unknown): LyricStylePreset | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string" || !r.name) return null;
  const str = (k: string, fallback: string) => typeof r[k] === "string" ? (r[k] as string) : fallback;
  const num = (k: string, fallback: number) => typeof r[k] === "number" ? (r[k] as number) : fallback;
  const bool = (k: string) => typeof r[k] === "boolean" ? (r[k] as boolean) : false;
  return {
    id: r.id as string,
    name: r.name as string,
    builtIn: bool("builtIn"),
    lyricsFontSize: num("lyricsFontSize", 36),
    lyricsFontFamily: str("lyricsFontFamily", "Arial") as LyricsFontFamily,
    lyricsColor: str("lyricsColor", "#ffffff"),
    lyricsHighlightColor: str("lyricsHighlightColor", "#ffd700"),
    lyricsPosition: str("lyricsPosition", "bottom") as LyricsPosition,
    lyricsHighlightStyle: str("lyricsHighlightStyle", "karaoke") as LyricsHighlightStyle,
    lyricsPace: num("lyricsPace", 1),
    lyricsLetterSpacing: num("lyricsLetterSpacing", 0),
    lyricsBold: bool("lyricsBold"),
    lyricsItalic: bool("lyricsItalic"),
    lyricsOutline: bool("lyricsOutline"),
    lyricsGlow: bool("lyricsGlow"),
    lyricsDropShadow: bool("lyricsDropShadow"),
    lyricsHardShadow: bool("lyricsHardShadow"),
    lyricsNeon: bool("lyricsNeon"),
    lyrics3D: bool("lyrics3D"),
    lyricsGradient: bool("lyricsGradient"),
    lyricsStroke: bool("lyricsStroke"),
    lyricsUnderline: bool("lyricsUnderline"),
    lyricsStrikethrough: bool("lyricsStrikethrough"),
    lyricsUppercase: bool("lyricsUppercase"),
    lyricsSmallCaps: bool("lyricsSmallCaps"),
    lyricsBgPill: bool("lyricsBgPill"),
    lyricsSticker: bool("lyricsSticker"),
    lyricsComicPop: bool("lyricsComicPop"),
    lyricsSubtitleBar: bool("lyricsSubtitleBar"),
    lyricsPopActiveWord: bool("lyricsPopActiveWord"),
    lyricsPopIntensity: Math.max(0, Math.min(100, num("lyricsPopIntensity", 40))),
    lyricsPopAccentColor: str("lyricsPopAccentColor", ""),
    lyricsBgColor: str("lyricsBgColor", "#000000"),
    lyricsBgOpacity: Math.max(0, Math.min(1, num("lyricsBgOpacity", 0.6))),
  };
}
