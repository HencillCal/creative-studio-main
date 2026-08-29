import { describe, expect, it } from "vitest";
import {
  AURORA_FLUX_BLEND_MODE,
  AURORA_FLUX_COLORS,
} from "@workspace/video-effects";
import { buildAuroraFluxOverlayFilter } from "./video-overlay";

describe("Aurora Flux FFmpeg filter contract", () => {
  it("uses the shared brand palette and CSS-compatible screen blend", () => {
    const filter = buildAuroraFluxOverlayFilter(100, 50);

    for (const channel of [...AURORA_FLUX_COLORS.cyan.rgb, ...AURORA_FLUX_COLORS.violet.rgb]) {
      expect(filter).toContain(String(channel));
    }
    expect(filter).toContain(`all_mode=${AURORA_FLUX_BLEND_MODE}`);
    expect(filter).not.toMatch(/color\s*=\s*violet/i);
    expect(filter).not.toContain("#EE82EE");
  });

  it("keeps the overlay alpha-capable until the output format is selected", () => {
    const filter = buildAuroraFluxOverlayFilter(70, 50);

    expect(filter).toContain("format=gbrap");
    expect(filter).toContain("alphaextract");
    expect(filter).toContain("maskedmerge");
    expect(filter).toContain("format=rgba");
    expect(filter).not.toContain("format=yuv420p");
  });
});
