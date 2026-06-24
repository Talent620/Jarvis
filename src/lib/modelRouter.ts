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
import { idbGet, idbSet } from "./db";

export type TaskKind = "simple" | "complex" | "vision";

// Heurystyka złożoności zapytania — steruje doborem modelu (prosty/mocny).
// Tu mieszka cała detekcja złożoności (isComplex + classifyTask + needsDeepThink), jedno miejsce.
export function isComplex(text: string): boolean {
  const t = text || "";
  return (
    t.length > 260 ||
    /(zaplanuj|research|analiz|porówn|napisz|\bkod\b|program|wyjaśnij|strategi|raport|e-?mail|mail do|przeanalizuj|podsumuj|stre[śs]|przet[łl]umacz)/i.test(t)
  );
}

// Sygnały zadania wymagającego mocnego rozumowania (kod, analiza, logika, wieloetapowość).
const REASONING_CUES =
  /\b(dlaczego|przeanalizuj|analiz|udowodnij|zaprojektuj|napisz kod|kod\b|debug|debuguj|stack ?trace|błąd w kodzie|porównaj|porownaj|strateg|algorytm|wyprowadź|krok po kroku|zoptymalizuj|optymaliz|refaktor|architekt|zaplanuj|sylogizm|paradoks|logiczn|wytłumacz dlaczego|wnioskuj|implikacj)\b/i;

// Sygnały MATEMATYCZNE/ILOŚCIOWE (oblicz, równanie, działanie, procenty) — wymagają liczenia.
const MATH_CUES =
  /\b(oblicz|policz|ile (wynosi|to (będzie|jest)|kosztuj|wyjdzie)|równani|rownani|pierwiastek|całk|pochodn|procent|odsetek|silni)\b|\d+\s*[+\-x*/^%]\s*\d+|=\s*\?/i;

/** Sklasyfikuj zadanie na podstawie ostatniej wiadomości użytkownika. Czysta funkcja. */
export function classifyTask(text: string, hasImage: boolean): { kind: TaskKind; reason: string } {
  if (hasImage) return { kind: "vision", reason: "wiadomość zawiera obraz → model z wizją" };
  const t = text || "";
  const long = t.length > 600;
  const math = MATH_CUES.test(t);
  const reasoning = REASONING_CUES.test(t) || math;
  if (isComplex(t) || reasoning || long) {
    const reason = math
      ? "zadanie ilościowe/matematyczne → liczenie krok po kroku"
      : reasoning
        ? "zadanie wymaga rozumowania (kod/analiza/logika)"
        : long
          ? "długie/złożone zapytanie"
          : "klasyfikacja: złożone";
    return { kind: "complex", reason };
  }
  return { kind: "simple", reason: "krótkie/proste zapytanie → szybki model" };
}

// Czysta treść do wygenerowania (mail/post/życzenia/opis) — NIE wymaga głębokiej analizy,
// nawet jeśli zawiera „napisz". Deep-think rezerwujemy na realne rozumowanie/matematykę.
const PLAIN_WRITING =
  /\b(napisz|napisać|stwórz|stworz|ułóż|uloz|sformułuj|sformuluj|wymyśl|wymysl)\b[^]{0,40}\b(mail|maila|e-?mail|wiadomo|post|ogłoszeni|ogloszeni|życzeni|zyczeni|tweet|opis|tekst|pozdrowieni|podziękowani|podziekowani|zaproszeni|wpis|nagłówek|naglowek|slogan|hasło|haslo)/i;

/**
 * Pure: czy zapytanie ZASŁUGUJE na głębokie myślenie (dwuetapową analizę)? Stricter niż isComplex —
 * tylko realne rozumowanie/matematyka/kod/planowanie/porównanie, NIE zwykłe generowanie treści.
 * Dzięki temu deep-think nie spowalnia prostego „napisz maila", a włącza się tam, gdzie podnosi jakość.
 */
export function needsDeepThink(text: string): boolean {
  const t = text || "";
  if (!t.trim()) return false;
  if (PLAIN_WRITING.test(t)) return false;
  if (MATH_CUES.test(t) || REASONING_CUES.test(t)) return true;
  return t.length > 500;
}

// --- Groq: Llama 4 Scout vs Kimi K2 ---
// Scout (17B, multimodalny, błyskawiczny) — proste/wizyjne; Kimi K2 (mocne rozumowanie/kod) — złożone.
export const GROQ_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct";
export const GROQ_KIMI = "moonshotai/kimi-k2-instruct";

/** Wybór modelu Groq do zadania: Kimi K2 do rozumowania, Scout do reszty (i wizji). */
export function groqModelFor(kind: TaskKind): string {
  return kind === "complex" ? GROQ_KIMI : GROQ_SCOUT;
}

// --- Dziennik decyzji routera + pętla ucząca (Z12) ---
export type Tier = "reflex" | "cortex";

