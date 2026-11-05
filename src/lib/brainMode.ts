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
    return { kind: "offline", icon: "🛡", label: "Brak sieci", title: "Połączenie z siecią jest niedostępne. Działanie modelu lokalnego wymaga osobnego sprawdzenia." };
  }
  if (s.onDeviceOnly) {
    return { kind: "local", icon: "🛡", label: "Tryb lokalny", title: "Konfiguracja modeli dopuszcza wyłącznie lokalną ścieżkę. Działanie potwierdza test odpowiedzi." };
  }

  // Najwięcej prawdy niesie OSTATNIA realna decyzja routera.
  const last = getRouteLog()[0];
  if (last) {
    const tier = last.tier ?? (last.provider === "ollama" || last.provider === "webllm" ? "reflex" : "cortex");
    if (tier === "reflex") {
      return { kind: "local", icon: "🛡", label: "Trasa lokalna (Refleks)", title: `Ostatnia zarejestrowana trasa modelu: ${last.provider}. To nie jest bieżący test dostępności.` };
    }
    return { kind: "cloud", icon: "☁", label: "Trasa chmurowa (Kora)", title: `Ostatnia zarejestrowana trasa modelu: ${last.provider}. To nie jest bieżący test dostępności.` };
  }

  // Brak historii tras: pokaż skłonność wynikającą z konfiguracji.
  if (s.ollamaUrl?.trim() && (s.localFirstSimple || s.confidenceGate)) {
    return { kind: "local", icon: "🛡", label: "Lokalnie najpierw", title: "Proste pytania trafiają najpierw do modelu lokalnego (Refleks); chmura w rezerwie." };
  }
  return { kind: "cloud", icon: "☁", label: "Model według ustawień", title: "Model zostanie wybrany według konfiguracji. Nie zarejestrowano jeszcze próby odpowiedzi." };
}
