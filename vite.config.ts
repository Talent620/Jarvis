import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Realne metryki kodu (do wyceny w panelu admina) — liczone PRZY BUDOWANIU, nie w runtime
// (zbudowany bundel nie ma dostępu do źródeł). Best-effort: błąd nie wywala builda.
function projectStats() {
  const out = { modules: 0, components: 0, tests: 0, files: 0, loc: 0 };
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e)) continue;
      out.files++;
      if (/\.test\.tsx?$/.test(e)) out.tests++;
      else if (e.endsWith(".tsx")) out.components++;
      else out.modules++;
      try { out.loc += readFileSync(p, "utf8").split("\n").length; } catch { /* pomiń */ }
    }
  };
  try { walk("src"); walk("tests"); } catch { /* fallback: zera */ }
  return out;
}

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
    // Data/godzina builda (UTC) — widoczna w ⚙ → Dane; jednoznacznie mówi, którą wersję masz.
    // W CI bierzemy z env APP_BUILD (TEN SAM znacznik trafia do bundle.json), by aktualizacja OTA
    // nie raportowała „nowszej wersji" dla identycznego buildu. Lokalnie fallback na bieżący czas.
    __APP_BUILD__: JSON.stringify(env.APP_BUILD || new Date().toISOString().slice(0, 16).replace("T", " ")),
    // Metryki kodu (moduły/komponenty/testy/LOC) — do wyceny projektu w panelu admina.
    __PROJECT_STATS__: JSON.stringify(projectStats()),
  },
  plugins: [react()],
  // Workery (np. embeddingi on-device) dynamicznie importują ciężkie biblioteki —
  // wymaga formatu ES (iife nie wspiera code-splittingu w workerze).
  worker: { format: "es" },
  build: {
    outDir: "dist",
    // Niższy target = szersza zgodność ze starszym Android System WebView (np. Galaxy S9+
    // bez aktualizacji). esbuild stranspiluje nowszą składnię (?., ??, ??=, ||=) — inaczej
    // taki WebView wyrzuca błąd składni i aplikacja „nic nie robi".
    target: ["es2019", "chrome79", "safari13"],
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
