import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// JARVIS web app — bundled by Vite, wrapped into Android by Capacitor.
// BEZPIECZEŃSTWO: do bundla klienta NIE trafiają żadne klucze API. Wbudowane (darmowe)
// modele działają przez BFF (Cloudflare Worker) ustawiony w VITE_BFF_URL, który dokleja
// klucze po stronie serwera. Klucze użytkownika dozwolone tylko w trybie „własny klucz"
// (BYOK) i są szyfrowane lokalnie. __DEFAULT_KEYS__ pozostaje PUSTE (kompatybilność store).
const env = process.env;
const DEFAULT_KEYS = {
  anthropic: "",
  gemini: "",
  groq: "",
  cerebras: "",
  mistral: "",
  openrouter: "",
  nvidia: "",
  github: "",
  tavily: "",
};

export default defineConfig({
  base: "./",
  define: {
    __DEFAULT_KEYS__: JSON.stringify(DEFAULT_KEYS),
    // Aktywacja licencją wymagana domyślnie; ustaw JARVIS_LICENSE_REQUIRED=false, by wyłączyć.
    __LICENSE_REQUIRED__: JSON.stringify(env.JARVIS_LICENSE_REQUIRED !== "false"),
    // Adres serwera licencji (Cloudflare Worker). Pusty = tryb offline (sam podpis ECDSA).
    __LICENSE_URL__: JSON.stringify(env.JARVIS_LICENSE_URL || ""),
    // Tryb rygorystyczny: wymaga udanej aktywacji online (limit urządzeń, zdalne unieważnienie).
    __LICENSE_STRICT__: JSON.stringify(env.JARVIS_LICENSE_STRICT === "true"),
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Wydziel TYLKO React (zawsze ładowany, stabilny) do osobnego chunku — lepsze
        // cache'owanie między buildami. Reszty zależności NIE scalamy: część używają wyłącznie
        // leniwie ładowane ekrany (PDF, QR…) i wymuszenie ich do wspólnego vendora pogorszyłoby start.
        manualChunks(id: string) {
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/")) {
            return "react-vendor";
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
