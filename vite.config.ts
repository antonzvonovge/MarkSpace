import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // react-dnd keeps its manager in a module-level React context, so a second
  // copy silently breaks `useDragDropManager` inside the sidebar tree.
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react-dnd",
      "react-dnd-html5-backend",
      "dnd-core",
    ],
  },
  optimizeDeps: {
    // Prebundle the DnD stack together: when Vite discovers these late it
    // re-optimizes mid-session and the reload can leave two react-dnd chunks
    // live at once ("Expected drag drop context", blank window).
    include: [
      "react-dnd",
      "react-dnd-html5-backend",
      "dnd-core",
      "@minoru/react-dnd-treeview",
    ],
    // Huge WASM-inlined browser build — do not prebundle / transform.
    exclude: ["@terrastruct/d2"],
  },
  build: {
    chunkSizeWarningLimit: 12000,
    assetsInlineLimit: 0,
  },
}));
