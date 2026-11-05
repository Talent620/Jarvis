import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { defaultPublicJwk } from "./src/lib/licenseAuthority";

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
const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
let appCommit = "unknown";
try { appCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* source archives have no .git */ }
if (env.APP_COMMIT) {
  if (!/^[0-9a-f]{40}$/.test(env.APP_COMMIT)) throw new Error("APP_COMMIT must be a full Git SHA.");
  if (appCommit !== "unknown" && appCommit !== env.APP_COMMIT) throw new Error("APP_COMMIT does not match the checked out source.");
  appCommit = env.APP_COMMIT;
}
const issuerFile = env.JARVIS_LICENSE_PUBLIC_KEY_FILE || "license-public.local.json";
let licensePublicJwk: Record<string, unknown> | null = null;
if (existsSync(issuerFile)) {
  const candidate = JSON.parse(readFileSync(issuerFile, "utf8"));
  if (candidate.kty !== "EC" || candidate.crv !== "P-256" || ["d", "privateKey", "keys"].some(key => Object.hasOwn(candidate, key))) {
    throw new Error("Plik wystawcy musi zawierać wyłącznie publiczny klucz EC P-256. Klucz prywatny nie może trafić do bundla.");
  }
  licensePublicJwk = { kty: "EC", crv: "P-256", x: candidate.x, y: candidate.y };
  createPublicKey({ key: licensePublicJwk, format: "jwk" }); // validates the curve point, not just JSON shape
} else if (env.JARVIS_LICENSE_PUBLIC_KEY_FILE) {
  throw new Error("Nie znaleziono wskazanego publicznego klucza wystawcy.");
} else {
  console.info("[licencje] Używam domyślnego publicznego klucza aplikacji. Własny wystawca: npm run license:init.");
}
const issuerPublicJwk = licensePublicJwk || defaultPublicJwk;
let issuerFingerprint: string | null = null;
try {
  createPublicKey({ key: issuerPublicJwk, format: "jwk" });
  issuerFingerprint = createHash("sha256").update(JSON.stringify({ kty: issuerPublicJwk.kty, crv: issuerPublicJwk.crv, x: issuerPublicJwk.x, y: issuerPublicJwk.y })).digest("hex");
} catch {
  const message = "MISSING_CONFIGURATION: niepoprawny publiczny klucz wystawcy licencji. Ustaw JARVIS_LICENSE_PUBLIC_KEY_FILE na zatwierdzony publiczny klucz. Klucz prywatny pozostaje u właściciela.";
  if (env.JARVIS_RELEASE_BUILD === "true") throw new Error(message);
  console.warn(`[licencje] ${message} Build deweloperski nie nadaje się do dystrybucji.`);
}
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
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
    // Aktywacja licencją wymagana domyślnie; ustaw JARVIS_LICENSE_REQUIRED=false, by wyłączyć.
    __LICENSE_REQUIRED__: JSON.stringify(env.JARVIS_LICENSE_REQUIRED !== "false"),
    __LICENSE_PUBLIC_JWK__: JSON.stringify(licensePublicJwk),
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
  plugins: [react(), {
    name: "jarvis-build-provenance",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build-metadata.json", source: JSON.stringify({
        schemaVersion: 1, version: appVersion, commit: appCommit,
        build: env.APP_BUILD || "local", licenseRequired: env.JARVIS_LICENSE_REQUIRED !== "false",
        issuer: licensePublicJwk ? "explicit-public-key" : "application-default",
        issuerPublicJwk, issuerFingerprint,
      }, null, 2) + "\n" });
    },
  }],
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
