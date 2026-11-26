import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
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

/**
 * A shortcut added before the manifest pointed at /vr still launches the site
 * root. On a Quest, route that first standalone launch to the theater once;
 * a `Back to browse` navigation afterwards is left alone.
 */
const StandaloneEntry = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname !== "/") return;
    if (sessionStorage.getItem("nyanime.standalone-routed") === "1") return;
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    const xr = navigator.xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported("immersive-vr")
      .then((supported) => {
        if (!supported) return;
        sessionStorage.setItem("nyanime.standalone-routed", "1");
        navigate("/vr", { replace: true });
      })
      .catch(() => undefined);
  }, [location.pathname, navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LiquidGlassDefs />
      <Toaster />
      <Sonner />
      <NetworkStatus />
      <BrowserRouter>
        <StandaloneEntry />
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
