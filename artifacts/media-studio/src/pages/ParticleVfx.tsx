import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft, Sparkles, Play, Pause, Download, RotateCcw,
  Snowflake, CloudRain, Cloud, Waves, Star, PartyPopper, Droplets, Bird, Bug, Leaf,
  Upload, X, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type ParticleType = "snow" | "rain" | "stars" | "fireflies" | "confetti" | "bubbles" | "birds"
  | "dove" | "eagle" | "parrot" | "flamingo" | "bees" | "crickets" | "flies" | "leaves" | "water" | "clouds"
  | "butterflies";

type WaterStyle = "clear" | "storm" | "pond" | "blue" | "muddy" | "tropical" | "deep" | "sunset" | "ice";
type WaterShape = "rectangle" | "oval" | "circle" | "puddle" | "shore" | "wave" | "blob" | "diamond";
type WaterMotion = "calm" | "rolling" | "ocean" | "choppy" | "cross" | "ripples" | "tide" | "swirl" | "rain rings";
type SnowStyle = "powder" | "icy" | "sparkle";
type LeafColor = "mixed" | "white" | "green" | "brown";
type LeafShape = "natural" | "maple" | "lance";
type ButterflySpecies = "mixed" | "monarch" | "morpho" | "swallowtail" | "white";
type CloudStyle = "fire" | "fluffy" | "storm" | "wispy" | "firesky" | "sun" | "silver" | "bank";
type CloudDirection = "left" | "right" | "mixed";
type CloudItemDirection = "left" | "right" | "still";
type VideoFitMode = "stretch" | "contain" | "fill" | "cover";

const CLOUD_ASSET_PATHS: Record<CloudStyle, string> = {
  fire: "/clouds/cloud-tower.png",
  fluffy: "/clouds/cloud-sunlit.png",
  storm: "/clouds/cloud-storm.png",
  wispy: "/clouds/cloud-wispy.png",
  firesky: "/clouds/cloud-fire.png",
  sun: "/clouds/cloud-sun.png",
  silver: "/clouds/cloud-silver.png",
  bank: "/clouds/cloud-bank.png",
};

const CLOUD_STYLE_LABELS: Record<CloudStyle, string> = {
  fire: "Tower",
  fluffy: "Fluffy",
  storm: "Storm",
  wispy: "Wispy",
  firesky: "Fire Sky",
  sun: "Sun Cloud",
  silver: "Silver",
  bank: "Cloud Bank",
};

const ALL_CLOUD_STYLES = Object.keys(CLOUD_ASSET_PATHS) as CloudStyle[];

const BUTTERFLY_SPECIES: { id: ButterflySpecies; label: string; atlasIndex: number | null }[] = [
  { id: "mixed", label: "Mixed", atlasIndex: null },
  { id: "monarch", label: "Monarch", atlasIndex: 0 },
  { id: "morpho", label: "Blue Morpho", atlasIndex: 1 },
  { id: "swallowtail", label: "Swallowtail", atlasIndex: 2 },
  { id: "white", label: "Cabbage White", atlasIndex: 3 },
];

interface WaterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type WaterTransformMode = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const PARTICLE_PRESETS: { id: ParticleType; label: string; icon: React.ElementType; desc: string; group: string }[] = [
  { id: "snow",      label: "Snow",      icon: Snowflake,    desc: "Gentle snowfall",              group: "Weather" },
  { id: "rain",      label: "Rain",      icon: CloudRain,    desc: "Falling raindrops",            group: "Weather" },
  { id: "stars",     label: "Stars",     icon: Star,         desc: "Twinkling stars",              group: "Weather" },
  { id: "fireflies", label: "Fireflies", icon: Sparkles,     desc: "Floating light orbs",          group: "Weather" },
  { id: "confetti",  label: "Confetti",  icon: PartyPopper,  desc: "Celebratory colours",          group: "Weather" },
  { id: "bubbles",   label: "Bubbles",   icon: Droplets,     desc: "Rising soap bubbles",          group: "Weather" },
  { id: "water",     label: "Water",     icon: Waves,        desc: "Independent water surface",    group: "Weather" },
  { id: "clouds",    label: "Clouds",    icon: Cloud,        desc: "Moving volumetric clouds",      group: "Weather" },
  { id: "leaves",    label: "Leaves",    icon: Leaf,         desc: "Natural falling leaves",       group: "Nature" },
  { id: "butterflies", label: "Butterflies", icon: Bug,       desc: "Real fluttering butterflies",   group: "Creatures" },
  { id: "birds",     label: "Birds",     icon: Bird,         desc: "Flying bird silhouettes",      group: "Creatures" },
  { id: "dove",      label: "Dove",      icon: Bird,         desc: "Graceful gliding doves",       group: "Creatures" },
  { id: "eagle",     label: "Eagle",     icon: Bird,         desc: "Majestic soaring eagles",      group: "Creatures" },
  { id: "parrot",    label: "Parrot",    icon: Bird,         desc: "Colorful darting parrots",     group: "Creatures" },
  { id: "flamingo",  label: "Flamingo",  icon: Bird,         desc: "Elegant pink flamingos",       group: "Creatures" },
  { id: "bees",      label: "Bees",      icon: Bug,          desc: "Buzzing honeybees",            group: "Insects" },
  { id: "crickets",  label: "Crickets",  icon: Bug,          desc: "Hopping crickets",             group: "Insects" },
  { id: "flies",     label: "Flies",     icon: Bug,          desc: "Erratic buzzing flies",        group: "Insects" },
];

interface Particle {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  opacity: number;
  color: string;
  phase: number;
  rot: number; rotSpeed: number;
  depth: number;
  life: number;
  shapeIdx: number;
  wingPhase: number;
  trail: { x: number; y: number; opacity: number }[];
  splashing: boolean;
  splashRadius: number;
  splashOpacity: number;
  jumpState: number;
  leaderIdx: number;
  dirChangeTimer: number;
  soarAngle: number;
  type: ParticleType;
  cloudStyle?: CloudStyle;
  cloudDirection?: CloudItemDirection;
}

let nextParticleId = 1;

function RangeSlider({ label, value, min, max, step, unit = "", onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs text-muted-foreground">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer accent-primary" />
    </div>
  );
}

const CONFETTI_COLORS = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff922b","#cc5de8","#f06595","#74c0fc"];
const STAR_COLORS = ["#ffffff","#fff5e0","#ffe8b0","#ffd480","#e0e8ff","#c0d0ff"];
const LEAF_COLORS = ["#4f772d", "#6a994e", "#a7c957", "#d97706", "#b45309", "#9f1239"];

const MAX_CANVAS_DIM = 1280;

function clampDims(w: number, h: number): [number, number] {
  const maxDim = Math.max(w, h);
  if (maxDim <= MAX_CANVAS_DIM) return [w, h];
  const scale = MAX_CANVAS_DIM / maxDim;
  return [Math.round(w * scale), Math.round(h * scale)];
}

function computeCanvasDims(nativeW: number, nativeH: number): [number, number] {
  return clampDims(nativeW, nativeH);
}

function drawVideoWithFit(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number, mode: VideoFitMode) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  if (mode === "stretch") {
    ctx.drawImage(video, 0, 0, W, H);
    return;
  }

  const containScale = Math.min(W / vw, H / vh);
  const coverScale = Math.max(W / vw, H / vh);
  const drawScaled = (scale: number) => {
    const width = vw * scale;
    const height = vh * scale;
    ctx.drawImage(video, (W - width) / 2, (H - height) / 2, width, height);
  };

  if (mode === "contain") {
    drawScaled(containScale);
  } else if (mode === "cover") {
    drawScaled(coverScale);
  } else {
    ctx.save();
    ctx.filter = `blur(${Math.max(12, Math.round(Math.min(W, H) * 0.035))}px) saturate(1.12) brightness(0.72)`;
    drawScaled(coverScale * 1.08);
    ctx.restore();
    drawScaled(containScale);
  }
}

function makeParticle(type: ParticleType, W: number, H: number, speedMul: number, sizeMul: number, opacity: number, color: string, startOnScreen = false): Particle {
  const resScale = W / 800;
  sizeMul = sizeMul * resScale;
  speedMul = speedMul * resScale;
  const depth = Math.random();

  let baseSize: number;
  let vx = 0, vy = 0;

  switch (type) {
    case "snow":
      baseSize = (1 + Math.random() * 3 + (Math.random() < 0.1 ? 4 : 0)) * sizeMul * (0.4 + depth * 0.6);
      vx = (Math.random() - 0.5) * speedMul * 0.3;
      vy = (0.3 + Math.random() * 0.6) * speedMul * (0.4 + depth * 0.6);
      break;
    case "rain":
      baseSize = (0.5 + Math.random() * 1.5) * sizeMul * (0.5 + depth * 0.5);
      vx = 1.5 * speedMul;
      vy = (6 + Math.random() * 6) * speedMul * (0.6 + depth * 0.4);
      break;
    case "stars":
      baseSize = (1 + Math.random() * 3) * sizeMul;
      break;
    case "fireflies":
      baseSize = (1.5 + Math.random() * 2.5) * sizeMul;
      vx = (Math.random() - 0.5) * speedMul * 0.3;
      vy = (Math.random() - 0.5) * speedMul * 0.3;
      break;
    case "confetti":
      baseSize = (5 + Math.random() * 7) * sizeMul;
      vx = (Math.random() - 0.5) * speedMul * 0.8;
      vy = (1.5 + Math.random() * 2.5) * speedMul;
      break;
    case "leaves":
      baseSize = (5 + Math.random() * 9) * sizeMul * (0.55 + depth * 0.45);
      vx = (-0.35 + Math.random() * 0.7) * speedMul;
      vy = (0.65 + Math.random() * 1.25) * speedMul * (0.55 + depth * 0.45);
      break;
    case "clouds":
      baseSize = (42 + Math.random() * 78) * sizeMul * (0.55 + depth * 0.45);
      vx = (0.12 + Math.random() * 0.32) * speedMul * (Math.random() < 0.5 ? -1 : 1);
      vy = (Math.random() - 0.5) * 0.035 * speedMul;
      break;
    case "butterflies":
      baseSize = (16 + Math.random() * 24) * sizeMul * (0.65 + depth * 0.45);
      vx = (0.25 + Math.random() * 0.55) * speedMul * (Math.random() < 0.45 ? -1 : 1);
      vy = (Math.random() - 0.5) * speedMul * 0.35;
      break;
    case "water":
      baseSize = 0;
      break;
    case "bubbles":
      baseSize = (4 + Math.random() * 12) * sizeMul;
      vx = 0;
      vy = -(0.3 + Math.random() * 0.8) * speedMul;
      break;
    case "birds":
      baseSize = (6 + Math.random() * 10) * sizeMul * (0.4 + depth * 0.6);
      vx = (1 + Math.random() * 2) * speedMul * (Math.random() < 0.3 ? -1 : 1);
      vy = (Math.random() - 0.5) * speedMul * 0.3;
      break;
    case "dove":
      baseSize = (8 + Math.random() * 6) * sizeMul * (0.5 + depth * 0.5);
      vx = (0.8 + Math.random() * 1.2) * speedMul * (Math.random() < 0.3 ? -1 : 1);
      vy = 0;
      break;
    case "eagle":
      baseSize = (12 + Math.random() * 8) * sizeMul * (0.5 + depth * 0.5);
      vx = (1.5 + Math.random() * 2.5) * speedMul * (Math.random() < 0.4 ? -1 : 1);
      vy = (Math.random() - 0.5) * speedMul * 0.8;
      break;
    case "parrot":
      baseSize = (6 + Math.random() * 5) * sizeMul * (0.5 + depth * 0.5);
      vx = (1.5 + Math.random() * 2.5) * speedMul * (Math.random() < 0.4 ? -1 : 1);
      vy = (Math.random() - 0.5) * speedMul * 0.8;
      break;
    case "flamingo":
      baseSize = (10 + Math.random() * 6) * sizeMul * (0.5 + depth * 0.5);
      vx = (1.5 + Math.random() * 2.5) * speedMul * (Math.random() < 0.4 ? -1 : 1);
      vy = (Math.random() - 0.5) * speedMul * 0.8;
      break;
    case "bees":
      baseSize = (3 + Math.random() * 3) * sizeMul;
      vx = (Math.random() - 0.5) * speedMul * 2;
      vy = (Math.random() - 0.5) * speedMul * 1.5;
      break;
    case "crickets":
      baseSize = (3 + Math.random() * 3) * sizeMul;
      vx = (Math.random() - 0.5) * speedMul * 0.5;
      vy = 0;
      break;
    case "flies":
      baseSize = (1.5 + Math.random() * 2) * sizeMul;
      vx = (Math.random() - 0.5) * speedMul * 3;
      vy = (Math.random() - 0.5) * speedMul * 3;
      break;
    default:
      baseSize = 3 * sizeMul;
  }

  const flyingTypes: ParticleType[] = ["stars", "fireflies", "birds", "dove", "eagle", "parrot", "flamingo", "bees", "flies", "clouds", "butterflies"];
  const groundTypes: ParticleType[] = ["crickets"];

  const yPos = flyingTypes.includes(type)
    ? Math.random() * H
    : groundTypes.includes(type)
      ? H - 10 - Math.random() * 5
       : type === "bubbles"
          ? Math.random() * H
          : startOnScreen
            ? Math.random() * H
            : Math.random() * H - H;

  return {
    id: nextParticleId++,
    x: Math.random() * W,
    y: type === "clouds"
      ? Math.random() * H * 0.62
      : yPos,
    vx, vy,
    size: baseSize,
    opacity: type === "stars" ? Math.random() : (opacity / 100),
    color: type === "confetti"
      ? CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      : type === "leaves"
        ? LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)]
      : type === "stars"
        ? STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
        : color,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.1,
    depth,
    life: 0,
    shapeIdx: Math.floor(Math.random() * (type === "butterflies" ? 4 : 3)),
    wingPhase: Math.random() * Math.PI * 2,
    trail: [],
    splashing: false,
    splashRadius: 0,
    splashOpacity: 0,
    jumpState: 0,
    leaderIdx: -1,
    dirChangeTimer: Math.floor(Math.random() * 15),
    soarAngle: Math.random() * Math.PI * 2,
    type,
  };
}

