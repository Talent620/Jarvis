// === 🎛 Tryby pracy JARVISA — jasny wybór „co się włącza i co się stanie" ===
// Zamiast dziesiątek pojedynczych przełączników: kilka czytelnych, gotowych trybów. Każdy ustawia
// SPÓJNY zestaw opcji jednym kliknięciem i jasno mówi, czego wymaga oraz co się wydarzy.
import { store } from "./store";
import { autoAssignRoles } from "./ollamaMaestro";

export type BrainModeId = "auto" | "online" | "offline" | "ollama";

export interface BrainModePreset {
  id: BrainModeId;
  icon: string;
  title: string;    // krótka nazwa
  tagline: string;  // jedno zdanie „co to jest"
  does: string;     // co robi
  happens: string;  // co dokładnie się ustawi
  needs: string;    // czego wymaga
}

export const BRAIN_MODES: BrainModePreset[] = [
  {
    id: "auto", icon: "🤝", title: "Automatyczny",
    tagline: "Zalecane — JARVIS sam wybiera najlepszą drogę.",
    does: "Proste pytania robi lokalnie (szybko, prywatnie), trudne kieruje do chmury.",
    happens: "Dostawca = auto, odpowiadanie lokalnie-najpierw, chmura w rezerwie.",
    needs: "Klucz API i/lub uruchomiona Ollama.",
  },
  {
    id: "online", icon: "☁", title: "Online (chmura)",
    tagline: "Zawsze najmądrzejsze, najszybsze modele z chmury.",
    does: "Każdą odpowiedź generuje najlepszy dostępny model w chmurze.",
    happens: "Wyłącza tryb on-device i lokalnie-najpierw; dostawca = auto (najlepszy z Twoich kluczy).",
    needs: "Internet + przynajmniej jeden klucz API.",
  },
  {
    id: "offline", icon: "🛡", title: "Offline (prywatnie)",
    tagline: "Wszystko na Twoim urządzeniu — nic nie wychodzi do sieci.",
    does: "Odpowiada wyłącznie model lokalny; zero wysyłki do chmury, działa bez internetu.",
    happens: "Włącza blokadę chmury (on-device) i wyłącza web-research.",
    needs: "Uruchomiona Ollama (lub mózg on-device WebLLM).",
  },
  {
    id: "ollama", icon: "🧠", title: "Lokalny — Ollama sama dobiera model",
    tagline: "Twój serwer Ollama; JARVIS dopasowuje model do zadania.",
    does: "Używa lokalnej Ollamy i automatycznie wybiera model (prosty / złożony / wizja).",
    happens: "Dostawca = Ollama, model = auto, role rozdzielone między zainstalowane modele. Chmura zostaje awaryjnie.",
    needs: "Uruchomiona Ollama z co najmniej jednym modelem.",
  },
];

/** Pure: który tryb jest obecnie aktywny (najlepsze dopasowanie do ustawień). */
export function detectBrainMode(s = store.settings): BrainModeId {
  if (s.onDeviceOnly) return "offline";
  if (s.provider === "ollama") return "ollama";
  if (s.provider === "auto" && s.localFirstSimple) return "auto";
  return "online";
}

export interface ModeRecommendation { mode: BrainModeId; reason: string }
/** Pure: dobierz najlepszy tryb do realnego stanu (Ollama + klucze chmury). Testowalne. */
export function recommendBrainMode(ctx: { ollamaOk: boolean; ollamaModels: number; cloudKeys: number }): ModeRecommendation {
  const localOk = ctx.ollamaOk && ctx.ollamaModels > 0;
  if (localOk && ctx.cloudKeys > 0) return { mode: "auto", reason: "Masz i lokalną Ollamę z modelami, i klucze chmury — najlepszy balans: lokalnie szybko/prywatnie, chmura do trudnych pytań." };
  if (localOk) return { mode: "ollama", reason: "Masz działającą Ollamę z modelami, ale brak kluczy chmury — pełnia możliwości lokalnie, Ollama sama dobiera model." };
  if (ctx.cloudKeys > 0) return { mode: "online", reason: "Masz klucze chmury, ale brak lokalnego modelu — najlepsze, najszybsze modele z chmury." };
  return { mode: "auto", reason: "Brak lokalnego modelu i kluczy API — ustawiam Auto; dodaj klucz API (⚙ → AI) albo uruchom Ollamę." };
}

/** Zastosuj tryb pracy. `installed` = zainstalowane modele Ollamy (do auto-przydziału ról). */
export function applyBrainMode(id: BrainModeId, installed: string[] = []): void {
  if (id === "auto") {
    store.setSettings({ provider: "auto", model: "auto", onDeviceOnly: false, localFirstSimple: true, webSearch: true });
  } else if (id === "online") {
    store.setSettings({ provider: "auto", model: "auto", onDeviceOnly: false, localFirstSimple: false, webSearch: true });
  } else if (id === "offline") {
    store.setSettings({ onDeviceOnly: true, webSearch: false });
  } else if (id === "ollama") {
    const roles = installed.length ? autoAssignRoles(installed) : null;
    store.setSettings({
      provider: "ollama", model: "auto", onDeviceOnly: false, localFirstSimple: true,
      ...(roles ? { ollamaModelSimple: roles.simple, ollamaModelComplex: roles.complex, ollamaModelVision: roles.vision } : {}),
    });
  }
}

/** Pure: ostrzeżenie, gdy wybrany tryb nie ma spełnionego wymagania (inaczej JARVIS nie odpowie). */
export function modeReadinessWarning(mode: BrainModeId, ctx: { ollamaConfigured: boolean; cloudKeys: number }): string {
  if ((mode === "offline" || mode === "ollama") && !ctx.ollamaConfigured)
    return "wymaga Ollamy — uruchom serwer i podaj adres (⚙ → AI), inaczej JARVIS nie odpowie.";
  if (mode === "online" && ctx.cloudKeys === 0)
    return "wymaga klucza API — dodaj klucz (⚙ → AI), inaczej JARVIS nie odpowie.";
  if (mode === "auto" && !ctx.ollamaConfigured && ctx.cloudKeys === 0)
    return "brak klucza API i Ollamy — dodaj jedno z nich, by JARVIS mógł odpowiadać.";
  return "";
}
