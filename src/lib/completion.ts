// === Droga do 100% JARVISA — Szef sam proponuje następny krok ===
// Pure: policz, w ilu procentach JARVIS jest „w pełni uzbrojony", i podaj uporządkowaną
// listę braków. Część kroków Szef może wykonać AUTONOMICZNIE (gotowy `patch` ustawień —
// pyta tylko o potwierdzenie); część wymaga Twoich danych (klucz/serwer) → kieruje do ekranu.
import type { Settings } from "../types";

export interface CompletionStep {
  id: string;
  title: string; // krótko, „do zrobienia"
  detail: string; // po co to
  patch?: Partial<Settings>; // gdy jest — Szef zrobi to sam (po „tak")
  openScreen?: "ai" | "profile" | "proxy" | "league"; // gdy trzeba Twoich danych
}

interface Check {
  id: string;
  title: string;
  detail: string;
  ok: (s: Settings) => boolean;
  patch?: Partial<Settings>;
  openScreen?: CompletionStep["openScreen"];
}

const hasAnyKey = (s: Settings) =>
  Object.values(s.keys || {}).some((k) => (k || "").trim()) || !!s.ollamaUrl?.trim();

// Kuratorowana lista „pełnej sprawności". Kolejność = priorytet (najpierw mózg).
const CHECKS: Check[] = [
  { id: "brain", title: "Dodaj klucz API (mózg AI)", detail: "Bez mózgu JARVIS nie odpowie. Wystarczy jeden darmowy klucz (np. Gemini/Groq).", ok: hasAnyKey, openScreen: "ai" },
  { id: "name", title: "Przedstaw się (imię)", detail: "Szef będzie zwracał się do Ciebie i podpowiadał Twoje dane w formularzach.", ok: (s) => !!s.userName?.trim(), openScreen: "profile" },
  { id: "voice", title: "Włącz głos JARVIS-a", detail: "Mówione odpowiedzi — podstawa Trybu Szefa i Słuchawek.", ok: (s) => s.speak !== false, patch: { speak: true } },
  { id: "websearch", title: "Włącz badanie w sieci", detail: "Aktualne odpowiedzi ze źródłami zamiast samej wiedzy modelu.", ok: (s) => !!s.webSearch, patch: { webSearch: true } },
  { id: "proactive", title: "Włącz proaktywne powitanie", detail: "JARVIS sam wita i podsuwa, co dziś zrobić.", ok: (s) => !!s.proactiveOnOpen, patch: { proactiveOnOpen: true } },
  { id: "tips", title: "Włącz podpowiedzi (coaching)", detail: "Dymki uczące funkcji w samą porę.", ok: (s) => s.tips !== false, patch: { tips: true } },
  { id: "wake", title: "Włącz nasłuch w tle (hotword)", detail: "Przywołasz Szefa słowem „szef” nawet bez dotykania telefonu.", ok: (s) => !!s.backgroundWake, patch: { backgroundWake: true } },
  { id: "bossfull", title: "Daj Szefowi pełny dostęp", detail: "Pełna moc agenta — z potwierdzaniem głosem przed akcjami nieodwracalnymi.", ok: (s) => !!s.bossFullAccess, patch: { bossFullAccess: true } },
  { id: "proxy", title: "Skonfiguruj proxy (BFF)", detail: "Pełny research i integracje na telefonie bez blokad CORS.", ok: (s) => !!s.proxyUrl?.trim(), openScreen: "proxy" },
];

export interface CompletionReport {
  percent: number;
  done: number;
  total: number;
  next: CompletionStep | null;
  remaining: CompletionStep[];
}

const toStep = (c: Check): CompletionStep => ({ id: c.id, title: c.title, detail: c.detail, patch: c.patch, openScreen: c.openScreen });

/** Pure: raport kompletności + następny krok. */
export function completionReport(s: Settings): CompletionReport {
  const done = CHECKS.filter((c) => c.ok(s)).length;
  const total = CHECKS.length;
  const remaining = CHECKS.filter((c) => !c.ok(s)).map(toStep);
  return {
    percent: Math.round((100 * done) / total),
    done,
    total,
    next: remaining[0] ?? null,
    remaining,
  };
}
