import { store } from "./store";

export type InterfaceMode = "classic" | "modern";

/** Only explicit, short requests to change the application's interface. */
export function parseInterfaceCommand(text: string): InterfaceMode | null {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").trim();
  if (t.length > 120 || !/\b(przelacz|wlacz|zmien|wroc|ustaw)\b/.test(t)) return null;
  if (!/\b(interfejs\w*|wyglad\w*)\b/.test(t)) return null;
  const modern = /\b(now\w*)\b/.test(t);
  const classic = /\b(klasyczn\w*|star\w*|poprzedni\w*)\b/.test(t);
  return modern === classic ? null : modern ? "modern" : "classic";
}

/** Apply only a recognized command and report the actual in-memory selection. */
export function applyInterfaceCommand(text: string): string | null {
  const mode = parseInterfaceCommand(text);
  if (!mode) return null;
  store.setSettings({ interfaceMode: mode });
  if (store.settings.interfaceMode !== mode) return null;
  return mode === "modern" ? "Włączyłem nowy interfejs." : "Włączyłem klasyczny interfejs.";
}
