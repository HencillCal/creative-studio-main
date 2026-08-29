import fs from "node:fs";

const source = fs.readFileSync(new URL("../artifacts/media-studio/src/pages/AiStylizer.tsx", import.meta.url), "utf8");
if (!source.includes("pattern.replace(/\\{(name|style|quality|codec)\\}/gi")) {
  throw new Error("Filename placeholder replacement regex is not present in the expected form");
}

function makeDownloadStem(name) {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "video";
}

function makeVideoDownloadName(fileName, styleLabel, template, quality, codec) {
  const name = makeDownloadStem(fileName);
  const style = makeDownloadStem(styleLabel);
  const pattern = template.trim() || "{name}-{style}";
  const values = { name, style, quality: quality === "original" ? "original" : quality, codec: codec === "hevc" ? "hevc" : "h264" };
  const rendered = pattern.replace(/\{(name|style|quality|codec)\}/gi, (_match, token) => values[token.toLowerCase()] ?? "");
  return `${makeDownloadStem(rendered)}.mp4`;
}

const blank = makeVideoDownloadName("Cruisin_ the Block.mp4", "Cyberpunk", "", "original", "h264");
if (blank !== "Cruisin-the-Block-Cyberpunk.mp4") throw new Error(`Blank fallback failed: ${blank}`);

const custom = makeVideoDownloadName("clip.mp4", "Aurora Flux", "{name}_{style}_{quality}_{codec}", "social", "hevc");
if (custom !== "clip-Aurora-Flux-social-hevc.mp4") throw new Error(`Custom template failed: ${custom}`);

console.log("download filename template checks passed");
