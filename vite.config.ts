import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { streamProxyPlugin } from "./vite-plugins/streamProxy";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // hls.js and mux.js are only needed once playback or a download
        // starts, so they are split out rather than shipped in the main
        // bundle. mux.js in particular is only reached by MP4 downloads.
        manualChunks: {
          'vendor-player': ['hls.js'],
          'vendor-transmux': ['mux.js'],
        },
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    // Serves /api/stream locally; Vercel serves it from `api/stream.ts` in
    // production, with both sharing the same implementation.
    mode === 'development' && streamProxyPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
