import { useState, useEffect, useCallback } from "react";
import {
  Settings as SettingsIcon, Key, Plus, Trash2, Save, CheckCircle,
  ExternalLink, Eye, EyeOff, ArrowLeft, RefreshCw, Zap, Lock, LogOut, ShieldCheck, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SESSION_KEY = "cs_admin_token";

// ── Password gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, password);
        onUnlock(password);
      } else {
        setError("Wrong password. Try again.");
        setPassword("");
      }
    } catch {
      setError("Could not reach server. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow-xl mb-4 border border-white/10">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Admin Access</h2>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            Enter your admin password to manage API keys
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Admin password"
              autoFocus
              className={cn(
                "w-full bg-background border rounded-xl px-4 py-3 text-sm font-mono pr-11 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all",
                error ? "border-red-500/60 focus:ring-red-500/20" : "border-border"
              )}
              spellCheck={false}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <XCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all",
              password.trim() && !loading
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
                : "bg-primary/30 text-primary-foreground/50 cursor-not-allowed"
            )}
          >
            {loading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Verifying…</> : <><ShieldCheck className="w-4 h-4" /> Unlock Settings</>}
          </button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          The admin password is set in<br />
          <code className="text-foreground font-mono bg-muted/40 px-1 py-0.5 rounded text-[11px]">
            artifacts/api-server/src/config/admin-config.ts
          </code>
        </p>
      </div>
    </div>
  );
}

// ── Per-provider key section ──────────────────────────────────────────────────

interface KeySectionState {
  keys: string[];
  showKeys: boolean[];
  savedCount: number;
  saving: boolean;
  saved: boolean;
  fetching: boolean;
}

function useKeySection(endpoint: string, token: string) {
  const [state, setState] = useState<KeySectionState>({
    keys: [""], showKeys: [false], savedCount: 0, saving: false, saved: false, fetching: true,
  });

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    "x-admin-token": token,
  }), [token]);

  useEffect(() => {
    fetch(`/api/settings/${endpoint}`, { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error("unauthorized");
        return r.json();
      })
      .then((d: { count: number }) => setState((s) => ({ ...s, savedCount: d.count, fetching: false })))
      .catch(() => setState((s) => ({ ...s, fetching: false })));
  }, [endpoint, headers]);

  const addKey = () => setState((s) => ({ ...s, keys: [...s.keys, ""], showKeys: [...s.showKeys, false] }));
  const removeKey = (i: number) => setState((s) => ({
    ...s,
    keys: s.keys.filter((_, idx) => idx !== i),
    showKeys: s.showKeys.filter((_, idx) => idx !== i),
  }));
  const updateKey = (i: number, val: string) => setState((s) => ({
    ...s, keys: s.keys.map((k, idx) => (idx === i ? val : k)),
  }));
  const toggleShow = (i: number) => setState((s) => ({
    ...s, showKeys: s.showKeys.map((v, idx) => (idx === i ? !v : v)),
  }));

  return { state, setState, addKey, removeKey, updateKey, toggleShow, headers };
}

interface ApiKeySectionProps {
  title: string;
  subtitle: string;
  endpoint: string;
  token: string;
  placeholder: string;
  iconColor: string;
  iconBg: string;
  accentColor: string;
  docsUrl: string;
  docsLabel: string;
  infoLines: Array<{ label: string; text: string }>;
}