function getCloudDimensions(particle: Particle, style: CloudStyle, aspect: number) {
  if (style === "fire") {
    const height = particle.size * 3.25;
    return { width: height * aspect, height };
  }
  const widthMultiplier = style === "wispy" ? 4.4 : style === "bank" ? 5.4 : style === "sun" ? 4.3 : style === "firesky" || style === "silver" ? 4.6 : 3.5;
  const width = particle.size * widthMultiplier;
  return { width, height: width / aspect };
}

export default function ParticleVfx() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number | null>(null);
  const particles  = useRef<Particle[]>([]);
  const snowLevelRef = useRef(0);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const cloudImagesRef = useRef<Partial<Record<CloudStyle, HTMLImageElement>>>({});
  const butterflyImageRef = useRef<HTMLImageElement | null>(null);
  const cloudStyleSelectionRef = useRef<Set<CloudStyle>>(new Set(["fire"]));
  const cloudDirectionRef = useRef<CloudDirection>("mixed");

  const [selectedTypes, setSelectedTypes] = useState<Set<ParticleType>>(new Set(["snow"]));
  const [count,      setCount]      = useState(120);
  const [speed,      setSpeed]      = useState(50);
  const [size,       setSize]       = useState(50);
  const [opacity,    setOpacity]    = useState(80);
  const [waterStyle, setWaterStyle] = useState<WaterStyle>("clear");
  const [waterShape, setWaterShape] = useState<WaterShape>("oval");
  const [waterRect, setWaterRect] = useState<WaterRect>({ x: 28, y: 72, width: 44, height: 18 });
  const [waterOpacity, setWaterOpacity] = useState(100);
  const [waterMotion, setWaterMotion] = useState<WaterMotion>("rolling");
  const [waterIntensity, setWaterIntensity] = useState(65);
  const [waterWaveSpeed, setWaterWaveSpeed] = useState(100);
  const [waterDepth, setWaterDepth] = useState(70);
  const [waterFoam, setWaterFoam] = useState(true);
  const [waterCaustics, setWaterCaustics] = useState(true);
  const [snowSurface, setSnowSurface] = useState(true);
  const [snowStyle, setSnowStyle] = useState<SnowStyle>("powder");
  const [leafColor, setLeafColor] = useState<LeafColor>("mixed");
  const [leafShape, setLeafShape] = useState<LeafShape>("natural");
  const [leafSize, setLeafSize] = useState(100);
  const [selectedCloudStyles, setSelectedCloudStyles] = useState<Set<CloudStyle>>(new Set(["fire"]));
  const [cloudDirection, setCloudDirection] = useState<CloudDirection>("mixed");
  const [cloudSpeed, setCloudSpeed] = useState(55);
  const [cloudAssetsReady, setCloudAssetsReady] = useState(false);
  const [butterflyAssetReady, setButterflyAssetReady] = useState(false);
  const [butterflySpecies, setButterflySpecies] = useState<ButterflySpecies>("mixed");
  const [butterflyFlutter, setButterflyFlutter] = useState(100);
  const [butterflyWander, setButterflyWander] = useState(100);
  const [selectedCloudId, setSelectedCloudId] = useState<number | null>(null);
  const [cloudSelectionVersion, setCloudSelectionVersion] = useState(0);
  const [cloudDragMode, setCloudDragMode] = useState<"move" | "resize" | null>(null);
  const [color,      setColor]      = useState("#ffffff");
  const [playing,    setPlaying]    = useState(true);
  const [videoSrc,   setVideoSrc]   = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [recording,  setRecording]  = useState(false);
  const [showPanel,  setShowPanel]  = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recordDuration, setRecordDuration] = useState(0);
  const [nativeW, setNativeW] = useState(800);
  const [nativeH, setNativeH] = useState(450);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartTimeRef = useRef(0);
  const videoEndedHandlerRef = useRef<(() => void) | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const seekedHandlerRef = useRef<(() => void) | null>(null);
  const videoSrcRef = useRef<string | null>(null);
  const waterTransformRef = useRef<{
    mode: WaterTransformMode;
    pointerId: number;
    startX: number;
    startY: number;
    initial: WaterRect;
  } | null>(null);
  const cloudTransformRef = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    cloudId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialSize: number;
    startDistance: number;
  } | null>(null);
  const [W, H] = computeCanvasDims(nativeW, nativeH);

  const toggleType = useCallback((t: ParticleType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(CLOUD_ASSET_PATHS) as [CloudStyle, string][];
    Promise.all(entries.map(([style, src]) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        cloudImagesRef.current[style] = image;
        resolve();
      };
      image.onerror = () => reject(new Error(`Unable to load cloud asset: ${src}`));
      image.src = src;
    }))).then(() => {
      if (!cancelled) setCloudAssetsReady(true);
    }).catch(error => {
      console.error(error);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      butterflyImageRef.current = image;
      if (!cancelled) setButterflyAssetReady(true);
    };
    image.onerror = () => console.error("Unable to load butterfly atlas");
    image.src = "/creatures/butterfly-atlas.png";
    return () => { cancelled = true; };
  }, []);

  const selectedTypesKey = Array.from(selectedTypes).sort().join(",");
  const selectedCloudStylesKey = Array.from(selectedCloudStyles).sort().join(",");

  useEffect(() => {
    cloudDirectionRef.current = cloudDirection;
  }, [cloudDirection]);

  const toggleCloudStyle = (style: CloudStyle) => {
    setSelectedCloudStyles(prev => {
      const next = new Set(prev);
      if (next.has(style)) {
        if (next.size > 1) next.delete(style);
      } else {
        next.add(style);
      }
      cloudStyleSelectionRef.current = next;
      return next;
    });
  };

  const initParticles = useCallback(() => {
    const speedMul = speed / 50;
    const sizeMul  = size  / 50;
    const types = Array.from(selectedTypes)
      .filter(type => type !== "water")
      .sort((a, b) => a === "clouds" ? -1 : b === "clouds" ? 1 : 0);
    if (types.length === 0) {
      particles.current = [];
      return;
    }
    const ps: Particle[] = [];
    const cloudStyles = Array.from(cloudStyleSelectionRef.current);
    const perType = Math.floor(count / types.length);
    const remainder = count % types.length;
    for (let ti = 0; ti < types.length; ti++) {
      const requested = perType + (ti < remainder ? 1 : 0);
      const currentType = types[ti];
      const n = currentType === "clouds"
        ? Math.min(7, Math.max(2, Math.ceil(requested / 32)))
        : currentType === "butterflies"
          ? Math.min(32, Math.max(6, Math.ceil(requested / 5)))
          : requested;
      for (let i = 0; i < n; i++) {
        const particle = makeParticle(currentType, W, H, speedMul, sizeMul, opacity, color, true);
        if (currentType === "clouds") {
          particle.cloudStyle = cloudStyles[i % cloudStyles.length] ?? "fire";
          particle.cloudDirection = cloudDirectionRef.current === "mixed" ? (particle.vx < 0 ? "left" : "right") : cloudDirectionRef.current;
          particle.x = W * 0.5 + (i - (n - 1) / 2) * W * 0.1 + (Math.random() - 0.5) * W * 0.04;
          particle.y = H * (0.18 + (i % 3) * 0.11);
        } else if (currentType === "butterflies") {
          const configured = BUTTERFLY_SPECIES.find(species => species.id === butterflySpecies)?.atlasIndex;
          particle.shapeIdx = configured ?? (i % 4);
        }
        ps.push(particle);
      }
    }
    particles.current = ps;
    setSelectedCloudId(null);
    if (!selectedTypes.has("snow")) snowLevelRef.current = 0;
  }, [selectedTypesKey, count, speed, size, opacity, color, butterflySpecies, W, H]);

  const addSelectedClouds = () => {
    if (!selectedTypes.has("clouds")) {
      setSelectedTypes(prev => new Set(prev).add("clouds"));
      return;
    }
    const styles = Array.from(selectedCloudStyles);
    const existing = particles.current.filter(p => p.type === "clouds");
    const centerX = existing.length ? existing.reduce((sum, p) => sum + p.x, 0) / existing.length : W * 0.5;
    const centerY = existing.length ? existing.reduce((sum, p) => sum + p.y, 0) / existing.length : H * 0.28;
    let firstId: number | null = null;
    styles.forEach((style, index) => {
      const particle = makeParticle("clouds", W, H, speed / 50, size / 50, opacity, color, true);
      particle.cloudStyle = style;
      particle.cloudDirection = cloudDirection === "mixed" ? (particle.vx < 0 ? "left" : "right") : cloudDirection;
      particle.x = Math.max(0, Math.min(W, centerX + (index - (styles.length - 1) / 2) * W * 0.08));
      particle.y = Math.max(0, Math.min(H, centerY + (index % 2) * H * 0.06));
      particles.current.push(particle);
      if (firstId === null) firstId = particle.id;
    });
    setSelectedCloudId(firstId);
    setCloudSelectionVersion(v => v + 1);
  };

  const selectedCloud = particles.current.find(p => p.id === selectedCloudId && p.type === "clouds");

  const duplicateSelectedCloud = () => {
    if (!selectedCloud) return;
    const duplicate: Particle = { ...selectedCloud, id: nextParticleId++, x: Math.min(W, selectedCloud.x + W * 0.05), y: Math.min(H, selectedCloud.y + H * 0.04), trail: [] };
    particles.current.push(duplicate);
    setSelectedCloudId(duplicate.id);
    setCloudSelectionVersion(v => v + 1);
  };

  const deleteSelectedCloud = () => {
    if (!selectedCloud) return;
    particles.current = particles.current.filter(p => p.id !== selectedCloud.id);
    setSelectedCloudId(null);
    setCloudSelectionVersion(v => v + 1);
  };

  const bringSelectedCloudForward = () => {
    if (!selectedCloud) return;
    particles.current = [...particles.current.filter(p => p.id !== selectedCloud.id), selectedCloud];
    setCloudSelectionVersion(v => v + 1);
  };

  const drawStar4 = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, innerR: number) => {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 - Math.PI / 2;
      const innerAngle = angle + Math.PI / 4;
      const method = i === 0 ? "moveTo" : "lineTo";
      ctx[method](cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.lineTo(cx + Math.cos(innerAngle) * innerR, cy + Math.sin(innerAngle) * innerR);
    }
    ctx.closePath();
  };

  const drawBird = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number, facingRight: boolean) => {
    ctx.save();
    ctx.translate(x, y);
    if (!facingRight) ctx.scale(-1, 1);
    const wingY = Math.sin(wingAngle) * s * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-s * 0.5, wingY, -s, wingY * 0.8);
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.5, wingY, s, wingY * 0.8);
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  };

  const drawDove = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number, facingRight: boolean) => {
    ctx.save();
    ctx.translate(x, y);
    if (!facingRight) ctx.scale(-1, 1);
    const wingY = Math.sin(wingAngle) * s * 0.6;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.4, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.4, wingY - s * 0.1, -s * 1.1, wingY * 0.9);
    ctx.quadraticCurveTo(-s * 0.5, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.4, wingY - s * 0.1, s * 1.1, wingY * 0.9);
    ctx.quadraticCurveTo(s * 0.5, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.4, 0);
    ctx.lineTo(s * 0.55, -s * 0.05);
    ctx.lineTo(s * 0.4, s * 0.02);
    ctx.fillStyle = "rgba(200,180,160,0.8)";
    ctx.fill();
    ctx.restore();
  };

  const drawEagle = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number, facingRight: boolean) => {
    ctx.save();
    ctx.translate(x, y);
    if (!facingRight) ctx.scale(-1, 1);
    const wingY = Math.sin(wingAngle) * s * 0.25;
    ctx.fillStyle = "rgba(60,40,20,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.08);
    ctx.quadraticCurveTo(-s * 0.7, wingY - s * 0.15, -s * 1.4, wingY * 0.7);
    ctx.lineTo(-s * 1.3, wingY * 0.7 + s * 0.05);
    ctx.quadraticCurveTo(-s * 0.6, wingY * 0.2, -s * 0.1, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.15, -s * 0.08);
    ctx.quadraticCurveTo(s * 0.7, wingY - s * 0.15, s * 1.4, wingY * 0.7);
    ctx.lineTo(s * 1.3, wingY * 0.7 + s * 0.05);
    ctx.quadraticCurveTo(s * 0.6, wingY * 0.2, s * 0.1, s * 0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.45, -s * 0.05, s * 0.12, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(240,240,240,0.9)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.55, -s * 0.05);
    ctx.lineTo(s * 0.7, s * 0.02);
    ctx.lineTo(s * 0.55, s * 0.02);
    ctx.fillStyle = "rgba(200,180,50,0.9)";
    ctx.fill();
    ctx.restore();
  };

  const drawParrot = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number, facingRight: boolean) => {
    ctx.save();
    ctx.translate(x, y);
    if (!facingRight) ctx.scale(-1, 1);
    const wingY = Math.sin(wingAngle) * s * 0.5;
    ctx.fillStyle = "rgba(50,180,80,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.35, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(30,140,60,0.85)";
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.4, wingY - s * 0.1, -s * 0.9, wingY * 0.9);
    ctx.quadraticCurveTo(-s * 0.4, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.fillStyle = "rgba(200,50,50,0.9)";
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.4, wingY - s * 0.1, s * 0.9, wingY * 0.9);
    ctx.quadraticCurveTo(s * 0.4, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.fillStyle = "rgba(255,220,50,0.9)";
    ctx.beginPath();
    ctx.ellipse(s * 0.3, -s * 0.05, s * 0.1, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.38, -s * 0.03);
    ctx.quadraticCurveTo(s * 0.5, s * 0.02, s * 0.42, s * 0.06);
    ctx.lineTo(s * 0.36, s * 0.01);
    ctx.fillStyle = "rgba(80,80,80,0.9)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, s * 0.1);
    ctx.quadraticCurveTo(-s * 0.6, s * 0.4, -s * 0.8, s * 0.5);
    ctx.strokeStyle = "rgba(50,180,80,0.7)";
    ctx.lineWidth = s * 0.06;
    ctx.stroke();
    ctx.restore();
  };

  const drawFlamingo = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number, facingRight: boolean) => {
    ctx.save();
    ctx.translate(x, y);
    if (!facingRight) ctx.scale(-1, 1);
    const wingY = Math.sin(wingAngle) * s * 0.3;
    ctx.fillStyle = "rgba(255,140,160,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.35, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.5, wingY, -s * 1.0, wingY * 0.8);
    ctx.quadraticCurveTo(-s * 0.5, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.5, wingY, s * 1.0, wingY * 0.8);
    ctx.quadraticCurveTo(s * 0.5, wingY * 0.3, 0, s * 0.05);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,140,160,0.8)";
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.35, s * 0.4, -s * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s * 0.4, -s * 0.55, s * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,160,180,0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,120,140,0.7)";
    ctx.lineWidth = s * 0.04;
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, s * 0.15);
    ctx.lineTo(-s * 0.25, s * 0.55);
    ctx.moveTo(-s * 0.1, s * 0.15);
    ctx.lineTo(-s * 0.12, s * 0.55);
    ctx.stroke();
    ctx.restore();
  };

  const drawBee = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(255,200,0,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.5, s * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(30,30,0,0.8)";
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(i * s * 0.22 - s * 0.05, -s * 0.35, s * 0.1, s * 0.7);
    }
    const wFlap = Math.sin(wingAngle * 8) * s * 0.35;
    ctx.fillStyle = "rgba(200,220,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.15, -s * 0.35 + wFlap * 0.5, s * 0.25, s * 0.45 + Math.abs(wFlap) * 0.3, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.15, -s * 0.35 + wFlap * 0.5, s * 0.25, s * 0.45 + Math.abs(wFlap) * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawCricket = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(60,80,30,0.9)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.45, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-s * 0.4, -s * 0.05, s * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(50,70,25,0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,80,30,0.8)";
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.moveTo(s * 0.15, s * 0.15);
    ctx.quadraticCurveTo(s * 0.5, s * 0.5, s * 0.25, s * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.15);
    ctx.quadraticCurveTo(s * 0.55, s * 0.5, s * 0.35, s * 0.6);
    ctx.stroke();
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s * 0.15);
    ctx.lineTo(-s * 0.15, s * 0.35);
    ctx.moveTo(0, s * 0.15);
    ctx.lineTo(-s * 0.02, s * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 0.15);
    ctx.quadraticCurveTo(-s * 0.7, -s * 0.45, -s * 0.6, -s * 0.55);
    ctx.moveTo(-s * 0.48, -s * 0.12);
    ctx.quadraticCurveTo(-s * 0.75, -s * 0.4, -s * 0.68, -s * 0.52);
    ctx.stroke();
    ctx.restore();
  };

  const drawFly = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, wingAngle: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(30,30,30,0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.25, -s * 0.05, s * 0.12, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60,20,20,0.8)";
    ctx.fill();
    const wFlap = Math.sin(wingAngle * 10) * s * 0.4;
    ctx.fillStyle = "rgba(180,200,220,0.25)";
    ctx.beginPath();
    ctx.ellipse(-s * 0.1, -s * 0.25 + wFlap * 0.4, s * 0.35, s * 0.15, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.1, -s * 0.25 + wFlap * 0.4, s * 0.35, s * 0.15, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawFrame = useCallback((t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    if (videoRef.current && videoReady) {
      drawVideoWithFit(ctx, videoRef.current, W, H, "contain");
    }

    const speedMul = speed / 50;
    const sizeMul  = size  / 50;
    const tSec = t / 1000;

    for (let pIdx = 0; pIdx < particles.current.length; pIdx++) {
      const p = particles.current[pIdx];
      ctx.save();
      p.life++;

      if (p.type === "snow") {
        p.phase += 0.012 + p.depth * 0.008;
        p.x += Math.sin(p.phase) * 0.6 * (0.5 + p.depth * 0.5) + p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed * (p.size > 4 ? 1 : 0);
        const snowFloor = H - (snowSurface ? snowLevelRef.current : 0);
        if (p.y > snowFloor - p.size * 0.35) {
          if (snowSurface) snowLevelRef.current = Math.min(H * 0.14, snowLevelRef.current + 0.018 * (0.5 + p.depth));
          Object.assign(p, makeParticle(p.type, W, H, speedMul, sizeMul, opacity, color));
          p.y = -p.size;
        }
        if (p.x < -p.size) p.x = W + p.size;
        if (p.x > W + p.size) p.x = -p.size;

        ctx.globalAlpha = p.opacity * (0.3 + p.depth * 0.7);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.size > 3.2) {
          ctx.strokeStyle = "rgba(250,253,255,0.94)";
          ctx.lineWidth = Math.max(0.55, p.size * 0.12);
          ctx.lineCap = "round";
          for (let arm = 0; arm < 6; arm++) {
            ctx.rotate(Math.PI / 3);
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.lineTo(0, p.size);
            ctx.moveTo(0, -p.size * 0.5);
            ctx.lineTo(-p.size * 0.24, -p.size * 0.72);
            ctx.moveTo(0, -p.size * 0.5);
            ctx.lineTo(p.size * 0.24, -p.size * 0.72);
            ctx.stroke();
          }
          ctx.shadowColor = "rgba(210,235,255,0.9)";
          ctx.shadowBlur = p.size * 1.5;
        } else {
          const grad = ctx.createRadialGradient(-p.size * 0.25, -p.size * 0.25, 0, 0, 0, p.size);
          grad.addColorStop(0, "rgba(255,255,255,1)");
          grad.addColorStop(0.5, "rgba(238,248,255,0.88)");
          grad.addColorStop(1, "rgba(205,230,250,0.15)");
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.shadowColor = "rgba(220,240,255,0.8)";
          ctx.shadowBlur = p.size * 2;
          ctx.fill();
        }

      } else if (p.type === "rain") {
        p.x += p.vx; p.y += p.vy;
        const rainSurfaceY = H - 2;

        if (p.splashing) {
          p.splashRadius += 1.2;
          p.splashOpacity -= 0.04;
          if (p.splashOpacity <= 0) {
            Object.assign(p, makeParticle(p.type, W, H, speedMul, sizeMul, opacity, color));
            p.y = -10 - Math.random() * 20;
          } else {
            ctx.globalAlpha = p.splashOpacity * 0.6;
            ctx.beginPath();
            ctx.ellipse(p.x, rainSurfaceY, p.splashRadius, p.splashRadius * 0.3, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(180,210,255,0.6)";
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
          ctx.restore();
          continue;
        }

        if (p.y > rainSurfaceY) {
          p.splashing = true;
          p.splashRadius = 1;
          p.splashOpacity = 1;
          ctx.restore();
          continue;
        }

        const len = p.vy * 2.5 * (0.5 + p.depth * 0.5);
        ctx.globalAlpha = p.opacity * (0.3 + p.depth * 0.7);
        const rainGrad = ctx.createLinearGradient(p.x, p.y, p.x + p.vx * 2, p.y + len);
        rainGrad.addColorStop(0, "rgba(180,210,255,0.8)");
        rainGrad.addColorStop(1, "rgba(180,210,255,0)");
        ctx.strokeStyle = rainGrad;
        ctx.lineWidth = p.size * (0.5 + p.depth * 0.5);
        ctx.lineCap = "round";
        for (let m = 0; m < 3; m++) {
          ctx.globalAlpha = (p.opacity * (0.3 + p.depth * 0.7)) / (1 + m * 1.5);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - m * 2);
          ctx.lineTo(p.x + p.vx * 2, p.y + len - m * 2);
          ctx.stroke();
        }

      } else if (p.type === "stars") {
        p.phase += 0.008 + p.depth * 0.015;
        p.opacity = (opacity / 100) * (0.3 + 0.7 * (Math.sin(p.phase) * 0.5 + 0.5));
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.color;

        drawStar4(ctx, 0, 0, p.size * 1.5, p.size * 0.4);
        ctx.fill();

        if (p.depth > 0.7) {
          ctx.globalAlpha = p.opacity * 0.3;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(-p.size * 3, 0); ctx.lineTo(p.size * 3, 0);
          ctx.moveTo(0, -p.size * 3); ctx.lineTo(0, p.size * 3);
          ctx.stroke();
        }

        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.size * 4;
        ctx.globalAlpha = p.opacity * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

      } else if (p.type === "fireflies") {
        p.phase += 0.015;
        const wanderX = Math.sin(p.phase * 1.3) * speedMul * 0.6 + Math.sin(p.phase * 0.7) * speedMul * 0.3;
        const wanderY = Math.cos(p.phase * 0.9) * speedMul * 0.5 + Math.cos(p.phase * 1.7) * speedMul * 0.2;
        p.x += wanderX + p.vx * 0.3;
        p.y += wanderY + p.vy * 0.3;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

        p.trail.push({ x: p.x, y: p.y, opacity: 1 });
        if (p.trail.length > 8) p.trail.shift();
        for (const tr of p.trail) {
          tr.opacity -= 0.12;
        }

        const brightCycle = Math.sin(p.phase * 1.5);
        const glow = brightCycle > 0 ? Math.pow(brightCycle, 0.5) : 0;

        for (const tr of p.trail) {
          if (tr.opacity <= 0) continue;
          ctx.globalAlpha = p.opacity * glow * tr.opacity * 0.3;
          ctx.beginPath();
          ctx.arc(tr.x, tr.y, p.size * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = "#ffe566";
          ctx.fill();
        }

        ctx.globalAlpha = p.opacity * glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = "#ffe566";
        ctx.shadowColor = "#bfff42";
        ctx.shadowBlur = p.size * 8;
        ctx.fill();
        ctx.shadowBlur = 0;

      } else if (p.type === "confetti") {
        p.vy *= 0.998;
        p.y += p.vy; p.x += p.vx + Math.sin(p.phase) * 0.8;
        p.phase += 0.03;
        p.rot += p.rotSpeed;
        if (p.y > H + p.size) { Object.assign(p, makeParticle(p.type, W, H, speedMul, sizeMul, opacity, color)); p.y = -p.size; }

        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const scaleX = Math.cos(p.phase * 2);
        ctx.scale(scaleX, 1);

        ctx.fillStyle = p.color;
        if (p.shapeIdx === 0) {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.shapeIdx === 1) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size * 0.1, -p.size * 0.6, p.size * 0.2, p.size * 1.2);
        }

      } else if (p.type === "leaves") {
        p.phase += 0.018 + p.depth * 0.01;
        p.x += p.vx + Math.sin(p.phase * 1.7) * (0.75 + p.depth);
        p.y += p.vy;
        p.rot += p.rotSpeed + Math.sin(p.phase) * 0.008;
        if (p.y > H + p.size * 2) {
          Object.assign(p, makeParticle(p.type, W, H, speedMul, sizeMul, opacity, color));
          p.y = -p.size * 2;
        }
        if (p.x < -p.size * 2) p.x = W + p.size;
        if (p.x > W + p.size * 2) p.x = -p.size;

        ctx.globalAlpha = p.opacity * (0.45 + p.depth * 0.55);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.phase) * 0.32 + 0.68);
        const leafS = p.size * (leafSize / 100);
        const leafTone = leafColor === "white"
          ? ["#ffffff", "#dbeafe"]
          : leafColor === "green"
            ? [p.shapeIdx % 2 ? "#4f772d" : "#6a994e", "#b7d77a"]
            : leafColor === "brown"
              ? [p.shapeIdx % 2 ? "#92400e" : "#b45309", "#f59e0b"]
              : [p.color, "rgba(255,210,90,0.82)"];
        const leafGrad = ctx.createLinearGradient(-leafS, 0, leafS, 0);
        leafGrad.addColorStop(0, leafTone[0]);
        leafGrad.addColorStop(0.58, leafTone[0]);
        leafGrad.addColorStop(1, leafTone[1]);
        ctx.fillStyle = leafGrad;
        ctx.beginPath();
        if (leafShape === "maple") {
          for (let point = 0; point < 12; point++) {
            const angle = -Math.PI / 2 + (point / 12) * Math.PI * 2;
            const radius = point % 2 === 0 ? leafS : leafS * 0.42;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        } else if (leafShape === "lance") {
          ctx.moveTo(-leafS * 1.25, 0);
          ctx.quadraticCurveTo(0, -leafS * 0.34, leafS * 1.25, 0);
          ctx.quadraticCurveTo(0, leafS * 0.34, -leafS * 1.25, 0);
        } else {
          ctx.moveTo(-leafS, 0);
          ctx.bezierCurveTo(-leafS * 0.35, -leafS * 0.72, leafS * 0.62, -leafS * 0.5, leafS, 0);
          ctx.bezierCurveTo(leafS * 0.5, leafS * 0.62, -leafS * 0.45, leafS * 0.7, -leafS, 0);
        }
        ctx.fill();
        ctx.strokeStyle = leafColor === "white" ? "rgba(140,170,195,0.65)" : "rgba(70,55,25,0.58)";
        ctx.lineWidth = Math.max(0.45, leafS * 0.06);
        ctx.beginPath();
        ctx.moveTo(-leafS * 0.8, 0);
        ctx.lineTo(leafS * 0.86, 0);
        ctx.stroke();

      } else if (p.type === "clouds") {
        const dir = p.cloudDirection === "right" ? 1 : p.cloudDirection === "left" ? -1 : p.cloudDirection === "still" ? 0 : cloudDirection === "right" ? 1 : cloudDirection === "left" ? -1 : Math.sign(p.vx || 1);
        if (cloudTransformRef.current?.cloudId !== p.id) {
          p.x += Math.abs(p.vx) * dir * (cloudSpeed / 50);
          p.y += p.vy;
        }
        p.phase += 0.003;

        const particleCloudStyle = p.cloudStyle ?? "fire";
        const cloudImage = cloudImagesRef.current[particleCloudStyle];
        if (cloudImage?.complete && cloudImage.naturalWidth > 0) {
          const aspect = cloudImage.naturalWidth / cloudImage.naturalHeight;
          const { width: cloudW, height: cloudH } = getCloudDimensions(p, particleCloudStyle, aspect);
          if (dir > 0 && p.x - cloudW / 2 > W) p.x = -cloudW / 2;
          if (dir < 0 && p.x + cloudW / 2 < 0) p.x = W + cloudW / 2;
          ctx.globalAlpha = p.opacity * (0.48 + p.depth * 0.5);
          ctx.translate(p.x, p.y);
          ctx.scale(p.shapeIdx % 2 === 0 ? 1 : -1, 1);
          ctx.drawImage(cloudImage, -cloudW / 2, -cloudH / 2, cloudW, cloudH);
        }

      } else if (p.type === "butterflies") {
        const butterflyImage = butterflyImageRef.current;
        if (butterflyImage?.complete && butterflyImage.naturalWidth > 0) {
          p.phase += (0.18 + p.depth * 0.08) * (butterflyFlutter / 100);
          p.x += p.vx + Math.sin(p.phase * 0.7) * 0.38 * (butterflyWander / 100);
          p.y += p.vy + Math.cos(p.phase * 0.9) * 0.42 * (butterflyWander / 100);
          if (p.x < -p.size * 2) p.x = W + p.size * 2;
          if (p.x > W + p.size * 2) p.x = -p.size * 2;
          if (p.y < -p.size * 2) p.y = H + p.size * 2;
          if (p.y > H + p.size * 2) p.y = -p.size * 2;
          const cellW = butterflyImage.naturalWidth / 2;
          const cellH = butterflyImage.naturalHeight / 2;
          const species = p.shapeIdx % 4;
          const sourceX = (species % 2) * cellW;
          const sourceY = Math.floor(species / 2) * cellH;
          const drawSize = p.size * 3.1;
          const wingFold = 0.25 + Math.abs(Math.sin(p.phase)) * 0.75;
          ctx.globalAlpha = p.opacity * (0.7 + p.depth * 0.3);
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2 + Math.sin(p.phase * 0.35) * 0.12);
          ctx.scale(wingFold, 1);
          ctx.shadowColor = "rgba(0,0,0,0.24)";
          ctx.shadowBlur = Math.max(1, p.size * 0.12);
          ctx.drawImage(butterflyImage, sourceX, sourceY, cellW, cellH, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        }

      } else if (p.type === "bubbles") {
        p.phase += 0.012;
        p.x += Math.sin(p.phase) * 0.5;
        p.y += p.vy;

        if (p.y < -p.size) {
          const expandFrames = 6;
          if (p.life > 10 && p.splashOpacity === 0) {
            p.splashing = true;
            p.splashOpacity = 1;
            p.splashRadius = p.size;
          }
          if (p.splashing) {
            p.splashRadius += 1;
            p.splashOpacity -= 1 / expandFrames;
            if (p.splashOpacity <= 0) {
              Object.assign(p, makeParticle(p.type, W, H, speedMul, sizeMul, opacity, color));
            }
            ctx.globalAlpha = p.splashOpacity * 0.5;
            ctx.beginPath();
            ctx.arc(p.x, 5, p.splashRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.lineWidth = 0.5;
            ctx.stroke();
            ctx.restore();
            continue;
          }
        }

        ctx.globalAlpha = p.opacity * 0.7;
        const iridescent = ctx.createRadialGradient(p.x - p.size * 0.2, p.y - p.size * 0.2, p.size * 0.1, p.x, p.y, p.size);
        const hueShift = (p.phase * 50) % 360;
        iridescent.addColorStop(0, `hsla(${hueShift}, 80%, 80%, 0.15)`);
        iridescent.addColorStop(0.3, `hsla(${(hueShift + 60) % 360}, 70%, 70%, 0.1)`);
        iridescent.addColorStop(0.6, `hsla(${(hueShift + 120) % 360}, 60%, 75%, 0.08)`);
        iridescent.addColorStop(1, "rgba(255,255,255,0)");
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = iridescent;
        ctx.fill();
        ctx.strokeStyle = `hsla(${hueShift}, 50%, 85%, 0.4)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.globalAlpha = p.opacity * 0.9;
        ctx.beginPath();
        ctx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();

      } else if (p.type === "birds") {
        p.wingPhase += 0.06 + p.depth * 0.03;
        p.x += p.vx * (0.4 + p.depth * 0.6);
        p.y += p.vy + Math.sin(p.phase + tSec) * 0.3;
        p.phase += 0.01;

        if (p.vx > 0 && p.x > W + p.size * 2) { p.x = -p.size * 2; p.y = Math.random() * H * 0.6; }
        if (p.vx < 0 && p.x < -p.size * 2) { p.x = W + p.size * 2; p.y = Math.random() * H * 0.6; }
        if (p.y < -p.size) p.y = H * 0.5;
        if (p.y > H + p.size) p.y = 0;

        ctx.globalAlpha = p.opacity * (0.4 + p.depth * 0.6);
        ctx.strokeStyle = p.color;
        drawBird(ctx, p.x, p.y, p.size, p.wingPhase, p.vx > 0);

      } else if (p.type === "dove") {
        p.wingPhase += 0.03;
        p.phase += 0.008;
        p.x += p.vx * (0.4 + p.depth * 0.6);
        p.y += Math.sin(p.phase) * 0.5;

        if (p.vx > 0 && p.x > W + p.size * 2) { p.x = -p.size * 2; p.y = H * 0.1 + Math.random() * H * 0.5; }
        if (p.vx < 0 && p.x < -p.size * 2) { p.x = W + p.size * 2; p.y = H * 0.1 + Math.random() * H * 0.5; }

        ctx.globalAlpha = p.opacity * (0.5 + p.depth * 0.5);
        drawDove(ctx, p.x, p.y, p.size, p.wingPhase, p.vx > 0);

      } else if (p.type === "eagle") {
        p.wingPhase += 0.08;
        p.phase += 0.02;
        p.dirChangeTimer--;
        if (p.dirChangeTimer <= 0) {
          p.vx += (Math.random() - 0.5) * speedMul * 2;
          p.vy += (Math.random() - 0.5) * speedMul * 1.5;
          p.vx = Math.max(-4 * speedMul, Math.min(4 * speedMul, p.vx));
          p.vy = Math.max(-2 * speedMul, Math.min(2 * speedMul, p.vy));
          p.dirChangeTimer = 10 + Math.floor(Math.random() * 20);
        }
        p.x += p.vx;
        p.y += p.vy;

        if (p.x > W + p.size) p.x = -p.size;
        if (p.x < -p.size) p.x = W + p.size;
        if (p.y < p.size) { p.y = p.size; p.vy = Math.abs(p.vy); }
        if (p.y > H - p.size) { p.y = H - p.size; p.vy = -Math.abs(p.vy); }

        ctx.globalAlpha = p.opacity * (0.5 + p.depth * 0.5);
        drawEagle(ctx, p.x, p.y, p.size, p.wingPhase, p.vx > 0);

      } else if (p.type === "parrot") {
        p.wingPhase += 0.1;
        p.phase += 0.02;
        p.dirChangeTimer--;
        if (p.dirChangeTimer <= 0) {
          p.vx += (Math.random() - 0.5) * speedMul * 2;
          p.vy += (Math.random() - 0.5) * speedMul * 1.5;
          p.vx = Math.max(-4 * speedMul, Math.min(4 * speedMul, p.vx));
          p.vy = Math.max(-2 * speedMul, Math.min(2 * speedMul, p.vy));
          p.dirChangeTimer = 10 + Math.floor(Math.random() * 20);
        }
        p.x += p.vx;
        p.y += p.vy;

        if (p.x > W + p.size) p.x = -p.size;
        if (p.x < -p.size) p.x = W + p.size;
        if (p.y < p.size) { p.y = p.size; p.vy = Math.abs(p.vy); }
        if (p.y > H - p.size) { p.y = H - p.size; p.vy = -Math.abs(p.vy); }

        ctx.globalAlpha = p.opacity * (0.5 + p.depth * 0.5);
        drawParrot(ctx, p.x, p.y, p.size, p.wingPhase, p.vx > 0);

      } else if (p.type === "flamingo") {
        p.wingPhase += 0.08;
        p.phase += 0.02;
        p.dirChangeTimer--;
        if (p.dirChangeTimer <= 0) {
          p.vx += (Math.random() - 0.5) * speedMul * 2;
          p.vy += (Math.random() - 0.5) * speedMul * 1.5;
          p.vx = Math.max(-4 * speedMul, Math.min(4 * speedMul, p.vx));
          p.vy = Math.max(-2 * speedMul, Math.min(2 * speedMul, p.vy));
          p.dirChangeTimer = 10 + Math.floor(Math.random() * 20);
        }
        p.x += p.vx;
        p.y += p.vy;

        if (p.x > W + p.size) p.x = -p.size;
        if (p.x < -p.size) p.x = W + p.size;
        if (p.y < p.size) { p.y = p.size; p.vy = Math.abs(p.vy); }
        if (p.y > H - p.size) { p.y = H - p.size; p.vy = -Math.abs(p.vy); }

        ctx.globalAlpha = p.opacity * (0.5 + p.depth * 0.5);
        drawFlamingo(ctx, p.x, p.y, p.size, p.wingPhase, p.vx > 0);

      } else if (p.type === "bees") {
        p.wingPhase += 0.3;
        p.phase += 0.04;
        p.dirChangeTimer--;
        if (p.dirChangeTimer <= 0) {
          p.vx += (Math.random() - 0.5) * speedMul * 1.5;
          p.vy += (Math.random() - 0.5) * speedMul * 1.5;
          p.vx = Math.max(-3 * speedMul, Math.min(3 * speedMul, p.vx));
          p.vy = Math.max(-2 * speedMul, Math.min(2 * speedMul, p.vy));
          if (Math.random() < 0.15) { p.vx *= 0.1; p.vy *= 0.1; }
          p.dirChangeTimer = 5 + Math.floor(Math.random() * 15);
        }
        p.x += p.vx + Math.sin(p.phase * 3) * 0.5;
        p.y += p.vy + Math.cos(p.phase * 2.7) * 0.3;

        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

        ctx.globalAlpha = p.opacity;
        drawBee(ctx, p.x, p.y, p.size, p.wingPhase);

      } else if (p.type === "crickets") {
        if (p.jumpState === 0) {
          p.dirChangeTimer--;
          if (p.dirChangeTimer <= 0) {
            p.vy = -(3 + Math.random() * 4) * speedMul;
            p.vx = (Math.random() - 0.5) * speedMul * 2;
            p.jumpState = 1;
          }
          p.y = Math.min(p.y, H - 8);
        } else if (p.jumpState === 1) {
          p.vy += 0.15 * speedMul;
          p.x += p.vx;
          p.y += p.vy;
          if (p.y >= H - 8) {
            p.y = H - 8;
            p.vy = 0;
            p.vx = 0;
            p.jumpState = 0;
            p.dirChangeTimer = 20 + Math.floor(Math.random() * 60);
          }
        }

        if (p.x > W + p.size) p.x = -p.size;
        if (p.x < -p.size) p.x = W + p.size;

        ctx.globalAlpha = p.opacity;
        drawCricket(ctx, p.x, p.y, p.size);

      } else if (p.type === "flies") {
        p.wingPhase += 0.4;
        p.dirChangeTimer--;
        if (p.dirChangeTimer <= 0) {
          p.vx = (Math.random() - 0.5) * speedMul * 6;
          p.vy = (Math.random() - 0.5) * speedMul * 6;
          p.dirChangeTimer = 3 + Math.floor(Math.random() * 10);
        }
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

        ctx.globalAlpha = p.opacity;
        drawFly(ctx, p.x, p.y, p.size, p.wingPhase);
      }

      ctx.restore();
    }

    if (snowSurface && selectedTypes.has("snow") && snowLevelRef.current > 0.25) {
      const level = snowLevelRef.current;
      const snowBank = ctx.createLinearGradient(0, H - level * 1.7, 0, H);
      const snowPalette = snowStyle === "icy"
        ? ["rgba(225,248,255,0.94)", "rgba(145,205,235,0.9)", "rgba(75,145,195,0.88)"]
        : snowStyle === "sparkle"
          ? ["rgba(255,255,255,1)", "rgba(225,220,255,0.95)", "rgba(155,175,235,0.9)"]
          : ["rgba(255,255,255,0.96)", "rgba(225,241,252,0.92)", "rgba(170,205,230,0.88)"];
      snowBank.addColorStop(0, snowPalette[0]);
      snowBank.addColorStop(0.45, snowPalette[1]);
      snowBank.addColorStop(1, snowPalette[2]);
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, H - level * 0.78);
      for (let x = 0; x <= W; x += Math.max(12, W / 42)) {
        const drift = Math.sin(x * 0.018 + tSec * 0.08) * level * 0.12 + Math.sin(x * 0.047) * level * 0.06;
        ctx.lineTo(x, H - level + drift);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = snowBank;
      ctx.shadowColor = "rgba(220,242,255,0.7)";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (selectedTypes.has("water")) {
      const waterX = W * (waterRect.x / 100);
      const waterTop = H * (waterRect.y / 100);
      const waterW = Math.max(6, W * (waterRect.width / 100));
      const waterH = Math.max(6, H * (waterRect.height / 100));
      const waterPalettes: Record<WaterStyle, [string, string, string]> = {
        clear: ["rgba(170,220,245,0.2)", "rgba(65,145,195,0.4)", "rgba(20,65,105,0.7)"],
        storm: ["rgba(160,180,195,0.35)", "rgba(65,85,105,0.7)", "rgba(15,30,45,0.92)"],
        pond: ["rgba(115,205,185,0.32)", "rgba(35,135,125,0.62)", "rgba(10,70,72,0.86)"],
        blue: ["rgba(30,144,255,0.98)", "rgba(0,92,210,0.98)", "rgba(0,45,130,1)"],
        muddy: ["rgba(154,116,65,0.96)", "rgba(104,72,38,0.98)", "rgba(58,39,23,1)"],
        tropical: ["rgba(125,249,232,0.88)", "rgba(10,190,190,0.95)", "rgba(0,92,122,1)"],
        deep: ["rgba(30,92,150,0.88)", "rgba(8,48,100,0.97)", "rgba(2,18,52,1)"],
        sunset: ["rgba(255,184,105,0.78)", "rgba(184,76,112,0.88)", "rgba(50,40,105,0.98)"],
        ice: ["rgba(235,252,255,0.9)", "rgba(145,220,238,0.82)", "rgba(80,145,185,0.9)"],
      };
      const palette = waterPalettes[waterStyle];
      const water = ctx.createLinearGradient(0, waterTop, 0, waterTop + waterH);
      water.addColorStop(0, palette[0]);
      water.addColorStop(Math.max(0.2, Math.min(0.7, waterDepth / 140)), palette[1]);
      water.addColorStop(1, palette[2]);
      ctx.save();
      ctx.globalAlpha = waterOpacity / 100;
      ctx.beginPath();
      if (waterShape === "oval" || waterShape === "puddle") {
        ctx.ellipse(waterX + waterW / 2, waterTop + waterH / 2, waterW / 2, waterH / 2, 0, 0, Math.PI * 2);
      } else if (waterShape === "circle") {
        const radius = Math.min(waterW, waterH) / 2;
        ctx.arc(waterX + waterW / 2, waterTop + waterH / 2, radius, 0, Math.PI * 2);
      } else if (waterShape === "shore") {
        ctx.moveTo(waterX, waterTop + waterH * 0.22);
        for (let x = waterX; x <= waterX + waterW; x += Math.max(5, waterW / 48)) {
          ctx.lineTo(x, waterTop + Math.sin(x * 0.022 + tSec * 0.55) * waterH * 0.13);
        }
        ctx.lineTo(waterX + waterW, waterTop + waterH);
        ctx.lineTo(waterX, waterTop + waterH);
        ctx.closePath();
      } else if (waterShape === "wave") {
        ctx.moveTo(waterX, waterTop + waterH * 0.2);
        for (let x = waterX; x <= waterX + waterW; x += Math.max(5, waterW / 52)) {
          ctx.lineTo(x, waterTop + waterH * 0.18 + Math.sin((x - waterX) * 0.055 + tSec * 2.1) * waterH * 0.16);
        }
        ctx.lineTo(waterX + waterW, waterTop + waterH * 0.78);
        for (let x = waterX + waterW; x >= waterX; x -= Math.max(5, waterW / 52)) {
          ctx.lineTo(x, waterTop + waterH * 0.8 + Math.sin((x - waterX) * 0.045 + tSec * 1.7) * waterH * 0.1);
        }
        ctx.closePath();
      } else if (waterShape === "blob") {
        ctx.moveTo(waterX + waterW * 0.12, waterTop + waterH * 0.18);
        ctx.bezierCurveTo(waterX + waterW * 0.38, waterTop - waterH * 0.06, waterX + waterW * 0.72, waterTop + waterH * 0.04, waterX + waterW * 0.9, waterTop + waterH * 0.25);
        ctx.bezierCurveTo(waterX + waterW * 1.04, waterTop + waterH * 0.5, waterX + waterW * 0.82, waterTop + waterH * 0.96, waterX + waterW * 0.54, waterTop + waterH * 0.9);
        ctx.bezierCurveTo(waterX + waterW * 0.26, waterTop + waterH * 1.03, waterX - waterW * 0.05, waterTop + waterH * 0.72, waterX + waterW * 0.04, waterTop + waterH * 0.44);
        ctx.bezierCurveTo(waterX + waterW * 0.02, waterTop + waterH * 0.3, waterX + waterW * 0.05, waterTop + waterH * 0.22, waterX + waterW * 0.12, waterTop + waterH * 0.18);
        ctx.closePath();
      } else if (waterShape === "diamond") {
        ctx.moveTo(waterX + waterW / 2, waterTop);
        ctx.lineTo(waterX + waterW, waterTop + waterH / 2);
        ctx.lineTo(waterX + waterW / 2, waterTop + waterH);
        ctx.lineTo(waterX, waterTop + waterH / 2);
        ctx.closePath();
      } else {
        ctx.rect(waterX, waterTop, waterW, waterH);
      }
      ctx.clip();
      ctx.fillStyle = water;
      ctx.fillRect(waterX, waterTop, waterW, waterH);
      const intensityScale = waterIntensity / 100;
      const speedScale = waterWaveSpeed / 100;
      const motionScale = waterMotion === "calm" ? 0.45 : waterMotion === "rolling" ? 0.8 : waterMotion === "ocean" ? 1.25 : waterMotion === "choppy" ? 1.55 : waterMotion === "cross" ? 1.05 : waterMotion === "tide" ? 1.15 : waterMotion === "swirl" ? 0.9 : 0.65;
      const waveLayers = [
        { amplitude: waterH * 0.09, frequency: 0.020, speed: 1.45, opacity: 0.48, color: "rgba(126,206,244,0.9)" },
        { amplitude: waterH * 0.055, frequency: 0.035, speed: 2.2, opacity: 0.34, color: "rgba(35,137,201,0.9)" },
        { amplitude: waterH * 0.13, frequency: 0.014, speed: 1.05, opacity: 0.28, color: "rgba(13,79,122,0.9)" },
        { amplitude: waterH * 0.035, frequency: 0.062, speed: 3.1, opacity: 0.25, color: "rgba(160,225,250,0.92)" },
        { amplitude: waterH * 0.075, frequency: 0.027, speed: -1.7, opacity: 0.22, color: "rgba(82,174,220,0.85)" },
      ];
      waveLayers.forEach((wave, index) => {
        const crossDirection = waterMotion === "cross" && index % 2 === 1 ? -1 : 1;
        const amplitude = wave.amplitude * intensityScale * motionScale;
        const baseline = waterTop + waterH * (0.12 + index * 0.16);
        ctx.beginPath();
        ctx.globalAlpha = wave.opacity * (waterOpacity / 100);
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = Math.max(1, W * 0.0018);
        for (let x = waterX; x <= waterX + waterW; x += Math.max(2, waterW / 120)) {
          const localX = x - waterX;
          const primary = Math.sin(localX * wave.frequency * crossDirection + tSec * wave.speed * speedScale) * amplitude;
          const secondary = Math.sin(localX * wave.frequency * 0.52 - tSec * wave.speed * 1.3 * speedScale) * amplitude * 0.5;
          const choppy = waterMotion === "choppy" ? Math.sin(localX * wave.frequency * 2.4 + tSec * 4.2 * speedScale) * amplitude * 0.38 : 0;
          const tide = waterMotion === "tide" ? Math.sin(tSec * 0.8 * speedScale) * waterH * 0.09 : 0;
          const waveY = baseline + primary + secondary + choppy + tide;
          if (x === waterX) ctx.moveTo(x, waveY); else ctx.lineTo(x, waveY);
        }
        ctx.stroke();
      });
      if (waterCaustics) {
        ctx.globalAlpha = (waterOpacity / 100) * 0.22;
        ctx.strokeStyle = "rgba(215,250,255,0.92)";
        ctx.lineWidth = Math.max(0.8, W * 0.0012);
        for (let caustic = 0; caustic < 9; caustic++) {
          const cx = waterX + ((caustic * 0.137 + tSec * 0.018 * speedScale) % 1) * waterW;
          const cy = waterTop + (0.18 + (caustic % 4) * 0.2) * waterH;
          ctx.beginPath();
          ctx.ellipse(cx, cy, waterW * 0.055, waterH * 0.035, Math.sin(tSec + caustic) * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (waterFoam) {
        ctx.globalAlpha = (waterOpacity / 100) * intensityScale * 0.65;
        ctx.strokeStyle = "rgba(242,252,255,0.95)";
        ctx.lineWidth = Math.max(1.2, W * 0.0025);
        ctx.beginPath();
        for (let x = waterX; x <= waterX + waterW; x += Math.max(2, waterW / 120)) {
          const localX = x - waterX;
          const foamY = waterTop + waterH * 0.1 + Math.sin(localX * 0.025 + tSec * 1.8 * speedScale) * waterH * 0.045 * intensityScale;
          if (x === waterX) ctx.moveTo(x, foamY); else ctx.lineTo(x, foamY);
        }
        ctx.stroke();
      }
      if (waterMotion === "swirl") {
        ctx.globalAlpha = (waterOpacity / 100) * 0.38;
        ctx.strokeStyle = "rgba(170,230,250,0.9)";
        for (let ring = 1; ring <= 5; ring++) {
          ctx.beginPath();
          ctx.ellipse(waterX + waterW / 2, waterTop + waterH / 2, waterW * 0.07 * ring, waterH * 0.045 * ring, tSec * 0.3 * speedScale, 0, Math.PI * 1.65);
          ctx.stroke();
        }
      }
      if (selectedTypes.has("water")) {
        const rippleCount = waterMotion === "rain rings" ? 16 : waterMotion === "ripples" ? 10 : 6;
        for (let ripple = 0; ripple < rippleCount; ripple++) {
          const cycle = (tSec * (waterMotion === "rain rings" ? 1.1 : waterMotion === "ripples" ? 0.68 : 0.42) * speedScale + ripple * 0.19) % 1;
          const rx = waterX + (((ripple * 173 + 67) % 1000) / 1000) * waterW;
          const ry = waterTop + Math.min(waterH * 0.65, 4 + (ripple % 3) * 7);
          ctx.globalAlpha = (1 - cycle) * (waterOpacity / 100) * intensityScale * 0.72;
          ctx.beginPath();
          ctx.ellipse(rx, ry, 3 + cycle * 22, 1 + cycle * 5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    if (selectedCloudId !== null && !recording) {
      const selected = particles.current.find(p => p.id === selectedCloudId && p.type === "clouds");
      if (selected) {
        const style = selected.cloudStyle ?? "fire";
        const image = cloudImagesRef.current[style];
        if (image?.complete && image.naturalWidth > 0) {
          const dimensions = getCloudDimensions(selected, style, image.naturalWidth / image.naturalHeight);
          const left = selected.x - dimensions.width / 2;
          const top = selected.y - dimensions.height / 2;
          const handleSize = Math.max(6, W * 0.009);
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "rgba(125,211,252,0.95)";
          ctx.lineWidth = Math.max(1.5, W * 0.002);
          ctx.strokeRect(left, top, dimensions.width, dimensions.height);
          ctx.setLineDash([]);
          ctx.fillStyle = "#0ea5e9";
          ctx.strokeStyle = "#e0f2fe";
          for (const [x, y] of [[left, top], [left + dimensions.width, top], [left + dimensions.width, top + dimensions.height], [left, top + dimensions.height]]) {
            ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
          }
          ctx.restore();
        }
      }
    }

    void t;
  }, [selectedTypesKey, selectedCloudStylesKey, speed, size, opacity, color, waterStyle, waterShape, waterMotion, waterIntensity, waterWaveSpeed, waterDepth, waterFoam, waterCaustics, waterRect, waterOpacity, snowSurface, snowStyle, leafColor, leafShape, leafSize, cloudDirection, cloudSpeed, cloudAssetsReady, butterflyAssetReady, butterflyFlutter, butterflyWander, selectedCloudId, recording, videoReady, W, H]);

  const loop = useCallback((t: number) => {
    drawFrame(t);
    rafRef.current = requestAnimationFrame(loop);
  }, [drawFrame]);

  const stopLoop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  useEffect(() => { initParticles(); }, [initParticles]);

  useEffect(() => {
    if (playing) { rafRef.current = requestAnimationFrame(loop); }
    else stopLoop();
    return stopLoop;
  }, [playing, loop, stopLoop]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDstRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const cleanupRecordingRefs = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const vid = videoRef.current;
    if (vid && videoEndedHandlerRef.current) {
      vid.removeEventListener("ended", videoEndedHandlerRef.current);
      videoEndedHandlerRef.current = null;
    }
    if (vid && seekedHandlerRef.current) {
      vid.removeEventListener("seeked", seekedHandlerRef.current);
      seekedHandlerRef.current = null;
    }
    if (vid) {
      vid.loop = true;
      vid.muted = true;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
    }
  }, []);

  const stopRecording = useCallback(() => {
    cleanupRecordingRefs();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      if (captureStreamRef.current) {
        captureStreamRef.current.getTracks().forEach(t => t.stop());
        captureStreamRef.current = null;
      }
      recorderRef.current = null;
      setRecording(false);
      setRecordElapsed(0);
    }
  }, [cleanupRecordingRefs]);

  useEffect(() => {
    videoSrcRef.current = videoSrc;
  }, [videoSrc]);

  useEffect(() => {
    return () => {
      if (videoSrcRef.current) URL.revokeObjectURL(videoSrcRef.current);
      stopRecording();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      audioSourceRef.current = null;
      audioDstRef.current = null;
    };
  }, [stopRecording]);

  const togglePlay = () => {
    if (recording) return;
    setPlaying(p => !p);
  };

  const startExport = () => {
    const canvas = canvasRef.current;
    const vid = videoRef.current;
    if (!canvas || !vid || !videoSrc || !videoReady || recording) return;

    setRecording(true);
    chunksRef.current = [];

    const duration = Number.isFinite(vid.duration) ? vid.duration : 0;
    setRecordDuration(duration);
    setRecordElapsed(0);

    vid.loop = false;

    const beginExport = () => {
      const stream = canvas.captureStream(60);

      try {
        let audioCtx = audioCtxRef.current;
        let source = audioSourceRef.current;

        if (!audioCtx || audioCtx.state === "closed") {
          audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
          source = null;
          audioSourceRef.current = null;
        }

        if (!source) {
          source = audioCtx.createMediaElementSource(vid);
          audioSourceRef.current = source;
        }

        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        audioDstRef.current = dest;

        if (audioCtx.state === "suspended") {
          audioCtx.resume().catch(() => {});
        }

        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
        vid.muted = false;
      } catch {
        vid.muted = true;
      }

      captureStreamRef.current = stream;
      const mimeTypes = [
        "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm; codecs=vp9,opus",
        "video/webm; codecs=vp9",
        "video/webm; codecs=vp8,opus",
        "video/webm; codecs=vp8",
        "video/webm",
      ];
      const mimeType = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || "";
      const fileExt = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      try {
        const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 16_000_000 });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = () => {
          if (captureStreamRef.current) {
            captureStreamRef.current.getTracks().forEach(t => t.stop());
            captureStreamRef.current = null;
          }
          recorderRef.current = null;
          setRecording(false);
          setRecordElapsed(0);
          setRecordDuration(0);
          const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const typesLabel = selectedTypes.size > 0 ? Array.from(selectedTypes).join("-") : "effects";
          a.download = `particle-vfx-${typesLabel}.${fileExt}`;
          a.click();
          URL.revokeObjectURL(url);
        };

        const onVideoEnded = () => {
          if (recorderRef.current && recorderRef.current.state !== "inactive") {
            stopRecording();
          }
        };
        videoEndedHandlerRef.current = onVideoEnded;
        vid.addEventListener("ended", onVideoEnded);

        if (!playing) setPlaying(true);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            vid.play().then(() => {
              recorder.start(100);
              recorderRef.current = recorder;

              const progressTracker = setInterval(() => {
                if (vid && Number.isFinite(vid.currentTime)) {
                  setRecordElapsed(vid.currentTime);
                }
              }, 250);
              recordTimerRef.current = progressTracker;
            }).catch(() => {
              console.error("Could not start video playback for export");
              stopRecording();
            });
          });
        });
      } catch {
        console.error("Export not supported in this browser");
        cleanupRecordingRefs();
        if (captureStreamRef.current) {
          captureStreamRef.current.getTracks().forEach(t => t.stop());
          captureStreamRef.current = null;
        }
        recorderRef.current = null;
        setRecording(false);
        setRecordElapsed(0);
        setRecordDuration(0);
      }
    };

    const needsSeek = vid.currentTime !== 0;
    if (needsSeek) {
      const onSeeked = () => {
        vid.removeEventListener("seeked", onSeeked);
        seekedHandlerRef.current = null;
        beginExport();
      };
      seekedHandlerRef.current = onSeeked;
      vid.addEventListener("seeked", onSeeked);
      vid.currentTime = 0;
    } else {
      beginExport();
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 150 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert("File too large. Maximum size is 150MB.");
      e.target.value = "";
      return;
    }
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setVideoReady(false);
    e.target.value = "";
  };

  const clearVideo = () => {
    if (recording) stopRecording();
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    setVideoSrc(null);
    setVideoReady(false);
    setNativeW(800);
    setNativeH(450);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
    }
  };

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoSrc) return;
    vid.src = videoSrc;
    vid.loop = true;
    vid.muted = true;
    vid.playsInline = true;
    const onReady = () => {
      if (vid.videoWidth > 0 && vid.videoHeight > 0) {
        setNativeW(vid.videoWidth);
        setNativeH(vid.videoHeight);
      }
      setVideoReady(true);
      vid.play().catch(() => {});
    };
    vid.addEventListener("canplay", onReady);
    vid.load();
    return () => vid.removeEventListener("canplay", onReady);
  }, [videoSrc]);

  useEffect(() => {
    if (!showPanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPanel(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPanel]);

  const startWaterTransform = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-water-handle]");
    const mode = handle?.dataset.waterHandle as WaterTransformMode | undefined;
    if (selectedTypes.has("water") && mode) {
      e.preventDefault();
      e.stopPropagation();
      waterTransformRef.current = {
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        initial: { ...waterRect },
      };
      setCloudDragMode(null);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const bounds = e.currentTarget.getBoundingClientRect();
    const pointerX = ((e.clientX - bounds.left) / bounds.width) * W;
    const pointerY = ((e.clientY - bounds.top) / bounds.height) * H;

    if (!selectedTypes.has("clouds")) return;
    const clouds = particles.current.filter(p => p.type === "clouds");
    const getBounds = (particle: Particle) => {
      const style = particle.cloudStyle ?? "fire";
      const image = cloudImagesRef.current[style];
      const aspect = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 2;
      const dimensions = getCloudDimensions(particle, style, aspect);
      return { ...dimensions, left: particle.x - dimensions.width / 2, top: particle.y - dimensions.height / 2 };
    };

    const current = clouds.find(p => p.id === selectedCloudId);
    if (current) {
      const cloudBounds = getBounds(current);
      const threshold = Math.max(12, W * 0.018);
      const corners = [
        [cloudBounds.left, cloudBounds.top],
        [cloudBounds.left + cloudBounds.width, cloudBounds.top],
        [cloudBounds.left + cloudBounds.width, cloudBounds.top + cloudBounds.height],
        [cloudBounds.left, cloudBounds.top + cloudBounds.height],
      ];
      const onCorner = corners.some(([x, y]) => Math.hypot(pointerX - x, pointerY - y) <= threshold);
      if (onCorner) {
        e.preventDefault();
        cloudTransformRef.current = {
          mode: "resize",
          pointerId: e.pointerId,
          cloudId: current.id,
          startX: pointerX,
          startY: pointerY,
          initialX: current.x,
          initialY: current.y,
          initialSize: current.size,
          startDistance: Math.max(1, Math.hypot(pointerX - current.x, pointerY - current.y)),
        };
        setCloudDragMode("resize");
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }

    const hit = [...clouds].reverse().find(particle => {
      const cloudBounds = getBounds(particle);
      return pointerX >= cloudBounds.left && pointerX <= cloudBounds.left + cloudBounds.width && pointerY >= cloudBounds.top && pointerY <= cloudBounds.top + cloudBounds.height;
    });
    if (!hit) {
      setSelectedCloudId(null);
      setCloudDragMode(null);
      return;
    }
    e.preventDefault();
    setSelectedCloudId(hit.id);
    cloudTransformRef.current = {
      mode: "move",
      pointerId: e.pointerId,
      cloudId: hit.id,
      startX: pointerX,
      startY: pointerY,
      initialX: hit.x,
      initialY: hit.y,
      initialSize: hit.size,
      startDistance: 1,
    };
    setCloudDragMode("move");
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveWaterTransform = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = waterTransformRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const bounds = e.currentTarget.getBoundingClientRect();
      const dx = ((e.clientX - drag.startX) / bounds.width) * 100;
      const dy = ((e.clientY - drag.startY) / bounds.height) * 100;
      const minSize = 5;
      const next = { ...drag.initial };

      if (drag.mode === "move") {
        next.x = Math.max(0, Math.min(100 - next.width, drag.initial.x + dx));
        next.y = Math.max(0, Math.min(100 - next.height, drag.initial.y + dy));
      } else {
        if (drag.mode.includes("e")) next.width = Math.max(minSize, Math.min(100 - drag.initial.x, drag.initial.width + dx));
        if (drag.mode.includes("s")) next.height = Math.max(minSize, Math.min(100 - drag.initial.y, drag.initial.height + dy));
        if (drag.mode.includes("w")) {
          next.x = Math.max(0, Math.min(drag.initial.x + drag.initial.width - minSize, drag.initial.x + dx));
          next.width = drag.initial.width + (drag.initial.x - next.x);
        }
        if (drag.mode.includes("n")) {
          next.y = Math.max(0, Math.min(drag.initial.y + drag.initial.height - minSize, drag.initial.y + dy));
          next.height = drag.initial.height + (drag.initial.y - next.y);
        }
      }
      setWaterRect(next);
      return;
    }

    const cloudDrag = cloudTransformRef.current;
    if (!cloudDrag || cloudDrag.pointerId !== e.pointerId) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const pointerX = ((e.clientX - bounds.left) / bounds.width) * W;
    const pointerY = ((e.clientY - bounds.top) / bounds.height) * H;
    const particle = particles.current.find(p => p.id === cloudDrag.cloudId && p.type === "clouds");
    if (!particle) return;
    if (cloudDrag.mode === "move") {
      particle.x = Math.max(0, Math.min(W, cloudDrag.initialX + pointerX - cloudDrag.startX));
      particle.y = Math.max(0, Math.min(H, cloudDrag.initialY + pointerY - cloudDrag.startY));
    } else {
      const distance = Math.hypot(pointerX - cloudDrag.initialX, pointerY - cloudDrag.initialY);
      particle.size = Math.max(W * 0.012, Math.min(W * 0.65, cloudDrag.initialSize * (distance / cloudDrag.startDistance)));
    }
    setCloudSelectionVersion(v => v + 1);
  };

  const stopWaterTransform = (e: React.PointerEvent<HTMLDivElement>) => {
    const handled = waterTransformRef.current?.pointerId === e.pointerId || cloudTransformRef.current?.pointerId === e.pointerId;
    if (!handled) return;
    if (waterTransformRef.current?.pointerId === e.pointerId) waterTransformRef.current = null;
    if (cloudTransformRef.current?.pointerId === e.pointerId) cloudTransformRef.current = null;
    setCloudDragMode(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const setWaterDimension = (key: keyof WaterRect, rawValue: number) => {
    setWaterRect(prev => {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      if (key === "x") return { ...prev, x: Math.max(0, Math.min(100 - prev.width, value)) };
      if (key === "y") return { ...prev, y: Math.max(0, Math.min(100 - prev.height, value)) };
      if (key === "width") return { ...prev, width: Math.max(5, Math.min(100 - prev.x, value)) };
      return { ...prev, height: Math.max(5, Math.min(100 - prev.y, value)) };
    });
  };

  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (showPanel && isMobile) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showPanel]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto lg:h-[calc(100vh-2rem)] lg:overflow-hidden lg:flex lg:flex-col">
      <video ref={videoRef} className="hidden" />

      {/* ── Mobile header bar (hidden on lg+) ── */}
      <div className="lg:hidden flex items-center gap-3 mb-5 px-1">
        <button
          onClick={() => setShowPanel(true)}
          aria-label="Open controls panel"
          aria-expanded={showPanel}
          aria-controls="vfx-controls-panel"
          className="flex items-center justify-center w-9 h-9 rounded-xl border border-border bg-card hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-sm truncate">Particle VFX</span>
        </div>
      </div>

      {/* ── Desktop header (hidden below lg) ── */}
      <div className="hidden lg:block mb-6 shrink-0">
        <Link href="/">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Particle VFX</h1>
            <p className="text-sm text-muted-foreground">Animate weather, flying creatures, and insects</p>
          </div>
        </div>
      </div>

      {/* ── Overlay – lives outside the grid so it never occupies a cell ── */}
      <div
        aria-hidden="true"
        onClick={() => setShowPanel(false)}
        className={cn(
          "fixed inset-0 z-40 lg:hidden bg-black/60 backdrop-blur-[2px]",
          "transition-opacity duration-300",
          showPanel ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:flex-1 lg:min-h-0">
        {/* ── Controls sidebar – LEFT column on desktop, left-slide drawer on mobile ── */}
        <div
          id="vfx-controls-panel"
          role="complementary"
          aria-label="Particle VFX controls"
          className={cn(
            "space-y-4",
            "fixed top-0 right-0 bottom-0 z-50 w-[300px] max-w-[88vw]",
            "bg-[#0c0f1d] border-l border-white/[0.08] p-5 overflow-y-auto",
            "shadow-[-4px_0_40px_rgba(0,0,0,0.6)]",
            "transition-transform duration-300 ease-in-out",
            "lg:static lg:order-2 lg:w-[320px] lg:flex-none lg:max-w-none lg:h-full lg:min-h-0 lg:bg-transparent lg:border-l-0 lg:p-0 lg:pr-2 lg:z-auto lg:shadow-none lg:transition-none lg:translate-x-0 lg:overflow-y-auto",
            showPanel ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* Drawer header (mobile only) */}
          <div className="flex items-center justify-between lg:hidden mb-4 pb-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-sky-600 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm leading-tight">Controls</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Particle VFX</p>
              </div>
            </div>
            <button
              onClick={() => setShowPanel(false)}
              aria-label="Close controls panel"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="font-semibold text-sm">Video Background</p>
            {!videoSrc ? (
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 px-3 py-4 rounded-lg border border-dashed border-border hover:bg-muted/40 transition-all text-sm text-muted-foreground">
                <Upload className="w-5 h-5" />
                <span>Upload video</span>
                <span className="text-[10px]">MP4, WebM up to 150MB</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate flex-1">{videoReady ? "Video loaded" : "Loading…"}</span>
                <button onClick={clearVideo} className="p-1 hover:text-destructive transition-colors" aria-label="Remove video">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button onClick={togglePlay} variant="outline" size="sm" className="gap-1.5" disabled={recording}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button onClick={() => { snowLevelRef.current = 0; initParticles(); }} variant="outline" size="sm" className="gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
            </div>
          </div>

          {/* Effect type picker */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="font-semibold text-sm">Effect Types</p>
            {["Weather", "Nature", "Creatures", "Insects"].map(group => (
              <div key={group}>
                <p className="text-[10px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">{group}</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {PARTICLE_PRESETS.filter(p => p.group === group).map(preset => {
                    const Icon = preset.icon;
                    const isActive = selectedTypes.has(preset.id);
                    return (
                      <button key={preset.id} onClick={() => toggleType(preset.id)}
                        title={preset.desc}
                        className={cn(
                          "flex flex-col items-center gap-0.5 p-2 rounded-xl border transition-all relative",
                          isActive
                            ? "border-primary/50 bg-primary/10 text-primary ring-1 ring-primary/30"
                            : "border-border hover:border-border/80 hover:bg-muted/30 text-muted-foreground"
                        )}>
                        <Icon className="w-4 h-4" />
                        <span className="text-[9px] font-medium">{preset.label}</span>
                        {isActive && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                            <span className="text-[6px] text-primary-foreground font-bold">✓</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sliders */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <p className="font-semibold text-sm">Controls</p>
            <RangeSlider label="Count" value={count} min={20} max={400} step={10} onChange={v => { setCount(v); }} />
            <RangeSlider label="Speed" value={speed} min={10} max={200} step={5} unit="%" onChange={setSpeed} />
            <RangeSlider label="Size"  value={size}  min={10} max={200} step={5} unit="%" onChange={setSize} />
            <RangeSlider label="Opacity" value={opacity} min={10} max={100} step={5} unit="%" onChange={setOpacity} />
            {selectedTypes.has("water") && (
              <div className="space-y-2 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-xs font-medium">Water surface</span>
                    <span className="block text-[10px] text-muted-foreground">Independent from rain. Drag the center to move; use any edge or corner to resize.</span>
                  </span>
                  <Badge variant="secondary" className="text-[9px] shrink-0">ON</Badge>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(["clear", "storm", "pond", "blue", "muddy", "tropical", "deep", "sunset", "ice"] as WaterStyle[]).map(style => (
                    <button key={style} onClick={() => setWaterStyle(style)}
                      className={cn("rounded-md border px-1.5 py-1 text-[10px] capitalize transition-colors",
                        waterStyle === style ? "border-sky-400/60 bg-sky-400/15 text-sky-300" : "border-border text-muted-foreground hover:bg-muted/40")}
                    >{style}</button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(["rectangle", "oval", "circle", "puddle", "shore", "wave", "blob", "diamond"] as WaterShape[]).map(shape => (
                    <button key={shape} onClick={() => setWaterShape(shape)}
                      className={cn("rounded-md border px-1.5 py-1 text-[10px] capitalize transition-colors",
                        waterShape === shape ? "border-blue-400/60 bg-blue-400/15 text-blue-200" : "border-border text-muted-foreground hover:bg-muted/40")}
                    >{shape}</button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Wavy form</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(["calm", "rolling", "ocean", "choppy", "cross", "ripples", "tide", "swirl", "rain rings"] as WaterMotion[]).map(motion => (
                      <button key={motion} type="button" onClick={() => setWaterMotion(motion)}
                        className={cn("rounded-md border px-1.5 py-1 text-[9px] capitalize transition-colors", waterMotion === motion ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-border text-muted-foreground hover:bg-muted/40")}>{motion}</button>
                    ))}
                  </div>
                </div>
                <RangeSlider label="Water intensity" value={waterIntensity} min={0} max={100} step={5} unit="%" onChange={setWaterIntensity} />
                <RangeSlider label="Wave speed" value={waterWaveSpeed} min={10} max={250} step={5} unit="%" onChange={setWaterWaveSpeed} />
                <RangeSlider label="Water depth" value={waterDepth} min={0} max={100} step={5} unit="%" onChange={setWaterDepth} />
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-background/40 px-2 py-1.5 text-[10px]">
                    Surface foam
                    <input type="checkbox" checked={waterFoam} onChange={event => setWaterFoam(event.target.checked)} className="accent-sky-400" />
                  </label>
                  <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-background/40 px-2 py-1.5 text-[10px]">
                    Light caustics
                    <input type="checkbox" checked={waterCaustics} onChange={event => setWaterCaustics(event.target.checked)} className="accent-sky-400" />
                  </label>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dimensions (%)</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["x", "y", "width", "height"] as (keyof WaterRect)[]).map(key => (
                      <label key={key} className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1">
                        <span className="w-7 text-[9px] uppercase text-muted-foreground">{key === "width" ? "W" : key === "height" ? "H" : key}</span>
                        <input
                          aria-label={`Water ${key}`}
                          type="number"
                          min={key === "width" || key === "height" ? 5 : 0}
                          max={100}
                          step={1}
                          value={Math.round(waterRect[key])}
                          onChange={e => setWaterDimension(key, Number(e.target.value))}
                          className="w-full bg-transparent text-right text-[10px] outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <RangeSlider label="Water opacity" value={waterOpacity} min={15} max={100} step={5} unit="%" onChange={setWaterOpacity} />
              </div>
            )}
            {selectedTypes.has("butterflies") && (
              <div className="space-y-2 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/5 p-3">
                <div>
                  <p className="text-xs font-medium">Real butterflies</p>
                  <p className="text-[10px] text-muted-foreground">Photoreal species with natural wing flutter and free-flight wandering.</p>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {BUTTERFLY_SPECIES.map(species => (
                    <button key={species.id} type="button" onClick={() => setButterflySpecies(species.id)}
                      className={cn("rounded-md border px-1.5 py-1 text-[9px] transition-colors", butterflySpecies === species.id ? "border-fuchsia-400/60 bg-fuchsia-400/15 text-fuchsia-100" : "border-border text-muted-foreground hover:bg-muted/40")}
                    >{species.label}</button>
                  ))}
                </div>
                <RangeSlider label="Wing flutter" value={butterflyFlutter} min={25} max={250} step={5} unit="%" onChange={setButterflyFlutter} />
                <RangeSlider label="Flight wander" value={butterflyWander} min={0} max={200} step={5} unit="%" onChange={setButterflyWander} />
              </div>
            )}
            {selectedTypes.has("snow") && (
              <div className="space-y-2 rounded-lg border border-cyan-100/20 bg-cyan-100/5 p-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span>
                    <span className="block text-xs font-medium">Snow surface</span>
                    <span className="block text-[10px] text-muted-foreground">Build a snow layer as flakes land</span>
                  </span>
                  <input type="checkbox" checked={snowSurface} onChange={e => { setSnowSurface(e.target.checked); if (!e.target.checked) snowLevelRef.current = 0; }} className="accent-primary" />
                </label>
                {snowSurface && <div className="grid grid-cols-3 gap-1">
                  {(["powder", "icy", "sparkle"] as SnowStyle[]).map(style => (
                    <button key={style} onClick={() => setSnowStyle(style)}
                      className={cn("rounded-md border px-1.5 py-1 text-[10px] capitalize transition-colors",
                        snowStyle === style ? "border-cyan-100/60 bg-cyan-100/15 text-cyan-100" : "border-border text-muted-foreground hover:bg-muted/40")}
                    >{style}</button>
                  ))}
                </div>}
              </div>
            )}
            {selectedTypes.has("leaves") && (
              <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                <p className="text-xs font-medium">Leaves</p>
                <div className="grid grid-cols-4 gap-1">
                  {(["mixed", "white", "green", "brown"] as LeafColor[]).map(tone => (
                    <button key={tone} onClick={() => setLeafColor(tone)}
                      className={cn("rounded-md border px-1 py-1 text-[9px] capitalize", leafColor === tone ? "border-amber-400/60 bg-amber-400/15 text-amber-200" : "border-border text-muted-foreground")}>{tone}</button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(["natural", "maple", "lance"] as LeafShape[]).map(shape => (
                    <button key={shape} onClick={() => setLeafShape(shape)}
                      className={cn("rounded-md border px-1 py-1 text-[9px] capitalize", leafShape === shape ? "border-amber-400/60 bg-amber-400/15 text-amber-200" : "border-border text-muted-foreground")}>{shape}</button>
                  ))}
                </div>
                <RangeSlider label="Leaf size" value={leafSize} min={30} max={220} step={5} unit="%" onChange={setLeafSize} />
              </div>
            )}
            {selectedTypes.has("clouds") && (
              <div className="space-y-2 rounded-lg border border-orange-400/20 bg-orange-400/5 p-3">
                <div>
                  <p className="text-xs font-medium">Clouds</p>
                  <p className="text-[10px] text-muted-foreground">Select one or more styles, then add them together.</p>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {ALL_CLOUD_STYLES.map(style => (
                    <button key={style} onClick={() => toggleCloudStyle(style)} aria-pressed={selectedCloudStyles.has(style)}
                      className={cn("rounded-md border px-1.5 py-1.5 text-[9px] transition-colors", selectedCloudStyles.has(style) ? "border-orange-400/60 bg-orange-400/15 text-orange-200" : "border-border text-muted-foreground")}>{selectedCloudStyles.has(style) ? "✓ " : ""}{CLOUD_STYLE_LABELS[style]}</button>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full h-8 text-[10px] border-orange-400/30" onClick={addSelectedClouds}>Add selected clouds</Button>
                <p className="rounded-md bg-background/35 px-2 py-1.5 text-[10px] text-muted-foreground">Click a cloud in the preview. Drag its center anywhere; drag any blue corner to expand or reduce it.</p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Direction for new clouds</p>
                <div className="grid grid-cols-3 gap-1">
                  {(["left", "right", "mixed"] as CloudDirection[]).map(direction => (
                    <button key={direction} onClick={() => setCloudDirection(direction)}
                      className={cn("rounded-md border px-1 py-1 text-[9px] capitalize", cloudDirection === direction ? "border-orange-400/60 bg-orange-400/15 text-orange-200" : "border-border text-muted-foreground")}>{direction === "left" ? "-X Left" : direction === "right" ? "+X Right" : "Mixed"}</button>
                  ))}
                </div>
                <RangeSlider label="Cloud movement" value={cloudSpeed} min={5} max={200} step={5} unit="%" onChange={setCloudSpeed} />
                {selectedCloud && (
                  <div key={`${selectedCloud.id}-${cloudSelectionVersion}`} className="space-y-2 rounded-lg border border-sky-400/25 bg-sky-400/5 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-sky-100">Selected: {CLOUD_STYLE_LABELS[selectedCloud.cloudStyle ?? "fire"]}</span>
                      <span className="text-[9px] text-muted-foreground">#{selectedCloud.id}</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Independent direction</p>
                      <div className="grid grid-cols-3 gap-1">
                        {(["left", "still", "right"] as CloudItemDirection[]).map(direction => {
                          const activeDirection = selectedCloud.cloudDirection ?? (selectedCloud.vx < 0 ? "left" : "right");
                          return (
                            <button key={direction} type="button" onClick={() => { selectedCloud.cloudDirection = direction; setCloudSelectionVersion(v => v + 1); }}
                              className={cn("rounded-md border px-1 py-1 text-[9px]", activeDirection === direction ? "border-sky-400/60 bg-sky-400/15 text-sky-100" : "border-border text-muted-foreground")}>{direction === "left" ? "-X Left" : direction === "right" ? "+X Right" : "Still"}</button>
                          );
                        })}
                      </div>
                    </div>
                    <RangeSlider label="Selected cloud size" value={Math.round(selectedCloud.size)} min={Math.max(4, Math.round(W * 0.012))} max={Math.max(20, Math.round(W * 0.65))} step={1} unit="px" onChange={value => { selectedCloud.size = value; setCloudSelectionVersion(v => v + 1); }} />
                    <RangeSlider label="Position X" value={Math.round((selectedCloud.x / W) * 100)} min={0} max={100} step={1} unit="%" onChange={value => { selectedCloud.x = W * value / 100; setCloudSelectionVersion(v => v + 1); }} />
                    <RangeSlider label="Position Y" value={Math.round((selectedCloud.y / H) * 100)} min={0} max={100} step={1} unit="%" onChange={value => { selectedCloud.y = H * value / 100; setCloudSelectionVersion(v => v + 1); }} />
                    <div className="grid grid-cols-3 gap-1">
                      <button type="button" onClick={duplicateSelectedCloud} className="rounded-md border border-border px-1 py-1 text-[9px] text-muted-foreground hover:bg-muted/40">Duplicate</button>
                      <button type="button" onClick={bringSelectedCloudForward} className="rounded-md border border-border px-1 py-1 text-[9px] text-muted-foreground hover:bg-muted/40">Bring front</button>
                      <button type="button" onClick={deleteSelectedCloud} className="rounded-md border border-red-400/25 px-1 py-1 text-[9px] text-red-300 hover:bg-red-400/10">Delete</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {Array.from(selectedTypes).some(t => !["confetti","fireflies","birds","dove","eagle","parrot","flamingo","butterflies","bees","crickets","flies"].includes(t)) && selectedTypes.size > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground block mb-1.5">Color</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent" />
                  <span className="text-xs text-muted-foreground font-mono">{color.toUpperCase()}</span>
                </div>
              </div>
            )}
          </div>

          {videoSrc && videoReady && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-1">
              <p className="font-semibold text-sm">Original video ratio</p>
              <p className="text-[10px] text-muted-foreground">The preview preserves the uploaded video exactly—no stretching, cropping or padding.</p>
              <p className="pt-1 text-[10px] font-mono text-cyan-200">{W} × {H}px</p>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <p className="font-semibold text-sm mb-3">Export</p>
            {!recording ? (
              <div className="space-y-2">
                <Button
                  onClick={startExport}
                  variant="outline"
                  className="w-full gap-2"
                  disabled={!videoSrc || !videoReady}
                >
                  <Download className="w-4 h-4" /> Download Video
                </Button>
                {!videoSrc && (
                  <p className="text-[10px] text-center text-muted-foreground">Upload a background video to enable export</p>
                )}
                {videoSrc && !videoReady && (
                  <p className="text-[10px] text-center text-muted-foreground">Waiting for video to load…</p>
                )}
                {videoSrc && videoReady && (
                  <p className="text-[10px] text-center text-muted-foreground">Exports full video with particle overlays as WebM</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Button onClick={stopRecording} variant="outline" className="w-full gap-2">
                  <X className="w-4 h-4" /> Cancel
                </Button>
                {recordDuration > 0 && (
                  <div className="space-y-1">
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min((recordElapsed / recordDuration) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-center text-muted-foreground">
                      Processing… {Math.floor(recordElapsed)}s / {Math.floor(recordDuration)}s
                    </p>
                  </div>
                )}
                {recordDuration === 0 && (
                  <p className="text-[10px] text-center text-muted-foreground">
                    Processing…
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Canvas – RIGHT 2 columns on desktop, full-width on mobile ── */}
        <div className="min-h-0 flex flex-1 items-center justify-center lg:order-1 lg:min-w-0 lg:items-center">
          <div className={cn(
              "relative rounded-2xl overflow-hidden border border-border shadow-xl mx-auto touch-none bg-[#080b12]",
              cloudDragMode === "move" ? "cursor-grabbing"
                : cloudDragMode === "resize" ? "cursor-nwse-resize"
                  : selectedTypes.has("clouds") ? "cursor-grab" : "cursor-default",
            )}
            onPointerDown={startWaterTransform}
            onPointerMove={moveWaterTransform}
            onPointerUp={stopWaterTransform}
            onPointerCancel={stopWaterTransform}
            style={H >= W
              ? { aspectRatio: `${W}/${H}`, height: "min(640px, 70vh)", width: "auto", maxWidth: "min(480px, 90vw)", maxHeight: "min(640px, 70vh)" }
              : { aspectRatio: `${W}/${H}`, width: "min(720px, 70vw)", height: "auto", maxWidth: "min(720px, 70vw)", maxHeight: "min(640px, 70vh)" }}>
            <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full object-contain" style={{ objectFit: "contain" }} />
            {selectedTypes.has("water") && (
              <div
                data-water-editor
                data-water-handle="move"
                className="absolute border border-sky-200/80 bg-sky-300/[0.04] shadow-[0_0_0_1px_rgba(14,165,233,.25),0_0_14px_rgba(14,165,233,.22)] cursor-move group"
                style={{ left: `${waterRect.x}%`, top: `${waterRect.y}%`, width: `${waterRect.width}%`, height: `${waterRect.height}%` }}
              >
                <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-sky-200/50 bg-sky-950/80 px-2 py-0.5 text-[9px] text-sky-100 backdrop-blur">move water</span>
                <span data-water-handle="n" className="absolute -top-1.5 left-3 right-3 h-3 cursor-ns-resize" />
                <span data-water-handle="s" className="absolute -bottom-1.5 left-3 right-3 h-3 cursor-ns-resize" />
                <span data-water-handle="w" className="absolute -left-1.5 top-3 bottom-3 w-3 cursor-ew-resize" />
                <span data-water-handle="e" className="absolute -right-1.5 top-3 bottom-3 w-3 cursor-ew-resize" />
                {([
                  ["nw", "-left-1.5 -top-1.5 cursor-nwse-resize"],
                  ["ne", "-right-1.5 -top-1.5 cursor-nesw-resize"],
                  ["se", "-right-1.5 -bottom-1.5 cursor-nwse-resize"],
                  ["sw", "-left-1.5 -bottom-1.5 cursor-nesw-resize"],
                ] as [WaterTransformMode, string][]).map(([handle, position]) => (
                  <span key={handle} data-water-handle={handle} className={cn("absolute z-10 w-3 h-3 rounded-sm border border-sky-100 bg-sky-500 shadow", position)} />
                ))}
              </div>
            )}
            {recording && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-primary/80 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm border border-primary/30">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Exporting…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
