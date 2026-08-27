import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  ArrowLeft, Wand2, Upload, Download, X, Sliders, Crop, Maximize, ChevronDown, Settings2, Loader2, Video, AlertCircle,
  Image, Palette, Clapperboard, Camera, Cloud, CircleDot, Sunrise, Snowflake, Zap, Pencil, Blend, Sparkles, Shapes,
  Monitor, Gamepad2, Paintbrush, Droplets, Grid3x3, Moon, SunMedium, Film, Glasses, Scroll, Aperture, Frame, Chrome,
  Haze, Sparkle, Sun, Flower2, SunDim, Heart, Cherry, Contrast, Diamond, Play, Pause, ArrowLeftRight, FlipHorizontal,
  Star, Flame, Waves, Leaf, Stars, CloudFog, Layers, Activity, Radio, Wind,
  Flower, CloudMoon, GlassWater, CloudSnow, Crown, Feather, Gem,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

type StyleMode = "css" | "pixel";

interface StyleDef {
  id: string;
  label: string;
  icon: LucideIcon;
  desc: string;
  mode: StyleMode;
  filter?: string;
  category?: "general" | "beauty";
}

const STYLES: StyleDef[] = [
  { id: "original",    label: "Original",      icon: Image,        desc: "No filter",                     mode: "css", filter: "none" },
  { id: "vivid",       label: "Vivid",         icon: Palette,      desc: "Saturated & punchy",            mode: "css", filter: "saturate(1.6) contrast(1.15) brightness(1.05)" },
  { id: "cinematic",   label: "Cinematic",     icon: Clapperboard, desc: "Cool shadows, warm highlights", mode: "css", filter: "contrast(1.1) saturate(0.85) brightness(0.92) hue-rotate(-5deg)" },
  { id: "vintage",     label: "Vintage",       icon: Camera,       desc: "Warm film look",                mode: "css", filter: "sepia(0.55) saturate(0.9) contrast(0.95) hue-rotate(10deg) brightness(1.05)" },
  { id: "fade",        label: "Fade",          icon: Cloud,        desc: "Soft washed-out feel",          mode: "css", filter: "contrast(0.82) brightness(1.12) saturate(0.7)" },
  { id: "noir",        label: "Noir",          icon: CircleDot,    desc: "High-contrast B&W",             mode: "css", filter: "grayscale(1) contrast(1.35) brightness(0.88)" },
  { id: "warm",        label: "Warm",          icon: Sunrise,      desc: "Golden hour glow",              mode: "css", filter: "sepia(0.25) saturate(1.3) hue-rotate(-15deg) brightness(1.08) contrast(1.05)" },
  { id: "cool",        label: "Cool",          icon: Snowflake,    desc: "Arctic blue tones",             mode: "css", filter: "saturate(0.9) hue-rotate(22deg) brightness(1.06) contrast(1.1)" },
  { id: "neon",        label: "Neon",          icon: Zap,          desc: "Glowing pixel edges",           mode: "pixel" },
  { id: "sketch",      label: "Sketch",        icon: Pencil,       desc: "Pencil drawing",                mode: "pixel" },
  { id: "duotone",     label: "Duotone",       icon: Blend,        desc: "Two-colour mapping",            mode: "pixel" },
  { id: "dreamy",      label: "Dreamy",        icon: Sparkles,     desc: "Soft pastel blur",              mode: "css", filter: "blur(0px) saturate(0.8) brightness(1.1) contrast(0.9) hue-rotate(5deg)" },
  { id: "popart",      label: "Pop Art",       icon: Shapes,       desc: "Posterize + bold colors",       mode: "pixel" },
  { id: "glitch",      label: "Glitch",        icon: Monitor,      desc: "RGB offset + scanlines",        mode: "pixel" },
  { id: "retro",       label: "Retro",         icon: Gamepad2,     desc: "Reduced palette + dithering",   mode: "pixel" },
  { id: "oilpainting", label: "Oil Painting",  icon: Paintbrush,   desc: "Kuwahara-style smoothing",      mode: "pixel" },
  { id: "watercolor",  label: "Watercolor",    icon: Droplets,     desc: "Soft blur + wet edges",         mode: "pixel" },
  { id: "pixelart",    label: "Pixel Art",     icon: Grid3x3,      desc: "Downscale + nearest-neighbor",  mode: "pixel" },
  { id: "moody",       label: "Moody",         icon: Moon,         desc: "Dark & desaturated",            mode: "css", filter: "brightness(0.78) contrast(1.2) saturate(0.6)" },
  { id: "sunset",      label: "Sunset",        icon: SunMedium,    desc: "Warm orange tones",             mode: "css", filter: "sepia(0.35) saturate(1.4) hue-rotate(-10deg) brightness(1.08) contrast(1.05)" },
  { id: "tealnorange", label: "Teal & Orange", icon: Film,         desc: "Cinema color grade",            mode: "css", filter: "saturate(1.35) contrast(1.12) hue-rotate(-8deg) brightness(0.98)" },
  { id: "cyberpunk",   label: "Cyberpunk",     icon: Glasses,      desc: "High-contrast neon",            mode: "css", filter: "contrast(1.4) saturate(1.8) brightness(0.85) hue-rotate(15deg)" },
  { id: "filmgrain",   label: "Film Grain",    icon: Video,        desc: "Analog film look",              mode: "css", filter: "contrast(1.08) saturate(0.82) brightness(0.95) sepia(0.12)" },
  { id: "sepianoir",   label: "Sepia Noir",    icon: Scroll,       desc: "Deep sepia + contrast",         mode: "css", filter: "sepia(0.7) contrast(1.3) brightness(0.88) saturate(0.75)" },
  { id: "lomo",        label: "Lomo",          icon: Aperture,     desc: "Vignette feel + saturation",    mode: "css", filter: "saturate(1.5) contrast(1.25) brightness(0.92) hue-rotate(5deg)" },
  { id: "polaroid",    label: "Polaroid",      icon: Frame,        desc: "Faded instant film",            mode: "css", filter: "contrast(0.88) brightness(1.15) saturate(0.75) sepia(0.15) hue-rotate(5deg)" },
  { id: "chrome",      label: "Chrome",        icon: Chrome,       desc: "High metallic contrast",        mode: "css", filter: "contrast(1.35) saturate(0.6) brightness(1.1)" },
  { id: "haze",        label: "Haze",          icon: Haze,         desc: "Soft dreamy mist",              mode: "css", filter: "brightness(1.18) contrast(0.75) saturate(0.65) blur(0px)" },
  { id: "golden",     label: "Golden",        icon: Star,         desc: "Warm golden tones",             mode: "css", filter: "sepia(0.35) saturate(1.6) hue-rotate(-18deg) brightness(1.1) contrast(1.08)" },
  { id: "amber",      label: "Amber",         icon: Flame,        desc: "Rich amber glow",               mode: "css", filter: "sepia(0.55) saturate(1.5) hue-rotate(-8deg) brightness(1.06) contrast(1.1)" },
  { id: "matte",      label: "Matte",         icon: Layers,       desc: "Flat lifted look",              mode: "css", filter: "contrast(0.75) brightness(1.2) saturate(0.78)" },
  { id: "ocean",      label: "Ocean",         icon: Waves,        desc: "Cool sea blue tones",           mode: "css", filter: "saturate(1.15) hue-rotate(25deg) brightness(1.05) contrast(1.08)" },
  { id: "midnight",   label: "Midnight",      icon: Stars,        desc: "Deep night blue",               mode: "css", filter: "brightness(0.68) contrast(1.3) saturate(0.75) hue-rotate(22deg)" },
  { id: "forest",     label: "Forest",        icon: Leaf,         desc: "Deep green nature",             mode: "css", filter: "saturate(1.5) contrast(1.1) brightness(0.88) hue-rotate(-15deg)" },
  { id: "overcast",   label: "Overcast",      icon: CloudFog,     desc: "Grey flat atmosphere",          mode: "css", filter: "contrast(0.82) brightness(1.08) saturate(0.4)" },
  { id: "drama",      label: "Drama",         icon: Activity,     desc: "High contrast punch",           mode: "css", filter: "contrast(1.5) brightness(0.82) saturate(1.25)" },
  { id: "retrowave",  label: "Retrowave",     icon: Radio,        desc: "Synthwave purple haze",         mode: "css", filter: "saturate(1.6) contrast(1.2) hue-rotate(-55deg) brightness(0.88)" },
  { id: "fog",        label: "Fog",           icon: Wind,         desc: "Soft misty atmosphere",         mode: "css", filter: "brightness(1.25) contrast(0.68) saturate(0.5)" },
];

