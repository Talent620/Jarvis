// Wskaźnik trybu mózgu: czy JARVIS odpowiada LOKALNIE (Refleks/offline/on-device) czy z CHMURY (Kora).
// Czysta funkcja — prawdę bierze z ostatniej decyzji routera + ustawień + stanu sieci. Tylko odczyt.
import { store } from "./store";
import { getRouteLog } from "./modelRouter";

export interface BrainMode {
  kind: "offline" | "local" | "cloud";
  icon: string; // 🛡 lokalnie / ☁ chmura
  label: string; // krótko do paska
  title: string; // pełny opis (tooltip)
}

/** Aktualny tryb pracy mózgu. `online` przekazujemy z UI (reaktywne). Czysta. */
export function currentBrainMode(online: boolean): BrainMode {
  const s = store.settings;

  if (!online) {
    return { kind: "offline", icon: "🛡", label: "Offline · lokalnie", title: "Brak sieci — JARVIS działa na modelu lokalnym (Refleks). Nic nie wychodzi do chmury." };
  }
  if (s.onDeviceOnly) {
    return { kind: "local", icon: "🛡", label: "Na urządzeniu", title: "Tryb on-device: wyłącznie model lokalny, nic nie opuszcza urządzenia." };
  }

  // Najwięcej prawdy niesie OSTATNIA realna decyzja routera.
  const last = getRouteLog()[0];
  if (last) {
    const tier = last.tier ?? (last.provider === "ollama" || last.provider === "webllm" ? "reflex" : "cortex");
    if (tier === "reflex") {
      return { kind: "local", icon: "🛡", label: "Lokalnie (Refleks)", title: `Ostatnia odpowiedź lokalnie: ${last.provider}. Szybko i prywatnie.` };
    }
    return { kind: "cloud", icon: "☁", label: "Chmura (Kora)", title: `Ostatnia odpowiedź z chmury: ${last.provider}.` };
  }

  // Brak historii tras: pokaż skłonność wynikającą z konfiguracji.
  if (s.ollamaUrl?.trim() && (s.localFirstSimple || s.confidenceGate)) {
    return { kind: "local", icon: "🛡", label: "Lokalnie najpierw", title: "Proste pytania trafiają najpierw do modelu lokalnego (Refleks); chmura w rezerwie." };
  }
  return { kind: "cloud", icon: "☁", label: "Chmura (Kora)", title: "Odpowiedzi z modeli w chmurze." };
}
