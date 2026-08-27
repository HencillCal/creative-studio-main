import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import {
  Film, FileText, Crop, Wand2, Sparkles, Clapperboard,
  ArrowRight, Zap, Layers, Download, Video, Menu, X,
  Play, Image, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── CSS keyframes ─────────────────────────────────────────────────────────────
const STYLE = `
@keyframes shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
@keyframes fade-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fade-in{from{opacity:0}to{opacity:1}}
@keyframes float-a{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@keyframes float-b{0%,100%{transform:translateY(0)}50%{transform:translateY(10px)}}
@keyframes float-c{0%,100%{transform:translate(0,0)}50%{transform:translate(8px,-8px)}}
@keyframes ping-slow{0%{opacity:.6;transform:scale(1)}70%{opacity:0;transform:scale(1.7)}100%{opacity:0}}
@keyframes spin-slow{to{transform:rotate(360deg)}}
@keyframes count-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.shimmer-text{background:linear-gradient(90deg,#a78bfa,#60a5fa,#f472b6,#a78bfa);background-size:300% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:shimmer 4s linear infinite}
.anim-fade-up{animation:fade-up .7s ease both}
.anim-fade-in{animation:fade-in .5s ease both}
.anim-float-a{animation:float-a 6s ease-in-out infinite}
.anim-float-b{animation:float-b 8s ease-in-out infinite}
.anim-float-c{animation:float-c 10s ease-in-out infinite}
.hero-glow{background:radial-gradient(ellipse 80% 60% at 65% 40%,rgba(139,92,246,.18) 0%,rgba(99,102,241,.1) 40%,transparent 70%)}
.nav-blur{backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.mockup-shadow{box-shadow:0 32px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06),inset 0 1px 0 rgba(255,255,255,.08)}
.tool-row:hover{background:rgba(139,92,246,.08)}
`;

// ── Live canvas background ────────────────────────────────────────────────────
function LiveScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    type P = { x: number; y: number; r: number; vx: number; vy: number; hue: number; phase: number };
    const make = (): P[] => Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.3, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
      hue: [265, 240, 200, 310, 180][Math.floor(Math.random() * 5)], phase: Math.random() * Math.PI * 2,
    }));
    let pts = make();
    type Orb = { x: number; y: number; r: number; vx: number; vy: number; hue: number };
    let orbs: Orb[] = [];
    const makeOrbs = () => {
      orbs = [
        { x: canvas.width * .18, y: canvas.height * .28, r: 200, vx: .14, vy: .09, hue: 265 },
        { x: canvas.width * .82, y: canvas.height * .7,  r: 170, vx: -.1, vy: .12, hue: 235 },
        { x: canvas.width * .5,  y: canvas.height * .9,  r: 130, vx: .08, vy: -.15, hue: 190 },
      ];
    };
    makeOrbs();
    let raf: number, t = 0;
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      t += .007;
      for (const o of orbs) {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        g.addColorStop(0, `hsla(${o.hue},80%,60%,.12)`);
        g.addColorStop(1, `hsla(${o.hue},80%,60%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r || o.x > W + o.r) o.vx *= -1;
        if (o.y < -o.r || o.y > H + o.r) o.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 85) {
            ctx.beginPath(); ctx.strokeStyle = `hsla(260,70%,70%,${.08 * (1 - d / 85)})`;
            ctx.lineWidth = .5; ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        p.phase += .016;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},80%,70%,${.3 + .3 * Math.sin(p.phase)})`; ctx.fill();
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" />;
}

// ── Count-up ──────────────────────────────────────────────────────────────────
function useCountUp(end: number, duration = 1200) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - t0) / duration, 1);
        setVal(Math.round((1 - Math.pow(1 - p, 3)) * end));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [end, duration]);
  return [val, ref] as const;
}

