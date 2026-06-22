import { App } from "@capacitor/app";
import { SendIntent } from "send-intent";
import { Capacitor } from "@capacitor/core";

// Obsługa: 1) deep-linków/skrótów (jarvis://run?text=...), 2) udostępnień (Android Share).
// Wszystko sprowadza się do jednego: przekaż tekst polecenia do JARVIS-a.

function parseRunUrl(url: string): string | null {
  try {
    if (!url.startsWith("jarvis://")) return null;
    const u = new URL(url);
    const text = u.searchParams.get("text");
    return text ? decodeURIComponent(text) : null;
  } catch {
    return null;
  }
}

const isWake = (url?: string) => !!url && url.replace(/\/$/, "") === "jarvis://wake";
const isBoss = (url?: string) => !!url && url.replace(/\/$/, "") === "jarvis://boss";

export function registerIntents(onCommand: (text: string) => void, onWake?: () => void, onBoss?: () => void): () => void {
  let disposed = false;

  const route = (url?: string) => {
    if (isBoss(url)) { onBoss?.(); return; }
    if (isWake(url)) { onWake?.(); return; }
    const cmd = url ? parseRunUrl(url) : null;
    if (cmd) onCommand(cmd);
  };

  // Skróty / deep-linki przy uruchomieniu.
  App.getLaunchUrl()
    .then((res) => { if (!disposed) route(res?.url); })
    .catch(() => {});

  const sub = App.addListener("appUrlOpen", (data) => route(data.url));

  // Udostępnienia (Android Share → JARVIS).
  const checkShare = () => {
    if (!Capacitor.isNativePlatform()) return;
    SendIntent.checkSendIntentReceived()
      .then((intent) => {
        const shared = intent?.title || intent?.description || intent?.url;
        if (shared) {
          onCommand(typeof shared === "string" ? shared : String(shared));
          try {
            SendIntent.finish();
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
  };
  checkShare();
  const resumeSub = App.addListener("resume", checkShare);

  return () => {
    disposed = true;
    sub.then((s) => s.remove()).catch(() => {});
    resumeSub.then((s) => s.remove()).catch(() => {});
  };
}