const BEAUTY_STYLES: StyleDef[] = [
  { id: "softskin",    label: "Soft Skin",     icon: Sparkle,      desc: "Softening glow",                mode: "css", filter: "brightness(1.15) contrast(0.85) saturate(0.9) blur(0.7px)", category: "beauty" },
  { id: "beautyglow",  label: "Beauty Glow",   icon: Sun,          desc: "Warm luminous radiance",        mode: "css", filter: "brightness(1.28) contrast(0.85) saturate(1.25) sepia(0.18)", category: "beauty" },
  { id: "blush",       label: "Blush",         icon: Flower2,      desc: "Rosy warmth",                   mode: "css", filter: "saturate(1.4) hue-rotate(-14deg) brightness(1.1) contrast(0.92) sepia(0.15)", category: "beauty" },
  { id: "bronze",      label: "Bronze",        icon: SunDim,       desc: "Sun-kissed tan",                mode: "css", filter: "sepia(0.45) saturate(1.4) brightness(1.08) contrast(1.1) hue-rotate(-6deg)", category: "beauty" },
  { id: "porcelain",   label: "Porcelain",     icon: Heart,        desc: "Pale smooth finish",            mode: "css", filter: "brightness(1.28) contrast(0.82) saturate(0.5) blur(0.5px)", category: "beauty" },
  { id: "peach",       label: "Peach",         icon: Cherry,       desc: "Soft warm pink",                mode: "css", filter: "sepia(0.22) saturate(1.3) hue-rotate(-15deg) brightness(1.15) contrast(0.9)", category: "beauty" },
  { id: "contour",     label: "Contour",       icon: Contrast,     desc: "Defined shadows",               mode: "css", filter: "contrast(1.4) brightness(0.85) saturate(0.78) sepia(0.06)", category: "beauty" },
  { id: "luminous",    label: "Luminous",      icon: Diamond,      desc: "Bright highlight",              mode: "css", filter: "brightness(1.32) contrast(0.87) saturate(1.1) blur(0.4px)", category: "beauty" },
  { id: "coral",      label: "Coral",         icon: Flower,       desc: "Warm coral warmth",             mode: "css", filter: "sepia(0.2) saturate(1.5) hue-rotate(-22deg) brightness(1.1) contrast(0.94)",  category: "beauty" },
  { id: "rose",       label: "Rose",          icon: CloudMoon,    desc: "Romantic rose tint",            mode: "css", filter: "sepia(0.15) saturate(1.5) hue-rotate(-15deg) brightness(1.12) contrast(0.9)", category: "beauty" },
  { id: "champagne",  label: "Champagne",     icon: GlassWater,   desc: "Soft golden radiance",          mode: "css", filter: "sepia(0.28) saturate(1.25) brightness(1.18) contrast(0.88)",                   category: "beauty" },
  { id: "frosted",    label: "Frosted",       icon: CloudSnow,    desc: "Cool dewy freshness",           mode: "css", filter: "brightness(1.18) contrast(0.82) saturate(0.65) hue-rotate(15deg) blur(0.4px)", category: "beauty" },
  { id: "diva",       label: "Diva",          icon: Crown,        desc: "Bold glam finish",              mode: "css", filter: "contrast(1.25) saturate(1.4) brightness(1.05) sepia(0.08)",                    category: "beauty" },
  { id: "nude",       label: "Nude",          icon: Feather,      desc: "Natural bare skin tones",       mode: "css", filter: "sepia(0.12) saturate(0.88) brightness(1.12) contrast(0.95)",                   category: "beauty" },
  { id: "velvet",     label: "Velvet",        icon: Gem,          desc: "Deep rich warmth",              mode: "css", filter: "brightness(0.9) contrast(1.15) saturate(1.3) sepia(0.1) hue-rotate(-5deg)",    category: "beauty" },
  { id: "glassskin",  label: "Glass Skin",    icon: Stars,        desc: "Dewy translucent glow",         mode: "css", filter: "brightness(1.3) contrast(0.8) saturate(0.9) blur(0.3px)",                      category: "beauty" },
];

const ALL_STYLES = [...STYLES, ...BEAUTY_STYLES];

