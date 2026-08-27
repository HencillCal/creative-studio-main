import { useState, useRef, useCallback, useEffect } from "react";
import { Film, Upload, Download, Loader2, X, Info, ArrowLeft, Play, Pause, Scissors, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type ConvertResult = { fileId: string; filename: string; size: number; mimeType: string; };

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function Timeline({
  duration, startTime, endTime, currentTime,
  onStartChange, onEndChange, onSeek,
}: {
  duration: number; startTime: number; endTime: number; currentTime: number;
  onStartChange: (t: number) => void; onEndChange: (t: number) => void; onSeek: (t: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "seek" | null>(null);
  const pct = (t: number) => Math.max(0, Math.min(100, (t / duration) * 100));
  const timeFromEvent = (e: MouseEvent | React.MouseEvent) => {
    const rail = railRef.current;
    if (!rail) return 0;
    const rect = rail.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };
  const onMouseDown = (e: React.MouseEvent, type: "start" | "end" | "seek") => {
    e.preventDefault();
    dragging.current = type;
    if (type === "seek") onSeek(timeFromEvent(e));
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const t = timeFromEvent(e);
      if (dragging.current === "start") onStartChange(Math.min(t, endTime - 0.5));
      else if (dragging.current === "end") onEndChange(Math.max(t, startTime + 0.5));
      else onSeek(t);
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [startTime, endTime, onStartChange, onEndChange, onSeek]);

  return (
    <div className="select-none">
      <div ref={railRef} className="relative h-8 rounded-lg bg-muted/40 border border-border cursor-crosshair"
        onMouseDown={(e) => onMouseDown(e, "seek")}>
        <div className="absolute inset-y-0 left-0 rounded-l-lg bg-black/20" style={{ width: `${pct(startTime)}%` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-lg bg-black/20" style={{ width: `${100 - pct(endTime)}%` }} />
        <div className="absolute inset-y-0 bg-primary/30 border-y border-primary/60"
          style={{ left: `${pct(startTime)}%`, width: `${pct(endTime) - pct(startTime)}%` }} />
        <div className="absolute inset-y-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize z-10 group"
          style={{ left: `${pct(startTime)}%` }}
          onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, "start"); }}>
          <div className="w-3 h-full bg-primary rounded-l border-r border-primary/60 group-hover:bg-primary/80 transition-colors" />
        </div>
        <div className="absolute inset-y-0 w-3 -mr-1.5 flex items-center justify-center cursor-ew-resize z-10 group"
          style={{ left: `${pct(endTime)}%` }}
          onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, "end"); }}>
          <div className="w-3 h-full bg-primary rounded-r border-l border-primary/60 group-hover:bg-primary/80 transition-colors" />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white/80 pointer-events-none z-20" style={{ left: `${pct(currentTime)}%` }} />
        <div className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
          style={{ left: `${pct(startTime)}%`, width: `${pct(endTime) - pct(startTime)}%` }}>
          <span className="text-[10px] font-mono text-primary-foreground/80 bg-primary/60 rounded px-1">
            {(endTime - startTime).toFixed(1)}s
          </span>
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
        <span>{formatTime(0)}</span>
        <span className="text-primary font-semibold">{formatTime(startTime)} → {formatTime(endTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export default function GifConverter() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(10);
  const [currentTime, setCurrentTime] = useState(0);
  const [fps, setFps] = useState(10);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const [videoNativeW, setVideoNativeW] = useState(0);
  const [videoNativeH, setVideoNativeH] = useState(0);
  const [originalSize, setOriginalSize] = useState(true);
  const [gifWidth, setGifWidth] = useState(480);
  const [gifHeight, setGifHeight] = useState(270);
  const [keepAspectRatio, setKeepAspectRatio] = useState(true);
  const [loopCount, setLoopCount] = useState<"infinite" | "once" | "custom">("infinite");
  const [quality, setQuality] = useState(80);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) {
      toast({ title: "Invalid file", description: "Please upload a video file.", variant: "destructive" });
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast({ title: "File too large", description: `Maximum size is 10 MB. Your file is ${formatBytes(f.size)}.`, variant: "destructive" });
      return;
    }
    setFile(f);
    setResult(null);
    setVideoUrl(URL.createObjectURL(f));
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      const w = videoRef.current.videoWidth;
      const h = videoRef.current.videoHeight;
      setVideoDuration(dur);
      setStartTime(0);
      setEndTime(Math.min(dur, 10));
      setVideoNativeW(w);
      setVideoNativeH(h);
      setGifWidth(w);
      setGifHeight(h);
    }
  };

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = t;
      setIsPlaying(false);
    }
  }, []);

  const handleStartChange = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, endTime - 0.5));
    setStartTime(clamped);
    seekTo(clamped);
  }, [endTime, seekTo]);

  const handleEndChange = useCallback((t: number) => {
    const clamped = Math.min(videoDuration, Math.max(t, startTime + 0.5));
    setEndTime(clamped);
    seekTo(clamped);
  }, [startTime, videoDuration, seekTo]);

  const setCurrentAsStart = () => setStartTime(Math.min(currentTime, endTime - 0.5));
  const setCurrentAsEnd = () => setEndTime(Math.max(currentTime, startTime + 0.5));

  const togglePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
      return;
    }
    video.currentTime = startTime;
    video.play().catch(() => {});
    setIsPlaying(true);
    previewIntervalRef.current = setInterval(() => {
      if (!video) return;
      if (video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlaying(false);
        if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
      }
    }, 100);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, [videoUrl]);

  const handleConvert = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("startTime", String(startTime));
      formData.append("endTime", String(endTime));
      formData.append("fps", String(fps));
      const response = await fetch("/api/media/gif-convert", { method: "POST", body: formData });
      if (!response.ok) {
        let message = `Server error (${response.status})`;
        try { const err = await response.json(); message = err.message || message; } catch {}
        throw new Error(message);
      }
      const data: ConvertResult = await response.json();
      setResult(data);
      toast({ title: "GIF ready!", description: `${formatBytes(data.size || 0)} — click download to save.` });
    } catch (err: unknown) {
      toast({ title: "Conversion failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const clearFile = () => {
    if (previewIntervalRef.current) clearInterval(previewIntervalRef.current);
    setFile(null); setVideoUrl(null); setResult(null);
    setVideoDuration(0); setStartTime(0); setEndTime(10);
    setCurrentTime(0); setIsPlaying(false);
    setVideoNativeW(0); setVideoNativeH(0);
  };

  const segmentDuration = endTime - startTime;
  const estimatedSizeKb = Math.round(segmentDuration * fps * (originalSize ? videoNativeW : gifWidth) * 0.012);

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 max-w-screen-xl w-full mx-auto px-4 sm:px-6 py-5">

        <div className="mb-5 shrink-0">
          <button onClick={() => window.history.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">GIF Converter</h1>
              <p className="text-sm text-muted-foreground">Upload a video, scrub to find your clip, convert to GIF</p>
            </div>
          </div>
        </div>

        {!file ? (
          <div className="flex-1 flex items-center justify-center">
          <div
            className={cn(
              "w-full border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all",
              isDragging ? "border-primary bg-primary/5 shadow-lg" : "border-border hover:border-primary/50 hover:bg-primary/5"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            data-testid="gif-upload-zone"
          >
            <input ref={inputRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              data-testid="gif-file-input" />
            <div className="w-16 h-16 bg-primary/10 border border-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-primary">
              <Upload className="w-7 h-7" />
            </div>
            <p className="font-bold text-base mb-1">Drop a video here or click to browse</p>
            <p className="text-sm text-muted-foreground mb-3">All video formats (MP4, MOV, WebM, AVI, MKV…) — up to 10 MB</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["MP4", "MOV", "WebM", "AVI", "MKV", "FLV", "TS", "3GP"].map(f => (
                <span key={f} className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-border bg-muted/40 text-muted-foreground">{f}</span>
              ))}
            </div>
          </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_380px] gap-5">

            {/* ── LEFT: Preview ── */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold">Preview Clip</span>
                <button onClick={clearFile}
                  className="p-1.5 bg-muted/30 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  data-testid="gif-clear-btn">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative bg-black aspect-video">
                <video ref={videoRef} src={videoUrl || undefined}
                  className="w-full h-full object-contain"
                  onLoadedMetadata={onVideoLoaded}
                  data-testid="gif-video-preview" />

                <button onClick={togglePreview}
                  className="absolute inset-0 flex items-center justify-center group">
                  <div className={cn(
                    "w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center transition-opacity",
                    isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"
                  )}>
                    {isPlaying ? <Pause className="w-7 h-7 text-white" /> : <Play className="w-7 h-7 text-white ml-1" />}
                  </div>
                </button>

                <div className="absolute bottom-2 right-2 text-xs font-mono bg-black/60 text-white rounded px-2 py-1">
                  {formatTime(currentTime)} / {formatTime(videoDuration)}
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border">
                <span className="truncate max-w-[200px] font-medium text-foreground/80">{file.name}</span>
                <span className="shrink-0 ml-2">{formatBytes(file.size)}</span>
              </div>
            </div>

            {/* ── RIGHT: Settings ── */}
            <div className="space-y-3 overflow-y-auto pb-4 pr-1">

              {/* Select Clip */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Select Clip</Label>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatTime(startTime)} → {formatTime(endTime)}
                    <span className="text-primary font-semibold ml-1">({segmentDuration.toFixed(1)}s)</span>
                  </span>
                </div>
                {videoDuration > 0 ? (
                  <Timeline duration={videoDuration} startTime={startTime} endTime={endTime}
                    currentTime={currentTime} onStartChange={handleStartChange}
                    onEndChange={handleEndChange} onSeek={seekTo} />
                ) : (
                  <div className="h-8 rounded-lg bg-muted/40 animate-pulse" />
                )}
                <div className="flex gap-2">
                  <button onClick={setCurrentAsStart}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors">
                    <Scissors className="w-3 h-3" /> Set Start Here
                  </button>
                  <button onClick={setCurrentAsEnd}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors">
                    <Scissors className="w-3 h-3 scale-x-[-1]" /> Set End Here
                  </button>
                </div>
              </div>

              {/* Frame Rate */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Frame Rate</Label>
                  <span className="text-xs font-semibold text-primary">{fps} fps</span>
                </div>
                <div className="flex gap-2">
                  {[5, 8, 10].map(f => (
                    <button key={f} onClick={() => setFps(f)}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                        fps === f ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                      )}>
                      {f} fps
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Smaller file</span>
                  <span>Smoothest (max for size)</span>
                </div>
              </div>

              {/* Dimensions */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Dimensions</Label>
                  <button onClick={() => setOriginalSize(o => !o)}
                    className={cn(
                      "text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all",
                      originalSize ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                    )}>
                    Original Size
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      value={originalSize ? videoNativeW || "" : gifWidth}
                      disabled={originalSize}
                      onChange={e => {
                        const v = parseInt(e.target.value) || 0;
                        setGifWidth(v);
                        if (keepAspectRatio && videoNativeW && videoNativeH) {
                          setGifHeight(Math.round(v * videoNativeH / videoNativeW));
                        }
                      }}
                      className="w-full bg-muted/30 border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-center disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary/60"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">px</span>
                  </div>
                  <span className="text-muted-foreground font-bold text-sm shrink-0">×</span>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      value={originalSize ? videoNativeH || "" : gifHeight}
                      disabled={originalSize}
                      onChange={e => {
                        const v = parseInt(e.target.value) || 0;
                        setGifHeight(v);
                        if (keepAspectRatio && videoNativeW && videoNativeH) {
                          setGifWidth(Math.round(v * videoNativeW / videoNativeH));
                        }
                      }}
                      className="w-full bg-muted/30 border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-center disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-primary/60"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none">px</span>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={keepAspectRatio}
                    onChange={e => setKeepAspectRatio(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <span className="text-xs text-muted-foreground">Keep aspect ratio</span>
                </label>
              </div>

              {/* Loop Count */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <Label className="text-sm font-semibold">Loop Count</Label>
                <div className="flex gap-2">
                  {(["infinite", "once", "custom"] as const).map(l => (
                    <button key={l} onClick={() => setLoopCount(l)}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize",
                        loopCount === l ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                      )}>
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
                {loopCount === "custom" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Repeat</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={3}
                      className="w-16 bg-muted/30 border border-border rounded-lg px-2 py-1 text-sm font-mono text-center focus:outline-none focus:border-primary/60"
                    />
                    <span className="text-xs text-muted-foreground">times</span>
                  </div>
                )}
              </div>

              {/* Quality */}
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Quality</Label>
                  <span className="text-xs font-semibold text-primary">{quality}%</span>
                </div>
                <div className="space-y-1.5">
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={quality}
                    onChange={e => setQuality(parseInt(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Low</span>
                    <span>Best Quality</span>
                  </div>
                </div>
              </div>

              {/* Tip */}
              <div className="bg-muted/20 border border-border rounded-xl p-3.5 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong>Max 10s clip · Auto size under 1MB</strong> — Drag the purple handles on the timeline to pick your clip. Clips are capped at 10 seconds and resolution auto-adjusts to keep the downloaded GIF under 1 MB.
                </p>
              </div>

              {/* Convert button */}
              <Button
                onClick={handleConvert}
                disabled={loading || segmentDuration < 0.5}
                className="w-full h-12 text-sm font-bold gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 border-0 shadow-lg shadow-violet-500/20"
                data-testid="gif-convert-btn"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Converting…</>
                ) : (
                  <><Film className="w-4 h-4" /> Convert to GIF ({segmentDuration.toFixed(1)}s)</>
                )}
              </Button>

              {!loading && !result && (
                <p className="text-center text-xs text-muted-foreground/60">
                  ~ {estimatedSizeKb > 1024 ? `${(estimatedSizeKb / 1024).toFixed(1)} MB` : `${estimatedSizeKb} KB`} estimated
                </p>
              )}

              {result && (
                <>
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <Film className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-emerald-400">GIF Ready</div>
                      <div className="text-xs text-muted-foreground truncate">{result.filename} — {formatBytes(result.size)}</div>
                    </div>
                  </div>
                  <Button variant="secondary" className="w-full gap-2"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = `/api/media/download/${result.fileId}`;
                      a.download = result.filename;
                      a.click();
                    }}
                    data-testid="gif-download-btn">
                    <Download className="w-4 h-4" />
                    Download GIF ({formatBytes(result.size)})
                  </Button>
                  <button onClick={() => setResult(null)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                    <RotateCcw className="w-3 h-3" /> Convert again
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
