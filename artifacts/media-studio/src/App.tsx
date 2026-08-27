import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import GifConverter from "@/pages/GifConverter";
import AspectResizer from "@/pages/AspectResizer";
import OcrTool from "@/pages/OcrTool";
import VideoMerger from "@/pages/VideoMerger";
import ParticleVfx from "@/pages/ParticleVfx";
import AiStylizer from "@/pages/AiStylizer";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route>
        {() => (
          <AppLayout>
            <Switch>
              <Route path="/gif-converter" component={GifConverter} />
              <Route path="/aspect-resizer" component={AspectResizer} />
              <Route path="/ocr" component={OcrTool} />
              <Route path="/video-merger" component={VideoMerger} />
              <Route path="/particle-vfx" component={ParticleVfx} />
              <Route path="/video-stylizer" component={AiStylizer} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
