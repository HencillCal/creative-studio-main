import { useState, useRef, useCallback, useEffect } from "react";
import {
  Plus, Upload, LayoutGrid, Type, Music, Video, ImageIcon,
  Shapes, Circle, AudioLines, Undo2, Redo2, Download,
  SkipBack, SkipForward, Play, Pause, ChevronLeft, ChevronRight,
  Minus, ZoomIn, Maximize2, Trash2, X, Link as LinkIcon,
  Scissors, ArrowLeft, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type TabId = "media" | "canvas" | "text" | "audio" | "videos" | "images" | "elements" | "record" | "tts";

interface SidebarTab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const TABS: SidebarTab[] = [
  { id: "media",    label: "Media",    icon: Upload },
  { id: "canvas",   label: "Canvas",   icon: LayoutGrid },
  { id: "text",     label: "Text",     icon: Type },
  { id: "audio",    label: "Audio",    icon: Music },
  { id: "videos",   label: "Videos",   icon: Video },
  { id: "images",   label: "Images",   icon: ImageIcon },
  { id: "elements", label: "Elements", icon: Shapes },
  { id: "record",   label: "Record",   icon: Circle },
  { id: "tts",      label: "TTS",      icon: AudioLines },
];

interface MediaFile {
  id: string;
  file: File;
  name: string;
  url: string;
  type: "video" | "image" | "audio";
  durationSec: number;
  thumbnail?: string;
}

interface TimelineClip {
  id: string;
  mediaId: string;
  name: string;
  url: string;
  type: "video" | "image" | "audio";
  durationSec: number;
  trimIn: number;
  trimOut: number;
  color: string;
}

const CLIP_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const whole = Math.floor(s);
  const frac = Math.floor((s - whole) * 100);
  return `${m}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

function loadMediaFile(file: File): Promise<MediaFile> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const id = makeId();
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const type: MediaFile["type"] = isVideo ? "video" : isAudio ? "audio" : "image";

    if (isVideo) {
      const el = document.createElement("video");
      el.src = url;
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        resolve({ id, file, name: file.name, url, type, durationSec: el.duration || 0 });
      };
      el.onerror = () => resolve({ id, file, name: file.name, url, type, durationSec: 0 });
    } else if (isAudio) {
      const el = document.createElement("audio");
      el.src = url;
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        resolve({ id, file, name: file.name, url, type, durationSec: el.duration || 0 });
      };
      el.onerror = () => resolve({ id, file, name: file.name, url, type, durationSec: 0 });
    } else {
      resolve({ id, file, name: file.name, url, type, durationSec: 5 });
    }
  });
}

function MediaPanel({
  mediaFiles,
  onUpload,
  onAddToTimeline,
}: {
  mediaFiles: MediaFile[];
  onUpload: (files: FileList) => void;
  onAddToTimeline: (media: MediaFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
  }, [onUpload]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all",
            dragging
              ? "border-indigo-400 bg-indigo-500/10"
              : "border-white/20 hover:border-white/40 bg-white/5"
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="w-8 h-8 text-white/40 mb-2" />
          <p className="text-sm font-medium text-white/80">Click to upload</p>
          <p className="text-xs text-white/40">or drag & drop file here</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*,image/*,audio/*"
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {mediaFiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {mediaFiles.map(media => (
              <button
                key={media.id}
                onClick={() => onAddToTimeline(media)}
                className="group relative rounded-lg overflow-hidden border border-white/10 hover:border-indigo-400/60 transition-all bg-black/30"
              >
                {media.type === "video" ? (
                  <video
                    src={media.url}
                    className="w-full aspect-video object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : media.type === "image" ? (
                  <img
                    src={media.url}
                    className="w-full aspect-video object-cover"
                    alt={media.name}
                  />
                ) : (
                  <div className="w-full aspect-video bg-gradient-to-br from-purple-900/40 to-pink-900/40 flex items-center justify-center">
                    <Music className="w-6 h-6 text-white/40" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                  <Plus className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-[10px] text-white/70 truncate">{media.name}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-around px-2 py-2 border-t border-white/10 bg-white/5">
        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white">
          <Video className="w-5 h-5" />
        </button>
        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white">
          <User className="w-5 h-5" />
        </button>
        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-red-400/70 hover:text-red-400">
          <Circle className="w-5 h-5 fill-current" />
        </button>
        <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white">
          <AudioLines className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function PlaceholderPanel({ tab }: { tab: TabId }) {
  const tabInfo = TABS.find(t => t.id === tab);
  const Icon = tabInfo?.icon ?? Shapes;
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
      <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-white/40" />
      </div>
      <p className="text-sm font-medium text-white/60">{tabInfo?.label}</p>
      <p className="text-xs text-white/30">Coming soon</p>
    </div>
  );
}

export default function VideoEditor() {
  const [activeTab, setActiveTab] = useState<TabId>("media");
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(100);
  const mediaRef = useRef<HTMLMediaElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const selectedClip = timelineClips.find(c => c.id === selectedClipId) ?? null;

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

  const handleUpload = useCallback(async (files: FileList) => {
    const loaded: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const media = await loadMediaFile(file);
      loaded.push(media);
    }
    loaded.forEach(m => objectUrlsRef.current.add(m.url));
    setMediaFiles(prev => [...prev, ...loaded]);

    const newClips: TimelineClip[] = loaded.map((media, i) => ({
      id: makeId(),
      mediaId: media.id,
      name: media.name,
      url: media.url,
      type: media.type,
      durationSec: media.durationSec,
      trimIn: 0,
      trimOut: media.durationSec,
      color: CLIP_COLORS[(timelineClips.length + i) % CLIP_COLORS.length],
    }));
    setTimelineClips(prev => [...prev, ...newClips]);
    if (newClips.length > 0) setSelectedClipId(newClips[0].id);
  }, [timelineClips.length]);

  const handleAddToTimeline = useCallback((media: MediaFile) => {
    const clip: TimelineClip = {
      id: makeId(),
      mediaId: media.id,
      name: media.name,
      url: media.url,
      type: media.type,
      durationSec: media.durationSec,
      trimIn: 0,
      trimOut: media.durationSec,
      color: CLIP_COLORS[timelineClips.length % CLIP_COLORS.length],
    };
    setTimelineClips(prev => [...prev, clip]);
    setSelectedClipId(clip.id);
  }, [timelineClips.length]);

  const handleRemoveClip = useCallback((id: string) => {
    setTimelineClips(prev => prev.filter(c => c.id !== id));
    if (selectedClipId === id) setSelectedClipId(null);
  }, [selectedClipId]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(selectedClip?.durationSec ?? 0);
    setIsPlaying(false);
  }, [selectedClipId]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !selectedClip) return;
    if (el.paused) {
      el.play().catch(() => {});
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [selectedClip]);

  const seekTo = useCallback((time: number) => {
    const el = mediaRef.current;
    if (el) {
      el.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const skipToStart = () => seekTo(0);
  const skipToEnd = () => seekTo(duration);
  const stepBack = () => seekTo(Math.max(0, currentTime - 1 / 30));
  const stepForward = () => seekTo(Math.min(duration, currentTime + 1 / 30));

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1a1225] text-white select-none overflow-hidden">

      {/* ── Top Bar ── */}
      <div className="h-12 flex items-center justify-between px-4 bg-[#251830] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <button className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors text-sm">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Play className="w-3.5 h-3.5 text-white fill-white" />
            </div>
            <span className="text-sm font-semibold text-white/90">Untitled Project</span>
            <span className="text-xs text-white/40">{dateStr}</span>
          </div>
          <button className="p-1 rounded hover:bg-white/10 text-white/40">
            <LinkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
            <Undo2 className="w-4 h-4" />
          </button>
          <button className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
            <Redo2 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left icon sidebar ── */}
        <div className="w-14 flex flex-col items-center py-2 bg-[#1e1428] border-r border-white/10 shrink-0 gap-0.5">
          <button
            onClick={() => {
              setActiveTab("media");
              document.querySelector<HTMLInputElement>("#ve-file-input")?.click();
            }}
            className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center mb-2 transition-colors"
          >
            <Plus className="w-5 h-5 text-white" />
          </button>

          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-12 flex flex-col items-center gap-0.5 py-2 rounded-xl transition-all text-[10px]",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="leading-none">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Left panel ── */}
        <div className="w-72 bg-[#201530] border-r border-white/10 shrink-0 flex flex-col overflow-hidden">
          <input
            id="ve-file-input"
            type="file"
            multiple
            accept="video/*,image/*,audio/*"
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) handleUpload(e.target.files);
              e.target.value = "";
            }}
          />
          {activeTab === "media" ? (
            <MediaPanel
              mediaFiles={mediaFiles}
              onUpload={handleUpload}
              onAddToTimeline={handleAddToTimeline}
            />
          ) : (
            <PlaceholderPanel tab={activeTab} />
          )}
        </div>

        {/* ── Main area (canvas + timeline) ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ── Preview canvas area ── */}
          <div className="flex-1 flex items-center justify-center bg-[#130d1a] p-4 relative min-h-0">
            <div
              className="relative bg-black rounded-lg overflow-hidden shadow-2xl border border-white/5"
              style={{ aspectRatio: "16/9", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "100%" }}
            >
              {selectedClip && selectedClip.type === "video" ? (
                <video
                  key={selectedClip.id}
                  ref={mediaRef as React.RefObject<HTMLVideoElement>}
                  src={selectedClip.url}
                  className="w-full h-full object-contain"
                  muted
                  playsInline
                  onEnded={() => setIsPlaying(false)}
                  onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration)}
                  onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                />
              ) : selectedClip && selectedClip.type === "image" ? (
                <img src={selectedClip.url} className="w-full h-full object-contain" alt="" />
              ) : selectedClip && selectedClip.type === "audio" ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3" style={{ aspectRatio: "16/9", minHeight: 300 }}>
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600/40 to-pink-600/40 flex items-center justify-center">
                    <Music className="w-8 h-8 text-white/60" />
                  </div>
                  <p className="text-xs text-white/40 truncate max-w-[60%]">{selectedClip.name}</p>
                  <audio
                    key={selectedClip.id}
                    ref={mediaRef as React.RefObject<HTMLAudioElement>}
                    src={selectedClip.url}
                    onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
                    onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
                    onEnded={() => setIsPlaying(false)}
                  />
                </div>
              ) : (
                <div className="w-full h-full" style={{ aspectRatio: "16/9", minHeight: 300 }} />
              )}
              <div className="absolute top-3 left-3">
                <div className="w-5 h-5 rounded-full border-2 border-white/30 bg-white/5" />
              </div>
            </div>
          </div>

          {/* ── Playback controls bar ── */}
          <div className="h-10 flex items-center justify-between px-3 bg-[#1e1428] border-t border-white/10 shrink-0">
            <div className="flex items-center gap-1">
              <button className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors" title="Delete">
                <Scissors className="w-4 h-4" />
              </button>
              <button className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors" title="Undo">
                <Undo2 className="w-4 h-4" />
              </button>
              <button className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button onClick={skipToStart} className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                <SkipBack className="w-4 h-4" />
              </button>
              <button onClick={stepBack} className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={togglePlay}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button onClick={stepForward} className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
              <button onClick={skipToEnd} className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                <SkipForward className="w-4 h-4" />
              </button>
              <span className="ml-2 text-xs text-white/50 font-mono tabular-nums w-32 text-center">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setZoom(z => Math.max(25, z - 25))} className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setZoom(z => Math.min(400, z + 25))} className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── Timeline track area ── */}
          <div className="h-44 bg-[#16101e] border-t border-white/10 shrink-0 overflow-x-auto overflow-y-hidden flex flex-col">
            {timelineClips.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-white/30 text-sm">Add media to timeline to start creating video!</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col p-2 gap-1 min-w-0">
                {/* Video track */}
                <div className="flex items-center gap-0.5 h-16">
                  <div className="w-16 shrink-0 flex items-center justify-center">
                    <Video className="w-4 h-4 text-white/30" />
                  </div>
                  <div className="flex gap-1 overflow-x-auto flex-1 items-center py-1">
                    {timelineClips.filter(c => c.type !== "audio").map(clip => {
                      const dur = clip.trimOut - clip.trimIn;
                      const pxWidth = Math.max(60, dur * (zoom / 100) * 30);
                      const active = selectedClipId === clip.id;
                      return (
                        <div
                          key={clip.id}
                          className={cn(
                            "relative shrink-0 h-14 rounded-lg cursor-pointer overflow-hidden border-2 transition-all group",
                            active
                              ? "border-white shadow-lg"
                              : "border-transparent hover:border-white/30"
                          )}
                          style={{ width: pxWidth, backgroundColor: clip.color }}
                          onClick={() => setSelectedClipId(clip.id)}
                        >
                          {clip.type === "video" ? (
                            <video src={clip.url} className="w-full h-full object-cover opacity-60" muted playsInline preload="metadata" />
                          ) : (
                            <img src={clip.url} className="w-full h-full object-cover opacity-60" alt="" />
                          )}
                          <div className="absolute inset-0 flex items-end p-1">
                            <p className="text-[9px] text-white font-medium truncate w-full drop-shadow-md">
                              {clip.name.length > 16 ? clip.name.slice(0, 14) + "..." : clip.name}
                            </p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handleRemoveClip(clip.id); }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white/70 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Audio track */}
                <div className="flex items-center gap-0.5 h-10">
                  <div className="w-16 shrink-0 flex items-center justify-center">
                    <Music className="w-4 h-4 text-white/30" />
                  </div>
                  <div className="flex gap-1 overflow-x-auto flex-1 items-center py-1">
                    {timelineClips.filter(c => c.type === "audio").map(clip => {
                      const dur = clip.trimOut - clip.trimIn;
                      const pxWidth = Math.max(60, dur * (zoom / 100) * 30);
                      const active = selectedClipId === clip.id;
                      return (
                        <div
                          key={clip.id}
                          className={cn(
                            "relative shrink-0 h-8 rounded-md cursor-pointer overflow-hidden border-2 transition-all group flex items-center px-2",
                            active
                              ? "border-white shadow-lg"
                              : "border-transparent hover:border-white/30"
                          )}
                          style={{ width: pxWidth, backgroundColor: clip.color + "80" }}
                          onClick={() => setSelectedClipId(clip.id)}
                        >
                          <Music className="w-3 h-3 text-white/60 shrink-0 mr-1" />
                          <p className="text-[9px] text-white/70 truncate">{clip.name}</p>
                          <button
                            onClick={e => { e.stopPropagation(); handleRemoveClip(clip.id); }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white/70 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