const CROP_RATIOS = [
  { label: "Free", value: "free" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
];

const RESIZE_PRESETS = [
  { label: "HD 1920×1080", w: 1920, h: 1080 },
  { label: "4K 3840×2160", w: 3840, h: 2160 },
  { label: "Instagram 1080×1080", w: 1080, h: 1080 },
  { label: "Story 1080×1920", w: 1080, h: 1920 },
];

function applyNeon(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;
  const k = [-1,-1,-1,-1,8,-1,-1,-1,-1];
  const t = intensity / 100;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const ki = (ky + 1) * 3 + (kx + 1);
          r += s[idx] * k[ki]; g += s[idx+1] * k[ki]; b += s[idx+2] * k[ki];
        }
      }
      const i = (y * w + x) * 4;
      const lum = Math.sqrt(r*r+g*g+b*b) * t;
      d[i]   = Math.min(255, Math.abs(r) * t + lum * 0.3);
      d[i+1] = Math.min(255, Math.abs(g) * t * 0.5);
      d[i+2] = Math.min(255, lum + Math.abs(b) * t * 0.8);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function applySketch(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;
  const sobelX = [-1,0,1,-2,0,2,-1,0,1];
  const sobelY = [-1,-2,-1,0,0,0,1,2,1];
  const t = intensity / 100;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gx = 0, gy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const ki = (ky + 1) * 3 + (kx + 1);
          const lum = s[idx] * 0.299 + s[idx+1] * 0.587 + s[idx+2] * 0.114;
          gx += lum * sobelX[ki]; gy += lum * sobelY[ki];
        }
      }
      const mag = Math.sqrt(gx*gx + gy*gy) * t;
      const v = Math.min(255, 255 - mag);
      const i = (y * w + x) * 4;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function applyDuotone(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const t = intensity / 100;
  const sc = [30, 0, 80], hc = [255, 150, 20];
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) / 255;
    d[i]   = d[i]   * (1 - t) + (sc[0] + (hc[0] - sc[0]) * lum) * t;
    d[i+1] = d[i+1] * (1 - t) + (sc[1] + (hc[1] - sc[1]) * lum) * t;
    d[i+2] = d[i+2] * (1 - t) + (sc[2] + (hc[2] - sc[2]) * lum) * t;
  }
  ctx.putImageData(src, 0, 0);
}

function applyPopArt(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const t = intensity / 100;
  const levels = Math.max(2, Math.round(4 * t));
  const step = 255 / levels;
  const palette = [
    [255, 20, 80], [255, 220, 0], [0, 180, 255], [0, 255, 120],
    [255, 100, 200], [255, 140, 0],
  ];
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.round(d[i] / step) * step;
    const g = Math.round(d[i+1] / step) * step;
    const b = Math.round(d[i+2] / step) * step;
    const lum = (r * 0.299 + g * 0.587 + b * 0.114);
    const pi = Math.floor((lum / 255) * (palette.length - 1));
    const p = palette[Math.min(pi, palette.length - 1)];
    d[i]   = d[i]   * (1 - t) + p[0] * t;
    d[i+1] = d[i+1] * (1 - t) + p[1] * t;
    d[i+2] = d[i+2] * (1 - t) + p[2] * t;
  }
  ctx.putImageData(src, 0, 0);
}

function applyGlitch(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;
  const t = intensity / 100;
  const offset = Math.round(w * 0.03 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const rx = Math.min(w - 1, x + offset);
      const bx = Math.max(0, x - offset);
      d[i]   = s[(y * w + rx) * 4];
      d[i+1] = s[i + 1];
      d[i+2] = s[(y * w + bx) * 4 + 2];
      d[i+3] = 255;
      if (y % 3 === 0) {
        const scanline = 1 - 0.15 * t;
        d[i] *= scanline; d[i+1] *= scanline; d[i+2] *= scanline;
      }
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function applyRetro(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const t = intensity / 100;
  const palette = [
    [0,0,0],[85,85,85],[170,170,170],[255,255,255],
    [170,0,0],[255,85,85],[0,170,0],[85,255,85],
    [0,0,170],[85,85,255],[170,170,0],[255,255,85],
    [170,0,170],[255,85,255],[0,170,170],[85,255,255],
  ];
  const buf = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) buf[i] = d[i];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const or = buf[i], og = buf[i+1], ob = buf[i+2];
      let minDist = Infinity, best = 0;
      for (let p = 0; p < palette.length; p++) {
        const dr = or - palette[p][0], dg = og - palette[p][1], db = ob - palette[p][2];
        const dist = dr*dr + dg*dg + db*db;
        if (dist < minDist) { minDist = dist; best = p; }
      }
      const nr = palette[best][0], ng = palette[best][1], nb = palette[best][2];
      d[i]   = d[i]   * (1 - t) + nr * t;
      d[i+1] = d[i+1] * (1 - t) + ng * t;
      d[i+2] = d[i+2] * (1 - t) + nb * t;

      const er = (or - nr) * t, eg = (og - ng) * t, eb = (ob - nb) * t;
      if (x + 1 < w) {
        const j = (y * w + x + 1) * 4;
        buf[j] += er * 7/16; buf[j+1] += eg * 7/16; buf[j+2] += eb * 7/16;
      }
      if (y + 1 < h) {
        if (x > 0) {
          const j = ((y+1) * w + x - 1) * 4;
          buf[j] += er * 3/16; buf[j+1] += eg * 3/16; buf[j+2] += eb * 3/16;
        }
        const j2 = ((y+1) * w + x) * 4;
        buf[j2] += er * 5/16; buf[j2+1] += eg * 5/16; buf[j2+2] += eb * 5/16;
        if (x + 1 < w) {
          const j3 = ((y+1) * w + x + 1) * 4;
          buf[j3] += er * 1/16; buf[j3+1] += eg * 1/16; buf[j3+2] += eb * 1/16;
        }
      }
    }
  }
  ctx.putImageData(src, 0, 0);
}

function applyOilPainting(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const radius = Math.max(1, Math.round(4 * (intensity / 100)));
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;
  const levels = 20;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const counts = new Array(levels).fill(0);
      const rSum = new Array(levels).fill(0);
      const gSum = new Array(levels).fill(0);
      const bSum = new Array(levels).fill(0);
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const ny = Math.min(h - 1, Math.max(0, y + ky));
          const nx = Math.min(w - 1, Math.max(0, x + kx));
          const idx = (ny * w + nx) * 4;
          const lum = Math.round(((s[idx] + s[idx+1] + s[idx+2]) / 3) * (levels - 1) / 255);
          counts[lum]++;
          rSum[lum] += s[idx]; gSum[lum] += s[idx+1]; bSum[lum] += s[idx+2];
        }
      }
      let maxCount = 0, maxIdx = 0;
      for (let l = 0; l < levels; l++) {
        if (counts[l] > maxCount) { maxCount = counts[l]; maxIdx = l; }
      }
      const i = (y * w + x) * 4;
      d[i]   = rSum[maxIdx] / maxCount;
      d[i+1] = gSum[maxIdx] / maxCount;
      d[i+2] = bSum[maxIdx] / maxCount;
      d[i+3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function applyWatercolor(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const radius = Math.max(1, Math.round(3 * (intensity / 100)));
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data, d = dst.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixels: number[][] = [];
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const ny = Math.min(h - 1, Math.max(0, y + ky));
          const nx = Math.min(w - 1, Math.max(0, x + kx));
          const idx = (ny * w + nx) * 4;
          pixels.push([s[idx], s[idx+1], s[idx+2]]);
        }
      }
      pixels.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      const mid = pixels[Math.floor(pixels.length / 2)];
      const i = (y * w + x) * 4;
      d[i] = mid[0]; d[i+1] = mid[1]; d[i+2] = mid[2]; d[i+3] = 255;
    }
  }
  const sobelX = [-1,0,1,-2,0,2,-1,0,1];
  const sobelY = [-1,-2,-1,0,0,0,1,2,1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let gxR = 0, gyR = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const ki = (ky + 1) * 3 + (kx + 1);
          const lum = s[idx] * 0.299 + s[idx+1] * 0.587 + s[idx+2] * 0.114;
          gxR += lum * sobelX[ki]; gyR += lum * sobelY[ki];
        }
      }
      const edge = Math.min(1, Math.sqrt(gxR*gxR + gyR*gyR) / 200);
      const i = (y * w + x) * 4;
      const darken = 1 - edge * 0.4 * (intensity / 100);
      d[i] *= darken; d[i+1] *= darken; d[i+2] *= darken;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

