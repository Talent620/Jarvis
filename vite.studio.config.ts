import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// === Build OSOBNEGO programu: Studio Obrazów (standalone) ===
// Buduje wyłącznie studio.html → katalog dist-studio. NIE rusza głównego buildu JARVIS-a
// (osobny config, osobny outDir). Stałe define z bezpiecznymi domyślnymi — standalone NIE
// wymaga aktywacji licencją (to Twoje narzędzie). Uruchom: `npx vite build --config vite.studio.config.ts`.

const DEFAULT_KEYS = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "", tavily: "" };

export default defineConfig({
  base: "./",
  define: {
    __DEFAULT_KEYS__: JSON.stringify(DEFAULT_KEYS),
    __LICENSE_REQUIRED__: JSON.stringify(false),
    __LICENSE_URL__: JSON.stringify(""),
    __LICENSE_STRICT__: JSON.stringify(false),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ")),
    __PROJECT_STATS__: JSON.stringify({ modules: 0, components: 0, tests: 0, files: 0, loc: 0 }),
  },
  plugins: [react()],
  worker: { format: "es" },
  build: {
    outDir: "dist-studio",
    target: ["es2019", "chrome79", "safari13"],
    sourcemap: false,
    // Jeden bundel (bez code-splittingu) — ułatwia złożenie pojedynczego pliku HTML „do kliknięcia".
    rollupOptions: { input: "studio.html", output: { inlineDynamicImports: true } },
  },
});
