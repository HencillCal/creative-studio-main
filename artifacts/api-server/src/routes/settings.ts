import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { ADMIN_PASSWORD } from "../config/admin-config.js";

const router: IRouter = Router();

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

interface Settings {
  geminiKeys: string[];
  aimlApiKeys: string[];
}

function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<Settings>;
      return {
        geminiKeys: parsed.geminiKeys ?? [],
        aimlApiKeys: parsed.aimlApiKeys ?? [],
      };
    }
  } catch {}
  return { geminiKeys: [], aimlApiKeys: [] };
}

function saveSettings(data: Settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function maskKey(k: string) {
  return {
    masked: k.length > 8 ? k.slice(0, 6) + "•".repeat(Math.max(0, k.length - 10)) + k.slice(-4) : "••••••••",
    suffix: k.slice(-4),
    active: k.length > 10,
  };
}

export function getGeminiKeys(): string[] {
  // Merge: UI-saved keys from settings.json only.
  // Code-defined keys from api-keys.ts are merged directly in engines.ts.
  return loadSettings().geminiKeys.filter(Boolean);
}

export function getAimlApiKeys(): string[] {
  return loadSettings().aimlApiKeys.filter(Boolean);
}

// ── Admin auth middleware ─────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or missing admin token." });
    return;
  }
  next();
}

// ── Auth check endpoint (no sensitive data returned) ─────────────────────────

router.post("/auth", (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password || password !== ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, message: "Wrong password." });
    return;
  }
  res.json({ ok: true });
});

// ── Gemini keys (admin only) ──────────────────────────────────────────────────

router.get("/gemini-keys", requireAdmin, (_req: Request, res: Response) => {
  const { geminiKeys } = loadSettings();
  res.json({ count: geminiKeys.length, keys: geminiKeys.map(maskKey) });
});

router.post("/gemini-keys", requireAdmin, (req: Request, res: Response) => {
  const { keys } = req.body as { keys?: string[] };
  if (!Array.isArray(keys)) { res.status(400).json({ error: "keys must be an array" }); return; }
  const cleaned = keys.map((k) => String(k).trim()).filter(Boolean);
  saveSettings({ ...loadSettings(), geminiKeys: cleaned });
  res.json({ saved: cleaned.length });
});

// ── AI/ML API keys (admin only) ───────────────────────────────────────────────

router.get("/aiml-keys", requireAdmin, (_req: Request, res: Response) => {
  const { aimlApiKeys } = loadSettings();
  res.json({ count: aimlApiKeys.length, keys: aimlApiKeys.map(maskKey) });
});

router.post("/aiml-keys", requireAdmin, (req: Request, res: Response) => {
  const { keys } = req.body as { keys?: string[] };
  if (!Array.isArray(keys)) { res.status(400).json({ error: "keys must be an array" }); return; }
  const cleaned = keys.map((k) => String(k).trim()).filter(Boolean);
  saveSettings({ ...loadSettings(), aimlApiKeys: cleaned });
  res.json({ saved: cleaned.length });
});

export default router;
