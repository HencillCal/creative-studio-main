import { describe, expect, it } from "vitest";
import { computeWordRanges, findActiveWord } from "./drawScene";
import type { DrawCtx } from "./drawScene";

// ── findActiveWord ──────────────────────────────────────────────────────────

describe("findActiveWord", () => {
  const words = [
    { text: "hello", start: 1.0, end: 1.5 },
    { text: "brave", start: 1.5, end: 2.0 },
    { text: "world", start: 2.5, end: 3.0 },
  ];

  it("returns null for an empty word list", () => {
    expect(findActiveWord([], 1.0)).toBeNull();
  });

  it("returns null when time is before the first word", () => {
    expect(findActiveWord(words, 0.5)).toBeNull();
  });

  it("returns null when time is after the last word", () => {
    expect(findActiveWord(words, 5.0)).toBeNull();
  });

  it("returns null when time falls in a gap between words", () => {
    expect(findActiveWord(words, 2.25)).toBeNull();
  });

  it("selects the first word and reports sub=0 at exact start", () => {
    const r = findActiveWord(words, 1.0);
    expect(r).toEqual({ idx: 0, sub: 0 });
  });

  it("selects the correct mid-word with sub ≈ 0.5", () => {
    const r = findActiveWord(words, 1.25);
    expect(r?.idx).toBe(0);
    expect(r?.sub).toBeCloseTo(0.5, 5);
  });

  it("excludes the exact end boundary (half-open interval)", () => {
    // t === word.end belongs to neither word; the next word starts at the
    // same instant and only inclusive-start applies.
    const r = findActiveWord(words, 1.5);
    expect(r).toEqual({ idx: 1, sub: 0 });
  });

  it("clamps sub to [0, 1] and survives a zero-duration word", () => {
    const zero = [{ text: "x", start: 1.0, end: 1.0 }];
    // t === start === end — half-open interval excludes it, so result is null.
    expect(findActiveWord(zero, 1.0)).toBeNull();
    // A near-zero-duration word still resolves without dividing by zero.
    const tiny = [{ text: "x", start: 1.0, end: 1.0000001 }];
    const r = findActiveWord(tiny, 1.0);
    expect(r?.idx).toBe(0);
    expect(r?.sub).toBeGreaterThanOrEqual(0);
    expect(r?.sub).toBeLessThanOrEqual(1);
  });

  it("returns the first matching word when intervals overlap", () => {
    const overlap = [
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 0.5, end: 1.5 },
    ];
    const r = findActiveWord(overlap, 0.75);
    expect(r?.idx).toBe(0);
  });
});

// ── computeWordRanges ───────────────────────────────────────────────────────

// Minimal fake ctx whose measureText returns one unit per character. This
// lets the tests assert exact pixel positions independent of any real font
// metric, while still exercising the same character-walk code path.
function fakeCtx(): DrawCtx {
  return {
    measureText: (s: string) => ({ width: s.length }),
  } as unknown as DrawCtx;
}

describe("computeWordRanges", () => {
  it("returns no ranges for an empty string", () => {
    expect(computeWordRanges(fakeCtx(), "", 0)).toEqual([]);
  });

  it("returns no ranges for whitespace-only input", () => {
    expect(computeWordRanges(fakeCtx(), "   ", 0)).toEqual([]);
  });

  it("computes a single-word range from 0 to width", () => {
    const r = computeWordRanges(fakeCtx(), "hello", 0);
    expect(r).toEqual([{ left: 0, right: 5 }]);
  });

  it("computes two words separated by a single space without letter-spacing", () => {
    // Layout: "h e l l o   w o r l d" → "hello" 0..5, space 5..6, "world" 6..11
    const r = computeWordRanges(fakeCtx(), "hello world", 0);
    expect(r).toEqual([
      { left: 0, right: 5 },
      { left: 6, right: 11 },
    ]);
  });

  it("applies letter-spacing between characters but not after the last", () => {
    // "ab cd" with letterSpacing=2:
    //   a:0..1, +2 spacing, b:3..4, +2 spacing, ' ':6..7, +2 spacing,
    //   c:9..10, +2 spacing, d:12..13. No trailing spacing after final char.
    // Note: when a word ends at a space, the captured right edge is
    // (x_at_space - charWidth) i.e. it includes the post-'b' letter-spacing
    // gap (4 + 2 = 6). This matches drawSpacedText's centering math.
    const r = computeWordRanges(fakeCtx(), "ab cd", 2);
    expect(r).toEqual([
      { left: 0, right: 6 },
      { left: 9, right: 13 },
    ]);
  });

  it("ignores leading whitespace and reports the word's true left edge", () => {
    const r = computeWordRanges(fakeCtx(), " hi", 0);
    expect(r).toEqual([{ left: 1, right: 3 }]);
  });

  it("collapses runs of whitespace between words correctly", () => {
    // "a   b" → a:0..1, three spaces 1..4, b:4..5
    const r = computeWordRanges(fakeCtx(), "a   b", 0);
    expect(r).toEqual([
      { left: 0, right: 1 },
      { left: 4, right: 5 },
    ]);
  });

  it("captures a trailing word when the string does not end in whitespace", () => {
    const r = computeWordRanges(fakeCtx(), "x yy", 0);
    expect(r).toEqual([
      { left: 0, right: 1 },
      { left: 2, right: 4 },
    ]);
  });
});
