import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import AnimeDetails from "./pages/AnimeDetails";
import Watch from "./pages/Watch";
import NotFound from "./pages/NotFound";
import Library from "./pages/Library";
import AnimeList from "./pages/AnimeList";
import NetworkStatus from "./components/NetworkStatus";
import { LiquidGlassDefs } from "./components/ui/liquid-glass";

// three.js lives only on the theater route, so the main bundle stays small.
const VrTheater = lazy(() => import("./pages/VrTheater"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: 1000,
      staleTime: 300000,
      refetchOnWindowFocus: false,
    },
  },
});

// Liquid glass is now applied per-surface via <GlassSurface> components.

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LiquidGlassDefs />
      <Toaster />
      <Sonner />
      <NetworkStatus />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/anime" element={<AnimeList />} />
          <Route path="/anime/:id" element={<AnimeDetails />} />
          <Route path="/anime/:id/watch" element={<Watch />} />
          <Route path="/library" element={<Library />} />
          <Route
            path="/vr"
            element={
              <Suspense
                fallback={
                  <div className="flex min-h-screen items-center justify-center bg-anime-darker text-white/70">
                    Loading theater…
                  </div>
                }
              >
                <VrTheater />
              </Suspense>
            }
          />
          {/* Old bookmarks and links to the removed account pages. */}
          <Route path="/profile" element={<Navigate to="/library" replace />} />
          <Route path="/settings" element={<Navigate to="/library" replace />} />
          <Route path="/signin" element={<Navigate to="/library" replace />} />
          <Route path="/signup" element={<Navigate to="/library" replace />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
