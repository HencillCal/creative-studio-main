import fs from "fs";

export const OCR_PROMPT =
  "Extract ALL text from this image exactly as it appears. Rules: " +
  "(1) Preserve the document structure — numbered items, bullet points, and sub-items each go on their own line. " +
  "(2) Keep paragraphs together — do NOT break a sentence just because the physical line ended in the image; join the words so each complete sentence flows on one line. " +
  "(3) Separate distinct sections and paragraphs with a blank line. " +
  "(4) Preserve any indentation for sub-items. " +
  "(5) Output ONLY the extracted text — no commentary, no explanation, no markdown formatting.";

export type OcrResult = { text: string; engine: string };

/**
 * Score OCR output quality. Higher = better.
 * Considers: text length, word count, vocabulary diversity,
 * alphabetic ratio, and penalises common OCR artefacts.
 */
export function scoreOcrResult(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;
  const alpha = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  const digits = (trimmed.match(/\d/g) ?? []).length;
  const total = trimmed.length;
  const meaningfulRatio = (alpha + digits) / total;
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / wordCount;
  const wordLenScore = avgWordLen >= 3 && avgWordLen <= 9 ? 1 : Math.max(0, 1 - Math.abs(avgWordLen - 6) * 0.1);
  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  const diversityScore = Math.min(1, uniqueWords / wordCount + 0.2);
  const repeatPenalty = (trimmed.match(/(.)\1{4,}/g) ?? []).length * 0.05;
  const upperRatio = (trimmed.match(/[A-Z]/g) ?? []).length / Math.max(1, alpha);
  const casePenalty = (upperRatio > 0.95 || upperRatio < 0.02) ? 0.1 : 0;
  const score =
    Math.log10(wordCount + 1) * 30
    + meaningfulRatio * 25
    + wordLenScore * 20
    + diversityScore * 15
    - repeatPenalty * 10
    - casePenalty * 10;
  return Math.max(0, score);
}

/** Pick the highest-scoring result from a list; null-safe. */
export function pickBestOcrResult(results: Array<OcrResult | null>): OcrResult | null {
  let best: OcrResult | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (!r) continue;
    const s = scoreOcrResult(r.text);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

function isQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource exhausted") || msg.includes("429");
}

export function normalizeOcrText(raw: string): string {
  // Only safe normalizations — never join or reorder lines, as AI engines already
  // structure the text correctly and any joining destroys document formatting.
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")  // collapse 4+ blank lines to 3 max
    .trim();
}

// ── Shared image preparation ──────────────────────────────────────────────────

async function prepareImage(filePath: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  const stats = fs.statSync(filePath);
  if (stats.size <= 500 * 1024) {
    return { base64: fs.readFileSync(filePath).toString("base64"), mimeType };
  }
  const sharp = (await import("sharp")).default;
  const resized = await sharp(filePath)
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { base64: resized.toString("base64"), mimeType: "image/jpeg" };
}

// ── Key helpers ───────────────────────────────────────────────────────────────

/** Merge keys from: api-keys.ts (code) + settings.json (UI) + env vars */
async function mergeGeminiKeys(): Promise<string[]> {
  const { API_KEYS, clean } = await import("../config/api-keys.js");
  const { getGeminiKeys } = await import("../routes/settings.js");
  const envKeys = (process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  return [...new Set([...clean(API_KEYS.gemini), ...getGeminiKeys(), ...envKeys])];
}

async function mergeAimlKeys(): Promise<string[]> {
  const { API_KEYS, clean } = await import("../config/api-keys.js");
  const { getAimlApiKeys } = await import("../routes/settings.js");
  const envKeys = (process.env.AIML_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  return [...new Set([...clean(API_KEYS.aiml), ...getAimlApiKeys(), ...envKeys])];
}

// ── Gemini Vision ─────────────────────────────────────────────────────────────

async function runGeminiClient(
  ai: import("@google/genai").GoogleGenAI,
  model: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }, { text: OCR_PROMPT }] }],
  });
  return normalizeOcrText(response.text ?? "");
}

