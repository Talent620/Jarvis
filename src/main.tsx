import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { toast } from "./lib/toast";
import { logError } from "./lib/errorLog";
import "./styles/index.css";
import { initPlugins } from "./plugins";
import { installSecretsVault } from "./lib/secretsVault";
import { applyPerformanceProfile } from "./lib/performanceProfile";
import { setChatStorageWarner } from "./lib/chats";

// Opcjonalny, OPT-IN podgląd „Neural Interface" pod hash-route `#neural` — ładowany leniwie,
// więc framer-motion/Tailwind nie wchodzą do głównego bundla zwykłych użytkowników.
// Domyślnie (bez hasha) renderujemy klasyczny <App/> — zero zmian w produkcyjnym przepływie.
const NeuralInterface = React.lazy(() => import("./components/jarvis-ui/NeuralInterface"));
const isNeural = typeof location !== "undefined" && location.hash.replace(/^#\/?/, "") === "neural";
window.addEventListener("hashchange", () => location.reload()); // przełączanie #neural ⇄ klasyczny

installSecretsVault(); // szyfrowanie kluczy w spoczynku (no-op, gdy wyłączone)
initPlugins();

// Profil wydajności: na słabszych urządzeniach (np. S9) włącz klasę low-power (CSS zdejmuje
// blur/ciężkie animacje). Pauzuj animacje, gdy aplikacja schowana (bateria/CPU).
applyPerformanceProfile();
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("app-hidden", document.hidden);
});

// Historia czatu: gdy pamięć jest pełna i trzeba było obciąć obrazy/starsze sesje, powiedz
// to użytkownikowi (koniec cichej degradacji widocznej tylko w konsoli). Throttling 1/min.
let lastChatWarn = 0;
setChatStorageWarner((r) => {
  const now = Date.now();
  if (now - lastChatWarn < 60_000) return;
  lastChatWarn = now;
  softReport(r.ok
    ? "Pamięć prawie pełna — skróciłem historię czatu (obrazy/starsze rozmowy). Zrób kopię i wyczyść stare."
    : "Pamięć pełna — nie zapisałem historii czatu. Wyczyść stare rozmowy albo zrób kopię.");
});

// Aktualizacje OTA: potwierdź wtyczce, że ta paczka DZIAŁA (inaczej cofnęłaby ją). No-op na web.
// Jeśli się nie uda (np. brak wtyczki w starym APK), logujemy — wtyczka i tak bezpiecznie cofnie paczkę.
void import("./lib/liveUpdate").then((m) => m.notifyLiveUpdateReady()).catch((e) => {
  console.warn("[JARVIS] OTA: nie potwierdziłem gotowości paczki (możliwy rollback przy następnym starcie).", e);
});

// Self-healing: b\u0142\u0119dy poza Reactem (asynchroniczne, sieciowe) nie gin\u0105 w konsoli \u2014
// JARVIS m\u00f3wi o nich po ludzku. Throttling chroni przed lawin\u0105 toast\u00f3w.
let lastGlobalToast = 0;
function softReport(msg: string): void {
  const now = Date.now();
  if (now - lastGlobalToast < 4000) return;
  lastGlobalToast = now;
  toast(msg);
}
window.addEventListener("unhandledrejection", (e) => {
  console.error("[JARVIS] nieobs\u0142u\u017cony b\u0142\u0105d (promise):", e.reason);
  logError("global", e.reason, "unhandledrejection"); // zasil monitor niezawodno\u015bci (\u2699 \u2192 Umys\u0142)
  softReport("Wykry\u0142em drobny problem w tle \u2014 obs\u0142u\u017cy\u0142em go, dzia\u0142am dalej.");
  e.preventDefault();
});
window.addEventListener("error", (e) => {
  // B\u0142\u0119dy \u0142adowania zasob\u00f3w (img/script) zg\u0142aszaj\u0105 si\u0119 tutaj bez .error \u2014 pomijamy.
  if (!e.error) return;
  console.error("[JARVIS] nieobs\u0142u\u017cony b\u0142\u0105d:", e.error);
  logError("global", e.error, "window.error"); // zasil monitor niezawodno\u015bci
  softReport("Wykry\u0142em drobny problem w tle \u2014 obs\u0142u\u017cy\u0142em go, dzia\u0142am dalej.");
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="głównego interfejsu">
      {isNeural ? (
        <Suspense fallback={null}>
          <NeuralInterface />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
