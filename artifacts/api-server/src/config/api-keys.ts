// =============================================================================
//  API KEYS  —  the only file you need to edit
//
//  Add your keys here. Every part of the project reads from this file.
//  You can add as many keys as you like for each provider — they rotate
//  automatically when one hits its quota limit.
//
//  Leave a value as "" or [] to skip that engine entirely.
// =============================================================================

export const API_KEYS = {

  // ── Google Gemini (OCR — primary engine) ──────────────────────────────────
  // Free keys: https://aistudio.google.com/app/apikey
  // ~1,500 requests/day per key. Add as many as you like.
  gemini: [
    "AIzaSyAL_88JkN0b_-iA3qHTrhxl53ZAVY78kJ0",
    "AIzaSyDgGVQYvtxIcxN5RUM6bnv2rgSHoF8-ac8",
    "AIzaSyBcxTfm__DA68VFfJ51J0drx6xFoQmHLwc",
    "AIzaSyCrnF6v44GNObjJs-UfAF0nUNKs6nhBU6Y",
    "AIzaSyDuhq1zYWuQ0eLxRermoZwVURcWTcJuY0o",
    "AIzaSyBXFT-D7urbH3U_lriAYPnMVZN0_YccAAg",
    "AIzaSyDG0pm1F05PFUOkzxBHRR7Z1MXSLhSizkE",
    "AIzaSyAlYP9JffB0sVXyCZicnbQN3x7kdlvvP9I",
    "AIzaSyD1vvlohWTxHiae6d3UPoux5SZ1lhsJFEY",
    "AIzaSyBXBqVK-54x8DH53cEClUajBkjbS9tmzbQ"
  ],

  // ── AI/ML API (200+ models: GPT, Llama, Flux, Sora...) ───────────────────
  // Keys: https://aimlapi.com/app/api-keys
  // OpenAI-compatible endpoint — used for OCR fallback and future AI features.
  aiml: [
    "789911d634a0728dca1b9294bbb2344d",
    "bfc01ad309742d7b2b4f26a33aed10df",
    "6b4c01fc575c5f30decb9560cc471ef9",
    "f3633015135804f2cf0a0469c13a66e7",
    "3f652c95fa32ba98905bbc47a7776684",
    "cd4a894fe040bbdbddd1eca742a493fc",
    "ad543ea37eb9b0d4b2b80239c11ae493",
    "3e47310c645754e56bc45ba82fc425f1"
  ],

  // ── OpenAI (GPT-4o vision — OCR fallback) ────────────────────────────────
  // Keys: https://platform.openai.com/api-keys
  openai: [
"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",
    "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",
    ""
  ],

  // ── Google Cloud Vision API (secondary OCR engine) ────────────────────────
  // 1. Enable API: https://console.cloud.google.com/apis/library/vision.googleapis.com
  // 2. Create key: https://console.cloud.google.com/apis/credentials  (API key)
  // Free tier: 1,000 units/month (DOCUMENT_TEXT_DETECTION = 1 unit per image)
  googleVision: [
    "AIzaSyBVSYFBhtDNZz3KfThWg8TdVCvQu9DT2J8", // <- paste key here
  ],

  // ── Azure Computer Vision ─────────────────────────────────────────────────
  // Create resource: https://portal.azure.com -> Cognitive Services -> Computer Vision
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
    "K83677151388957", // "K8XXXXXXXXXXXXXXXX"  <- paste key here
  ],

};

// Helpers — used internally throughout the project. Do not edit below this line.
export const clean = (arr: string[]) => arr.map(s => s.trim()).filter(Boolean);