export async function runGemini(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const { GoogleGenAI } = await import("@google/genai");
  const { base64, mimeType: finalMime } = await prepareImage(filePath, mimeType);

  // Replit-managed key (always on when hosted on Replit)
  const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (replitBase && replitKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: replitKey, httpOptions: { apiVersion: "", baseUrl: replitBase } });
      const text = await runGeminiClient(ai, "gemini-2.5-flash", base64, finalMime);
      return { text, engine: "gemini-managed" };
    } catch (err) {
      if (!isQuotaError(err)) throw err;
    }
  }

  // User keys: api-keys.ts + settings.json UI + GEMINI_API_KEY env var
  const allKeys = await mergeGeminiKeys();
  let lastErr: unknown;
  for (let i = 0; i < allKeys.length; i++) {
    try {
      const ai = new GoogleGenAI({ apiKey: allKeys[i] });
      const text = await runGeminiClient(ai, "gemini-2.0-flash", base64, finalMime);
      return { text, engine: "gemini" };
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < allKeys.length - 1) continue;
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── AI/ML API (OpenAI-compatible, 200+ models) ────────────────────────────────

export async function runAimlApi(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const allKeys = await mergeAimlKeys();
  if (allKeys.length === 0) return null;

  const { base64, mimeType: finalMime } = await prepareImage(filePath, mimeType);
  const { default: OpenAI } = await import("openai");

  let lastErr: unknown;
  for (let i = 0; i < allKeys.length; i++) {
    try {
      const client = new OpenAI({ apiKey: allKeys[i], baseURL: "https://api.aimlapi.com/v1" });
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${finalMime};base64,${base64}`, detail: "high" } },
          { type: "text", text: OCR_PROMPT },
        ]}],
        max_tokens: 4096,
      });
      const text = normalizeOcrText(response.choices[0]?.message?.content ?? "");
      return { text, engine: "aiml-api" };
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < allKeys.length - 1) continue;
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── OpenAI Vision (GPT-4o) ────────────────────────────────────────────────────

export async function runOpenAI(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const { API_KEYS, clean } = await import("../config/api-keys.js");
  const envKey = process.env.OPENAI_API_KEY;
  const allKeys = [...new Set([...clean(API_KEYS.openai), ...(envKey ? [envKey] : [])])];
  if (allKeys.length === 0) return null;

  const { base64, mimeType: finalMime } = await prepareImage(filePath, mimeType);
  const { default: OpenAI } = await import("openai");

  let lastErr: unknown;
  for (let i = 0; i < allKeys.length; i++) {
    try {
      const client = new OpenAI({ apiKey: allKeys[i] });
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${finalMime};base64,${base64}`, detail: "high" } },
          { type: "text", text: OCR_PROMPT },
        ]}],
        max_tokens: 4096,
      });
      const text = normalizeOcrText(response.choices[0]?.message?.content ?? "");
      return { text, engine: "openai" };
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < allKeys.length - 1) continue;
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── Azure Computer Vision ─────────────────────────────────────────────────────

export async function runAzure(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const { API_KEYS } = await import("../config/api-keys.js");
  const key = API_KEYS.azure.key || process.env.AZURE_CV_KEY || "";
  const endpoint = API_KEYS.azure.endpoint || process.env.AZURE_CV_ENDPOINT || "";
  if (!key || !endpoint) return null;

  const { base64 } = await prepareImage(filePath, mimeType);
  const base = endpoint.replace(/\/$/, "");

  const submitRes = await fetch(`${base}/vision/v3.2/read/analyze`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
    body: Buffer.from(base64, "base64"),
  });
  if (!submitRes.ok) throw new Error(`Azure OCR submit failed: ${submitRes.status} ${await submitRes.text()}`);
  const operationUrl = submitRes.headers.get("Operation-Location");
  if (!operationUrl) throw new Error("Azure OCR: missing Operation-Location header");

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(operationUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
    const data = await pollRes.json() as { status: string; analyzeResult?: { readResults?: Array<{ lines?: Array<{ text: string }> }> } };
    if (data.status === "succeeded") {
      const lines = data.analyzeResult?.readResults?.flatMap(p => p.lines ?? []).map(l => l.text) ?? [];
      return { text: normalizeOcrText(lines.join("\n")), engine: "azure" };
    }
    if (data.status === "failed") throw new Error("Azure OCR analysis failed");
  }
  throw new Error("Azure OCR timed out");
}