function applyPixelArt(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  const blockSize = Math.max(2, Math.round(16 * (intensity / 100)));
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  for (let y = 0; y < h; y += blockSize) {
    for (let x = 0; x < w; x += blockSize) {
      let rr = 0, gg = 0, bb = 0, count = 0;
      for (let by = 0; by < blockSize && y + by < h; by++) {
        for (let bx = 0; bx < blockSize && x + bx < w; bx++) {
          const idx = ((y + by) * w + (x + bx)) * 4;
          rr += d[idx]; gg += d[idx+1]; bb += d[idx+2]; count++;
        }
      }
      rr = Math.round(rr / count); gg = Math.round(gg / count); bb = Math.round(bb / count);
      for (let by = 0; by < blockSize && y + by < h; by++) {
        for (let bx = 0; bx < blockSize && x + bx < w; bx++) {
          const idx = ((y + by) * w + (x + bx)) * 4;
          d[idx] = rr; d[idx+1] = gg; d[idx+2] = bb;
        }
      }
    }
  }
  ctx.putImageData(src, 0, 0);
}

function applyPixelEffect(ctx: CanvasRenderingContext2D, w: number, h: number, styleId: string, intensity: number) {
  switch (styleId) {
    case "neon":        applyNeon(ctx, w, h, intensity); break;
    case "sketch":      applySketch(ctx, w, h, intensity); break;
    case "duotone":     applyDuotone(ctx, w, h, intensity); break;
    case "popart":      applyPopArt(ctx, w, h, intensity); break;
    case "glitch":      applyGlitch(ctx, w, h, intensity); break;
    case "retro":       applyRetro(ctx, w, h, intensity); break;
    case "oilpainting": applyOilPainting(ctx, w, h, intensity); break;
    case "watercolor":  applyWatercolor(ctx, w, h, intensity); break;
    case "pixelart":    applyPixelArt(ctx, w, h, intensity); break;
  }
}

const HEAVY_STYLES = new Set(["oilpainting", "watercolor"]);
const MAX_HEAVY_DIM = 600;

