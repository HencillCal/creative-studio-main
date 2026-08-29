import { test, expect, type Page } from "@playwright/test";
import { buildAuroraFluxOverlayFilter } from "../../api-server/src/lib/video-overlay";
import { AURORA_FLUX_CSS_VARIABLES } from "@workspace/video-effects";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const WIDTH = 160;
const HEIGHT = 90;
const TIMESTAMP_SECONDS = 0;

type RgbaFrame = Buffer;

type PixelDiff = {
  meanChannelDelta: number;
  p95ChannelDelta: number;
  p99ChannelDelta: number;
  maxChannelDelta: number;
  differingPixelRatio: number;
};

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    maxBuffer: 1024 * 1024 * 8,
  });
}

async function readPngAsRgba(filePath: string): Promise<RgbaFrame> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", filePath, "-f", "rawvideo", "-pix_fmt", "rgba", "-frames:v", "1", "pipe:1"],
    { encoding: "buffer", maxBuffer: WIDTH * HEIGHT * 4 + 1024 },
  );
  return stdout as Buffer;
}

async function renderLivePreviewFrame(page: Page, basePng: Buffer, outputPath: string): Promise<void> {
  const baseDataUrl = `data:image/png;base64,${basePng.toString("base64")}`;
  await page.goto("/video-stylizer");
  await page.evaluate(async ({ baseDataUrl, cssVariables }) => {
    document.body.innerHTML = "";
    Object.assign(document.body.style, { margin: "0", background: "#000" });

    const stage = document.createElement("div");
    stage.id = "aurora-flux-parity-stage";
    Object.assign(stage.style, {
      position: "relative",
      width: "160px",
      height: "90px",
      overflow: "hidden",
      background: "#000",
    });

    const image = document.createElement("img");
    image.alt = "parity fixture";
    Object.assign(image.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
    });
    image.src = baseDataUrl;

    const overlay = document.createElement("div");
    overlay.className = "video-effect-overlay video-effect-aurora-flux";
    for (const [name, value] of Object.entries(cssVariables)) {
      overlay.style.setProperty(name, value);
    }
    overlay.style.setProperty("--effect-strength", "1");
    overlay.style.setProperty("--effect-speed", "12s");
    overlay.style.animation = "none";
    overlay.style.backgroundPosition = "0 0, 0 0";
    overlay.style.transform = "none";

    stage.append(image, overlay);
    document.body.append(stage);
    await image.decode();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, { baseDataUrl, cssVariables: AURORA_FLUX_CSS_VARIABLES });

  const overlayContract = await page.locator("#aurora-flux-parity-stage .video-effect-aurora-flux").evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      blendMode: style.mixBlendMode,
      opacity: style.opacity,
      filter: style.filter,
    };
  });
  expect(overlayContract.blendMode).toBe("screen");
  expect(overlayContract.backgroundImage).toContain("154, 95, 255");
  expect(overlayContract.backgroundImage).toContain("73, 235, 255");
  expect(overlayContract.opacity).toBe("0.82");

  await page.locator("#aurora-flux-parity-stage").screenshot({ path: outputPath });
}

function diffRgbaFrames(preview: RgbaFrame, exported: RgbaFrame): PixelDiff {
  expect(preview.length).toBe(WIDTH * HEIGHT * 4);
  expect(exported.length).toBe(WIDTH * HEIGHT * 4);

  let sum = 0;
  let max = 0;
  const channelDeltas: number[] = [];
  let differingPixels = 0;
  for (let i = 0; i < preview.length; i += 4) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(preview[i + channel] - exported[i + channel]);
      pixelDelta += delta;
      sum += delta;
      channelDeltas.push(delta);
      if (delta > max) max = delta;
    }
    // Count only materially different pixels (mean RGB delta > 64); normal
    // browser/FFmpeg antialiasing noise is ignored, while a flat wash trips this.
    if (pixelDelta > 192) differingPixels++;
  }

  const pixelCount = WIDTH * HEIGHT;
  channelDeltas.sort((a, b) => a - b);
  const percentile = (p: number): number => channelDeltas[Math.min(channelDeltas.length - 1, Math.floor(channelDeltas.length * p))];
  return {
    meanChannelDelta: sum / (pixelCount * 3),
    p95ChannelDelta: percentile(0.95),
    p99ChannelDelta: percentile(0.99),
    maxChannelDelta: max,
    differingPixelRatio: differingPixels / pixelCount,
  };
}

test("Aurora Flux preview and FFmpeg export stay pixel-close", async ({ page }) => {
  const workDir = await mkdtemp(path.join(tmpdir(), "aurora-flux-parity-"));
  const basePath = path.join(workDir, "base.png");
  const previewPath = path.join(workDir, "preview.png");
  const exportPath = path.join(workDir, "export.png");

  try {
    await runFfmpeg([
      "-f", "lavfi",
      "-i", `testsrc2=size=${WIDTH}x${HEIGHT}:rate=1`,
      "-frames:v", "1",
      "-pix_fmt", "rgba",
      "-y", basePath,
    ]);
    const basePng = await readFile(basePath);

    await renderLivePreviewFrame(page, basePng, previewPath);

    await runFfmpeg([
      "-i", basePath,
      "-filter_complex", buildAuroraFluxOverlayFilter(100, 50),
      "-frames:v", "1",
      "-pix_fmt", "rgba",
      "-y", exportPath,
    ]);

    const diff = diffRgbaFrames(
      await readPngAsRgba(previewPath),
      await readPngAsRgba(exportPath),
    );
    console.log(`Aurora Flux parity at t=${TIMESTAMP_SECONDS}s: ${JSON.stringify(diff)}`);

    expect(diff.meanChannelDelta, "preview/export mean RGB delta").toBeLessThan(20);
    expect(diff.p95ChannelDelta, "preview/export p95 RGB channel delta").toBeLessThanOrEqual(56);
    expect(diff.p99ChannelDelta, "preview/export p99 RGB channel delta").toBeLessThanOrEqual(70);
    expect(diff.differingPixelRatio, "preview/export materially differing pixel ratio").toBeLessThan(0.35);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
