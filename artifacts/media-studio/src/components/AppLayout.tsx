import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Film,
  FileText,
  Crop,
  Wand2,
  Sparkles,
  Video,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Clapperboard,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  {
    section: "Dashboard",
    items: [
      { path: "/", label: "Home", icon: LayoutDashboard, available: true },
    ],
  },
  {
    section: "Video Tools",
    items: [
      { path: "/gif-converter", label: "GIF Converter", icon: Film, available: true },
      { path: "/aspect-resizer", label: "Aspect Resizer", icon: Crop, available: true },
      { path: "/video-merger", label: "Video Merger", icon: Clapperboard, available: true },
      { path: "/particle-vfx", label: "Particle VFX", icon: Sparkles, available: true },
      { path: "/video-stylizer", label: "AI Stylizer", icon: Wand2, available: true },
    ],
  },
  {
    section: "Creative Tools",
    items: [
      { path: "/ocr", label: "OCR Text Extract", icon: FileText, available: true },
    ],
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:relative z-50 lg:z-auto flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 h-full",
          collapsed ? "w-16" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-sidebar-border", collapsed && "justify-center px-2")}>
          {!collapsed && (
            <>
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Video className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="font-bold text-sm text-sidebar-foreground leading-none">CreativeStudio</div>
                <div className="text-xs text-muted-foreground mt-0.5">Media Platform</div>
              </div>
            </>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Video className="w-4 h-4 text-white" />
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
          {navItems.map((section) => (
            <div key={section.section}>
              {!collapsed && (
                <div className="px-2 mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {section.section}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                  const navLink = (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={() => setMobileOpen(false)}
                      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                          isActive
                            ? "bg-sidebar-primary/15 text-sidebar-primary"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                          collapsed && "justify-center px-2",
                          !item.available && "opacity-50"
                        )}
                      >
                        <item.icon className={cn("shrink-0", collapsed ? "w-5 h-5" : "w-4 h-4")} />
                        {!collapsed && (
                          <span className="flex-1 truncate">{item.label}</span>
                        )}
                        {!collapsed && !item.available && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Soon
                          </Badge>
                        )}
                        {!collapsed && isActive && item.available && (
                          <div className="w-1.5 h-1.5 rounded-full bg-sidebar-primary shrink-0" />
                        )}
                      </div>
                    </Link>
                  );
                  if (!collapsed) return <div key={item.path}>{navLink}</div>;
                  return (
                    <Tooltip key={item.path} delayDuration={200}>
                      <TooltipTrigger asChild>
                        {navLink}
                      </TooltipTrigger>
                      <TooltipContent side="right" className="text-xs font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse button */}
        <div className="p-2 border-t border-sidebar-border">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center w-full p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            data-testid="sidebar-collapse-btn"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            data-testid="mobile-menu-btn"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
              <Video className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold text-sm">CreativeStudio</span>
          </div>
        </div>

        {/* Page */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
