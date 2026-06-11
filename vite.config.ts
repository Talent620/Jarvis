import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// JARVIS web app — bundled by Vite, wrapped into Android by Capacitor.
// Domyślne klucze API wstrzykiwane przy budowie z zmiennych środowiskowych
// (ustawianych w CI z Secrets repo). W kodzie źródłowym NIE ma żadnych kluczy.
const env = process.env;
const DEFAULT_KEYS = {
  anthropic: env.JARVIS_ANTHROPIC_KEY || "",
  gemini: env.JARVIS_GEMINI_KEY || "",
  groq: env.JARVIS_GROQ_KEY || "",
  cerebras: env.JARVIS_CEREBRAS_KEY || "",
  mistral: env.JARVIS_MISTRAL_KEY || "",
  openrouter: env.JARVIS_OPENROUTER_KEY || "",
  nvidia: env.JARVIS_NVIDIA_KEY || "",
  github: env.JARVIS_GITHUB_KEY || "",
  // Nie-AI: klucz researchu (Tavily) — wstrzykiwany tak samo, mapowany w store.
  tavily: env.JARVIS_TAVILY_KEY || "",
};

export default defineConfig({
  base: "./",
  define: {
    __DEFAULT_KEYS__: JSON.stringify(DEFAULT_KEYS),
  },
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