// ── AWS Textract ──────────────────────────────────────────────────────────────

export async function runAwsTextract(filePath: string): Promise<OcrResult | null> {
  const { API_KEYS } = await import("../config/api-keys.js");
  const accessKeyId = API_KEYS.aws.accessKeyId || process.env.AWS_ACCESS_KEY_ID || "";
  const secretAccessKey = API_KEYS.aws.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "";
  const region = API_KEYS.aws.region || process.env.AWS_REGION || "us-east-1";
  if (!accessKeyId || !secretAccessKey) return null;

  const { TextractClient, DetectDocumentTextCommand } = await import("@aws-sdk/client-textract");
  const client = new TextractClient({ region, credentials: { accessKeyId, secretAccessKey } });
  const imageBytes = fs.readFileSync(filePath);
  const result = await client.send(new DetectDocumentTextCommand({ Document: { Bytes: imageBytes } }));
  const lines = (result.Blocks ?? []).filter(b => b.BlockType === "LINE").map(b => b.Text ?? "");
  return { text: normalizeOcrText(lines.join("\n")), engine: "aws-textract" };
}

// ── OCR.space ─────────────────────────────────────────────────────────────────

export async function runOcrSpace(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const { API_KEYS, clean } = await import("../config/api-keys.js");
  const envKey = process.env.OCR_SPACE_KEY;
  const allKeys = [...new Set([...clean(API_KEYS.ocrSpace), ...(envKey ? [envKey] : [])])];
  if (allKeys.length === 0) return null;

  const { base64, mimeType: finalMime } = await prepareImage(filePath, mimeType);
  let lastErr: unknown;
  for (let i = 0; i < allKeys.length; i++) {
    try {
      const body = new URLSearchParams({
        apikey: allKeys[i],
        base64Image: `data:${finalMime};base64,${base64}`,
        language: "eng",
        isOverlayRequired: "false",
        OCREngine: "2",
      });
      const res = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`OCR.space request failed: ${res.status}`);
      const data = await res.json() as { IsErroredOnProcessing: boolean; ErrorMessage?: string[]; ParsedResults?: Array<{ ParsedText: string }> };
      if (data.IsErroredOnProcessing) throw new Error(data.ErrorMessage?.join(", ") ?? "OCR.space error");
      const text = data.ParsedResults?.[0]?.ParsedText ?? "";
      return { text: normalizeOcrText(text), engine: "ocr-space" };
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < allKeys.length - 1) continue;
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── Google Cloud Vision API ───────────────────────────────────────────────────

export async function runGoogleVision(filePath: string, mimeType: string): Promise<OcrResult | null> {
  const { API_KEYS, clean } = await import("../config/api-keys.js");
  const envKey = process.env.GOOGLE_VISION_API_KEY;
  const allKeys = [...new Set([...clean(API_KEYS.googleVision), ...(envKey ? [envKey] : [])])];
  if (allKeys.length === 0) return null;

  const { base64, mimeType: finalMime } = await prepareImage(filePath, mimeType);

  let lastErr: unknown;
  for (let i = 0; i < allKeys.length; i++) {
    try {
      const body = {
        requests: [{
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["en"] },
        }],
      };
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${allKeys[i]}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) throw new Error("quota");
        throw new Error(`Google Vision API error ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json() as {
        responses?: Array<{
          fullTextAnnotation?: { text: string };
          error?: { message: string };
        }>;
      };
      const apiErr = data.responses?.[0]?.error;
      if (apiErr) throw new Error(`Google Vision: ${apiErr.message}`);
      const text = data.responses?.[0]?.fullTextAnnotation?.text ?? "";
      return { text: normalizeOcrText(text), engine: "google-vision" };
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) && i < allKeys.length - 1) continue;
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// ── Tesseract.js (offline fallback — no key needed) ───────────────────────────

export async function runTesseract(filePath: string): Promise<OcrResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const { data } = await worker.recognize(filePath);
  await worker.terminate();
  return { text: normalizeOcrText(data.text), engine: "tesseract" };
}
