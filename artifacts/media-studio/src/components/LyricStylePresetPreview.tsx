import type { CSSProperties } from "react";
import type { LyricStylePreset } from "@/lib/lyricStylePresets";

interface Props {
  preset: LyricStylePreset;
}

export function LyricStylePresetPreview({ preset }: Props) {
  const text = preset.lyricsUppercase ? "AA" : "Aa";

  const shadows: string[] = [];
  if (preset.lyricsNeon) {
    shadows.push(
      `0 0 3px ${preset.lyricsHighlightColor}`,
      `0 0 6px ${preset.lyricsHighlightColor}`,
    );
  } else if (preset.lyricsGlow) {
    shadows.push(`0 0 4px ${preset.lyricsHighlightColor}`);
  }
  if (preset.lyricsHardShadow) shadows.push("1px 1px 0 #000");
  else if (preset.lyricsDropShadow) shadows.push("1px 1px 1px rgba(0,0,0,0.6)");

  const baseStyle: CSSProperties = {
    fontFamily: `"${preset.lyricsFontFamily}", sans-serif`,
    fontWeight: preset.lyricsBold ? 700 : 500,
    fontStyle: preset.lyricsItalic ? "italic" : "normal",
    fontVariant: preset.lyricsSmallCaps ? "small-caps" : "normal",
    letterSpacing: `${Math.min(Math.max(preset.lyricsLetterSpacing, 0), 2)}px`,
    fontSize: 11,
    lineHeight: 1,
    textShadow: shadows.length ? shadows.join(", ") : undefined,
    textDecoration:
      [
        preset.lyricsUnderline ? "underline" : null,
        preset.lyricsStrikethrough ? "line-through" : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  };

  if (preset.lyricsStroke || preset.lyricsOutline) {
    (baseStyle as CSSProperties & { WebkitTextStroke?: string }).WebkitTextStroke =
      "0.5px #000";
  }

  const wrapperStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    padding: preset.lyricsBgPill || preset.lyricsSubtitleBar ? "1px 5px" : "1px 3px",
    borderRadius: preset.lyricsBgPill ? 999 : preset.lyricsSubtitleBar ? 2 : 3,
    background: preset.lyricsBgPill
      ? "rgba(0,0,0,0.6)"
      : preset.lyricsSubtitleBar
      ? "rgba(0,0,0,0.75)"
      : "rgba(0,0,0,0.4)",
  };

  if (preset.lyricsGradient) {
    const gradStyle: CSSProperties = {
      ...baseStyle,
      backgroundImage: `linear-gradient(90deg, ${preset.lyricsColor}, ${preset.lyricsHighlightColor})`,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
    return (
      <span style={wrapperStyle} aria-hidden="true">
        <span style={gradStyle}>{text}</span>
      </span>
    );
  }

  return (
    <span style={wrapperStyle} aria-hidden="true">
      <span style={{ ...baseStyle, color: preset.lyricsColor }}>{text[0]}</span>
      <span style={{ ...baseStyle, color: preset.lyricsHighlightColor }}>{text[1]}</span>
    </span>
  );
}
