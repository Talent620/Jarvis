// Faza 4 — orkiestracja + router modeli.
//
// Decyzja architektoniczna (spójna z Fazą 2/MCP): NIE wciągamy frameworka Mastra do
// bundla PWA. Mastra jest zaprojektowana pod Node/serwer (workflowy, storage, telemetria
// serwerowa) i nie jest browser-first — dodanie jej rozdęłoby bundle i wprowadziło zależności
// niedziałające w WebView. Zamiast tego realizujemy te same pojęcia lekko i lokalnie:
//   • router modeli (dobór modelu do zadania),
//   • dziennik decyzji (orkiestracja widoczna, zasila panel kosztów — Faza 5),
//   • retry + fallback (już w brain.ts: withRetry + łańcuch dostawców).
// Osobowość/zachowanie JARVIS-a pozostają bez zmian (router dotyka tylko WYBORU modelu).

import type { ProviderId } from "./providers/types";
import { isComplex } from "./aiHelpers";

export type TaskKind = "simple" | "complex" | "vision";

// Sygnały zadania wymagającego mocnego rozumowania (kod, analiza, wieloetapowość).
const REASONING_CUES =
  /\b(dlaczego|przeanalizuj|analiz|udowodnij|zaprojektuj|napisz kod|kod\b|debug|porównaj|porownaj|strateg|algorytm|wyprowadź|krok po kroku|zoptymalizuj|optymaliz|refaktor|architekt|zaplanuj)\b/i;

/** Sklasyfikuj zadanie na podstawie ostatniej wiadomości użytkownika. Czysta funkcja. */
export function classifyTask(text: string, hasImage: boolean): { kind: TaskKind; reason: string } {
  if (hasImage) return { kind: "vision", reason: "wiadomość zawiera obraz → model z wizją" };
  const t = text || "";
  const long = t.length > 600;
  const reasoning = REASONING_CUES.test(t);
  if (isComplex(t) || reasoning || long) {
    const reason = reasoning
      ? "zadanie wymaga rozumowania (kod/analiza)"
      : long
        ? "długie/złożone zapytanie"
        : "klasyfikacja: złożone";
    return { kind: "complex", reason };
  }
  return { kind: "simple", reason: "krótkie/proste zapytanie → szybki model" };
}

// --- Groq: Llama 4 Scout vs Kimi K2 ---
// Scout (17B, multimodalny, błyskawiczny) — proste/wizyjne; Kimi K2 (mocne rozumowanie/kod) — złożone.
export const GROQ_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
export const GROQ_KIMI = "moonshotai/kimi-k2-instruct";

/** Wybór modelu Groq do zadania: Kimi K2 do rozumowania, Scout do reszty (i wizji). */
export function groqModelFor(kind: TaskKind): string {
  return kind === "complex" ? GROQ_KIMI : GROQ_SCOUT;
}

// --- Dziennik decyzji routera (orkiestracja widoczna; zasila panel kosztów — Faza 5) ---
export interface RouteLogEntry {
  at: number;
  provider: ProviderId;
  model: string;
  kind: TaskKind;
  reason: string;
  fellBack: boolean; // czy odpowiedział model zapasowy (failover), nie główny
}

const LOG: RouteLogEntry[] = [];
const MAX_LOG = 100;

/** Zapisz decyzję routera (po faktycznej, udanej odpowiedzi). */
export function logRouteDecision(e: Omit<RouteLogEntry, "at">): void {
  LOG.unshift({ ...e, at: Date.now() });
  if (LOG.length > MAX_LOG) LOG.length = MAX_LOG;
}

/** Ostatnie decyzje (najnowsze pierwsze) — do podglądu/telemetrii. */
export function getRouteLog(): RouteLogEntry[] {
  return LOG.slice();
}

export function clearRouteLog(): void {
  LOG.length = 0;
}
