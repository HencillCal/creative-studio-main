import React, { useState, useRef, useCallback } from "react";
import {
  Crop, Upload, Download, Loader2, X, Check, ArrowLeft,
  Monitor, Tablet, Smartphone, Sliders, Eye, Play, Pause, Maximize2,
  LayoutGrid, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type ResizeResult = {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

type Platform = {
  id: string;
  label: string;
  dimensions: string;
  ratio: string;
  icon: string;
  w: number;
  h: number;
  color: string;
  bg: string;
};

const SOCIAL_PLATFORMS: Platform[] = [
  { id: "youtube",   label: "YouTube",        dimensions: "1920×1080", ratio: "16:9",   icon: "▶",  w: 1920, h: 1080, color: "#FF0000", bg: "from-red-600/20 to-red-900/10" },
  { id: "tiktok",    label: "TikTok",          dimensions: "1080×1920", ratio: "9:16",   icon: "♪",  w: 1080, h: 1920, color: "#69C9D0", bg: "from-cyan-500/20 to-pink-600/10" },
  { id: "instagram", label: "Instagram",      dimensions: "1080×1080", ratio: "1:1",    icon: "⬡",  w: 1080, h: 1080, color: "#E1306C", bg: "from-pink-600/20 to-purple-700/10" },
  { id: "twitter",   label: "Twitter / X",    dimensions: "1280×720",  ratio: "16:9",   icon: "✕",  w: 1280, h: 720,  color: "#1DA1F2", bg: "from-sky-500/20 to-blue-900/10" },
  { id: "facebook",  label: "Facebook",       dimensions: "1080×1350", ratio: "4:5",    icon: "f",  w: 1080, h: 1350, color: "#1877F2", bg: "from-blue-600/20 to-blue-900/10" },
];

const DEVICE_PLATFORMS: Platform[] = [
  { id: "desktop_fhd",      label: "Desktop Full HD",  dimensions: "1920×1080", ratio: "16:9",   icon: "FHD", w: 1920, h: 1080, color: "#a78bfa", bg: "from-violet-500/20 to-violet-900/10" },
  { id: "desktop_4k",       label: "Desktop 4K",       dimensions: "3840×2160", ratio: "16:9",   icon: "4K",  w: 3840, h: 2160, color: "#a78bfa", bg: "from-violet-500/20 to-violet-900/10" },
  { id: "tablet_landscape",  label: "Tablet Landscape", dimensions: "2048×1536", ratio: "4:3",    icon: "TAB", w: 2048, h: 1536, color: "#34d399", bg: "from-emerald-500/20 to-emerald-900/10" },
  { id: "tablet_portrait",   label: "Tablet Portrait",  dimensions: "1536×2048", ratio: "3:4",    icon: "TAB", w: 1536, h: 2048, color: "#34d399", bg: "from-emerald-500/20 to-emerald-900/10" },
  { id: "phone_portrait",    label: "Phone Portrait",   dimensions: "1170×2532", ratio: "9:19.5", icon: "PH↑", w: 1170, h: 2532, color: "#f59e0b", bg: "from-amber-500/20 to-amber-900/10" },
  { id: "phone_landscape",   label: "Phone Landscape",  dimensions: "2532×1170", ratio: "19.5:9", icon: "PH↔", w: 2532, h: 1170, color: "#f59e0b", bg: "from-amber-500/20 to-amber-900/10" },
];

const ALL_PLATFORMS = [...SOCIAL_PLATFORMS, ...DEVICE_PLATFORMS];

function PlatformIcon({ id }: { id: string }) {
  if (id.startsWith("desktop")) return <Monitor className="w-3.5 h-3.5" />;
  if (id.startsWith("tablet"))  return <Tablet  className="w-3.5 h-3.5" />;
  if (id.startsWith("phone"))   return <Smartphone className="w-3.5 h-3.5" />;
  return null;
}

// ── Aspect ratio visual ────────────────────────────────────────────────────────
function RatioVisual({ w, h, size = 28 }: { w: number; h: number; size?: number }) {
  const aspect = w / h;
  let rw: number, rh: number;
  if (aspect >= 1) { rw = size; rh = Math.max(10, Math.round(size / aspect)); }
  else             { rh = size; rw = Math.max(10, Math.round(size * aspect)); }
  return (
    <div
      className="rounded border-2 border-current opacity-60 shrink-0"
      style={{ width: rw, height: rh }}
    />
  );
}

// ── Preview modal ──────────────────────────────────────────────────────────────
type CropX = "left" | "center" | "right";
type CropY = "top" | "center" | "bottom";
type PadColor = "black" | "white";

function PreviewModal({
  open, onClose, onApply,
  mediaUrl, isVideo, targetW, targetH, mode, label,
  initCropX, initCropY, initPadColor,
}: {
  open: boolean; onClose: () => void;
  onApply: (cropX: CropX, cropY: CropY, padColor: PadColor) => void;
  mediaUrl: string; isVideo: boolean;
  targetW: number; targetH: number;
  mode: "crop" | "pad"; label: string;
  initCropX: CropX; initCropY: CropY; initPadColor: PadColor;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cropX, setCropX] = useState<CropX>(initCropX);
  const [cropY, setCropY] = useState<CropY>(initCropY);
  const [padColor, setPadColor] = useState<PadColor>(initPadColor);

  const MAX = 440;
  const aspect = targetW / targetH;
  const dispW = aspect >= 1 ? MAX : Math.round(MAX * aspect);
  const dispH = aspect >= 1 ? Math.round(MAX / aspect) : MAX;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else { v.play().catch(() => {}); setPlaying(true); }
  };

  const bgStyle = mode === "pad" ? { background: padColor === "white" ? "#ffffff" : "#000000" } : {};
  const mediaStyle: React.CSSProperties = {
    width: "100%", height: "100%",
    objectFit: mode === "crop" ? "cover" : "contain",
    objectPosition: mode === "crop" ? `${cropX} ${cropY}` : "center",
    display: "block",
  };

  const cropPositions: { x: CropX; y: CropY; label: string }[] = [
    { x: "left",   y: "top",    label: "↖" }, { x: "center", y: "top",    label: "↑" }, { x: "right",  y: "top",    label: "↗" },
    { x: "left",   y: "center", label: "←" }, { x: "center", y: "center", label: "●" }, { x: "right",  y: "center", label: "→" },
    { x: "left",   y: "bottom", label: "↙" }, { x: "center", y: "bottom", label: "↓" }, { x: "right",  y: "bottom", label: "↘" },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="font-bold text-sm">Preview — {label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{targetW}×{targetH} · {mode === "crop" ? "Crop to Fill" : "Fit with Padding"}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex justify-center">
            <div className="relative rounded-xl overflow-hidden border border-border shadow-inner" style={{ width: dispW, height: dispH, ...bgStyle }}>
              {isVideo ? (
                <>
                  <video ref={videoRef} src={mediaUrl} style={mediaStyle} loop playsInline onEnded={() => setPlaying(false)} />
                  <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center group">
                    <div className={cn("rounded-full p-3 bg-black/60 text-white transition-all", playing ? "opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100" : "opacity-100")}>
                      {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                    </div>
                  </button>
                </>
              ) : (
                <img src={mediaUrl} alt="preview" style={mediaStyle} />
              )}
            </div>
          </div>

          {mode === "crop" && (
            <div className="bg-muted/20 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Crop Position</Label>
                <span className="text-xs text-muted-foreground capitalize">{cropY} {cropX}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="grid grid-cols-3 gap-1.5 shrink-0">
                  {cropPositions.map((pos) => {
                    const active = cropX === pos.x && cropY === pos.y;
                    return (
                      <button key={`${pos.x}-${pos.y}`} onClick={() => { setCropX(pos.x); setCropY(pos.y); }}
                        className={cn("w-9 h-9 rounded-lg text-sm font-bold border transition-all",
                          active ? "bg-primary border-primary text-primary-foreground" : "bg-muted/40 border-border text-muted-foreground hover:border-primary/50 hover:bg-primary/10"
                        )} title={`${pos.y} ${pos.x}`}
                      >{pos.label}</button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">Click a position to control which part of the media stays in frame after cropping.</p>
              </div>
            </div>
          )}

          {mode === "pad" && (
            <div className="bg-muted/20 border border-border rounded-xl p-4 space-y-3">
              <Label className="text-sm font-semibold">Background Color</Label>
              <div className="flex gap-2">
                {(["black", "white"] as PadColor[]).map((c) => (
                  <button key={c} onClick={() => setPadColor(c)}
                    className={cn("flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all",
                      padColor === c ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <span className="w-4 h-4 rounded border border-border" style={{ background: c === "white" ? "#fff" : "#000" }} />
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                    {padColor === c && <Check className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Export will be full <span className="font-semibold text-foreground">{targetW}×{targetH}px</span>. Adjust above, then apply.
          </p>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <Button onClick={() => { onApply(cropX, cropY, padColor); onClose(); }} className="flex-1">
            <Check className="w-4 h-4 mr-2" />Apply & Close
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Dimension resolver ─────────────────────────────────────────────────────────
function resolveVal(raw: string, sourceDim: number | null): number | null {
  const v = raw.trim();
  if (v.endsWith("%")) {
    const pct = parseFloat(v);
    if (isNaN(pct) || pct <= 0 || pct > 500) return null;
    if (!sourceDim) return null;
    return Math.max(1, Math.min(8000, Math.round(sourceDim * pct / 100)));
  }
  const px = parseInt(v, 10);
  if (isNaN(px) || px < 1 || px > 8000) return null;
  return px;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AspectResizer() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState("youtube");
  const [mode, setMode] = useState<"crop" | "pad">("crop");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResizeResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceW, setSourceW] = useState<number | null>(null);
  const [sourceH, setSourceH] = useState<number | null>(null);
  const [customW, setCustomW] = useState("800");
  const [customH, setCustomH] = useState("600");
  const [activeTab, setActiveTab] = useState<"social" | "device" | "custom">("social");
  const [showPreview, setShowPreview] = useState(false);
  const [showPlatformSidebar, setShowPlatformSidebar] = useState(false);
  const [cropX, setCropX] = useState<CropX>("center");
  const [cropY, setCropY] = useState<CropY>("center");
  const [padColor, setPadColor] = useState<PadColor>("black");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/") && !f.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image or video file.", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(f);
    setFile(f); setResult(null); setPreviewUrl(url); setSourceW(null); setSourceH(null);
    if (f.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => { setSourceW(img.naturalWidth); setSourceH(img.naturalHeight); };
      img.src = url;
    } else {
      const vid = document.createElement("video");
      vid.onloadedmetadata = () => { setSourceW(vid.videoWidth); setSourceH(vid.videoHeight); };
      vid.src = url;
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleResize = async () => {
    if (!file) return;
    const w = resolveVal(customW, sourceW);
    const h = resolveVal(customH, sourceH);
    if (activeTab === "custom") {
      const needsSrc = customW.trim().endsWith("%") || customH.trim().endsWith("%");
      if (needsSrc && (!sourceW || !sourceH)) {
        toast({ title: "Source dimensions unknown", description: "Wait for the file to fully load before using % values.", variant: "destructive" });
        return;
      }
      if (!w || !h) {
        toast({ title: "Invalid dimensions", description: "Enter a pixel value (e.g. 800) or percentage (e.g. 50%). Max 8000px.", variant: "destructive" });
        return;
      }
    }
    setLoading(true); setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode);
      formData.append("cropX", cropX);
      formData.append("cropY", cropY);
      formData.append("padColor", padColor);
      if (activeTab === "custom") {
        formData.append("platform", "custom");
        formData.append("customWidth", String(w));
        formData.append("customHeight", String(h));
      } else {
        formData.append("platform", platform);
      }
      const response = await fetch("/api/media/resize", { method: "POST", body: formData });
      if (!response.ok) { const err = await response.json(); throw new Error(err.message || "Resize failed"); }
      const data: ResizeResult = await response.json();
      setResult(data);
      toast({ title: "Resize complete!", description: `${formatBytes(data.size || 0)} — ready to download.` });
    } catch (err: unknown) {
      toast({ title: "Resize failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = `/api/media/download/${result.fileId}`;
    a.download = result.filename;
    a.click();
  };

  const clearFile = () => { setFile(null); setPreviewUrl(null); setResult(null); };

  const isVideo = file?.type.startsWith("video/");
  const selectedPlatform = ALL_PLATFORMS.find(p => p.id === platform);
  const resolvedCustomW = resolveVal(customW, sourceW);
  const resolvedCustomH = resolveVal(customH, sourceH);
  const displayDims = activeTab === "custom"
    ? `${customW || "?"}×${customH || "?"} px`
    : selectedPlatform ? `${selectedPlatform.dimensions} · ${selectedPlatform.ratio}` : "";
  const previewTargetW = activeTab === "custom" ? (resolvedCustomW ?? 800) : (selectedPlatform?.w ?? 1920);
  const previewTargetH = activeTab === "custom" ? (resolvedCustomH ?? 600) : (selectedPlatform?.h ?? 1080);
  const previewLabel   = activeTab === "custom" ? `${customW}×${customH} px` : (selectedPlatform?.label ?? "");

  return (
    <div className="min-h-screen p-6 lg:p-8">
      {/* ── Header ── */}
      <div className="max-w-6xl mx-auto mb-8">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Crop className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Aspect Ratio Resizer</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Resize images & videos for any platform — pixel-perfect every time</p>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2">
            {["16:9", "9:16", "1:1", "4:5"].map(r => (
              <div key={r} className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-muted/40 border border-border text-muted-foreground">
                {r}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Upload zone (no file) ── */}
      {!file ? (
        <div className="max-w-3xl mx-auto">
          <div
            className={cn(
              "relative rounded-2xl border-2 border-dashed p-14 text-center cursor-pointer transition-all duration-300 overflow-hidden group",
              isDragging
                ? "border-primary bg-primary/8 scale-[1.01]"
                : "border-border hover:border-primary/60 hover:bg-primary/3"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            data-testid="resize-upload-zone"
          >
            {/* Subtle background glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-cyan-500/5 pointer-events-none" />

            <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

            <div className="relative">
              {/* Icon */}
              <div className={cn(
                "w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all duration-300",
                isDragging
                  ? "bg-primary text-primary-foreground scale-110 shadow-xl shadow-primary/30"
                  : "bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20 text-blue-400 group-hover:scale-105"
              )}>
                <Upload className="w-9 h-9" />
              </div>

              <p className="font-bold text-xl mb-2 text-foreground">
                {isDragging ? "Drop it here" : "Drop your file here"}
              </p>
              <p className="text-muted-foreground text-sm mb-6">
                or <span className="text-primary font-semibold underline underline-offset-2">browse to upload</span>
              </p>

              {/* Format badges */}
              <div className="flex flex-wrap justify-center gap-1.5 mb-6">
                {["JPG", "PNG", "WebP", "HEIC", "AVIF", "GIF", "MP4", "MOV", "WebM", "AVI", "MKV"].map(f => (
                  <span key={f} className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-border bg-muted/30 text-muted-foreground">
                    {f}
                  </span>
                ))}
              </div>

              {/* Platform pill previews */}
              <div className="flex flex-wrap justify-center gap-2">
                {SOCIAL_PLATFORMS.map(p => (
                  <div key={p.id} className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border border-border bg-muted/20 text-muted-foreground">
                    <span style={{ color: p.color }}>{p.icon}</span>
                    {p.label}
                    <span className="font-mono opacity-60">{p.ratio}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Single-column layout + sliding platform sidebar ── */
        <div className="max-w-3xl mx-auto space-y-4">

          {/* ── Media preview card ── */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="relative bg-[#0a0a12] flex items-center justify-center min-h-[220px] max-h-[420px] overflow-hidden">
              {isVideo ? (
                <video src={previewUrl || undefined} className="max-h-[420px] max-w-full object-contain" muted />
              ) : (
                <img src={previewUrl || undefined} alt="preview" className="max-h-[420px] max-w-full object-contain" />
              )}
              <button onClick={clearFile}
                className="absolute top-3 right-3 p-2 bg-black/60 rounded-xl text-white hover:bg-black/80 transition-colors backdrop-blur-sm border border-white/10"
                data-testid="resize-clear-btn"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="absolute top-3 left-3">
                <Badge variant="secondary" className="text-[10px] backdrop-blur-sm bg-black/50 border-white/10 text-white/80">
                  {isVideo ? "Video" : "Image"}
                </Badge>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-3 bg-muted/20 border-t border-border">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Maximize2 className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}{sourceW && sourceH ? ` · ${sourceW}×${sourceH}px` : ""}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowPreview(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors shrink-0"
                data-testid="resize-preview-btn"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview output
              </button>
            </div>
          </div>

          {/* ── Output summary bar ── */}
          {displayDims && (
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-primary">
                  <RatioVisual w={previewTargetW} h={previewTargetH} size={32} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Output dimensions</p>
                  <p className="text-sm font-bold font-mono">{displayDims}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">
                  {mode === "crop" ? "Crop to Fill" : "Fit with Padding"}
                </Badge>
                {/* Platform chip */}
                {activeTab !== "custom" && selectedPlatform && (
                  <button
                    onClick={() => setShowPlatformSidebar(true)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    <span style={{ color: (selectedPlatform as Platform & { color: string }).color }}>
                      {(selectedPlatform as Platform & { icon: string }).icon}
                    </span>
                    {selectedPlatform.label}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Resize mode ── */}
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold">Resize Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("crop")}
                className={cn("relative p-3.5 rounded-xl border text-left transition-all overflow-hidden",
                  mode === "crop" ? "border-primary bg-primary/8" : "border-border hover:border-border/80 hover:bg-muted/20"
                )}
                data-testid="mode-crop"
              >
                {mode === "crop" && <div className="absolute top-2 right-2"><Check className="w-3.5 h-3.5 text-primary" /></div>}
                <div className="w-10 h-7 rounded-md bg-primary/30 border border-primary/50 mb-2.5 overflow-hidden relative">
                  <div className="absolute inset-0 bg-primary/20" />
                  <div className="absolute inset-[-20%] bg-primary/40" />
                </div>
                <div className="font-semibold text-xs mb-0.5">Crop to Fill</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Fills the frame. Edges may be trimmed.</p>
              </button>
              <button onClick={() => setMode("pad")}
                className={cn("relative p-3.5 rounded-xl border text-left transition-all overflow-hidden",
                  mode === "pad" ? "border-primary bg-primary/8" : "border-border hover:border-border/80 hover:bg-muted/20"
                )}
                data-testid="mode-pad"
              >
                {mode === "pad" && <div className="absolute top-2 right-2"><Check className="w-3.5 h-3.5 text-primary" /></div>}
                <div className="w-10 h-7 rounded-md bg-muted/60 border border-border mb-2.5 flex items-center justify-center">
                  <div className="w-5 h-4 rounded-sm bg-primary/40 border border-primary/30" />
                </div>
                <div className="font-semibold text-xs mb-0.5">Fit with Padding</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">Whole image visible. Bars added.</p>
              </button>
            </div>
          </div>

          {/* ── Action + success ── */}
          <Button onClick={handleResize} disabled={loading}
            className="w-full h-11 font-semibold text-sm rounded-xl"
            data-testid="resize-convert-btn"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resizing…</>
              : <><Crop className="w-4 h-4 mr-2" />Resize Now</>
            }
          </Button>

          {result && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Check className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-emerald-300">Resize complete</p>
                  <p className="text-xs text-muted-foreground">{result.filename} · {formatBytes(result.size)}</p>
                </div>
              </div>
              <Button size="sm" onClick={handleDownload} data-testid="resize-download-btn"
                className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 shrink-0">
                <Download className="w-3.5 h-3.5 mr-1.5" />Download
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Platform sidebar toggle button (fixed right edge) ── */}
      {file && (
        <button
          onClick={() => setShowPlatformSidebar(v => !v)}
          className={cn(
            "fixed top-1/2 -translate-y-1/2 right-0 z-40 flex flex-col items-center gap-1.5 py-4 px-2.5 rounded-l-2xl border-l border-t border-b transition-all duration-300 shadow-xl",
            showPlatformSidebar
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
          title="Target Platform"
        >
          <LayoutGrid className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            Platform
          </span>
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-300", showPlatformSidebar && "rotate-180")} />
        </button>
      )}

      {/* ── Platform sidebar backdrop ── */}
      {showPlatformSidebar && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowPlatformSidebar(false)}
        />
      )}

      {/* ── Platform sidebar panel ── */}
      <div className={cn(
        "fixed top-0 right-0 h-full z-50 w-[340px] bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
        showPlatformSidebar ? "translate-x-0" : "translate-x-full"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-sm">Target Platform</p>
              <p className="text-[11px] text-muted-foreground">Choose output size</p>
            </div>
          </div>
          <button onClick={() => setShowPlatformSidebar(false)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="px-4 pt-4 shrink-0">
          <div className="flex gap-1 p-1 bg-muted/30 rounded-xl border border-border">
            {([
              { key: "social", label: "Social" },
              { key: "device", label: "Device" },
              { key: "custom", label: "Custom" },
            ] as { key: typeof activeTab; label: string }[]).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={cn("flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all",
                  activeTab === tab.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >{tab.label}</button>
            ))}
          </div>
        </div>

        {/* Platform list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">

          {activeTab === "social" && SOCIAL_PLATFORMS.map((p) => (
            <button key={p.id} onClick={() => { setPlatform(p.id); setShowPlatformSidebar(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all",
                platform === p.id ? "border-primary/60 bg-primary/8" : "border-border hover:border-border/80 hover:bg-muted/20"
              )}
              data-testid={`platform-${p.id}`}
            >
              <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-base font-black shrink-0", p.bg)}
                style={{ color: p.color }}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm">{p.label}</span>
                  {platform === p.id && <Check className="w-3 h-3 text-primary" />}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">{p.dimensions} · {p.ratio}</div>
              </div>
              <RatioVisual w={p.w} h={p.h} size={24} />
            </button>
          ))}

          {activeTab === "device" && DEVICE_PLATFORMS.map((p) => (
            <button key={p.id} onClick={() => { setPlatform(p.id); setShowPlatformSidebar(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all",
                platform === p.id ? "border-primary/60 bg-primary/8" : "border-border hover:border-border/80 hover:bg-muted/20"
              )}
              data-testid={`platform-${p.id}`}
            >
              <div className={cn("w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0", p.bg)}
                style={{ color: p.color }}>
                <PlatformIcon id={p.id} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm">{p.label}</span>
                  {platform === p.id && <Check className="w-3 h-3 text-primary" />}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">{p.dimensions} · {p.ratio}</div>
              </div>
              <RatioVisual w={p.w} h={p.h} size={24} />
            </button>
          ))}

          {activeTab === "custom" && (
            <div className="space-y-4 pt-1">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Label className="text-xs mb-1.5 block text-muted-foreground">Width</Label>
                  <Input type="text" value={customW} onChange={(e) => setCustomW(e.target.value)}
                    placeholder="1920 or 100%" className="font-mono" />
                </div>
                <div className="text-muted-foreground mt-5 font-bold text-lg">×</div>
                <div className="flex-1">
                  <Label className="text-xs mb-1.5 block text-muted-foreground">Height</Label>
                  <Input type="text" value={customH} onChange={(e) => setCustomH(e.target.value)}
                    placeholder="1080 or 100%" className="font-mono" />
                </div>
              </div>

              {resolvedCustomW && resolvedCustomH ? (
                <div className="flex items-center gap-2 text-xs bg-primary/8 rounded-lg px-3 py-2 border border-primary/20">
                  <Sliders className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <span className="font-mono font-semibold">{resolvedCustomW} × {resolvedCustomH} px</span>
                  <span className="text-muted-foreground">({(resolvedCustomW / resolvedCustomH).toFixed(2)})</span>
                </div>
              ) : (customW.includes("%") || customH.includes("%")) && !sourceW ? (
                <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                  Upload a file first to resolve % values.
                </div>
              ) : null}

              <div>
                <p className="text-[11px] text-muted-foreground mb-2 font-semibold uppercase tracking-wide">% of original</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {["25%", "50%", "75%", "100%", "150%", "200%"].map(pct => (
                    <button key={pct} onClick={() => { setCustomW(pct); setCustomH(pct); }}
                      className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors",
                        customW === pct && customH === pct
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                      )}
                    >{pct}</button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground mb-2 font-semibold uppercase tracking-wide">Pixel presets</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "HD", w: 1280, h: 720 }, { label: "Full HD", w: 1920, h: 1080 },
                    { label: "Square", w: 1080, h: 1080 }, { label: "4:3", w: 1024, h: 768 },
                    { label: "Portrait", w: 600, h: 900 }, { label: "Banner", w: 1200, h: 628 },
                  ].map(p => (
                    <button key={p.label} onClick={() => { setCustomW(String(p.w)); setCustomH(String(p.h)); }}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground"
                    >{p.label} ({p.w}×{p.h})</button>
                  ))}
                </div>
              </div>

              <Button onClick={() => setShowPlatformSidebar(false)} className="w-full" size="sm">
                <Check className="w-3.5 h-3.5 mr-1.5" />Apply Custom Size
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {file && previewUrl && (
        <PreviewModal
          open={showPreview}
          onClose={() => setShowPreview(false)}
          onApply={(x, y, pc) => { setCropX(x); setCropY(y); setPadColor(pc); }}
          mediaUrl={previewUrl}
          isVideo={!!isVideo}
          targetW={previewTargetW}
          targetH={previewTargetH}
          mode={mode}
          label={previewLabel}
          initCropX={cropX}
          initCropY={cropY}
          initPadColor={padColor}
        />
      )}
    </div>
  );
}
