import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { toast } from "./lib/toast";
import "./styles/index.css";
import { initPlugins } from "./plugins";
import { installSecretsVault } from "./lib/secretsVault";

installSecretsVault(); // szyfrowanie kluczy w spoczynku (no-op, gdy wyłączone)
initPlugins();

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
  softReport("Wykry\u0142em drobny problem w tle \u2014 obs\u0142u\u017cy\u0142em go, dzia\u0142am dalej.");
  e.preventDefault();
});
window.addEventListener("error", (e) => {
  // B\u0142\u0119dy \u0142adowania zasob\u00f3w (img/script) zg\u0142aszaj\u0105 si\u0119 tutaj bez .error \u2014 pomijamy.
  if (!e.error) return;
  console.error("[JARVIS] nieobs\u0142u\u017cony b\u0142\u0105d:", e.error);
  softReport("Wykry\u0142em drobny problem w tle \u2014 obs\u0142u\u017cy\u0142em go, dzia\u0142am dalej.");
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="g\u0142\u00f3wnego interfejsu">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
