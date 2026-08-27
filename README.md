# CreativeStudio — Multi-Tool Creative Media Platform

A full-stack creative media platform built with a **React + Vite** frontend and an **Express** API server in a PNPM monorepo. It includes a GIF Converter, Aspect Ratio Resizer, OCR Text Extractor, Thumbnail Creator, and Content Dashboard — all served from a single unified sidebar interface.

---

## Project Structure

```
workspace/
├── artifacts/
│   ├── media-studio/                     # React + Vite frontend (port 3000)
│   │   ├── public/
│   │   │   └── textscan.html             # Standalone TextScan OCR UI (iframe embed)
│   │   ├── src/
│   │   │   ├── App.tsx                   # Router — all page routes defined here
│   │   │   ├── components/
│   │   │   │   └── AppLayout.tsx         # Sidebar navigation
│   │   │   ├── pages/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── GifConverter.tsx
│   │   │   │   ├── AspectResizer.tsx
│   │   │   │   ├── OcrTool.tsx           # Embeds textscan.html in an iframe
│   │   │   │   ├── ThumbnailGenerator.tsx
│   │   │   │   ├── ContentDashboard.tsx
│   │   │   │   └── Settings.tsx          # Admin API key management UI (password-protected)
│   │   │   └── lib/
│   │   │       └── utils.ts
│   │   └── vite.config.ts                # Vite proxy: /api → http://localhost:8080
│   │
│   └── api-server/                       # Express API server (port 8080)
│       ├── settings.json                 # Runtime key storage (auto-created, do not commit)
│       └── src/
│           ├── config/
│           │   ├── api-keys.ts           # ★ THE KEY FILE — add all your API keys here
│           │   ├── admin-config.ts       # Admin password for the Settings page
│           │   └── ocr-config.ts        # Deprecated — no longer used
│           ├── ocr/
│           │   └── engines.ts            # All OCR engine implementations + quality scorer
│           └── routes/
│               ├── index.ts              # Route registry
│               ├── media.ts              # GIF, resize, thumbnail, OCR endpoints
│               ├── settings.ts           # Runtime key storage API (admin-protected)
│               ├── content.ts            # Content dashboard feed
│               └── upload.ts             # File upload helpers
```

---

## Tools & Pages

| Route | Tool | Description |
|---|---|---|
| `/` | Dashboard | Overview of all tools |
| `/gif-converter` | GIF Converter | Converts video clips to optimised GIF files |
| `/aspect-resizer` | Aspect Resizer | Crops/resizes images to standard aspect ratios |
| `/ocr` | OCR Text Extractor | Extracts text from images using multi-engine AI OCR |
| `/thumbnail-generator` | Thumbnail Creator | Generates YouTube/social thumbnails from images |
| `/content-dashboard` | Content Dashboard | Curated creative inspiration feed |
| `/settings` | Settings | Admin-only API key management (password-protected) |

---

## Adding API Keys — The Only File You Need

All API keys live in **one file**. Open it, paste your keys in, save, and restart the server.

### `artifacts/api-server/src/config/api-keys.ts`

```ts
export const API_KEYS = {

  // ── Google Gemini (OCR — primary engine) ─────────────────────────────────
  // Free keys: https://aistudio.google.com/app/apikey
  // ~1,500 requests/day per key. Add as many as you like — they rotate automatically.
  gemini: [
    "AIzaSy...",  // Key 1
    "AIzaSy...",  // Key 2
    "AIzaSy...",  // Key 3
  ],

  // ── AI/ML API (200+ models: GPT, Llama, Flux, Sora…) ────────────────────
  // Keys: https://aimlapi.com/app/api-keys
  // Used for OCR fallback and future AI features. Supports multiple keys.
  aiml: [
    "your-aiml-key",  // Key 1
    "your-aiml-key",  // Key 2
  ],

  // ── OpenAI (GPT-4o vision — OCR fallback) ────────────────────────────────
  // Keys: https://platform.openai.com/api-keys
  openai: [
    "sk-...",  // Key 1 (add more for rotation)
  ],

  // ── Google Cloud Vision API ───────────────────────────────────────────────
  // 1. Enable: https://console.cloud.google.com/apis/library/vision.googleapis.com
  // 2. Create key: https://console.cloud.google.com/apis/credentials
  // Free tier: 1,000 units/month (1 unit = 1 image). Uses DOCUMENT_TEXT_DETECTION.
  googleVision: [
    "",  // paste key here
  ],

  // ── Azure Computer Vision ─────────────────────────────────────────────────
  // Create resource: https://portal.azure.com → Cognitive Services → Computer Vision
  azure: {
    key: "",      // "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    endpoint: "", // "https://your-resource.cognitiveservices.azure.com/"
  },

  // ── AWS Textract ──────────────────────────────────────────────────────────
  // Credentials: https://console.aws.amazon.com/iam/
  aws: {
    accessKeyId: "",     // "AKIAIOSFODNN7EXAMPLE"
    secretAccessKey: "", // "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    region: "us-east-1",
  },

  // ── OCR.space (free fallback) ─────────────────────────────────────────────
  // Free key: https://ocr.space/ocrapi/freekey
  ocrSpace: [
    "", // "K8XXXXXXXXXXXXXXXX"
  ],

};
```

**After editing:** restart the server. Changes take effect immediately on restart.

**Key rotation:** For providers that support arrays (`gemini`, `aiml`, `openai`, `googleVision`, `ocrSpace`), the app automatically tries the next key when one hits its quota — keeping OCR running 24/7.

---

## Admin Password

The Settings page in the app is password-protected. To change the password, edit:

### `artifacts/api-server/src/config/admin-config.ts`

```ts
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-123";
//                                                            ↑ change this
```

You can also set the `ADMIN_PASSWORD` environment variable (Replit Secrets) — it takes priority over the value in this file.