/** Warstwa decyzji: refleks = model lokalny (Ollama/WebLLM), kora = chmura. */
export function tierOf(provider: ProviderId): Tier {
  return provider === "ollama" || provider === "webllm" ? "reflex" : "cortex";
}

export interface RouteLogEntry {
  at: number;
  provider: ProviderId;
  model: string;
  kind: TaskKind;
  reason: string;
  fellBack: boolean; // czy odpowiedział model zapasowy (failover), nie główny
  tier?: Tier; // wyliczane z provider, jeśli nie podano
  latencyMs?: number; // czas odpowiedzi (do mediany latencji)
  localConfidence?: number; // pewność refleksu (0..1), gdy dotyczy
  escalated?: boolean; // czy decyzja zakończyła się eskalacją do Kory (porażka refleksu)
}

const LOG: RouteLogEntry[] = [];
const MAX_LOG = 500;
const IDB_KEY = "routerLog";

// Trwałość: hydratacja z IndexedDB przy starcie (graceful — brak IDB = sam RAM) + zapis debounced.
let hydrated = false;
async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const saved = await idbGet<RouteLogEntry[]>(IDB_KEY);
  if (Array.isArray(saved) && !LOG.length) LOG.push(...saved.slice(0, MAX_LOG));
}
void hydrate();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void idbSet(IDB_KEY, LOG.slice(0, MAX_LOG)); }, 600);
}

/** Zapisz decyzję routera (po faktycznej, udanej odpowiedzi lub eskalacji). */
export function logRouteDecision(e: Omit<RouteLogEntry, "at">): void {
  LOG.unshift({ ...e, tier: e.tier || tierOf(e.provider), at: Date.now() });
  if (LOG.length > MAX_LOG) LOG.length = MAX_LOG;
  scheduleSave();
}

/** Ostatnie decyzje (najnowsze pierwsze) — do podglądu/telemetrii. */
export function getRouteLog(): RouteLogEntry[] {
  return LOG.slice();
}

export function clearRouteLog(): void {
  LOG.length = 0;
  scheduleSave();
}

// --- Statystyki skuteczności tras (Z12) ---
export interface RouterTierStat {
  kind: TaskKind;
  tier: Tier;
  count: number;
  successRate: number; // odsetek decyzji BEZ eskalacji/failoveru (0..1)
  medianLatencyMs?: number;
}

/** Krocząca skuteczność per (kind, tier) z dziennika — do strojenia/diagnostyki. Czysta. */
export function getRouterStats(): RouterTierStat[] {
  const groups = new Map<string, RouteLogEntry[]>();
  for (const e of LOG) {
    const tier = e.tier || tierOf(e.provider);
    const key = `${e.kind}|${tier}`;
    const arr = groups.get(key) || [];
    arr.push(e);
    groups.set(key, arr);
  }
  const out: RouterTierStat[] = [];
  for (const [key, entries] of groups) {
    const [kind, tier] = key.split("|") as [TaskKind, Tier];
    const ok = entries.filter((e) => !e.fellBack && !e.escalated).length;
    const lats = entries.map((e) => e.latencyMs).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
    out.push({
      kind,
      tier,
      count: entries.length,
      successRate: entries.length ? ok / entries.length : 0,
      medianLatencyMs: lats.length ? lats[Math.floor(lats.length / 2)] : undefined,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

const RELIABLE = 0.85; // refleks wiarygodny → ufamy bardziej (niższy próg eskalacji)
const WEAK = 0.5; // refleks słaby → eskalujemy częściej (wyższy próg)
const MIN_SAMPLES = 5; // bez minimum próbek nie adaptujemy (za mało danych)

/**
 * Dostosuj próg eskalacji (Brama Pewności) do skuteczności refleksu na danym `kind`.
 * Gdy refleks historycznie wiarygodny → obniż próg (mniej eskalacji); gdy słaby → podnieś.
 * Czysta (czyta dziennik). Zwraca też `reason` do zalogowania, gdy nastąpiła adaptacja.
 */
export function adaptiveConfidenceThreshold(kind: TaskKind, base: number): { threshold: number; reason?: string } {
  const stat = getRouterStats().find((s) => s.kind === kind && s.tier === "reflex");
  if (!stat || stat.count < MIN_SAMPLES) return { threshold: base };
  const pct = Math.round(stat.successRate * 100);
  if (stat.successRate >= RELIABLE) return { threshold: Math.max(0.2, base - 0.15), reason: `adaptacja: refleks ${pct}% skuteczny na '${kind}' → niższy próg` };
  if (stat.successRate < WEAK) return { threshold: Math.min(0.9, base + 0.15), reason: `adaptacja: refleks ${pct}% słaby na '${kind}' → wyższy próg` };
  return { threshold: base };
}