function ApiKeySection({
  title, subtitle, endpoint, token, placeholder,
  iconColor, iconBg, accentColor, docsUrl, docsLabel, infoLines,
}: ApiKeySectionProps) {
  const { toast } = useToast();
  const { state, setState, addKey, removeKey, updateKey, toggleShow, headers } = useKeySection(endpoint, token);

  const validKeys = state.keys.filter((k) => k.trim().length > 10);

  const handleSave = async () => {
    const cleaned = state.keys.map((k) => k.trim()).filter(Boolean);
    if (!cleaned.length) {
      toast({ title: "No keys entered", description: "Add at least one key.", variant: "destructive" });
      return;
    }
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = await fetch(`/api/settings/${endpoint}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ keys: cleaned }),
      });
      if (res.status === 401) {
        toast({ title: "Session expired", description: "Please re-enter your password.", variant: "destructive" });
        return;
      }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { saved: number };
      setState((s) => ({ ...s, savedCount: data.saved, saved: true, keys: [""], showKeys: [false] }));
      toast({ title: `${data.saved} key${data.saved > 1 ? "s" : ""} saved!` });
      setTimeout(() => setState((s) => ({ ...s, saved: false })), 3000);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setState((s) => ({ ...s, saving: false }));
    }
  };

  const handleClear = async () => {
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = await fetch(`/api/settings/${endpoint}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ keys: [] }),
      });
      if (res.status === 401) {
        toast({ title: "Session expired", variant: "destructive" });
        return;
      }
      setState((s) => ({ ...s, savedCount: 0, keys: [""], showKeys: [false] }));
      toast({ title: "All keys removed" });
    } catch {
      toast({ title: "Failed to clear", variant: "destructive" });
    } finally {
      setState((s) => ({ ...s, saving: false }));
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border", iconBg)}>
            <Key className={cn("w-4 h-4", iconColor)} />
          </div>
          <div>
            <div className="font-semibold text-sm">{title}</div>
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        <a href={docsUrl} target="_blank" rel="noopener noreferrer"
          className={cn("flex items-center gap-1.5 text-xs font-semibold transition-colors", accentColor)}>
          {docsLabel} <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="px-5 pt-4">
        <div className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
          state.savedCount > 0
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-muted/30 border-border text-muted-foreground"
        )}>
          {state.fetching
            ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking saved keys…</>
            : state.savedCount > 0
              ? <><CheckCircle className="w-3.5 h-3.5" /> {state.savedCount} key{state.savedCount > 1 ? "s" : ""} active — rotating on quota limits</>
              : <><Key className="w-3.5 h-3.5" /> No keys saved yet</>}
        </div>
      </div>

      <div className="p-5 space-y-3">
        {state.keys.map((k, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type={state.showKeys[i] ? "text" : "password"}
                value={k}
                onChange={(e) => updateKey(i, e.target.value)}
                placeholder={`${placeholder} ${i + 1}`}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono pr-10 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/50 placeholder:font-sans"
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" onClick={() => toggleShow(i)} tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {state.showKeys[i] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            {state.keys.length > 1 && (
              <button onClick={() => removeKey(i)}
                className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addKey}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors py-1">
          <Plus className="w-4 h-4" /> Add another key
        </button>
      </div>

      <div className="px-5 py-4 border-t border-border bg-muted/10 flex items-center gap-3">
        {state.savedCount > 0 && (
          <button onClick={handleClear} disabled={state.saving}
            className="text-xs font-semibold text-muted-foreground hover:text-red-400 transition-colors">
            Clear all saved keys
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {validKeys.length} key{validKeys.length !== 1 ? "s" : ""} ready to save
          </span>
          <button onClick={handleSave} disabled={state.saving || validKeys.length === 0}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all",
              state.saved
                ? "bg-emerald-500 text-white"
                : validKeys.length > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
                  : "bg-primary/30 text-primary-foreground/50 cursor-not-allowed"
            )}>
            {state.saved ? <><CheckCircle className="w-4 h-4" /> Saved!</>
              : state.saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</>
                : <><Save className="w-4 h-4" /> Save Keys</>}
          </button>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="bg-muted/20 border border-border rounded-xl p-3 text-xs text-muted-foreground space-y-1 leading-relaxed">
          {infoLines.map((line, i) => (
            <p key={i}><strong className="text-foreground">{line.label}</strong> {line.text}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Settings page ────────────────────────────────────────────────────────

export default function Settings() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));

  const handleUnlock = (t: string) => setToken(t);

  const handleLock = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken(null);
  };

  if (!token) {
    return <PasswordGate onUnlock={handleUnlock} />;
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <button onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shadow-md">
              <SettingsIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </span>
              </div>
              <p className="text-sm text-muted-foreground">Manage API keys — only visible to admins</p>
            </div>
          </div>
          <button
            onClick={handleLock}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-muted/30 transition-all"
            title="Lock settings"
          >
            <LogOut className="w-3.5 h-3.5" /> Lock
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-6 text-sm text-blue-300">
        <Zap className="w-4 h-4 mt-0.5 shrink-0" />
        <span>Keys rotate automatically — when one hits its daily limit the next key takes over, keeping everything running 24/7.</span>
      </div>

      <div className="space-y-6">
        <ApiKeySection
          title="Gemini API Keys"
          subtitle="Powers OCR text extraction — free & high accuracy"
          endpoint="gemini-keys"
          token={token}
          placeholder="AIzaSy… — Gemini key"
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10 border-blue-500/20"
          accentColor="text-blue-400 hover:text-blue-300"
          docsUrl="https://aistudio.google.com/app/apikey"
          docsLabel="Get free keys"
          infoLines={[
            { label: "Free tier:", text: "~1,500 OCR requests/day per key. 3 keys = ~4,500/day." },
            { label: "Used for:", text: "OCR text extraction (primary engine)." },
            { label: "Security:", text: "Keys stored only on this server." },
          ]}
        />

        <ApiKeySection
          title="AI/ML API Keys"
          subtitle="Access to 200+ models — GPT, Llama, Flux, Sora, and more"
          endpoint="aiml-keys"
          token={token}
          placeholder="Key — from aimlapi.com"
          iconColor="text-violet-400"
          iconBg="bg-violet-500/10 border-violet-500/20"
          accentColor="text-violet-400 hover:text-violet-300"
          docsUrl="https://aimlapi.com/app/api-keys"
          docsLabel="Get keys"
          infoLines={[
            { label: "Used for:", text: "OCR fallback (GPT-4o vision) when Gemini quota is reached." },
            { label: "Models:", text: "GPT-4o, Llama 3.2 Vision, Qwen-VL, and 200+ others via a single API." },
            { label: "Rotation:", text: "Add multiple keys — the app rotates through them when one hits its limit." },
          ]}
        />
      </div>
    </div>
  );
}