---

## Environment Variables (Alternative to Code)

You can also supply keys via environment variables. These are merged with the keys in `api-keys.ts` at runtime.

| Variable | Engine | Format |
|---|---|---|
| `GEMINI_API_KEY` | Gemini | Comma-separated: `key1,key2,key3` |
| `AIML_API_KEY` | AI/ML API | Comma-separated |
| `OPENAI_API_KEY` | OpenAI | Single key |
| `GOOGLE_VISION_API_KEY` | Google Cloud Vision | Single key |
| `AZURE_CV_KEY` | Azure Computer Vision | Single key |
| `AZURE_CV_ENDPOINT` | Azure Computer Vision | URL |
| `AWS_ACCESS_KEY_ID` | AWS Textract | Single value |
| `AWS_SECRET_ACCESS_KEY` | AWS Textract | Single value |
| `AWS_REGION` | AWS Textract | e.g. `us-east-1` |
| `OCR_SPACE_KEY` | OCR.space | Single key |
| `ADMIN_PASSWORD` | Settings page lock | Single value |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Gemini (Replit-managed) | Set automatically |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini (Replit-managed) | Set automatically |

Set environment variables in the Replit **Secrets** tab (padlock icon in sidebar).

---

## OCR Engine Details

All engines run **in parallel** for every image. The result with the highest quality score wins automatically — no fixed priority.

### Quality Scoring (`artifacts/api-server/src/ocr/engines.ts` → `scoreOcrResult()`)

| Factor | What it measures |
|---|---|
| Word count (log-scaled) | More extracted text is generally better |
| Meaningful character ratio | Alphabetic + numeric chars vs total |
| Vocabulary diversity | Unique words / total words |
| Average word length | Realistic text clusters between 3–9 chars |
| Repeated character penalty | Penalises garbage like `lllll`, `aaaa` |
| Casing extremes penalty | Penalises all-caps or all-lowercase |

### Engine Summary

| Engine | Where to add key | Free tier |
|---|---|---|
| Gemini (Replit-managed) | Automatic — no key needed | Yes |
| Gemini (your keys) | `api-keys.ts` → `gemini: []` | ~1,500 req/day/key |
| AI/ML API | `api-keys.ts` → `aiml: []` | Trial available |
| OpenAI GPT-4o | `api-keys.ts` → `openai: []` | No |
| Google Cloud Vision | `api-keys.ts` → `googleVision: []` | 1,000 units/month |
| Azure Computer Vision | `api-keys.ts` → `azure: {}` | Limited free tier |
| AWS Textract | `api-keys.ts` → `aws: {}` | Limited free tier |
| OCR.space | `api-keys.ts` → `ocrSpace: []` | ~500 req/day |
| Tesseract.js | No key needed — always runs offline | Yes |

---

## Runtime Key Storage (Settings UI)

The Settings page (admin-only) lets you add **Gemini** and **AI/ML API** keys at runtime without editing code or restarting. These are stored in `artifacts/api-server/settings.json` and merged with keys from `api-keys.ts` automatically.

```json
{
  "geminiKeys": ["AIzaSy...", "AIzaSy..."],
  "aimlApiKeys": ["your-aiml-key"]
}
```

This file is created automatically. Do not commit it — it contains live keys.

### Settings API Endpoints (admin token required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/settings/auth` | Validate admin password |
| `GET` | `/api/settings/gemini-keys` | Get saved Gemini key count |
| `POST` | `/api/settings/gemini-keys` | Save Gemini API keys |
| `GET` | `/api/settings/aiml-keys` | Get saved AI/ML key count |
| `POST` | `/api/settings/aiml-keys` | Save AI/ML API keys |

---

## All API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/media/gif` | Convert video to GIF |
| `POST` | `/api/media/resize` | Resize/crop image to aspect ratio |
| `POST` | `/api/media/ocr` | Extract text from a single image |
| `POST` | `/api/media/extract` | Bulk OCR — up to 20 images |
| `POST` | `/api/media/thumbnail` | Generate thumbnail from image |
| `GET` | `/api/media/download/:fileId` | Download a previously processed file |
| `GET` | `/api/content/feed` | Fetch content dashboard feed |
| `GET` | `/api/health` | Health check |

---

## Running the Project

```bash
# Install dependencies
pnpm install

# Start both services (frontend + API server)
PORT=8080 pnpm --filter @workspace/api-server run dev & pnpm --filter @workspace/media-studio run dev
```

- Frontend: http://localhost:3000
- API server: http://localhost:8080
- All `/api` requests from the frontend are proxied to port 8080 via Vite

---

## Running the Tests

This monorepo uses [Vitest](https://vitest.dev) as the test runner in every
package. There is a single root command that runs every package's test suite:

```bash
# Run every package's test suite
pnpm test
```

You can also run the suite for a single package:

```bash
pnpm --filter @workspace/api-server  test   # backend route + helper tests
pnpm --filter @workspace/media-studio test   # frontend component + util tests
pnpm --filter @workspace/db          test   # db package smoke tests
pnpm --filter @workspace/api-zod     test   # generated zod schema tests
```

Test files live next to the code they cover and use the `*.test.ts` /
`*.test.tsx` suffix. Frontend component tests run in jsdom via
`@testing-library/react`; backend tests use `supertest` to exercise the
Express app in-process. New code should ship with at least one smoke test
in the same package.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, Wouter (routing) |
| Backend | Express, TypeScript, Pino (logging), Multer (file uploads) |
| OCR | Gemini Vision, AI/ML API, OpenAI GPT-4o, Azure CV, AWS Textract, OCR.space, Tesseract.js |
| Image Processing | Sharp, FFmpeg (GIF conversion) |
| Monorepo | PNPM workspaces |
