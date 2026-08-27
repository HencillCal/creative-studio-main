import { Clock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

interface ComingSoonProps {
  tool: string;
  phase: number;
}

export default function ComingSoon({ tool, phase }: ComingSoonProps) {
  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
        <Clock className="w-8 h-8 text-muted-foreground" />
      </div>
      <Badge variant="secondary" className="mb-4 text-xs">Coming in Phase {phase}</Badge>
      <h1 className="text-2xl font-bold mb-3">{tool}</h1>
      <p className="text-muted-foreground text-sm mb-6 max-w-sm">
        This tool is under development and will be available in a future update.
        The core tools in Phase 1 are available now — check out the dashboard.
      </p>
      <Link href="/">
        <Button variant="secondary" data-testid="back-to-dashboard-btn">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </Link>
    </div>
  );
}
