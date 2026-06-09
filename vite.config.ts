import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// JARVIS web app — bundled by Vite, wrapped into Android by Capacitor.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
});