// ── App UI Mockup (right-side hero panel) ─────────────────────────────────────
function AppMockup() {
  return (
    <div className="relative w-full max-w-[520px] mx-auto lg:mx-0 lg:ml-auto">
      {/* Floating decorative badges */}
      <div className="anim-float-c absolute -top-4 -left-6 z-20 hidden sm:flex items-center gap-2 bg-background/90 border border-border/60 rounded-xl px-3 py-2 shadow-lg nav-blur">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
          <Play className="w-3.5 h-3.5 text-white fill-white" />
        </div>
        <div className="text-xs font-semibold text-foreground/90">Video Tools</div>
      </div>
      <div className="anim-float-a absolute -top-6 right-4 z-20 hidden sm:flex w-9 h-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-lg">
        <Type className="w-4 h-4 text-white" />
      </div>
      <div className="anim-float-b absolute bottom-16 -right-4 z-20 hidden sm:flex w-9 h-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg">
        <Image className="w-4 h-4 text-white" />
      </div>
      <div className="anim-float-c absolute top-1/3 -right-7 z-20 hidden md:flex items-center gap-1.5 bg-background/90 border border-border/60 rounded-xl px-3 py-2 shadow-lg nav-blur">
        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-xs font-semibold text-foreground/80">AI Ready</span>
      </div>

      {/* Main mockup window */}
      <div className="relative rounded-2xl overflow-hidden mockup-shadow border border-white/8 bg-[#0d0e1a]" style={{ aspectRatio: "16/11" }}>
        {/* Window chrome */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/6 bg-[#111224]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center">
              <Video className="w-2.5 h-2.5 text-white" />
            </div>
            <span className="text-[11px] font-bold text-white/80">CreativeStudio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-white/6 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full border border-white/20" />
            </div>
            <div className="w-5 h-5 rounded-full bg-white/6 flex items-center justify-center">
              <div className="w-2 h-0.5 bg-white/30 rounded-full" />
            </div>
            <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
              <span className="text-[8px] text-white/60 font-bold">K</span>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="flex h-full">
          {/* Sidebar */}
          <div className="w-[110px] shrink-0 border-r border-white/5 bg-[#0c0d1c] flex flex-col py-2 px-1.5 gap-0.5 overflow-hidden">
            <div className="px-1.5 py-1 mb-1">
              <div className="text-[7px] font-bold uppercase tracking-widest text-white/25">Dashboard</div>
            </div>
            {[
              { icon: Layers, label: "Home", active: true },
            ].map((item) => (
              <div key={item.label} className={cn("flex items-center gap-1.5 px-1.5 py-1 rounded-md", item.active ? "bg-violet-500/20 text-violet-300" : "text-white/40")}>
                <item.icon className="w-2.5 h-2.5 shrink-0" />
                <span className="text-[8px] font-semibold truncate">{item.label}</span>
              </div>
            ))}
            <div className="px-1.5 py-1 mt-1.5 mb-1">
              <div className="text-[7px] font-bold uppercase tracking-widest text-white/25">Video Tools</div>
            </div>
            {[
              { icon: Film, label: "GIF Converter" },
              { icon: Crop, label: "Aspect Resizer" },
              { icon: Clapperboard, label: "Video Merger" },
              { icon: Sparkles, label: "Particle VFX" },
              { icon: Wand2, label: "AI Stylizer" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-white/40 tool-row transition-colors">
                <item.icon className="w-2.5 h-2.5 shrink-0" />
                <span className="text-[8px] font-medium truncate">{item.label}</span>
              </div>
            ))}
            <div className="px-1.5 py-1 mt-1.5 mb-1">
              <div className="text-[7px] font-bold uppercase tracking-widest text-white/25">Creative Tools</div>
            </div>
            <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-white/40 tool-row transition-colors">
              <FileText className="w-2.5 h-2.5 shrink-0" />
              <span className="text-[8px] font-medium truncate">OCR Text Extract</span>
            </div>
          </div>

          {/* Main panel */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Top tool cards row */}
            <div className="grid grid-cols-3 gap-1.5 p-2.5">
              {[
                { label: "AI Video Converter", sub: "Convert any format.", grad: "from-violet-500 to-purple-600", btn: "Convert Now", icon: Film },
                { label: "AI Text Extractor", sub: "Extract text from images & PDFs", grad: "from-emerald-500 to-teal-500", btn: "Extract Text", icon: FileText },
                { label: "AI Image Stylizer", sub: "Transform with AI styles", grad: "from-pink-500 to-fuchsia-500", btn: "Start Styling", icon: Wand2 },
              ].map((card) => (
                <div key={card.label} className="rounded-lg bg-white/4 border border-white/6 p-2 flex flex-col gap-1.5">
                  <div className={cn("w-5 h-5 rounded-md bg-gradient-to-br flex items-center justify-center", card.grad)}>
                    <card.icon className="w-2.5 h-2.5 text-white" />
                  </div>
                  <div className="text-[8px] font-bold text-white/80 leading-tight">{card.label}</div>
                  <div className="text-[6.5px] text-white/40 leading-tight">{card.sub}</div>
                  <div className={cn("mt-auto text-[7px] font-bold text-white px-1.5 py-0.5 rounded-md bg-gradient-to-r w-fit", card.grad)}>{card.btn}</div>
                </div>
              ))}
            </div>

            {/* Recent Creations */}
            <div className="px-2.5 pb-1 flex items-center justify-between">
              <div className="text-[8px] font-bold text-white/70">Recent Creations</div>
              <div className="text-[7px] text-violet-400 font-semibold">View All</div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 px-2.5 pb-2.5">
              {[
                "from-violet-600 via-purple-600 to-indigo-700",
                "from-cyan-500 via-blue-600 to-indigo-700",
                "from-fuchsia-600 via-pink-600 to-rose-700",
                "from-emerald-500 via-teal-600 to-cyan-700",
              ].map((grad, i) => (
                <div key={i} className={cn("rounded-lg bg-gradient-to-br aspect-[4/3] relative overflow-hidden", grad)}>
                  <div className="absolute inset-0 opacity-30" style={{ background: "repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,.04) 4px,rgba(255,255,255,.04) 8px)" }} />
                  {i === 0 && <div className="absolute inset-0 flex items-center justify-center"><div className="w-4 h-4 rounded-full border border-white/40 flex items-center justify-center"><Play className="w-2 h-2 text-white fill-white" /></div></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats strip below mockup */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { n: "6", label: "Tools Available", sub: "All live now", icon: Layers, hue: 265 },
          { n: "5", label: "AI Features", sub: "Powered by Replit AI", icon: Zap, hue: 200 },
          { n: "10+", label: "Export Formats", sub: "MP4, GIF, PNG, JPEG & more", icon: Download, hue: 310 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/60 bg-card/60 nav-blur px-3 py-2.5 flex items-center gap-2.5">
            <div className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `hsla(${s.hue},70%,60%,.15)` }}>
              <s.icon className="w-3.5 h-3.5" style={{ color: `hsl(${s.hue},70%,65%)` }} />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-black leading-none" style={{ color: `hsl(${s.hue},80%,72%)` }}>{s.n}</div>
              <div className="text-[10px] font-semibold text-foreground/80 truncate">{s.label}</div>
              <div className="text-[9px] text-muted-foreground truncate hidden sm:block">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat card for below-fold section ─────────────────────────────────────────
const STATS = [
  { label: "Tools Available", end: 6,  suffix: "",  sub: "All live now",         icon: Layers,   hue: 265 },
  { label: "AI Features",     end: 5,  suffix: "",  sub: "Powered by Replit AI", icon: Zap,      hue: 200 },
  { label: "Export Formats",  end: 10, suffix: "+", sub: "MP4, GIF, PNG, JPEG…", icon: Download, hue: 310 },
];

// ── Tool card for tools grid ──────────────────────────────────────────────────
const tools = [
  { path: "/gif-converter",  label: "GIF Converter",       desc: "Convert any video to a smooth, optimized GIF with custom trim points.", icon: Film,        grad: "from-violet-500 via-purple-500 to-fuchsia-500", glow: "rgba(139,92,246,.35)",  cat: "Video",   tag: "FFmpeg" },
  { path: "/aspect-resizer", label: "Aspect Ratio Resizer",desc: "Resize images & videos for any platform — TikTok, YouTube, Instagram.", icon: Crop,        grad: "from-blue-500 via-cyan-500 to-sky-400",         glow: "rgba(56,189,248,.3)",   cat: "Video",   tag: "Sharp + FFmpeg" },
  { path: "/ocr",            label: "OCR Text Extract",    desc: "Extract text from any image — printed, handwritten, or screenshots.",   icon: FileText,    grad: "from-emerald-500 via-teal-500 to-green-400",    glow: "rgba(52,211,153,.3)",   cat: "Creative",tag: "Tesseract.js" },
  { path: "/video-merger",   label: "Video Merger",        desc: "Stitch multiple clips into one — cut or fade transitions, exported as 720p MP4.", icon: Clapperboard,grad: "from-indigo-500 via-blue-500 to-violet-500",glow: "rgba(99,102,241,.3)",   cat: "Video",   tag: "FFmpeg" },
  { path: "/particle-vfx",   label: "Particle VFX",        desc: "Animate snow, rain, stars, fireflies, confetti or bubbles over any background.", icon: Sparkles, grad: "from-cyan-400 via-sky-500 to-blue-500",      glow: "rgba(34,211,238,.3)",   cat: "Video",   tag: "Canvas API" },
  { path: "/video-stylizer", label: "AI Stylizer",         desc: "Apply 18 cinematic and artistic styles — vivid, noir, sketch, neon and more.", icon: Wand2,   grad: "from-pink-500 via-fuchsia-500 to-purple-500",  glow: "rgba(244,114,182,.3)",  cat: "AI",      tag: "Gemini AI" },
];

function ToolCard({ tool, index }: { tool: typeof tools[0]; index: number }) {
  return (
    <Link href={tool.path}>
      <div
        className="group relative overflow-hidden rounded-2xl border border-border bg-card cursor-pointer transition-all duration-300 hover:border-primary/40 anim-fade-up"
        style={{ animationDelay: `${index * 70}ms`, boxShadow: "0 1px 0 rgba(255,255,255,.03)" }}
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl" style={{ background: `radial-gradient(circle at 50% 0%,${tool.glow},transparent 70%)` }} />
        <div className="relative px-5 pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div className="relative">
              <div className={cn("w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110", tool.grad)}>
                <tool.icon className="w-5 h-5 text-white" />
              </div>
              <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ boxShadow: `0 0 18px 4px ${tool.glow}` }} />
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all duration-200 mt-1" />
          </div>
          <h3 className="font-bold text-sm mt-4 mb-1.5 group-hover:text-primary transition-colors">{tool.label}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{tool.desc}</p>
        </div>
        <div className={cn("h-0.5 w-full bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-300", tool.grad)} />
      </div>
    </Link>
  );
}

// ── Navbar ─────────────────────────────────────────────────────────────────────
function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 nav-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Video className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-black text-sm tracking-tight">CreativeStudio</span>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {["Features", "Tools", "AI Models", "Pricing", "Resources"].map((item) => (
            <button key={item} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors font-medium">
              {item}
            </button>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3 shrink-0">
          <button className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
            Sign in
          </button>
          <Link href="/gif-converter">
            <button className="flex items-center gap-1.5 text-sm font-bold px-4 py-1.5 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors shadow-md shadow-primary/25">
              Get Started <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-1.5 rounded-lg hover:bg-muted transition-colors" onClick={() => setOpen(!open)}>
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border/50 bg-background/95 nav-blur px-4 py-4 space-y-1 anim-fade-in">
          {["Features", "Tools", "AI Models", "Pricing", "Resources"].map((item) => (
            <button key={item} className="w-full text-left px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors font-medium">
              {item}
            </button>
          ))}
          <div className="pt-3 flex flex-col gap-2">
            <button className="w-full text-center py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors">Sign in</button>
            <Link href="/gif-converter">
              <button className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors">
                Get Started <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [toolsVal, toolsRef] = useCountUp(6);
  const [aiVal, aiRef] = useCountUp(5);
  const [fmtVal, fmtRef] = useCountUp(10);

  return (
    <>
      <style>{STYLE}</style>
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />

        {/* ── HERO ── */}
        <section className="relative overflow-hidden">
          {/* Canvas bg */}
          <div className="absolute inset-0 pointer-events-none">
            <LiveScene />
          </div>
          {/* Glow overlay */}
          <div className="absolute inset-0 hero-glow pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background pointer-events-none" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 xl:py-20">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">

              {/* Left — text */}
              <div>
                {/* Headline */}
                <h1
                  className="text-4xl sm:text-5xl lg:text-5xl xl:text-6xl font-black tracking-tight leading-[1.06] mb-5 anim-fade-up"
                  style={{ animationDelay: "60ms" }}
                >
                  <span className="shimmer-text">All-in-one</span>
                  <br />
                  <span className="text-foreground">Creative Media Studio</span>
                </h1>

                {/* Description */}
                <p
                  className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-lg mb-6 anim-fade-up"
                  style={{ animationDelay: "120ms" }}
                >
                  A powerful suite of AI-powered media tools — convert videos,
                  extract text, apply AI styles, and create stunning visuals,
                  all in one place.
                </p>

                {/* CTAs */}
                <div className="flex flex-wrap gap-3 mb-8 anim-fade-up" style={{ animationDelay: "240ms" }}>
                  <Link href="/gif-converter">
                    <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-sm shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-[1.02] transition-all duration-200">
                      Start Creating Now <ArrowRight className="w-4 h-4" />
                    </button>
                  </Link>
                  <button
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-muted/30 text-foreground font-bold text-sm hover:bg-muted/60 hover:border-primary/30 transition-all duration-200"
                    onClick={() => document.getElementById("tools-grid")?.scrollIntoView({ behavior: "smooth" })}
                  >
                    Explore Tools
                  </button>
                </div>

              </div>

              {/* Right — App mockup */}
              <div className="anim-fade-up" style={{ animationDelay: "200ms" }}>
                <AppMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ── TOOLS GRID ── */}
        <section id="tools-grid" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="relative w-5 h-5 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-emerald-400 relative z-10" />
              <div className="absolute inset-0 rounded-full border border-emerald-400 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold">Ready to Use</h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/60">{tools.length} tools</span>
            <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {tools.map((tool, i) => <ToolCard key={tool.path} tool={tool} index={i} />)}
          </div>
        </section>

      </div>
    </>
  );
}
