import { useState, useRef, useCallback, useEffect } from "react";
import {
  ArrowLeft, Upload, X, ArrowUp, ArrowDown,
  Loader2, Download, CheckCircle2, AlertCircle,
  ChevronRight, Film, PictureInPicture2, Play, Pause,
  SkipBack, SkipForward, Volume2, VolumeX, Plus, ChevronDown, ChevronUp,
  Clapperboard, Music, Maximize2, Crop, SlidersHorizontal,
  Menu, Pencil, Scissors, Gauge, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type TransitionId = "none" | "fade" | "wipe" | "slide" | "zoom";
type MotionId = "none" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right";
type CornerPos = "tl" | "tr" | "bl" | "br";

type MainClip = {
  id: string; file: File; name: string; url: string;
  durationSec: number;
  trimIn: number; trimOut: number;
  transition: TransitionId; motion: MotionId;
};

type OverlayClip = {
  id: string; file: File; name: string; url: string;
  durationSec: number;
  trimIn: number; trimOut: number;
  x: number; y: number;
  scale: number; scaleX: number; scaleY: number;
  offsetTime: number;
  panX: number; panY: number;
};

type Selection = { type: "main" | "overlay"; id: string } | null;

const TRANSITIONS: { id: TransitionId; label: string; desc: string; icon: string }[] = [
  { id: "none",  label: "Cut",       desc: "Hard cut",   icon: "✂" },
  { id: "fade",  label: "Fade",      desc: "Crossfade",  icon: "◑" },
  { id: "wipe",  label: "Wipe",      desc: "Wipe left",  icon: "▶" },
  { id: "slide", label: "Slide",     desc: "Slide left", icon: "»" },
  { id: "zoom",  label: "Zoom blur", desc: "Zoom blur",  icon: "⊕" },
];

const MOTIONS: { id: MotionId; label: string; icon: string }[] = [
  { id: "none",     label: "None",       icon: "◼" },
  { id: "zoom_in",  label: "Zoom In",    icon: "🔍" },
  { id: "zoom_out", label: "Zoom Out",   icon: "🔎" },
  { id: "pan_left", label: "Pan Left",   icon: "◀" },
  { id: "pan_right",label: "Pan Right",  icon: "▶" },
];

const CORNERS: { id: CornerPos; label: string }[] = [
  { id: "tl", label: "Top Left" },
  { id: "tr", label: "Top Right" },
  { id: "bl", label: "Bottom Left" },
  { id: "br", label: "Bottom Right" },
];

const ASPECT_RATIOS: { id: string; w: number; h: number; label: string; hint: string }[] = [
  { id: "1:1", w: 1080, h: 1080, label: "1:1", hint: "Instagram / Facebook" },
  { id: "16:9", w: 1920, h: 1080, label: "16:9", hint: "YouTube / Widescreen" },
  { id: "9:16", w: 1080, h: 1920, label: "9:16", hint: "TikTok / Reels" },
  { id: "5:4", w: 1350, h: 1080, label: "5:4", hint: "Photo / Classic" },
  { id: "FHD", w: 1920, h: 1080, label: "FHD", hint: "Full HD 1920×1080" },
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatSec(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadVideo(file: File): Promise<{ url: string; durationSec: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.src = url; el.preload = "metadata";
    el.onloadedmetadata = () => resolve({ url, durationSec: el.duration || 0 });
    el.onerror = () => resolve({ url, durationSec: 0 });
  });
}

const CANVAS_W = 1280;
const CANVAS_H = 720;
const PIP_MARGIN = 12;

function cornerToXY(corner: CornerPos, scale: number): { x: number; y: number } {
  const w = Math.round(CANVAS_W * scale);
  const h = Math.round(CANVAS_H * scale);
  switch (corner) {
    case "tl": return { x: PIP_MARGIN, y: PIP_MARGIN };
    case "tr": return { x: CANVAS_W - w - PIP_MARGIN, y: PIP_MARGIN };
    case "bl": return { x: PIP_MARGIN, y: CANVAS_H - h - PIP_MARGIN };
    case "br": return { x: CANVAS_W - w - PIP_MARGIN, y: CANVAS_H - h - PIP_MARGIN };
  }
}

const MOTION_CSS: Record<MotionId, string> = {
  none: "",
  zoom_in:  "vmZoomIn",
  zoom_out: "vmZoomOut",
  pan_left: "vmPanLeft",
  pan_right: "vmPanRight",
};

const TRANSITION_LABEL: Record<TransitionId, string> = {
  none: "Cut", fade: "Fade", wipe: "Wipe", slide: "Slide", zoom: "Zoom blur",
};

function PreviewModal({
  mainClips, overlayClips, onClose, onUpdateOverlay, overlayVolume,
}: {
  mainClips: MainClip[];
  overlayClips: OverlayClip[];
  onClose: () => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayClip>) => void;
  overlayVolume: number;
}) {
  const [playIdx, setPlayIdx] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [transName, setTransName] = useState<TransitionId>("none");
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewMuted, setPreviewMuted] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previewVidRef = useRef<HTMLVideoElement>(null);

  const currentClip = mainClips[playIdx] ?? null;

  const goTo = (idx: number) => {
    setPlayIdx(Math.max(0, Math.min(mainClips.length - 1, idx)));
    setTransitioning(false);
    setPreviewPlaying(true);
  };

  const handleEnded = () => {
    if (playIdx >= mainClips.length - 1) {
      setPreviewPlaying(false);
      return;
    }
    const t = mainClips[playIdx].transition;
    setTransName(t);
    setPreviewPlaying(true);
    if (t !== "none") {
      setTransitioning(true);
      setTimeout(() => {
        setPlayIdx(p => p + 1);
        setTransitioning(false);
      }, 500);
    } else {
      setPlayIdx(p => p + 1);
    }
  };

  const togglePreviewPlay = () => {
    const vid = previewVidRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => {});
      setPreviewPlaying(true);
    } else {
      vid.pause();
      setPreviewPlaying(false);
    }
  };

  useEffect(() => {
    const vid = previewVidRef.current;
    if (!vid) return;
    const onTime = () => {
      const c = mainClips[playIdx];
      if (c) {
        setPreviewTime(vid.currentTime - c.trimIn);
        setPreviewDuration(c.trimOut - c.trimIn);
      }
    };
    vid.addEventListener("timeupdate", onTime);
    return () => vid.removeEventListener("timeupdate", onTime);
  }, [playIdx, mainClips]);

  const motionDur = currentClip ? (currentClip.trimOut - currentClip.trimIn) : 5;
  const motionClass = currentClip ? MOTION_CSS[currentClip.motion] : "";

  const startDrag = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    const clip = overlayClips.find(c => c.id === clipId);
    if (!clip || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = rect.width / CANVAS_W;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startX = clip.x;
    const startY = clip.y;
    const move = (me: MouseEvent) => {
      const dx = (me.clientX - startMouseX) / scale;
      const dy = (me.clientY - startMouseY) / scale;
      onUpdateOverlay(clipId, {
        x: Math.round(startX + dx),
        y: Math.round(startY + dy),
      });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <style>{`
        @keyframes vmZoomIn  { from { transform: scale(1);   } to { transform: scale(1.5); } }
        @keyframes vmZoomOut { from { transform: scale(1.5); } to { transform: scale(1);   } }
        @keyframes vmPanLeft { from { transform: scale(1.3) translateX(15%); } to { transform: scale(1.3) translateX(-15%); } }
        @keyframes vmPanRight{ from { transform: scale(1.3) translateX(-15%); } to { transform: scale(1.3) translateX(15%); } }
        .vm-fade  { animation: vmFadeOverlay 0.5s ease-in-out; }
        .vm-wipe  { animation: vmWipeOverlay 0.5s ease-in-out; }
        .vm-slide { animation: vmSlideOverlay 0.5s ease-in-out; }
        .vm-zoom  { animation: vmZoomOverlay 0.5s ease-in-out; }
        @keyframes vmFadeOverlay  { 0%,100%{opacity:0} 50%{opacity:1} }
        @keyframes vmWipeOverlay  { 0%{clip-path:inset(0 100% 0 0)} 100%{clip-path:inset(0 0 0 0)} }
        @keyframes vmSlideOverlay { 0%{transform:translateX(-100%)} 100%{transform:translateX(0)} }
        @keyframes vmZoomOverlay  { 0%{transform:scale(0.5);opacity:0} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <button
        onClick={onClose}
        className="fixed top-4 left-4 z-[60] w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="w-full max-w-2xl flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-indigo-400" />
            <h2 className="text-white font-semibold">Composition Preview</h2>
            {currentClip && (
              <span className="text-white/40 text-xs">
                — Clip {playIdx + 1}/{mainClips.length}: {currentClip.name.split(".")[0]}
                {currentClip.motion !== "none" && <span className="ml-2 text-amber-400/70">◎ {currentClip.motion.replace("_", " ")}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {overlayClips.length > 0 && (
              <span className="text-white/40 text-xs">Drag overlays to reposition</span>
            )}
            <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div
          ref={canvasRef}
          className="w-full bg-black relative overflow-hidden rounded-xl border border-white/10 shadow-2xl"
          style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
        >
          {mainClips.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-2">
              <Film className="w-8 h-8" />
              <p className="text-sm">Add clips to the Main Track to preview</p>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 overflow-hidden cursor-pointer" onClick={togglePreviewPlay}>
                <video
                  key={`clip-${currentClip?.id}-${playIdx}`}
                  src={currentClip?.url}
                  className="w-full h-full object-cover"
                  style={motionClass ? {
                    animation: `${motionClass} ${motionDur}s linear forwards`,
                    transformOrigin: "center center",
                  } : undefined}
                  muted={previewMuted}
                  autoPlay
                  playsInline
                  onEnded={handleEnded}
                  onPlay={() => setPreviewPlaying(true)}
                  onPause={() => setPreviewPlaying(false)}
                  ref={el => {
                    (previewVidRef as any).current = el;
                    if (!el || !currentClip) return;
                    if (currentClip.trimIn > 0 && el.currentTime < currentClip.trimIn) {
                      el.currentTime = currentClip.trimIn;
                    }
                  }}
                  onTimeUpdate={e => {
                    if (!currentClip) return;
                    const vid = e.currentTarget;
                    if (vid.currentTime >= currentClip.trimOut) {
                      vid.pause();
                      handleEnded();
                    }
                  }}
                />
              </div>

              {transitioning && (
                <div
                  className={cn(
                    "absolute inset-0 bg-black pointer-events-none",
                    transName === "fade"  && "vm-fade",
                    transName === "wipe"  && "vm-wipe",
                    transName === "slide" && "vm-slide",
                    transName === "zoom"  && "vm-zoom",
                    !transName || transName === "none" ? "opacity-0" : ""
                  )}
                />
              )}

              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 items-center">
                {mainClips.map((_, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); goTo(i); }}
                    className={cn(
                      "rounded-full transition-all duration-200 bg-white",
                      i === playIdx ? "w-4 h-2 opacity-100" : "w-2 h-2 opacity-40 hover:opacity-70"
                    )}
                  />
                ))}
              </div>

              {playIdx < mainClips.length - 1 && mainClips[playIdx].transition !== "none" && (
                <div className="absolute top-2 right-2 bg-black/50 text-white/60 text-[10px] rounded px-1.5 py-0.5">
                  Next: {TRANSITION_LABEL[mainClips[playIdx].transition]}
                </div>
              )}

              <button
                onClick={e => { e.stopPropagation(); goTo(playIdx - 1); }}
                disabled={playIdx === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center transition-all disabled:opacity-20"
              >◀</button>
              <button
                onClick={e => { e.stopPropagation(); goTo(playIdx + 1); }}
                disabled={playIdx >= mainClips.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 flex items-center justify-center transition-all disabled:opacity-20"
              >▶</button>

              {!previewPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                    <Play className="w-7 h-7 text-white ml-1" />
                  </div>
                </div>
              )}
            </>
          )}

          {overlayClips.map(clip => {
            const overlayW = Math.round(CANVAS_W * clip.scaleX);
            const overlayH = Math.round(CANVAS_H * clip.scaleY);
            return (
              <div
                key={clip.id}
                className="absolute rounded-lg border-2 border-white/70 cursor-move select-none shadow-xl group"
                style={{
                  left: `${(clip.x / CANVAS_W) * 100}%`,
                  top: `${(clip.y / CANVAS_H) * 100}%`,
                  width: `${(overlayW / CANVAS_W) * 100}%`,
                  height: `${(overlayH / CANVAS_H) * 100}%`,
                }}
                onMouseDown={e => startDrag(e, clip.id)}
              >
                <video
                  src={clip.url}
                  className="w-full h-full object-cover rounded-md pointer-events-none"
                  style={{
                    objectPosition: `${clip.panX}% ${clip.panY}%`,
                  }}
                  ref={el => { if (el) el.volume = overlayVolume; }}
                  autoPlay loop playsInline
                />
                <div className="absolute inset-0 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-black/60 rounded px-2 py-0.5 text-white text-[10px]">⠿ drag</div>
                </div>
                {(["tl","t","tr","l","r","bl","b","br"] as const).map(handle => {
                  const isSide = handle === "t" || handle === "b" || handle === "l" || handle === "r";
                  return (
                    <div
                      key={handle}
                      className={cn(
                        "absolute bg-white border-2 border-violet-500 z-20 opacity-0 group-hover:opacity-100 transition-opacity",
                        isSide ? "rounded-[2px]" : "rounded-sm",
                        (handle === "t" || handle === "b") && "w-5 h-2.5",
                        (handle === "l" || handle === "r") && "w-2.5 h-5",
                        (!isSide) && "w-3 h-3",
                        handle === "tl" && "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
                        handle === "tr" && "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize",
                        handle === "bl" && "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
                        handle === "br" && "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize",
                        handle === "t" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize",
                        handle === "b" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
                        handle === "l" && "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
                        handle === "r" && "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-e-resize",
                      )}
                      onMouseDown={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const container = canvasRef.current;
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const pxScale = rect.width / CANVAS_W;
                        const startMouseX = e.clientX;
                        const startMouseY = e.clientY;
                        const startSX = clip.scaleX;
                        const startSY = clip.scaleY;
                        const startX = clip.x;
                        const startY = clip.y;
                        const hasLeft = handle === "l" || handle === "tl" || handle === "bl";
                        const hasTop = handle === "t" || handle === "tl" || handle === "tr";
                        let active = true;
                        const cleanup = () => {
                          if (!active) return;
                          active = false;
                          window.removeEventListener("mousemove", move);
                          window.removeEventListener("mouseup", up);
                          window.removeEventListener("blur", cleanup);
                          document.removeEventListener("visibilitychange", cleanup);
                        };
                        const move = (me: MouseEvent) => {
                          if (!active) return;
                          const dx = (me.clientX - startMouseX) / pxScale / CANVAS_W;
                          const dy = (me.clientY - startMouseY) / pxScale / CANVAS_H;
                          let newSX = startSX;
                          let newSY = startSY;
                          if (handle === "r" || handle === "tr" || handle === "br") newSX = startSX + dx;
                          if (hasLeft) newSX = startSX - dx;
                          if (handle === "b" || handle === "br" || handle === "bl") newSY = startSY + dy;
                          if (hasTop) newSY = startSY - dy;
                          if (!isSide) {
                            const avg = (newSX + newSY) / 2;
                            newSX = avg;
                            newSY = avg;
                          }
                          const clampedSX = Math.max(0.05, Math.min(0.95, newSX));
                          const clampedSY = Math.max(0.05, Math.min(0.95, newSY));
                          const updates: Record<string, number> = {
                            scaleX: clampedSX,
                            scaleY: clampedSY,
                            scale: (clampedSX + clampedSY) / 2,
                          };
                          if (hasLeft) {
                            updates.x = Math.round(startX + (startSX - clampedSX) * CANVAS_W);
                          }
                          if (hasTop) {
                            updates.y = Math.round(startY + (startSY - clampedSY) * CANVAS_H);
                          }
                          onUpdateOverlay(clip.id, updates);
                        };
                        const up = () => { cleanup(); };
                        window.addEventListener("mousemove", move);
                        window.addEventListener("mouseup", up);
                        window.addEventListener("blur", cleanup);
                        document.addEventListener("visibilitychange", cleanup);
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        {mainClips.length > 0 && (
          <div className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
            <button onClick={togglePreviewPlay} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors shrink-0">
              {previewPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div
              className="flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer relative group"
              onClick={e => {
                const vid = previewVidRef.current;
                if (!vid || !currentClip) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const dur = currentClip.trimOut - currentClip.trimIn;
                vid.currentTime = currentClip.trimIn + pct * dur;
              }}
            >
              <div className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full" style={{ width: `${previewDuration > 0 ? Math.min(100, (previewTime / previewDuration) * 100) : 0}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: `calc(${previewDuration > 0 ? Math.min(100, (previewTime / previewDuration) * 100) : 0}% - 5px)` }} />
            </div>
            <span className="text-[11px] text-white/50 font-mono tabular-nums shrink-0 min-w-[90px] text-right">
              {formatTime(Math.max(0, previewTime))} / {formatTime(previewDuration)}
            </span>
            <button onClick={() => setPreviewMuted(m => !m)} className="text-white/50 hover:text-white transition-colors shrink-0">
              {previewMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button onClick={e => { e.stopPropagation(); goTo(playIdx - 1); }} disabled={playIdx === 0} className="text-white/50 hover:text-white transition-colors disabled:opacity-20 shrink-0">
              <SkipBack className="w-4 h-4" />
            </button>
            <button onClick={e => { e.stopPropagation(); goTo(playIdx + 1); }} disabled={playIdx >= mainClips.length - 1} className="text-white/50 hover:text-white transition-colors disabled:opacity-20 shrink-0">
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        )}

        {mainClips.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mainClips.map((clip, i) => (
              <button
                key={clip.id}
                onClick={() => goTo(i)}
                className={cn(
                  "shrink-0 flex flex-col items-start gap-0.5 rounded-lg border p-1.5 transition-all w-28 text-left",
                  i === playIdx
                    ? "border-indigo-500/60 bg-indigo-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                )}
              >
                <video src={clip.url} className="w-full aspect-video rounded object-cover pointer-events-none" muted playsInline preload="metadata" />
                <p className="text-[9px] text-white/50 truncate w-full">{clip.name.split(".")[0]}</p>
                {clip.motion !== "none" && (
                  <span className="text-[8px] text-amber-400/70">{MOTION_CSS[clip.motion] ? "◎ motion" : ""}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <p className="text-white/25 text-[10px] text-center">
          Clips play in sequence with CSS-approximated effects · Overlay positions save as you drag · Exact rendering happens on export
        </p>
      </div>
    </div>
  );
}

function RightPanel({
  selection, mainClips, overlayClips, totalDuration,
  onUpdateMain, onUpdateOverlay,
  onAddFiles, onAddOverlayFiles,
  onSelectOverlay, onRemoveOverlay,
  aspectRatio, onAspectRatioChange,
  cropMode, onCropModeChange,
  overlayExpanded, onToggleOverlay,
  audioTrack, onAddAudio, onRemoveAudio,
  audioPlaying, onToggleAudioPlay,
  open, onClose,
}: {
  selection: Selection;
  mainClips: MainClip[]; overlayClips: OverlayClip[];
  totalDuration: number;
  onUpdateMain: (id: string, patch: Partial<MainClip>) => void;
  onUpdateOverlay: (id: string, patch: Partial<OverlayClip>) => void;
  onAddFiles: () => void;
  onAddOverlayFiles: () => void;
  onSelectOverlay: (id: string) => void;
  onRemoveOverlay: (id: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (id: string) => void;
  cropMode: "fit" | "crop";
  onCropModeChange: (mode: "fit" | "crop") => void;
  overlayExpanded: boolean;
  onToggleOverlay: () => void;
  audioTrack: { file: File; name: string; url: string } | null;
  onAddAudio: () => void;
  onRemoveAudio: () => void;
  audioPlaying: boolean;
  onToggleAudioPlay: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const selectedMain = selection?.type === "main" ? mainClips.find(c => c.id === selection.id) : null;
  const selectedOverlay = selection?.type === "overlay" ? overlayClips.find(c => c.id === selection.id) : null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <div className={cn(
        "w-full max-w-[360px] lg:w-[360px] shrink-0 border-l border-border/40 bg-[#0f1117] flex flex-col overflow-y-auto",
        "fixed right-0 top-0 bottom-0 z-50 transition-transform duration-300 lg:static lg:translate-x-0 lg:z-auto",
        open ? "translate-x-0" : "translate-x-full"
      )}>

      <div className="px-4 pt-4 pb-3 border-b border-border/30">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Output Settings</p>
          <button
            onClick={onClose}
            className="flex lg:hidden items-center justify-center w-7 h-7 rounded-lg bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={onAddFiles}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-sm font-medium text-indigo-300 hover:bg-indigo-600/20 hover:border-indigo-500/40 transition-all duration-150 group"
        >
          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Plus className="w-3.5 h-3.5" />
          </div>
          Add more clips
          <Upload className="w-3.5 h-3.5 ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>

      <div className="p-4 border-b border-border/30 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-indigo-400 to-indigo-600" />
            <p className="text-xs font-semibold text-foreground/90 tracking-wide">Frame Mode</p>
          </div>
          <span className="text-[10px] text-muted-foreground/50 font-medium px-2 py-0.5 rounded-full bg-muted/20 border border-border/30">
            {cropMode === "fit" ? "Fit" : "Fill"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            {
              value: "fit" as const,
              icon: Maximize2,
              label: "Fit",
              desc: "Letter-boxed with borders",
              accent: "indigo",
            },
            {
              value: "crop" as const,
              icon: Crop,
              label: "Crop to fill",
              desc: "Fills frame, edges trimmed",
              accent: "violet",
            },
          ] as const).map(opt => {
            const Icon = opt.icon;
            const active = cropMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onCropModeChange(opt.value)}
                className={cn(
                  "relative flex flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left transition-all duration-150 cursor-pointer group",
                  active
                    ? opt.accent === "indigo"
                      ? "border-indigo-500/70 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.2)] shadow-indigo-500/10"
                      : "border-violet-500/70 bg-violet-500/10 shadow-[0_0_0_1px_rgba(139,92,246,0.2)] shadow-violet-500/10"
                    : "border-border/40 bg-muted/20 hover:border-border/70 hover:bg-muted/40"
                )}
              >
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-lg transition-colors",
                  active
                    ? opt.accent === "indigo"
                      ? "bg-indigo-500/20 text-indigo-400"
                      : "bg-violet-500/20 text-violet-400"
                    : "bg-muted/50 text-muted-foreground group-hover:text-foreground"
                )}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className={cn(
                    "text-[11px] font-semibold leading-tight",
                    active
                      ? opt.accent === "indigo" ? "text-indigo-300" : "text-violet-300"
                      : "text-foreground"
                  )}>
                    {opt.label}
                  </p>
                  <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
                </div>
                {active && (
                  <div className={cn(
                    "absolute top-2 right-2 w-1.5 h-1.5 rounded-full",
                    opt.accent === "indigo" ? "bg-indigo-400" : "bg-violet-400"
                  )} />
                )}
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Aspect Ratio</p>
          <div className="flex gap-1.5">
            {ASPECT_RATIOS.map(ar => {
              const active = aspectRatio === ar.id;
              return (
                <div key={ar.id} className="relative flex-1 group/ratio">
                  <button
                    onClick={() => onAspectRatioChange(ar.id)}
                    className={cn(
                      "w-full py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 border",
                      active
                        ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-300 shadow-sm"
                        : "border-border/30 bg-muted/10 text-muted-foreground hover:border-border/60 hover:text-foreground hover:bg-muted/20"
                    )}
                  >
                    {ar.label}
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-popover border border-border/60 shadow-xl text-[10px] text-foreground whitespace-nowrap opacity-0 pointer-events-none group-hover/ratio:opacity-100 transition-opacity z-50">
                    {ar.hint}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-border/60" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-b border-border/30">
        <button
          onClick={onToggleOverlay}
          className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-muted/10 transition-colors group"
        >
          <div className="w-6 h-6 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
            <PictureInPicture2 className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="flex flex-col items-start">
            <span className="text-xs font-semibold text-foreground/90">Overlays</span>
            <span className="text-[10px] text-muted-foreground/60 leading-tight">Picture-in-picture · plays simultaneously</span>
          </div>
          {overlayClips.length > 0 && (
            <span className="text-[10px] font-semibold text-violet-400 bg-violet-500/15 border border-violet-500/25 px-1.5 py-0.5 rounded-full">
              {overlayClips.length}
            </span>
          )}
          <div className="ml-auto text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            {overlayExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </button>

        {overlayExpanded && (
          <div className="px-3 pb-3 space-y-2">
            <button
              onClick={onAddOverlayFiles}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-violet-500/25 text-violet-400/60 text-xs font-medium hover:border-violet-400/50 hover:text-violet-300 hover:bg-violet-500/5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add overlay clip
            </button>
            {overlayClips.length > 0 && (
              <div className="space-y-1">
                {overlayClips.map(clip => {
                  const active = selection?.type === "overlay" && selection.id === clip.id;
                  return (
                    <div
                      key={clip.id}
                      onClick={() => onSelectOverlay(clip.id)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs cursor-pointer group transition-all border",
                        active
                          ? "bg-violet-500/12 border-violet-500/30 shadow-sm"
                          : "bg-transparent border-transparent hover:bg-muted/15 hover:border-border/30"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors",
                        active ? "bg-violet-500/25" : "bg-muted/30"
                      )}>
                        <PictureInPicture2 className="w-3 h-3 text-violet-400" />
                      </div>
                      <span className={cn("truncate flex-1 font-medium", active ? "text-foreground" : "text-foreground/60")}>{clip.name.replace(/\.[^.]+$/, "")}</span>
                      <span className="text-muted-foreground/50 text-[10px] font-mono shrink-0">{formatSec(clip.durationSec)}</span>
                      <button
                        onClick={e => { e.stopPropagation(); onRemoveOverlay(clip.id); }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-red-400 transition-all p-0.5 ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedMain && (
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Active Clip</p>
          <div className="rounded-xl border border-border/30 bg-muted/10 p-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
                <Film className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{selectedMain.name.replace(/\.[^.]+$/, "")}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{selectedMain.name.split(".").pop()?.toUpperCase()} · {formatSec(selectedMain.durationSec)} total</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Motion Effect</p>
            <div className="grid grid-cols-5 gap-1">
              {MOTIONS.map(m => {
                const active = selectedMain.motion === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => onUpdateMain(selectedMain.id, { motion: m.id })}
                    title={m.label}
                    className={cn(
                      "flex flex-col items-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border",
                      active
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                        : "border-border/30 bg-muted/10 text-muted-foreground hover:border-border/60 hover:text-foreground"
                    )}
                  >
                    <span className="text-sm">{m.icon}</span>
                    <span className="leading-tight">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {mainClips.findIndex(c => c.id === selectedMain.id) < mainClips.length - 1 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">Transition to Next</p>
              <div className="grid grid-cols-5 gap-1">
                {TRANSITIONS.map(t => {
                  const active = selectedMain.transition === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onUpdateMain(selectedMain.id, { transition: t.id })}
                      title={`${t.label} — ${t.desc}`}
                      className={cn(
                        "flex flex-col items-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border",
                        active
                          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                          : "border-border/30 bg-muted/10 text-muted-foreground hover:border-border/60 hover:text-foreground"
                      )}
                    >
                      <span className="text-sm">{t.icon}</span>
                      <span className="leading-tight">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedOverlay && (
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Overlay Clip</p>
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
                <PictureInPicture2 className="w-4 h-4 text-violet-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{selectedOverlay.name.replace(/\.[^.]+$/, "")}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{selectedOverlay.name.split(".").pop()?.toUpperCase()} · {formatSec(selectedOverlay.durationSec)} total</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedMain && !selectedOverlay && mainClips.length > 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-muted/20 border border-border/30 flex items-center justify-center mb-3">
            <Film className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs font-semibold text-foreground/60">No clip selected</p>
          <p className="text-[10px] text-muted-foreground/40 mt-1 leading-relaxed">Click any clip in the<br />timeline to inspect it</p>
        </div>
      )}

      <div className="mt-auto border-t border-border/30">
        {audioTrack ? (
          <div className="px-4 py-3">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
              <button onClick={onToggleAudioPlay} className="w-6 h-6 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 flex items-center justify-center shrink-0 transition-colors" title={audioPlaying ? "Pause audio" : "Play audio"}>
                {audioPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-amber-400 ml-0.5" />}
              </button>
              <span className="text-xs font-medium text-foreground/80 truncate flex-1">{audioTrack.name.replace(/\.[^.]+$/, "")}</span>
              <button onClick={onRemoveAudio} className="text-muted-foreground/40 hover:text-red-400 transition-colors p-0.5" title="Remove audio">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onAddAudio}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-muted-foreground/60 hover:text-amber-400 hover:bg-amber-500/5 transition-all group"
          >
            <div className="w-6 h-6 rounded-lg bg-muted/20 group-hover:bg-amber-500/15 flex items-center justify-center shrink-0 transition-colors">
              <Music className="w-3.5 h-3.5" />
            </div>
            Add background audio
            <Plus className="w-3.5 h-3.5 ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>
    </div>
    </>
  );
}

const CLIP_COLORS = [
  "from-blue-500/80 to-blue-600/80",
  "from-emerald-500/80 to-emerald-600/80",
  "from-amber-500/80 to-amber-600/80",
  "from-purple-500/80 to-purple-600/80",
  "from-rose-500/80 to-rose-600/80",
  "from-cyan-500/80 to-cyan-600/80",
  "from-orange-500/80 to-orange-600/80",
  "from-indigo-500/80 to-indigo-600/80",
  "from-teal-500/80 to-teal-600/80",
  "from-pink-500/80 to-pink-600/80",
];

export default function VideoMerger() {
  const [mainClips, setMainClips] = useState<MainClip[]>([]);
  const [overlayClips, setOverlayClips] = useState<OverlayClip[]>([]);
  const mainClipsUrlRef = useRef<string[]>([]);
  const overlayClipsUrlRef = useRef<string[]>([]);
  useEffect(() => {
    mainClipsUrlRef.current = mainClips.map(c => c.url);
  }, [mainClips]);
  useEffect(() => {
    overlayClipsUrlRef.current = overlayClips.map(c => c.url);
  }, [overlayClips]);
  useEffect(() => {
    return () => {
      mainClipsUrlRef.current.forEach(u => URL.revokeObjectURL(u));
      overlayClipsUrlRef.current.forEach(u => URL.revokeObjectURL(u));
    };
  }, []);
  const [selection, setSelection] = useState<Selection>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);
  const [merging, setMerging] = useState(false);
  const [mergePhase, setMergePhase] = useState("");
  const [result, setResult] = useState<{ fileId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [cropMode, setCropMode] = useState<"fit" | "crop">("fit");
  const [overlayExpanded, setOverlayExpanded] = useState(false);

  const [playing, _setPlaying] = useState(false);
  const playingRef = useRef(false);
  const setPlaying = (v: boolean) => { playingRef.current = v; _setPlaying(v); };
  const [currentTime, _setCurrentTime] = useState(0);
  const [clipDuration, setClipDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [panX, setPanX] = useState(50);
  const [panY, setPanY] = useState(50);
  const [mainVolume, setMainVolume] = useState(1);
  const [overlayVolume, setOverlayVolume] = useState(0.5);
  const [audioTrack, setAudioTrack] = useState<{ file: File; name: string; url: string } | null>(null);
  const [audioVolume, setAudioVolume] = useState(0.7);
  const [audioPlaying, setAudioPlaying] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(false);
  const overlayTimesRef = useRef<Record<string, number>>({});

  const mainInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLDivElement>(null);
  const autoAdvanceRef = useRef(false);
  const playheadRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubHandleRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const currentTimeRef = useRef(0);
  const setCurrentTime = useCallback((t: number) => {
    currentTimeRef.current = t;
    _setCurrentTime(t);
  }, []);
  const overlayVideoRefs = useRef(new Map<string, HTMLVideoElement>());
  const [overlayPlayingMap, setOverlayPlayingMap] = useState<Record<string, boolean>>({});
  const mainClipsRef = useRef(mainClips);
  mainClipsRef.current = mainClips;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const totalDuration = mainClips.reduce((sum, c) => sum + (c.trimOut - c.trimIn), 0);

  const selectedClip = selection?.type === "main"
    ? mainClips.find(c => c.id === selection.id) ?? null
    : null;

  const lastMainIdRef = useRef<string | null>(null);
  if (selectedClip) {
    lastMainIdRef.current = selectedClip.id;
  }
  const visibleClip = selectedClip
    ?? (lastMainIdRef.current ? mainClips.find(c => c.id === lastMainIdRef.current) ?? null : null)
    ?? (mainClips.length > 0 ? mainClips[0] : null);

  useEffect(() => {
    if (mainClips.length > 0 && !selection) {
      setSelection({ type: "main", id: mainClips[0].id });
    }
  }, [mainClips, selection]);

  const visibleClipRef = useRef(visibleClip);
  visibleClipRef.current = visibleClip;

  const wantsAutoplayRef = useRef(false);

  useEffect(() => {
    setCurrentTime(0);
    setClipDuration(0);
    const vid = videoRef.current;
    if (!vid) return;
    const clip = visibleClipRef.current;
    const shouldAutoplay = autoAdvanceRef.current || playingRef.current;
    autoAdvanceRef.current = false;
    wantsAutoplayRef.current = shouldAutoplay;

    let autoplayConsumed = false;
    const tryAutoplay = () => {
      if (autoplayConsumed || !wantsAutoplayRef.current) return;
      autoplayConsumed = true;
      wantsAutoplayRef.current = false;
      const wasMuted = vid.muted;
      vid.muted = true;
      vid.play().then(() => {
        vid.muted = wasMuted;
      }).catch(() => {
        vid.muted = wasMuted;
      });
    };

    const onTime = () => {
      const c = visibleClipRef.current;
      if (c && vid.currentTime >= c.trimOut) {
        vid.pause();
        const clips = mainClipsRef.current;
        const idx = clips.findIndex(mc => mc.id === c.id);
        if (idx >= 0 && idx < clips.length - 1) {
          autoAdvanceRef.current = true;
          setSelection({ type: "main", id: clips[idx + 1].id });
        } else {
          vid.currentTime = c.trimOut;
          setCurrentTime(c.trimOut);
          setPlaying(false);
        }
      }
    };
    const onDur = () => {
      setClipDuration(vid.duration || 0);
      const c = visibleClipRef.current;
      if (c && c.trimIn > 0) {
        vid.currentTime = c.trimIn;
        setCurrentTime(c.trimIn);
      }
    };
    const onSeeked = () => {
      setCurrentTime(vid.currentTime);
      tryAutoplay();
    };
    const onCanPlay = () => {
      tryAutoplay();
    };
    const onPlay = () => {
      setPlaying(true);
      if (vid) setCurrentTime(vid.currentTime);
    };
    const onPause = () => {
      if (!wantsAutoplayRef.current) {
        setPlaying(false);
        if (vid) setCurrentTime(vid.currentTime);
      }
    };
    const onEnded = () => {
      const clips = mainClipsRef.current;
      const c = visibleClipRef.current;
      const idx = clips.findIndex(mc => mc.id === c?.id);
      if (idx >= 0 && idx < clips.length - 1) {
        autoAdvanceRef.current = true;
        setSelection({ type: "main", id: clips[idx + 1].id });
      } else {
        setPlaying(false);
      }
    };
    vid.addEventListener("timeupdate", onTime);
    vid.addEventListener("loadedmetadata", onDur);
    vid.addEventListener("seeked", onSeeked);
    vid.addEventListener("canplay", onCanPlay);
    vid.addEventListener("play", onPlay);
    vid.addEventListener("pause", onPause);
    vid.addEventListener("ended", onEnded);

    if (vid.readyState >= 1) {
      setClipDuration(vid.duration || 0);
      if (clip && clip.trimIn > 0) {
        vid.currentTime = clip.trimIn;
      } else {
        tryAutoplay();
      }
    }

    return () => {
      wantsAutoplayRef.current = false;
      vid.removeEventListener("timeupdate", onTime);
      vid.removeEventListener("loadedmetadata", onDur);
      vid.removeEventListener("seeked", onSeeked);
      vid.removeEventListener("canplay", onCanPlay);
      vid.removeEventListener("play", onPlay);
      vid.removeEventListener("pause", onPause);
      vid.removeEventListener("ended", onEnded);
    };
  }, [visibleClip?.id, aspectRatio, cropMode]);

  const addMainFiles = useCallback((files: FileList | File[]) => {
    const vids = Array.from(files).filter(f => f.type.startsWith("video/"));
    vids.forEach(async file => {
      const { url, durationSec } = await loadVideo(file);
      setMainClips(prev => [...prev, {
        id: makeId(), file, name: file.name, url, durationSec,
        trimIn: 0, trimOut: durationSec,
        transition: "none", motion: "none",
      }]);
    });
    setResult(null); setError(null);
  }, []);

  const addOverlayFiles = useCallback((files: FileList | File[]) => {
    const vids = Array.from(files).filter(f => f.type.startsWith("video/"));
    vids.forEach(async file => {
      const { url, durationSec } = await loadVideo(file);
      const defaultScale = 0.3;
      const { x, y } = cornerToXY("tr", defaultScale);
      const newId = makeId();
      setOverlayClips(prev => [...prev, {
        id: newId, file, name: file.name, url, durationSec,
        trimIn: 0, trimOut: durationSec,
        x, y, scale: defaultScale, scaleX: defaultScale, scaleY: defaultScale, offsetTime: 0, panX: 50, panY: 50,
      }]);
      setOverlayPlayingMap(prev => ({ ...prev, [newId]: true }));
    });
  }, []);

  const updateMain = (id: string, patch: Partial<MainClip>) =>
    setMainClips(p => p.map(c => c.id === id ? { ...c, ...patch } : c));

  const updateOverlay = (id: string, patch: Partial<OverlayClip>) =>
    setOverlayClips(p => p.map(c => c.id === id ? { ...c, ...patch } : c));

  const moveMain = (id: string, dir: -1 | 1) => setMainClips(prev => {
    const idx = prev.findIndex(c => c.id === id);
    if (idx < 0) return prev;
    const next = idx + dir;
    if (next < 0 || next >= prev.length) return prev;
    const arr = [...prev];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    return arr;
  });

  const removeMain = (id: string) => {
    setMainClips(p => {
      const clip = p.find(c => c.id === id);
      if (clip) URL.revokeObjectURL(clip.url);
      return p.filter(c => c.id !== id);
    });
    if (selection?.id === id) setSelection(null);
  };

  const removeOverlay = (id: string) => {
    overlayVideoRefs.current.delete(id);
    delete overlayTimesRef.current[id];
    setOverlayPlayingMap(prev => { const n = { ...prev }; delete n[id]; return n; });
    setOverlayClips(p => {
      const clip = p.find(c => c.id === id);
      if (clip) URL.revokeObjectURL(clip.url);
      return p.filter(c => c.id !== id);
    });
    if (selection?.id === id) setSelection(null);
  };

  const toggleOverlayPlay = (id: string) => {
    const el = overlayVideoRefs.current.get(id);
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      setOverlayPlayingMap(prev => ({ ...prev, [id]: true }));
    } else {
      el.pause();
      setOverlayPlayingMap(prev => ({ ...prev, [id]: false }));
    }
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    autoAdvanceRef.current = false;
    wantsAutoplayRef.current = false;
    if (!vid.paused) {
      vid.pause();
      setPlaying(false);
      setCurrentTime(vid.currentTime);
    } else {
      const c = visibleClipRef.current;
      if (c && (vid.currentTime < c.trimIn || vid.currentTime >= c.trimOut)) {
        vid.currentTime = c.trimIn;
        setCurrentTime(c.trimIn);
      }
      setPlaying(true);
      vid.play().catch(() => {
        setPlaying(false);
      });
    }
  };

  useEffect(() => {
    let active = true;
    let lastFrame = 0;
    const INTERVAL = 1000 / 30;
    const tick = (now: number) => {
      if (!active) return;
      if (now - lastFrame >= INTERVAL) {
        lastFrame = now;
        const vid = videoRef.current;
        if (vid && !vid.paused && !vid.ended) {
          const t = vid.currentTime;
          currentTimeRef.current = t;

          const vc = visibleClipRef.current;
          const trimIn = vc?.trimIn ?? 0;
          const trimOut = vc?.trimOut ?? (vid.duration || 0);
          const trimmedDuration = trimOut - trimIn;
          const relativeTime = Math.max(0, t - trimIn);
          const pct = trimmedDuration > 0 ? Math.min(100, (relativeTime / trimmedDuration) * 100) : 0;

          if (progressBarRef.current) progressBarRef.current.style.width = `${pct}%`;
          if (scrubHandleRef.current) scrubHandleRef.current.style.left = `calc(${pct}% - 6px)`;
          if (timeDisplayRef.current) timeDisplayRef.current.textContent = `${formatTime(relativeTime)} / ${formatTime(trimmedDuration)}`;
          if (playheadRef.current && vc) {
            const clipPct = vc.durationSec > 0 ? Math.min(100, Math.max(0, (t / vc.durationSec) * 100)) : 0;
            playheadRef.current.style.left = `${clipPct}%`;
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { active = false; };
  }, []);


  useEffect(() => {
    const vid = videoRef.current;
    if (vid) vid.volume = muted ? 0 : mainVolume;
  }, [mainVolume, muted]);

  useEffect(() => {
    const aud = audioRef.current;
    if (aud) aud.volume = muted ? 0 : audioVolume;
  }, [audioVolume, muted]);

  useEffect(() => {
    const aud = audioRef.current;
    if (!aud || !audioTrack) return;
    aud.play().then(() => setAudioPlaying(true)).catch(() => setAudioPlaying(false));
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    aud.addEventListener("play", onPlay);
    aud.addEventListener("pause", onPause);
    return () => {
      aud.removeEventListener("play", onPlay);
      aud.removeEventListener("pause", onPause);
    };
  }, [audioTrack]);

  const toggleAudioPlay = () => {
    const aud = audioRef.current;
    if (!aud) return;
    if (aud.paused) {
      aud.play().catch(() => {});
    } else {
      aud.pause();
    }
  };

  const skipPrev = () => {
    autoAdvanceRef.current = false;
    const idx = mainClips.findIndex(c => c.id === selection?.id);
    if (idx > 0) setSelection({ type: "main", id: mainClips[idx - 1].id });
  };

  const skipNext = () => {
    autoAdvanceRef.current = false;
    const idx = mainClips.findIndex(c => c.id === selection?.id);
    if (idx >= 0 && idx < mainClips.length - 1) setSelection({ type: "main", id: mainClips[idx + 1].id });
  };

  const handleMerge = async () => {
    if (mainClips.length < 1) return;
    setMerging(true); setError(null); setResult(null);

    const hasMotion = mainClips.some(c => c.motion !== "none");
    const hasTransition = mainClips.some(c => c.transition !== "none");
    const hasOverlay = overlayClips.length > 0;

    const phaseList = [
      "Uploading clips…",
      hasMotion ? "Applying motion effects…" : "Normalising clips…",
      hasTransition ? "Rendering transitions…" : "Stitching clips…",
      hasOverlay ? "Compositing overlays…" : "Encoding output…",
      "Finalising…",
    ];
    let pi = 0;
    setMergePhase(phaseList[0]);
    const interval = setInterval(() => {
      pi = Math.min(pi + 1, phaseList.length - 1);
      setMergePhase(phaseList[pi]);
    }, 5000);

    try {
      const ar = ASPECT_RATIOS.find(a => a.id === aspectRatio) ?? { w: 1280, h: 720 };
      const spec: Record<string, unknown> = {
        canvasW: ar.w,
        canvasH: ar.h,
        cropMode,
        mainClips: mainClips.map(c => ({
          id: c.id, startTime: c.trimIn, endTime: c.trimOut,
          transition: c.transition, motion: c.motion,
          panX, panY,
        })),
        overlays: overlayClips.map(c => ({
          id: c.id, startTime: c.trimIn, endTime: c.trimOut,
          x: Math.round((c.x / CANVAS_W) * ar.w), y: Math.round((c.y / CANVAS_H) * ar.h),
          scale: c.scale, scaleX: c.scaleX, scaleY: c.scaleY, offsetTime: c.offsetTime,
          panX: c.panX, panY: c.panY,
        })),
      };

      if (audioTrack) {
        spec.audioFileId = "bg_audio";
        spec.muteOriginal = muted;
      }

      const fd = new FormData();
      fd.append("spec", JSON.stringify(spec));
      mainClips.forEach(c => fd.append(`file_${c.id}`, c.file));
      overlayClips.forEach(c => fd.append(`overlay_${c.id}`, c.file));
      if (audioTrack) {
        fd.append("bg_audio", audioTrack.file);
      }

      const res = await fetch("/api/media/merge", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Merge failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      clearInterval(interval);
      setMerging(false);
      setMergePhase("");
    }
  };

  const [mainDragging, setMainDragging] = useState(false);


  return (
    <div className="flex h-full bg-background overflow-hidden">
      {showPreview && (
        <PreviewModal
          mainClips={mainClips}
          overlayClips={overlayClips}
          onClose={() => setShowPreview(false)}
          onUpdateOverlay={updateOverlay}
          overlayVolume={overlayVolume}
        />
      )}

      <input ref={mainInputRef} type="file" accept="video/*" multiple className="hidden"
        onChange={e => e.target.files && addMainFiles(e.target.files)} />
      <input ref={overlayInputRef} type="file" accept="video/*" multiple className="hidden"
        onChange={e => e.target.files && addOverlayFiles(e.target.files)} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) setAudioTrack({ file: f, name: f.name, url: URL.createObjectURL(f) });
          e.target.value = "";
        }} />
      {audioTrack && <audio ref={audioRef} src={audioTrack.url} loop />}

      {/* Left sidebar mobile overlay */}
      {showLeftSidebar && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowLeftSidebar(false)} />
      )}

      {/* ── LEFT SIDEBAR ── */}
      <div className={cn(
        "shrink-0 flex flex-col border-r border-border/30 bg-[#0a0c14] z-50",
        "fixed left-0 top-0 bottom-0 w-[168px] transition-transform duration-300",
        "lg:static lg:translate-x-0",
        showLeftSidebar ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-3 border-b border-border/20">
          <button
            onClick={() => { mainInputRef.current?.click(); setShowLeftSidebar(false); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold transition-colors shadow-md shadow-violet-500/20"
          >
            <Upload className="w-4 h-4" /> Upload Videos
          </button>
          <p className="text-[10px] text-muted-foreground/40 text-center mt-1.5">Drag & drop or click to upload</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
          {mainClips.length > 0 && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Your Videos</p>
              <div className="space-y-1.5 mb-3">
                {mainClips.map((clip, idx) => {
                  const isSel = selection?.type === "main" && selection.id === clip.id;
                  return (
                    <div key={clip.id}
                      onClick={() => setSelection({ type: "main", id: clip.id })}
                      className={cn(
                        "flex items-center gap-2 p-1.5 rounded-xl cursor-pointer group transition-all border",
                        isSel ? "bg-indigo-500/15 border-indigo-500/30" : "border-transparent hover:bg-muted/20 hover:border-border/30"
                      )}>
                      <video src={clip.url} className="w-12 h-8 rounded-lg object-cover shrink-0" muted playsInline preload="metadata" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium truncate">{clip.name.replace(/\.[^.]+$/, "")}</p>
                        <p className="text-[10px] text-muted-foreground/50 font-mono">{formatSec(clip.durationSec)}</p>
                      </div>
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {idx > 0 && (
                          <button onClick={e => { e.stopPropagation(); moveMain(clip.id, -1); }}
                            className="w-4 h-4 rounded flex items-center justify-center bg-muted/40 hover:bg-muted/70">
                            <ArrowUp className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {idx < mainClips.length - 1 && (
                          <button onClick={e => { e.stopPropagation(); moveMain(clip.id, 1); }}
                            className="w-4 h-4 rounded flex items-center justify-center bg-muted/40 hover:bg-muted/70">
                            <ArrowDown className="w-2.5 h-2.5" />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); removeMain(clip.id); }}
                          className="w-4 h-4 rounded flex items-center justify-center bg-muted/40 hover:bg-red-500/50 hover:text-red-400">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div
            className={cn(
              "border border-dashed border-border/40 rounded-xl text-center cursor-pointer hover:border-border/60 transition-colors group",
              mainClips.length === 0 ? "py-10 px-3" : "py-3 px-2"
            )}
            onClick={() => mainInputRef.current?.click()}
            onDrop={e => { e.preventDefault(); addMainFiles(e.dataTransfer.files); }}
            onDragOver={e => e.preventDefault()}
          >
            <Film className={cn("mx-auto mb-1.5 text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors", mainClips.length === 0 ? "w-5 h-5" : "w-4 h-4")} />
            <p className="text-[10px] text-muted-foreground/40 leading-relaxed whitespace-pre-line">
              {mainClips.length === 0 ? "Drag videos here\nor click to upload" : "Drag more videos\nhere to add to timeline"}
            </p>
          </div>
        </div>

        <div className="p-3 border-t border-border/20 space-y-2 shrink-0">
          {[
            { icon: "◎", title: "Easy to Use", desc: "Intuitive interface for seamless video merging" },
            { icon: "⚡", title: "Fast Processing", desc: "Cloud powered rendering for ultra-fast output" },
            { icon: "✦", title: "High Quality Output", desc: "Export in up to 4K quality with no watermark" },
          ].map(card => (
            <div key={card.title} className="flex items-start gap-2 p-2 rounded-lg bg-muted/10 border border-border/20">
              <span className="text-primary/50 text-sm shrink-0 mt-0.5">{card.icon}</span>
              <div>
                <p className="text-[10px] font-semibold text-foreground/60">{card.title}</p>
                <p className="text-[9px] text-muted-foreground/40 leading-tight mt-0.5">{card.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CENTER ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">

        {/* Header bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-[#0a0c12]/80 shrink-0">
          <button
            onClick={() => setShowLeftSidebar(s => !s)}
            className="flex lg:hidden items-center justify-center w-7 h-7 rounded-lg bg-muted/20 hover:bg-muted/40 text-muted-foreground transition-all"
          >
            <Menu className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
              <Clapperboard className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <span className="text-sm font-semibold shrink-0">Video Merger</span>
            {mainClips.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground/50 min-w-0">
                <span className="truncate">· My Merged Video</span>
                <Pencil className="w-3 h-3 shrink-0 opacity-60" />
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {mainClips.length > 0 && (
              <button
                onClick={() => setShowPreview(true)}
                className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-indigo-300 bg-muted/20 hover:bg-indigo-500/10 border border-transparent hover:border-indigo-500/25 px-2.5 py-1.5 rounded-lg transition-all"
              >
                <Play className="w-3 h-3" /> Preview
              </button>
            )}
            <div className="relative">
              <select
                value={aspectRatio}
                onChange={e => setAspectRatio(e.target.value)}
                className="appearance-none bg-muted/30 border border-border/40 text-xs font-semibold rounded-lg px-2.5 py-1.5 pr-6 cursor-pointer hover:bg-muted/50 transition-colors focus:outline-none focus:border-primary/50"
              >
                {ASPECT_RATIOS.map(ar => <option key={ar.id} value={ar.id}>{ar.label}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            </div>
            <button
              onClick={handleMerge}
              disabled={mainClips.length < 1 || merging}
              className="flex items-center gap-1.5 text-xs font-bold bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-3.5 py-1.5 rounded-lg shadow-md shadow-violet-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {merging
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline"> Exporting…</span></>
                : <><Download className="w-3.5 h-3.5" /><span className="hidden sm:inline"> Export</span></>
              }
            </button>
            <button
              onClick={() => setShowRightPanel(true)}
              className="flex xl:hidden items-center justify-center w-7 h-7 rounded-lg bg-muted/20 hover:bg-muted/40 text-muted-foreground transition-all"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

          <div className="flex items-center justify-center bg-black/80 relative min-h-0" style={{ flex: "1 1 0", maxHeight: "min(calc(100% - 270px), 44vh)" }}>
            {mainClips.length === 0 ? (
              <div
                onDrop={e => { e.preventDefault(); setMainDragging(false); addMainFiles(e.dataTransfer.files); }}
                onDragOver={e => { e.preventDefault(); setMainDragging(true); }}
                onDragLeave={() => setMainDragging(false)}
                onClick={() => mainInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 cursor-pointer rounded-xl border-2 border-dashed p-12 transition-all",
                  mainDragging ? "border-primary bg-primary/5" : "border-white/20 hover:border-white/40"
                )}
              >
                <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
                  <Upload className="w-7 h-7 text-white/50" />
                </div>
                <div className="text-center">
                  <p className="text-white/70 text-sm font-medium">Drop videos here or click to upload</p>
                  <p className="text-white/30 text-xs mt-1">MP4, MOV, WebM, AVI · Up to 150 MB · Max 10 clips</p>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-background">
                {visibleClip ? (
                  <div
                    ref={previewCanvasRef}
                    className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
                    style={{
                      aspectRatio: `${ASPECT_RATIOS.find(a => a.id === aspectRatio)?.w ?? 16} / ${ASPECT_RATIOS.find(a => a.id === aspectRatio)?.h ?? 9}`,
                      maxWidth: "100%",
                      maxHeight: "100%",
                    }}
                  >
                    <video
                      ref={videoRef}
                      key={`${visibleClip.id}-${aspectRatio}-${cropMode}`}
                      src={visibleClip.url}
                      className={cn(
                        "rounded-lg",
                        cropMode === "crop"
                          ? "w-full h-full object-cover cursor-grab active:cursor-grabbing"
                          : "max-w-full max-h-full object-contain"
                      )}
                      style={cropMode === "crop" ? {
                        objectPosition: `${panX}% ${panY}%`,
                      } : undefined}
                      muted={muted}
                      playsInline
                      onClick={e => {
                        if (!(e as any)._dragged) togglePlay();
                      }}
                      onMouseDown={e => {
                        if (cropMode !== "crop") return;
                        e.preventDefault();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startPanX = panX;
                        const startPanY = panY;
                        let moved = false;
                        let active = true;
                        const cleanup = () => {
                          if (!active) return;
                          active = false;
                          window.removeEventListener("mousemove", move);
                          window.removeEventListener("mouseup", up);
                          window.removeEventListener("blur", cleanup);
                          document.removeEventListener("visibilitychange", cleanup);
                        };
                        const move = (me: MouseEvent) => {
                          if (!active) return;
                          const dx = me.clientX - startX;
                          const dy = me.clientY - startY;
                          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                          setPanX(Math.max(0, Math.min(100, startPanX - dx * 0.25)));
                          setPanY(Math.max(0, Math.min(100, startPanY - dy * 0.25)));
                        };
                        const up = () => {
                          cleanup();
                          if (moved) {
                            const vid = videoRef.current;
                            if (vid) (vid as any)._dragged = true;
                            setTimeout(() => { if (vid) (vid as any)._dragged = false; }, 50);
                          }
                        };
                        window.addEventListener("mousemove", move);
                        window.addEventListener("mouseup", up);
                        window.addEventListener("blur", cleanup);
                        document.addEventListener("visibilitychange", cleanup);
                      }}
                      onTouchStart={e => {
                        if (cropMode !== "crop") return;
                        const touch = e.touches[0];
                        const startX = touch.clientX;
                        const startY = touch.clientY;
                        const startPanX = panX;
                        const startPanY = panY;
                        const move = (te: TouchEvent) => {
                          const t = te.touches[0];
                          const dx = t.clientX - startX;
                          const dy = t.clientY - startY;
                          setPanX(Math.max(0, Math.min(100, startPanX - dx * 0.25)));
                          setPanY(Math.max(0, Math.min(100, startPanY - dy * 0.25)));
                        };
                        const up = () => {
                          window.removeEventListener("touchmove", move);
                          window.removeEventListener("touchend", up);
                        };
                        window.addEventListener("touchmove", move);
                        window.addEventListener("touchend", up);
                      }}
                    />
                    {overlayClips.map(clip => {
                      const overlayW = Math.round(CANVAS_W * clip.scaleX);
                      const overlayH = Math.round(CANVAS_H * clip.scaleY);
                      const isOvSelected = selection?.type === "overlay" && selection.id === clip.id;
                      return (
                        <div
                          key={clip.id}
                          data-overlay-dragged="false"
                          onMouseDown={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelection({ type: "overlay", id: clip.id });
                            const container = previewCanvasRef.current;
                            if (!container) return;
                            const rect = container.getBoundingClientRect();
                            const scaleX = rect.width / CANVAS_W;
                            const scaleY = rect.height / CANVAS_H;
                            const startMouseX = e.clientX;
                            const startMouseY = e.clientY;
                            const startX = clip.x;
                            const startY = clip.y;
                            const el = e.currentTarget;
                            el.dataset.overlayDragged = "false";
                            let active = true;
                            const cleanup = () => {
                              if (!active) return;
                              active = false;
                              window.removeEventListener("mousemove", move);
                              window.removeEventListener("mouseup", up);
                              window.removeEventListener("blur", cleanup);
                              document.removeEventListener("visibilitychange", cleanup);
                            };
                            const move = (me: MouseEvent) => {
                              if (!active) return;
                              const dx = (me.clientX - startMouseX) / scaleX;
                              const dy = (me.clientY - startMouseY) / scaleY;
                              if (Math.abs(dx) > 2 || Math.abs(dy) > 2) el.dataset.overlayDragged = "true";
                              updateOverlay(clip.id, {
                                x: Math.round(startX + dx),
                                y: Math.round(startY + dy),
                              });
                            };
                            const up = () => { cleanup(); };
                            window.addEventListener("mousemove", move);
                            window.addEventListener("mouseup", up);
                            window.addEventListener("blur", cleanup);
                            document.addEventListener("visibilitychange", cleanup);
                          }}
                          className={cn(
                            "absolute rounded-md overflow-hidden cursor-move shadow-lg transition-shadow select-none",
                            isOvSelected ? "ring-2 ring-violet-500 shadow-violet-500/30" : "ring-1 ring-white/40 hover:ring-white/70"
                          )}
                          style={{
                            left: `${(clip.x / CANVAS_W) * 100}%`,
                            top: `${(clip.y / CANVAS_H) * 100}%`,
                            width: `${(overlayW / CANVAS_W) * 100}%`,
                            height: `${(overlayH / CANVAS_H) * 100}%`,
                          }}
                        >
                          <video
                            src={clip.url}
                            className="w-full h-full object-cover pointer-events-none"
                            style={{
                              objectPosition: `${clip.panX}% ${clip.panY}%`,
                            }}
                            ref={el => {
                              if (!el) return;
                              el.volume = muted ? 0 : overlayVolume;
                              el.dataset.trimIn = String(clip.trimIn);
                              el.dataset.trimOut = String(clip.trimOut);
                              overlayVideoRefs.current.set(clip.id, el);
                              if (!(el as any)._trimBound) {
                                (el as any)._trimBound = true;
                                const oid = clip.id;
                                el.addEventListener("timeupdate", () => {
                                  const ti = parseFloat(el.dataset.trimIn || "0");
                                  const to = parseFloat(el.dataset.trimOut || String(el.duration));
                                  if (el.currentTime >= to || el.currentTime < ti) {
                                    el.currentTime = ti;
                                  }
                                  overlayTimesRef.current[oid] = el.currentTime;
                                  const ph = document.getElementById(`ovr-playhead-${oid}`);
                                  if (ph) {
                                    const ti = parseFloat(el.dataset.trimIn || "0");
                                    const to = parseFloat(el.dataset.trimOut || String(el.duration));
                                    const dur = to - ti;
                                    const pct = dur > 0 ? Math.min(100, Math.max(0, ((el.currentTime - ti) / dur) * 100)) : 0;
                                    ph.style.left = `${pct}%`;
                                  }
                                });
                                el.addEventListener("play", () => {
                                  setOverlayPlayingMap(prev => ({ ...prev, [oid]: true }));
                                });
                                el.addEventListener("pause", () => {
                                  setOverlayPlayingMap(prev => ({ ...prev, [oid]: false }));
                                });
                                el.addEventListener("loadedmetadata", () => {
                                  const ti = parseFloat(el.dataset.trimIn || "0");
                                  if (ti > 0) el.currentTime = ti;
                                  el.play().then(() => {
                                    setOverlayPlayingMap(prev => ({ ...prev, [oid]: true }));
                                  }).catch(() => {
                                    setOverlayPlayingMap(prev => ({ ...prev, [oid]: false }));
                                  });
                                });
                              }
                            }}
                            playsInline
                          />
                          <div
                            className={cn(
                              "absolute inset-0 flex items-center justify-center transition-opacity",
                              isOvSelected ? "bg-black/20 opacity-100" : "opacity-0 hover:opacity-100 bg-black/30",
                              isOvSelected && shiftHeld ? "cursor-grab" : ""
                            )}
                            onClick={(e) => {
                              const wrapper = e.currentTarget.closest("[data-overlay-dragged]") as HTMLElement | null;
                              if (wrapper?.dataset.overlayDragged === "true") return;
                              if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                                e.stopPropagation();
                                toggleOverlayPlay(clip.id);
                              }
                            }}
                            onMouseDown={isOvSelected ? (e) => {
                              if (e.altKey || e.shiftKey) {
                                e.preventDefault();
                                e.stopPropagation();
                                const startX = e.clientX;
                                const startY = e.clientY;
                                const startPanX = clip.panX;
                                const startPanY = clip.panY;
                                const styleEl = document.createElement("style");
                                styleEl.textContent = `* { cursor: grabbing !important; }`;
                                document.head.appendChild(styleEl);
                                let active = true;
                                const cleanup = () => {
                                  if (!active) return;
                                  active = false;
                                  styleEl.remove();
                                  window.removeEventListener("mousemove", move);
                                  window.removeEventListener("mouseup", up);
                                  window.removeEventListener("blur", cleanup);
                                  document.removeEventListener("visibilitychange", cleanup);
                                };
                                const move = (me: MouseEvent) => {
                                  if (!active) return;
                                  const dx = me.clientX - startX;
                                  const dy = me.clientY - startY;
                                  updateOverlay(clip.id, {
                                    panX: Math.max(0, Math.min(100, startPanX - dx * 0.4)),
                                    panY: Math.max(0, Math.min(100, startPanY - dy * 0.4)),
                                  });
                                };
                                const up = () => { cleanup(); };
                                window.addEventListener("mousemove", move);
                                window.addEventListener("mouseup", up);
                                window.addEventListener("blur", cleanup);
                                document.addEventListener("visibilitychange", cleanup);
                              }
                            } : undefined}
                          >
                            {overlayPlayingMap[clip.id] === false && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center">
                                  <Play className="w-4 h-4 text-white ml-0.5" />
                                </div>
                              </div>
                            )}
                            <span className="text-[9px] text-white/80 bg-black/50 rounded px-1.5 py-0.5">
                              {isOvSelected && shiftHeld ? "✋ Shift+drag to pan" : isOvSelected ? "⠿ drag · click ▶/❚❚" : "click ▶/❚❚"}
                            </span>
                          </div>
                          {isOvSelected && (
                            <>
                              {(["tl","t","tr","l","r","bl","b","br"] as const).map(handle => {
                                const isSide = handle === "t" || handle === "b" || handle === "l" || handle === "r";
                                return (
                                  <div
                                    key={handle}
                                    className={cn(
                                      "absolute bg-white border-2 border-violet-500 z-20",
                                      isSide ? "rounded-[2px]" : "rounded-sm",
                                      (handle === "t" || handle === "b") && "w-5 h-2.5",
                                      (handle === "l" || handle === "r") && "w-2.5 h-5",
                                      (!isSide) && "w-3 h-3",
                                      handle === "tl" && "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
                                      handle === "tr" && "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize",
                                      handle === "bl" && "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
                                      handle === "br" && "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize",
                                      handle === "t" && "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize",
                                      handle === "b" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
                                      handle === "l" && "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
                                      handle === "r" && "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-e-resize",
                                    )}
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const container = previewCanvasRef.current;
                                      if (!container) return;
                                      const rect = container.getBoundingClientRect();
                                      const pxScale = rect.width / CANVAS_W;
                                      const startMouseX = e.clientX;
                                      const startMouseY = e.clientY;
                                      const startSX = clip.scaleX;
                                      const startSY = clip.scaleY;
                                      const startX = clip.x;
                                      const startY = clip.y;
                                      const hasLeft = handle === "l" || handle === "tl" || handle === "bl";
                                      const hasTop = handle === "t" || handle === "tl" || handle === "tr";
                                      let active = true;
                                      const cleanup = () => {
                                        if (!active) return;
                                        active = false;
                                        window.removeEventListener("mousemove", move);
                                        window.removeEventListener("mouseup", up);
                                        window.removeEventListener("blur", cleanup);
                                        document.removeEventListener("visibilitychange", cleanup);
                                      };
                                      const move = (me: MouseEvent) => {
                                        if (!active) return;
                                        const dx = (me.clientX - startMouseX) / pxScale / CANVAS_W;
                                        const dy = (me.clientY - startMouseY) / pxScale / CANVAS_H;
                                        let newSX = startSX;
                                        let newSY = startSY;
                                        if (handle === "r" || handle === "tr" || handle === "br") newSX = startSX + dx;
                                        if (hasLeft) newSX = startSX - dx;
                                        if (handle === "b" || handle === "br" || handle === "bl") newSY = startSY + dy;
                                        if (hasTop) newSY = startSY - dy;
                                        if (!isSide) {
                                          const avg = (newSX + newSY) / 2;
                                          newSX = avg;
                                          newSY = avg;
                                        }
                                        const clampedSX = Math.max(0.05, Math.min(0.95, newSX));
                                        const clampedSY = Math.max(0.05, Math.min(0.95, newSY));
                                        const updates: Record<string, number> = {
                                          scaleX: clampedSX,
                                          scaleY: clampedSY,
                                          scale: (clampedSX + clampedSY) / 2,
                                        };
                                        if (hasLeft) {
                                          updates.x = Math.round(startX + (startSX - clampedSX) * CANVAS_W);
                                        }
                                        if (hasTop) {
                                          updates.y = Math.round(startY + (startSY - clampedSY) * CANVAS_H);
                                        }
                                        updateOverlay(clip.id, updates);
                                      };
                                      const up = () => { cleanup(); };
                                      window.addEventListener("mousemove", move);
                                      window.addEventListener("mouseup", up);
                                      window.addEventListener("blur", cleanup);
                                      document.addEventListener("visibilitychange", cleanup);
                                    }}
                                  />
                                );
                              })}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-white/30 text-sm">Select a clip from the timeline</div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 border-t border-destructive/20 px-4 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
          {result && (
            <div className="bg-emerald-500/10 border-t border-emerald-500/20 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <p className="font-semibold text-sm">Merge complete!</p>
              </div>
              <a href={`/api/media/download/${result.fileId}`} download>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Download
                </Button>
              </a>
            </div>
          )}

          {/* Mobile clips strip — visible below lg */}
          <div className="lg:hidden shrink-0 border-t border-border/30 bg-[#0a0c14] px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Your Videos</p>
              <button
                onClick={() => mainInputRef.current?.click()}
                className="text-[10px] text-primary/70 hover:text-primary flex items-center gap-1 transition-colors"
              >
                <Upload className="w-3 h-3" /> Upload
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {mainClips.map(clip => {
                const isSel = selection?.type === "main" && selection.id === clip.id;
                return (
                  <div key={clip.id} onClick={() => setSelection({ type: "main", id: clip.id })}
                    className={cn(
                      "shrink-0 w-20 cursor-pointer rounded-lg overflow-hidden border-2 transition-all",
                      isSel ? "border-indigo-500" : "border-transparent hover:border-indigo-500/40"
                    )}>
                    <video src={clip.url} className="w-full h-12 object-cover" muted playsInline preload="metadata" />
                    <div className="px-1 py-0.5 bg-[#0a0c14]">
                      <p className="text-[9px] truncate text-foreground/70">{clip.name.replace(/\.[^.]+$/, "")}</p>
                      <p className="text-[9px] text-muted-foreground/50 font-mono">{formatSec(clip.durationSec)}</p>
                    </div>
                  </div>
                );
              })}
              <button
                onClick={() => mainInputRef.current?.click()}
                className="shrink-0 w-10 h-[68px] rounded-lg border-2 border-dashed border-border/40 flex items-center justify-center text-muted-foreground/50 hover:border-primary/50 hover:text-primary/70 transition-all"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Toolbar row */}
          {mainClips.length > 0 && (
            <div className="shrink-0 flex items-center gap-0 px-2 py-1 border-t border-border/30 bg-card/20 overflow-x-auto">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all whitespace-nowrap"
              >
                <Scissors className="w-3.5 h-3.5" /> Split
              </button>
              <div className="w-px h-4 bg-border/30 mx-0.5 shrink-0" />
              <button
                onClick={() => { if (selection?.type === "main") removeMain(selection.id); else if (selection?.type === "overlay") removeOverlay(selection.id); }}
                disabled={!selection}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" /> Delete
              </button>
              <div className="w-px h-4 bg-border/30 mx-0.5 shrink-0" />
              <button
                onClick={() => setShowRightPanel(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all whitespace-nowrap"
              >
                <Zap className="w-3.5 h-3.5" /> Transition
              </button>
              <div className="w-px h-4 bg-border/30 mx-0.5 shrink-0" />
              <button
                onClick={() => setMuted(m => !m)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all whitespace-nowrap"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />} Volume
              </button>
              <div className="w-px h-4 bg-border/30 mx-0.5 shrink-0" />
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all whitespace-nowrap"
              >
                <Gauge className="w-3.5 h-3.5" /> Speed
              </button>
            </div>
          )}

          {mainClips.length > 0 && (() => {
            const vc = visibleClip;
            const trimIn = vc?.trimIn ?? 0;
            const trimOut = vc?.trimOut ?? clipDuration;
            const trimmedDuration = trimOut - trimIn;
            const relativeTime = Math.max(0, currentTime - trimIn);
            const progressPct = trimmedDuration > 0 ? Math.min(100, (relativeTime / trimmedDuration) * 100) : 0;

            return (
              <div className="shrink-0 border-t border-border/40 bg-card/30">
                <div
                  className="relative h-2 bg-white/5 cursor-pointer group/scrub mx-3 mt-2 rounded-full overflow-hidden"
                  onClick={e => {
                    const vid = videoRef.current;
                    if (!vid || !vc) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const newTime = trimIn + pct * trimmedDuration;
                    vid.currentTime = newTime;
                    setCurrentTime(newTime);
                  }}
                >
                  <div
                    ref={progressBarRef}
                    className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                  <div
                    ref={scrubHandleRef}
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                    style={{ left: `calc(${progressPct}% - 6px)` }}
                  />
                </div>

                <div className="flex items-center gap-3 px-3 py-2">
                  <button onClick={() => setMuted(m => !m)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>

                  <div className="flex items-center gap-1.5 min-w-0" style={{ width: 120 }}>
                    <span className="text-[9px] text-muted-foreground uppercase shrink-0 w-7">Main</span>
                    <div className="flex-1">
                      <Slider value={[mainVolume]} min={0} max={1} step={0.05}
                        onValueChange={([v]) => setMainVolume(v)} />
                    </div>
                    <span className="text-[9px] font-mono text-foreground w-7 text-right shrink-0">{Math.round(mainVolume * 100)}%</span>
                  </div>

                  {overlayClips.length > 0 && (
                    <div className="flex items-center gap-1.5 min-w-0" style={{ width: 120 }}>
                      <span className="text-[9px] text-violet-400 uppercase shrink-0 w-7">OVR</span>
                      <div className="flex-1">
                        <Slider value={[overlayVolume]} min={0} max={1} step={0.05}
                          onValueChange={([v]) => setOverlayVolume(v)} />
                      </div>
                      <span className="text-[9px] font-mono text-foreground w-7 text-right shrink-0">{Math.round(overlayVolume * 100)}%</span>
                    </div>
                  )}

                  {audioTrack && (
                    <div className="flex items-center gap-1.5 min-w-0" style={{ width: 140 }}>
                      <button onClick={toggleAudioPlay} className="text-amber-400 hover:text-amber-300 transition-colors shrink-0 w-4 flex items-center justify-center" title={audioPlaying ? "Pause audio" : "Play audio"}>
                        {audioPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      <span className="text-[9px] text-amber-400 uppercase shrink-0 w-5">SFX</span>
                      <div className="flex-1">
                        <Slider value={[audioVolume]} min={0} max={1} step={0.05}
                          onValueChange={([v]) => setAudioVolume(v)} />
                      </div>
                      <span className="text-[9px] font-mono text-foreground w-7 text-right shrink-0">{Math.round(audioVolume * 100)}%</span>
                    </div>
                  )}

                  <div className="flex-1 flex items-center justify-center gap-3">
                    <button onClick={skipPrev} className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                      disabled={!selection || selection.type !== "main" || mainClips.findIndex(c => c.id === selection.id) <= 0}>
                      <SkipBack className="w-4 h-4" />
                    </button>
                    <button
                      onClick={togglePlay}
                      disabled={!visibleClip}
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-foreground transition-colors disabled:opacity-30"
                    >
                      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </button>
                    <button onClick={skipNext} className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                      disabled={!selection || selection.type !== "main" || mainClips.findIndex(c => c.id === selection.id) >= mainClips.length - 1}>
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>

                  <span ref={timeDisplayRef} className="text-xs text-muted-foreground font-mono tabular-nums min-w-[110px] text-right shrink-0">
                    {formatTime(relativeTime)} / {formatTime(trimmedDuration)}
                  </span>
                </div>
              </div>
            );
          })()}

          <div
            className="shrink-0 border-t border-border/40 bg-card/20 px-3 py-2 overflow-x-auto"
            onDrop={e => { e.preventDefault(); setMainDragging(false); addMainFiles(e.dataTransfer.files); }}
            onDragOver={e => { e.preventDefault(); setMainDragging(true); }}
            onDragLeave={() => setMainDragging(false)}
          >
            <div className="flex items-stretch gap-0 min-h-[56px]">
              {mainClips.map((clip, idx) => {
                const trimmedDur = clip.trimOut - clip.trimIn;
                const minW = 100;
                const maxW = 220;
                const blockW = Math.max(minW, Math.min(maxW, 60 + clip.durationSec * 15));
                const isSelected = selection?.type === "main" && selection.id === clip.id;
                const trimLeftPct = (clip.trimIn / clip.durationSec) * 100;
                const trimRightPct = ((clip.durationSec - clip.trimOut) / clip.durationSec) * 100;
                const secPerPx = clip.durationSec / blockW;

                return (
                  <div key={clip.id} className="flex items-stretch shrink-0">
                    <div
                      className={cn(
                        "relative rounded-lg overflow-hidden cursor-pointer transition-all group border-2 select-none",
                        isSelected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]" : "border-transparent hover:border-primary/30"
                      )}
                      style={{ width: `${blockW}px`, height: 52 }}
                      onMouseDown={e => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        e.stopPropagation();
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const relX = e.clientX - rect.left;
                        const handleZone = Math.min(blockW * 0.25, 20);
                        const zone: "left" | "right" =
                          relX <= handleZone ? "left" : "right";

                        const dragCursor = zone === "left" ? "w-resize" : "e-resize";
                        const styleEl = document.createElement("style");
                        styleEl.textContent = `* { cursor: ${dragCursor} !important; }`;
                        document.head.appendChild(styleEl);
                        const startX = e.clientX;
                        const cid = clip.id;
                        const startTrimIn = clip.trimIn;
                        const startTrimOut = clip.trimOut;
                        const dur = clip.durationSec;
                        const spp = secPerPx;
                        let active = true;

                        const cleanup = () => {
                          if (!active) return;
                          active = false;
                          styleEl.remove();
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                          window.removeEventListener("blur", cleanup);
                          document.removeEventListener("visibilitychange", cleanup);
                        };
                        const onMove = (me: MouseEvent) => {
                          if (!active) return;
                          const dx = me.clientX - startX;
                          const dt = dx * spp;
                          if (zone === "left") {
                            const v = Math.max(0, Math.min(startTrimOut - 0.1, startTrimIn + dt));
                            updateMain(cid, { trimIn: Math.round(v * 10) / 10 });
                          } else {
                            const v = Math.max(startTrimIn + 0.1, Math.min(dur, startTrimOut + dt));
                            updateMain(cid, { trimOut: Math.round(v * 10) / 10 });
                          }
                        };
                        const onUp = () => {
                          cleanup();
                          setSelection({ type: "main", id: cid });
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                        window.addEventListener("blur", cleanup);
                        document.addEventListener("visibilitychange", cleanup);
                      }}
                    >
                      <div className={cn("absolute inset-0 bg-gradient-to-r pointer-events-none", CLIP_COLORS[idx % CLIP_COLORS.length])} />
                      <video
                        src={clip.url}
                        className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
                        muted playsInline preload="metadata"
                      />

                      {trimLeftPct > 0.5 && (
                        <div className="absolute top-0 bottom-0 left-0 bg-black/60 z-[5] pointer-events-none" style={{ width: `${trimLeftPct}%` }}>
                          <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-yellow-400/80" />
                        </div>
                      )}
                      {trimRightPct > 0.5 && (
                        <div className="absolute top-0 bottom-0 right-0 bg-black/60 z-[5] pointer-events-none" style={{ width: `${trimRightPct}%` }}>
                          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-yellow-400/80" />
                        </div>
                      )}

                      {visibleClip?.id === clip.id && (
                        <div
                          ref={playheadRef}
                          className="absolute top-0 bottom-0 z-[10] pointer-events-none"
                          style={{ left: `${Math.min(100, Math.max(0, clip.durationSec > 0 ? (currentTime / clip.durationSec) * 100 : 0))}%` }}
                        >
                          <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-white shadow-[0_0_4px_rgba(255,255,255,0.6)]" />
                          <div className="absolute -left-[3px] -top-[2px] w-[6px] h-[6px] rounded-full bg-white shadow-sm" />
                        </div>
                      )}

                      <div className="absolute top-0 bottom-0 left-0 w-5 z-[8] cursor-w-resize flex items-center justify-start pl-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-[3px] h-5 rounded-full bg-white/80 shadow-sm pointer-events-none" />
                      </div>
                      <div className="absolute top-0 bottom-0 right-0 w-5 z-[8] cursor-e-resize flex items-center justify-end pr-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-[3px] h-5 rounded-full bg-white/80 shadow-sm pointer-events-none" />
                      </div>

                      <div className="absolute inset-0 flex items-end justify-between p-1.5 pointer-events-none z-[6]">
                        <span className="text-[10px] text-white font-medium truncate drop-shadow-lg leading-tight flex-1 mr-1">
                          {clip.name.replace(/\.[^.]+$/, "")}
                        </span>
                        <span className="text-[9px] text-white/70 font-mono drop-shadow-lg shrink-0">
                          {formatSec(trimmedDur)}
                        </span>
                      </div>
                      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {idx > 0 && (
                          <button onClick={e => { e.stopPropagation(); moveMain(clip.id, -1); }}
                            className="w-4 h-4 rounded bg-black/60 flex items-center justify-center text-white hover:bg-black/80">
                            <ArrowUp className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {idx < mainClips.length - 1 && (
                          <button onClick={e => { e.stopPropagation(); moveMain(clip.id, 1); }}
                            className="w-4 h-4 rounded bg-black/60 flex items-center justify-center text-white hover:bg-black/80">
                            <ArrowDown className="w-2.5 h-2.5" />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); removeMain(clip.id); }}
                          className="w-4 h-4 rounded bg-black/60 flex items-center justify-center text-white hover:bg-red-600/80">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {clip.motion !== "none" && (
                        <div className="absolute bottom-1 right-1 text-[8px] text-amber-300/80">◎</div>
                      )}
                    </div>

                    {idx < mainClips.length - 1 && (
                      <div className="flex items-center mx-0.5 self-stretch">
                        <span className="text-[11px] text-muted-foreground/50">⚡</span>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={() => mainInputRef.current?.click()}
                className={cn(
                  "shrink-0 rounded-lg border-2 border-dashed flex items-center justify-center transition-all ml-1 cursor-pointer",
                  mainClips.length === 0 ? "flex-1 min-h-[56px]" : "w-[120px] min-h-[52px]",
                  "border-border/40 hover:border-primary/50 text-muted-foreground hover:text-primary"
                )}
              >
                <span className="text-xs">Add more videos</span>
              </button>
            </div>

            {overlayClips.length > 0 && (() => {
              const mainRowW = mainClips.reduce((s, c) => s + Math.max(100, Math.min(220, 60 + c.durationSec * 15)), 0);
              const totalFullDuration = mainClips.reduce((s, c) => s + c.durationSec, 0);
              const pxPerSec = totalFullDuration > 0 ? mainRowW / totalFullDuration : 5;
              return (
                <div className="relative mt-1.5 overflow-hidden" style={{ height: 36, width: mainRowW }}>
                  <span className="absolute -left-8 top-1/2 -translate-y-1/2 text-[9px] text-violet-400/70">OVR</span>
                  {overlayClips.map(clip => {
                    const trimmedDur = clip.trimOut - clip.trimIn;
                    const rawW = trimmedDur * pxPerSec;
                    const rawLeft = clip.offsetTime * pxPerSec;
                    const blockW = Math.max(40, Math.min(rawW, mainRowW - rawLeft));
                    const leftPx = Math.max(0, Math.min(rawLeft, mainRowW - 40));
                    const isSelected = selection?.type === "overlay" && selection.id === clip.id;
                    const secPerPx = 1 / pxPerSec;
                    return (
                      <div
                        key={clip.id}
                        className={cn(
                          "absolute top-0 rounded-md overflow-hidden transition-colors group border-2 shrink-0 select-none",
                          isSelected ? "border-violet-500 shadow-[0_0_0_1px_rgba(139,92,246,0.3)]" : "border-transparent hover:border-violet-500/30"
                        )}
                        style={{ left: leftPx, width: blockW, height: 36 }}
                        onMouseDown={e => {
                          e.stopPropagation();
                          e.preventDefault();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const relX = e.clientX - rect.left;
                          const handleZone = 12;
                          const zone: "left" | "right" | "body" =
                            relX <= handleZone ? "left" :
                            relX >= rect.width - handleZone ? "right" : "body";

                          const startX = e.clientX;
                          const cid = clip.id;
                          const startTrimIn = clip.trimIn;
                          const startTrimOut = clip.trimOut;
                          const startOff = clip.offsetTime;
                          const dur = clip.durationSec;
                          let active = true;

                          const dragCursor =
                            zone === "left" ? "w-resize" :
                            zone === "right" ? "e-resize" : "grabbing";
                          const styleEl = document.createElement("style");
                          styleEl.textContent = `* { cursor: ${dragCursor} !important; }`;
                          document.head.appendChild(styleEl);
                          const cleanup = () => {
                            if (!active) return;
                            active = false;
                            styleEl.remove();
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", onUp);
                            window.removeEventListener("blur", cleanup);
                            document.removeEventListener("visibilitychange", cleanup);
                          };
                          const onMove = (me: MouseEvent) => {
                            if (!active) return;
                            const dx = me.clientX - startX;
                            const dt = dx * secPerPx;

                            if (zone === "left") {
                              const newTrimIn = Math.max(0, Math.min(startTrimOut - 0.1, startTrimIn + dt));
                              const actualDt = newTrimIn - startTrimIn;
                              const newOff = Math.max(0, startOff + actualDt);
                              updateOverlay(cid, {
                                trimIn: Math.round(newTrimIn * 10) / 10,
                                offsetTime: Math.round(newOff * 10) / 10,
                              });
                            } else if (zone === "right") {
                              const v = Math.max(startTrimIn + 0.1, Math.min(dur, startTrimOut + dt));
                              updateOverlay(cid, { trimOut: Math.round(v * 10) / 10 });
                            } else {
                              const td = startTrimOut - startTrimIn;
                              const v = Math.max(0, Math.min(totalFullDuration - td, startOff + dt));
                              updateOverlay(cid, { offsetTime: Math.round(v * 10) / 10 });
                            }
                          };
                          const onUp = () => {
                            cleanup();
                            setSelection({ type: "overlay", id: cid });
                          };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                          window.addEventListener("blur", cleanup);
                          document.addEventListener("visibilitychange", cleanup);
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-violet-600/60 to-purple-600/60 pointer-events-none" />
                        <video
                          src={clip.url}
                          className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                          muted playsInline preload="metadata"
                        />

                        <div
                          id={`ovr-playhead-${clip.id}`}
                          className="absolute top-0 bottom-0 z-[10] pointer-events-none"
                          style={{ left: "0%" }}
                        >
                          <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-violet-300 shadow-[0_0_4px_rgba(167,139,250,0.6)]" />
                          <div className="absolute -left-[3px] -top-[2px] w-[6px] h-[6px] rounded-full bg-violet-300 shadow-sm" />
                        </div>

                        <div className="absolute top-0 bottom-0 left-0 w-3 cursor-w-resize z-[12] pointer-events-none">
                          <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-violet-400/80" />
                        </div>

                        <div className="absolute top-0 bottom-0 right-0 w-3 cursor-e-resize z-[12] pointer-events-none">
                          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-violet-400/80" />
                        </div>

                        <div className="absolute inset-0 flex items-center px-2 pointer-events-none z-[6]">
                          <div className="flex items-center gap-1 overflow-hidden">
                            <PictureInPicture2 className="w-3 h-3 text-white/70 shrink-0" />
                            <span className="text-[9px] text-white/80 font-medium truncate">{clip.name.split(".")[0]}</span>
                          </div>
                          <span className="text-[9px] text-white/60 ml-auto shrink-0">{formatSec(trimmedDur)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

      </div>{/* ── end CENTER ── */}

      <RightPanel
        selection={selection}
        mainClips={mainClips}
        overlayClips={overlayClips}
        totalDuration={totalDuration}
        onUpdateMain={updateMain}
        onUpdateOverlay={updateOverlay}
        onAddFiles={() => mainInputRef.current?.click()}
        onAddOverlayFiles={() => overlayInputRef.current?.click()}
        onSelectOverlay={(id) => setSelection({ type: "overlay", id })}
        onRemoveOverlay={removeOverlay}
        aspectRatio={aspectRatio}
        onAspectRatioChange={setAspectRatio}
        cropMode={cropMode}
        onCropModeChange={setCropMode}
        overlayExpanded={overlayExpanded}
        onToggleOverlay={() => setOverlayExpanded(e => !e)}
        audioTrack={audioTrack}
        onAddAudio={() => audioInputRef.current?.click()}
        onRemoveAudio={() => { setAudioTrack(null); setAudioPlaying(false); if (audioRef.current) audioRef.current.pause(); }}
        audioPlaying={audioPlaying}
        onToggleAudioPlay={toggleAudioPlay}
        open={showRightPanel}
        onClose={() => setShowRightPanel(false)}
      />
    </div>
  );
}