function capDimensions(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const scale = maxDim / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function renderStyledCanvas(
  img: HTMLImageElement,
  style: StyleDef,
  styleId: string,
  intensity: number,
  cropRect?: { x: number; y: number; w: number; h: number } | null,
  resizeDims?: { w: number; h: number } | null,
  forPreview?: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (cropRect) {
    sx = cropRect.x; sy = cropRect.y; sw = cropRect.w; sh = cropRect.h;
  }

  let dw = sw, dh = sh;
  if (resizeDims) { dw = resizeDims.w; dh = resizeDims.h; }

  if (forPreview && HEAVY_STYLES.has(styleId)) {
    const capped = capDimensions(dw, dh, MAX_HEAVY_DIM);
    dw = capped.w; dh = capped.h;
  }

  canvas.width = dw;
  canvas.height = dh;

  if (style.mode === "css") {
    const cssIntensity = intensity / 100;
    const f = (style.filter ?? "none").replace("none", "");
    const scaled = f ? f.replace(/(\d+(\.\d+)?)(deg|%)?/g, (_match, num, _dec, unit = "") => {
      const base = unit === "deg" ? 0 : unit === "%" ? 100 : (parseFloat(num) > 1 ? 100 : 1);
      const s = base + (parseFloat(num) - base) * cssIntensity;
      return `${s.toFixed(2)}${unit}`;
    }) : "";
    ctx.filter = scaled || "none";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.filter = "none";
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    applyPixelEffect(ctx, dw, dh, styleId, intensity);
  }
  return canvas;
}

type MediaType = "image" | "video";

const PIXEL_STYLE_IDS = new Set(
  ALL_STYLES.filter(s => s.mode === "pixel").map(s => s.id)
);

interface ImageItem {
  id: string;
  file: File;
  img: HTMLImageElement;
  src: string;
}

export default function AiStylizer() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [styleId, setStyleId] = useState("vivid");
  const [intensity, setIntensity] = useState(100);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);

  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [videoError, setVideoError] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoOrigRef = useRef<HTMLVideoElement>(null);
  const videoCompareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => { if (e.matches) setSidebarOpen(false); };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  const [compareFlipped, setCompareFlipped] = useState(false);
  const [mirrorFlipped, setMirrorFlipped] = useState(false);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const styledCanvasRef = useRef<HTMLCanvasElement>(null);

  const [cropRatio, setCropRatio] = useState("free");
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [showCropTool, setShowCropTool] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  const [tempCropRect, setTempCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeW, setResizeW] = useState("");
  const [resizeH, setResizeH] = useState("");
  const [resizeDims, setResizeDims] = useState<{ w: number; h: number } | null>(null);

  const [downloadFormat, setDownloadFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [downloadQuality, setDownloadQuality] = useState(90);
  const [fileSizeEstimate, setFileSizeEstimate] = useState<string>("");

  const [processingStyle, setProcessingStyle] = useState(false);

  const isVideo = mediaType === "video";

  const selectedStyle = ALL_STYLES.find(s => s.id === styleId) ?? ALL_STYLES[0];
  const primaryImage = images[0] ?? null;

  const imagesRef = useRef(images);
  imagesRef.current = images;

  const videoSrcRef = useRef(videoSrc);
  videoSrcRef.current = videoSrc;

  useEffect(() => {
    return () => {
      imagesRef.current.forEach(item => {
        URL.revokeObjectURL(item.src);
      });
      if (videoSrcRef.current) URL.revokeObjectURL(videoSrcRef.current);
    };
  }, []);

  const renderPreview = useCallback(() => {
    if (!primaryImage?.img) return;
    const img = primaryImage.img;

    const origCanvas = originalCanvasRef.current;
    const styledCanvas = styledCanvasRef.current;
    if (!origCanvas || !styledCanvas) return;
    const octx = origCanvas.getContext("2d");
    const sctx = styledCanvas.getContext("2d");
    if (!octx || !sctx) return;

    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (cropRect) { sx = cropRect.x; sy = cropRect.y; sw = cropRect.w; sh = cropRect.h; }
    let dw = sw, dh = sh;
    if (resizeDims) { dw = resizeDims.w; dh = resizeDims.h; }

    origCanvas.width = dw; origCanvas.height = dh;
    styledCanvas.width = dw; styledCanvas.height = dh;

    octx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

    const isHeavy = HEAVY_STYLES.has(styleId);
    if (isHeavy) setProcessingStyle(true);

    requestAnimationFrame(() => {
      setTimeout(() => {
        const styled = renderStyledCanvas(img, selectedStyle, styleId, intensity, cropRect, resizeDims, true);
        sctx.drawImage(styled, 0, 0, styled.width, styled.height, 0, 0, dw, dh);
        if (isHeavy) setProcessingStyle(false);
      }, 0);
    });
  }, [primaryImage, selectedStyle, styleId, intensity, cropRect, resizeDims]);

  useEffect(() => { renderPreview(); }, [renderPreview]);

  useEffect(() => {
    if (!primaryImage?.img) return;
    const canvas = styledCanvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const mimeType = downloadFormat === "png" ? "image/png" : downloadFormat === "jpeg" ? "image/jpeg" : "image/webp";
    const q = downloadFormat === "png" ? undefined : downloadQuality / 100;
    canvas.toBlob(blob => {
      if (blob) setFileSizeEstimate("~" + formatFileSize(blob.size));
    }, mimeType, q);
  }, [primaryImage, downloadFormat, downloadQuality, styleId, intensity, cropRect, resizeDims]);

  const loadMedia = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const videoFile = fileArr.find(f => f.type.startsWith("video/"));
    const imageFile = fileArr.find(f => f.type.startsWith("image/"));

    if (videoFile) {
      images.forEach(i => URL.revokeObjectURL(i.src));
      if (videoSrc) URL.revokeObjectURL(videoSrc);
      const url = URL.createObjectURL(videoFile);
      setMediaType("video");
      setVideoFile(videoFile);
      setVideoSrc(url);
      setVideoError("");
      setImages([]);
      if (PIXEL_STYLE_IDS.has(styleId)) {
        setStyleId("vivid");
      }
      return;
    }

    if (imageFile) {
      images.forEach(i => URL.revokeObjectURL(i.src));
      if (videoSrc) URL.revokeObjectURL(videoSrc);
      const url = URL.createObjectURL(imageFile);
      const img = new window.Image();
      img.onload = () => {
        setMediaType("image");
        setVideoFile(null);
        setVideoSrc("");
        setImages([{ id: crypto.randomUUID(), file: imageFile, img, src: url }]);
      };
      img.src = url;
    }
  }, [styleId, videoSrc, images]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length > 0) loadMedia(e.dataTransfer.files);
  };

  const downloadSingle = useCallback(() => {
    if (!primaryImage?.img) return;
    let canvas = renderStyledCanvas(primaryImage.img, selectedStyle, styleId, intensity, cropRect, resizeDims);
    if (mirrorFlipped) {
      const mc = document.createElement("canvas");
      mc.width = canvas.width; mc.height = canvas.height;
      const mctx = mc.getContext("2d")!;
      mctx.translate(canvas.width, 0);
      mctx.scale(-1, 1);
      mctx.drawImage(canvas, 0, 0);
      canvas = mc;
    }
    const mimeType = downloadFormat === "png" ? "image/png" : downloadFormat === "jpeg" ? "image/jpeg" : "image/webp";
    const q = downloadFormat === "png" ? undefined : downloadQuality / 100;
    const ext = downloadFormat;
    canvas.toBlob(blob => {
      if (!blob) return;
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `styled-${styleId}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, mimeType, q);
  }, [primaryImage, selectedStyle, downloadFormat, downloadQuality, styleId, intensity, cropRect, resizeDims, mirrorFlipped]);

  const downloadVideoStyled = useCallback(async () => {
    const hasStyle = selectedStyle.filter && selectedStyle.filter !== "none";
    if (!videoFile || (!hasStyle && !mirrorFlipped)) return;
    setVideoProcessing(true);
    setVideoError("");
    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      fd.append("cssFilter", hasStyle ? selectedStyle.filter! : "none");
      fd.append("intensity", String(intensity));
      if (mirrorFlipped) fd.append("mirror", "1");
      const res = await fetch("/api/media/stylize-video", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Server error" }));
        throw new Error(data.message || "Video stylization failed");
      }
      const { fileId } = await res.json();
      const a = document.createElement("a");
      a.href = `/api/media/download/${fileId}`;
      a.download = `styled-${styleId}.mp4`;
      a.click();
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Failed to process video");
    } finally {
      setVideoProcessing(false);
    }
  }, [videoFile, selectedStyle, styleId, intensity, mirrorFlipped]);

  const videoFilterStyle = useMemo(() => {
    if (!isVideo || !selectedStyle.filter || selectedStyle.filter === "none" || styleId === "original") return "none";
    const t = intensity / 100;
    const f = selectedStyle.filter.replace("none", "").trim();
    if (!f) return "none";
    const fnBaseMap: Record<string, number> = {
      brightness: 1, contrast: 1, saturate: 1,
      sepia: 0, grayscale: 0, blur: 0,
      "hue-rotate": 0,
    };
    return f.replace(/(brightness|contrast|saturate|sepia|grayscale|blur|hue-rotate)\(([^)]+)\)/g,
      (_match: string, fn: string, rawVal: string) => {
        const val = parseFloat(rawVal);
        const base = fnBaseMap[fn] ?? 0;
        const scaled = base + (val - base) * t;
        const unit = rawVal.replace(/[\d.\-]/g, "").trim();
        return `${fn}(${scaled.toFixed(2)}${unit})`;
      }
    );
  }, [isVideo, selectedStyle, styleId, intensity]);

  useEffect(() => {
    const orig = videoOrigRef.current;
    const styled = videoRef.current;
    if (!orig || !styled || !isVideo) return;
    const sync = () => {
      if (Math.abs(orig.currentTime - styled.currentTime) > 0.1) {
        styled.currentTime = orig.currentTime;
      }
    };
    const onPlay = () => { styled.currentTime = orig.currentTime; styled.play().catch(() => {}); setIsPlaying(true); };
    const onPause = () => { styled.pause(); setIsPlaying(false); };
    orig.addEventListener("seeked", sync);
    orig.addEventListener("play", onPlay);
    orig.addEventListener("pause", onPause);
    const interval = setInterval(sync, 500);
    return () => {
      clearInterval(interval);
      orig.removeEventListener("seeked", sync);
      orig.removeEventListener("play", onPlay);
      orig.removeEventListener("pause", onPause);
    };
  }, [isVideo, videoSrc]);

  useEffect(() => { setIsPlaying(false); }, [videoSrc]);

  const handleSliderMove = useCallback((clientX: number) => {
    const container = compareRef.current ?? videoCompareRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const pct = (x / rect.width) * 100;
    setSliderPos(mirrorFlipped ? 100 - pct : pct);
  }, [mirrorFlipped]);

  useEffect(() => {
    if (!isDraggingSlider) return;
    const onMove = (e: MouseEvent) => { e.preventDefault(); handleSliderMove(e.clientX); };
    const onTouchMove = (e: TouchEvent) => { handleSliderMove(e.touches[0].clientX); };
    const onUp = () => setIsDraggingSlider(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDraggingSlider, handleSliderMove]);

  const drawCropOverlay = useCallback(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !primaryImage?.img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = primaryImage.img;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    canvas.width = displayW; canvas.height = displayH;

    ctx.drawImage(img, 0, 0, displayW, displayH);

    if (tempCropRect) {
      const scaleX = displayW / img.naturalWidth;
      const scaleY = displayH / img.naturalHeight;
      const rx = tempCropRect.x * scaleX;
      const ry = tempCropRect.y * scaleY;
      const rw = tempCropRect.w * scaleX;
      const rh = tempCropRect.h * scaleY;

      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, displayW, displayH);
      ctx.clearRect(rx, ry, rw, rh);
      ctx.drawImage(img, tempCropRect.x, tempCropRect.y, tempCropRect.w, tempCropRect.h, rx, ry, rw, rh);
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    }
  }, [primaryImage, tempCropRect]);

  useEffect(() => { if (showCropTool) drawCropOverlay(); }, [showCropTool, drawCropOverlay]);

  const onCropMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !primaryImage?.img) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * primaryImage.img.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * primaryImage.img.naturalHeight;
    setCropStart({ x, y });
  };

  const onCropMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cropStart || !primaryImage?.img) return;
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let x2 = ((e.clientX - rect.left) / rect.width) * primaryImage.img.naturalWidth;
    let y2 = ((e.clientY - rect.top) / rect.height) * primaryImage.img.naturalHeight;

    let cx = Math.min(cropStart.x, x2);
    let cy = Math.min(cropStart.y, y2);
    let cw = Math.abs(x2 - cropStart.x);
    let ch = Math.abs(y2 - cropStart.y);

    if (cropRatio !== "free") {
      const [rw, rh] = cropRatio.split(":").map(Number);
      const ratio = rw / rh;
      if (cw / ch > ratio) { cw = ch * ratio; } else { ch = cw / ratio; }
    }

    cx = Math.max(0, Math.min(cx, primaryImage.img.naturalWidth - cw));
    cy = Math.max(0, Math.min(cy, primaryImage.img.naturalHeight - ch));

    setTempCropRect({ x: Math.round(cx), y: Math.round(cy), w: Math.round(cw), h: Math.round(ch) });
  };

  const onCropMouseUp = () => {
    setCropStart(null);
  };

  const applyCrop = () => {
    if (tempCropRect && tempCropRect.w > 10 && tempCropRect.h > 10) {
      setCropRect(tempCropRect);
    }
    setShowCropTool(false);
    setTempCropRect(null);
  };

  const clearCrop = () => {
    setCropRect(null);
    setTempCropRect(null);
  };

  const applyResize = () => {
    const w = parseInt(resizeW); const h = parseInt(resizeH);
    if (w > 0 && h > 0) { setResizeDims({ w, h }); }
    setResizeOpen(false);
  };

  const previewDims = useMemo(() => {
    if (!primaryImage?.img) return { w: 0, h: 0 };
    let w = primaryImage.img.naturalWidth, h = primaryImage.img.naturalHeight;
    if (cropRect) { w = cropRect.w; h = cropRect.h; }
    if (resizeDims) { w = resizeDims.w; h = resizeDims.h; }
    return { w, h };
  }, [primaryImage, cropRect, resizeDims]);

  const sidebarContent = (
    <>
      {/* Choose Style */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Choose Style</p>
        <div className="grid grid-cols-4 gap-1">
          {STYLES.map(s => {
            const disabledForVideo = isVideo && s.mode === "pixel";
            return (
              <Tooltip key={s.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => { if (!disabledForVideo) setStyleId(s.id); }}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all group relative",
                      disabledForVideo && "opacity-30 cursor-not-allowed",
                      styleId === s.id && !disabledForVideo
                        ? "border-purple-500/50 bg-purple-500/10"
                        : "border-transparent hover:border-border hover:bg-muted/30"
                    )}
                  >
                    <s.icon className={cn(
                      "w-4 h-4 transition-all",
                      styleId === s.id && !disabledForVideo ? "text-purple-400" : "text-muted-foreground opacity-60 group-hover:opacity-100"
                    )} />
                    <span className={cn(
                      "text-[8px] font-medium leading-tight text-center truncate w-full",
                      styleId === s.id && !disabledForVideo ? "text-purple-300" : "text-muted-foreground"
                    )}>
                      {s.label}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs bg-gray-900 text-white border-gray-700 shadow-xl z-[100] px-3 py-2">
                  <p className="font-medium">{s.label}</p>
                  <p className="text-gray-300">{disabledForVideo ? "Not available for video" : s.desc}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Beauty & Portrait */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Beauty & Portrait</p>
        <div className="grid grid-cols-4 gap-1">
          {BEAUTY_STYLES.map(s => (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setStyleId(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all group relative",
                    styleId === s.id
                      ? "border-purple-500/50 bg-purple-500/10"
                      : "border-transparent hover:border-border hover:bg-muted/30"
                  )}
                >
                  <s.icon className={cn(
                    "w-4 h-4 transition-all",
                    styleId === s.id ? "text-purple-400" : "text-muted-foreground opacity-60 group-hover:opacity-100"
                  )} />
                  <span className={cn(
                    "text-[8px] font-medium leading-tight text-center truncate w-full",
                    styleId === s.id ? "text-purple-300" : "text-muted-foreground"
                  )}>
                    {s.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs bg-gray-900 text-white border-gray-700 shadow-xl z-[100] px-3 py-2">
                <p className="font-medium">{s.label}</p>
                <p className="text-gray-300">{s.desc}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Selected style info */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <selectedStyle.icon className="w-6 h-6 text-muted-foreground" />
          <div>
            <p className="font-semibold text-sm">{selectedStyle.label}</p>
            <p className="text-xs text-muted-foreground">{selectedStyle.desc}</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {selectedStyle.mode === "pixel" ? "Pixel processing" : "CSS filter"}
        </Badge>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="font-semibold text-sm">Intensity</p>
        </div>
        <div className="flex justify-between mb-1.5">
          <Label className="text-xs text-muted-foreground">Effect strength</Label>
          <span className="text-xs text-muted-foreground">{intensity}%</span>
        </div>
        <Slider
          min={0} max={100} step={5}
          value={[intensity]}
          onValueChange={v => setIntensity(v[0])}
          disabled={styleId === "original"}
          className="w-full"
        />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="font-semibold text-sm">Export</p>
        </div>

        {isVideo ? (
          <>
            <p className="text-xs text-muted-foreground">
              Video will be processed server-side with FFmpeg and exported as MP4.
            </p>
            <Button
              onClick={() => downloadVideoStyled()}
              disabled={!videoFile || videoProcessing || styleId === "original" || !selectedStyle.filter || selectedStyle.filter === "none"}
              className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-sm"
            >
              {videoProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Processing video…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Stylize & Download MP4
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Format</Label>
              <Select value={downloadFormat} onValueChange={v => setDownloadFormat(v as "png" | "jpeg" | "webp")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG (lossless)</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(downloadFormat === "jpeg" || downloadFormat === "webp") && (
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <Label className="text-xs text-muted-foreground">Quality</Label>
                  <span className="text-xs text-muted-foreground">{downloadQuality}%</span>
                </div>
                <Slider
                  min={1} max={100} step={1}
                  value={[downloadQuality]}
                  onValueChange={v => setDownloadQuality(v[0])}
                  className="w-full"
                />
              </div>
            )}

            {fileSizeEstimate && primaryImage && (
              <p className="text-[10px] text-muted-foreground">Estimated size: {fileSizeEstimate}</p>
            )}

            <Button onClick={() => downloadSingle()} disabled={!primaryImage}
              className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-sm">
              <Download className="w-4 h-4" /> Download {downloadFormat.toUpperCase()}
            </Button>
          </>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tips</p>
        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
          {isVideo ? (
            <>
              <li>CSS filter styles are previewed in real-time on the video</li>
              <li>Pixel-processing styles are not available for video</li>
              <li>Toggle original/styled view with the button overlay</li>
              <li>Video is processed server-side via FFmpeg for export</li>
            </>
          ) : (
            <>
              <li>Use the compare slider to see before/after</li>
              <li>Crop and resize before applying styles</li>
              <li>Oil Painting and Watercolor work best on smaller images</li>
              <li>Adjust intensity to blend with original</li>
            </>
          )}
        </ul>
      </div>
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col overflow-hidden p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="mb-6 shrink-0">
          <Link href="/">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Stylizer</h1>
              <p className="text-sm text-muted-foreground">Apply {ALL_STYLES.length} cinematic & artistic styles to images and videos</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden w-9 h-9 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center transition-all active:scale-95"
                aria-label="Open style settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
          <div className="col-span-1 lg:col-span-2 space-y-4 overflow-y-auto">
            {images.length === 0 && !videoFile ? (
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all",
                  "h-[170px]",
                  dragging
                    ? "border-purple-500 bg-purple-500/5 scale-[1.01]"
                    : "border-border hover:border-purple-500/50 hover:bg-muted/20"
                )}
              >
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
                  onChange={e => { if (e.target.files) loadMedia(e.target.files); e.target.value = ""; }} />
                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                  <Upload className="w-7 h-7 text-purple-400" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm">Drop an image or video here</p>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP, MP4, MOV, WebM (video up to 150 MB)</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {isVideo && videoFile ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Video className="w-3 h-3" /> Video
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => { setCompareFlipped(f => !f); setSliderPos(50); }}
                            className={cn(
                              "w-6 h-6 rounded flex items-center justify-center transition-all border",
                              compareFlipped
                                ? "bg-purple-600 border-purple-600 text-white"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                            )}
                            aria-label="Swap compare sides"
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Swap Original / Styled sides</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setMirrorFlipped(f => !f)}
                            className={cn(
                              "w-6 h-6 rounded flex items-center justify-center transition-all border",
                              mirrorFlipped
                                ? "bg-purple-600 border-purple-600 text-white"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                            )}
                            aria-label="Mirror horizontally"
                          >
                            <FlipHorizontal className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Mirror horizontally</TooltipContent>
                      </Tooltip>
                      <span className="text-[10px] text-muted-foreground ml-auto">{videoFile.name} ({formatFileSize(videoFile.size)})</span>
                    </div>

                    <div
                      ref={videoCompareRef}
                      className="relative rounded-xl overflow-hidden border border-border bg-black select-none cursor-col-resize mx-auto"
                      style={{ aspectRatio: "5/4", maxHeight: "280px" }}
                      onMouseDown={e => { e.preventDefault(); setIsDraggingSlider(true); handleSliderMove(e.clientX); }}
                      onTouchStart={e => { setIsDraggingSlider(true); handleSliderMove(e.touches[0].clientX); }}
                    >
                      <video
                        ref={videoOrigRef}
                        src={videoSrc}
                        loop
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{
                          zIndex: compareFlipped ? 1 : 0,
                          clipPath: compareFlipped ? `inset(0 0 0 ${sliderPos}%)` : undefined,
                          transform: mirrorFlipped ? "scaleX(-1)" : undefined,
                        }}
                      />
                      <video
                        ref={videoRef}
                        src={videoSrc}
                        loop
                        muted
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{
                          filter: videoFilterStyle,
                          zIndex: compareFlipped ? 0 : 1,
                          clipPath: compareFlipped ? undefined : `inset(0 0 0 ${sliderPos}%)`,
                          transform: mirrorFlipped ? "scaleX(-1)" : undefined,
                        }}
                      />

                      <div className="absolute top-0 bottom-0 z-10" style={{ left: `${mirrorFlipped ? 100 - sliderPos : sliderPos}%`, transform: "translateX(-50%)" }}>
                        <div className="w-0.5 h-full bg-white/80 shadow-lg" />
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                          <div className="flex gap-0.5">
                            <ChevronDown className="w-3 h-3 text-gray-700 -rotate-90" />
                            <ChevronDown className="w-3 h-3 text-gray-700 rotate-90" />
                          </div>
                        </div>
                      </div>

                      <div className={cn("absolute top-2 z-20 px-2 py-0.5 rounded text-[10px] text-white pointer-events-none bg-purple-600/90", (compareFlipped !== mirrorFlipped) ? "left-2" : "right-2")}>
                        {selectedStyle.label}
                      </div>
                      <div className={cn("absolute top-2 z-20 px-2 py-0.5 rounded text-[10px] text-white pointer-events-none bg-black/70", (compareFlipped !== mirrorFlipped) ? "right-2" : "left-2")}>
                        Original
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const orig = videoOrigRef.current;
                          if (!orig) return;
                          if (orig.paused) { orig.play().catch(() => {}); } else { orig.pause(); }
                        }}
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-sm border border-white/20 flex items-center justify-center transition-all active:scale-90 shadow-lg"
                        aria-label={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying
                          ? <Pause className="w-5 h-5 text-white fill-white" />
                          : <Play  className="w-5 h-5 text-white fill-white translate-x-0.5" />
                        }
                      </button>
                    </div>

                    {videoError && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {videoError}
                      </div>
                    )}
                  </>
                ) : primaryImage ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7" onClick={() => setShowCropTool(true)}>
                        <Crop className="w-3 h-3" /> Crop {cropRect && <span className="text-purple-400">(active)</span>}
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7" onClick={() => {
                        const img = primaryImage.img;
                        let sw = img.naturalWidth, sh = img.naturalHeight;
                        if (cropRect) { sw = cropRect.w; sh = cropRect.h; }
                        setResizeW(String(resizeDims?.w ?? sw));
                        setResizeH(String(resizeDims?.h ?? sh));
                        setResizeOpen(true);
                      }}>
                        <Maximize className="w-3 h-3" /> Resize {resizeDims && <span className="text-purple-400">(active)</span>}
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => { setCompareFlipped(f => !f); setSliderPos(50); }}
                            className={cn(
                              "w-7 h-7 rounded flex items-center justify-center transition-all border",
                              compareFlipped
                                ? "bg-purple-600 border-purple-600 text-white"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                            )}
                            aria-label="Swap compare sides"
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Swap Original / Styled sides</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setMirrorFlipped(f => !f)}
                            className={cn(
                              "w-7 h-7 rounded flex items-center justify-center transition-all border",
                              mirrorFlipped
                                ? "bg-purple-600 border-purple-600 text-white"
                                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                            )}
                            aria-label="Mirror horizontally"
                          >
                            <FlipHorizontal className="w-3 h-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Mirror horizontally</TooltipContent>
                      </Tooltip>
                      {(cropRect || resizeDims) && (
                        <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={() => { clearCrop(); setResizeDims(null); }}>
                          Reset
                        </Button>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">{previewDims.w} × {previewDims.h}</span>
                    </div>

                    <div
                      ref={compareRef}
                      className="relative rounded-xl overflow-hidden border border-border bg-black select-none cursor-col-resize mx-auto"
                      style={{ aspectRatio: "16/9", maxHeight: "280px" }}
                      onMouseDown={e => { e.preventDefault(); setIsDraggingSlider(true); handleSliderMove(e.clientX); }}
                      onTouchStart={e => { setIsDraggingSlider(true); handleSliderMove(e.touches[0].clientX); }}
                    >
                      <canvas
                        ref={originalCanvasRef}
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{
                          zIndex: compareFlipped ? 1 : 0,
                          clipPath: compareFlipped ? `inset(0 0 0 ${sliderPos}%)` : undefined,
                          transform: mirrorFlipped ? "scaleX(-1)" : undefined,
                        }}
                      />
                      <canvas
                        ref={styledCanvasRef}
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{
                          zIndex: compareFlipped ? 0 : 1,
                          clipPath: compareFlipped ? undefined : `inset(0 0 0 ${sliderPos}%)`,
                          transform: mirrorFlipped ? "scaleX(-1)" : undefined,
                        }}
                      />

                      <div className="absolute top-0 bottom-0 z-10" style={{ left: `${mirrorFlipped ? 100 - sliderPos : sliderPos}%`, transform: "translateX(-50%)" }}>
                        <div className="w-0.5 h-full bg-white/80 shadow-lg" />
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                          <div className="flex gap-0.5">
                            <ChevronDown className="w-3 h-3 text-gray-700 -rotate-90" />
                            <ChevronDown className="w-3 h-3 text-gray-700 rotate-90" />
                          </div>
                        </div>
                      </div>

                      <div className={cn("absolute top-2 z-20 px-2 py-0.5 rounded text-[10px] text-white pointer-events-none bg-purple-600/90", (compareFlipped !== mirrorFlipped) ? "left-2" : "right-2")}>
                        {selectedStyle.label}
                      </div>
                      <div className={cn("absolute top-2 z-20 px-2 py-0.5 rounded text-[10px] text-white pointer-events-none bg-black/70", (compareFlipped !== mirrorFlipped) ? "right-2" : "left-2")}>
                        Original
                      </div>
                      {processingStyle && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none z-20">
                          <div className="flex items-center gap-2 bg-black/70 rounded-lg px-4 py-2">
                            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs text-white">Processing…</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    images.forEach(i => URL.revokeObjectURL(i.src));
                    if (videoSrc) URL.revokeObjectURL(videoSrc);
                    setImages([]);
                    setVideoFile(null);
                    setVideoSrc("");
                    setMediaType("image");
                    setCropRect(null);
                    setResizeDims(null);
                    setVideoError("");
                  }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3 h-3" /> Clear
                  </button>
                </div>
              </div>
            )}

          </div>

          <div className="hidden lg:flex lg:flex-col gap-4 overflow-y-auto pr-0.5">
            {sidebarContent}
          </div>
        </div>

        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="right" className="w-80 max-w-[85vw] overflow-y-auto space-y-4 pt-10">
            <SheetHeader className="sr-only">
              <SheetTitle>Style Settings</SheetTitle>
              <SheetDescription>Adjust style, intensity, and export options</SheetDescription>
            </SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>

        {showCropTool && primaryImage && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-3xl w-full space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Crop Image</h3>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Ratio:</Label>
                  <Select value={cropRatio} onValueChange={setCropRatio}>
                    <SelectTrigger className="h-7 text-xs w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CROP_RATIOS.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
                <canvas
                  ref={cropCanvasRef}
                  className="w-full h-full cursor-crosshair"
                  onMouseDown={onCropMouseDown}
                  onMouseMove={onCropMouseMove}
                  onMouseUp={onCropMouseUp}
                />
              </div>
              {tempCropRect && (
                <p className="text-[10px] text-muted-foreground">
                  Selection: {tempCropRect.w} × {tempCropRect.h} from ({tempCropRect.x}, {tempCropRect.y})
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setShowCropTool(false); setTempCropRect(null); }}>Cancel</Button>
                <Button variant="ghost" size="sm" onClick={clearCrop}>Clear Crop</Button>
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={applyCrop} disabled={!tempCropRect}>
                  Apply Crop
                </Button>
              </div>
            </div>
          </div>
        )}

        <Dialog open={resizeOpen} onOpenChange={setResizeOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Resize Image</DialogTitle>
              <DialogDescription>Set custom dimensions or choose a preset.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Width (px)</Label>
                  <input type="number" value={resizeW} onChange={e => setResizeW(e.target.value)}
                    className="w-full mt-1 h-8 text-sm px-2 rounded-md border border-input bg-transparent" />
                </div>
                <div>
                  <Label className="text-xs">Height (px)</Label>
                  <input type="number" value={resizeH} onChange={e => setResizeH(e.target.value)}
                    className="w-full mt-1 h-8 text-sm px-2 rounded-md border border-input bg-transparent" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Presets</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {RESIZE_PRESETS.map(p => (
                    <Button key={p.label} variant="outline" size="sm" className="text-[10px] h-7 justify-start"
                      onClick={() => { setResizeW(String(p.w)); setResizeH(String(p.h)); }}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setResizeDims(null); setResizeOpen(false); }}>
                  Clear
                </Button>
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={applyResize}>
                  Apply
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
