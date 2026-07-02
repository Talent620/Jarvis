import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// KOMPAS — PWA bez backendu. sql.js (WASM) ładowany przez ?url, więc żadnych
// specjalnych wtyczek; manifest i service worker leżą w public/.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", sourcemap: false },
});
