// Obserwowalność — lekki, lokalny pierścień zdarzeń (błędy, latencja, metryki). Bez sieci,
// bez wysyłki na zewnątrz (prywatność): zasila ekran diagnostyki i pomaga zrozumieć, co
// zawodzi i jak szybko odpowiadają dostawcy. Pierścień ograniczony — nie rośnie w nieskończoność.

export type LogLevel = "error" | "warn" | "info";

export interface LogEvent {
  at: number;
  scope: string;
  level: LogLevel;
  message: string;
  /** Opcjonalny krótki kontekst (np. provider/model) — bez treści użytkownika (prywatność). */
  ctx?: string;
  /** Czas trwania operacji (ms) — do metryk latencji. */
  ms?: number;
}

const CAP = 300;
const ring: LogEvent[] = [];
const subs = new Set<(e: LogEvent) => void>();

/** Subskrybuj nowe zdarzenia na żywo (np. wizualizacja „strumienia poznawczego"). */
export function subscribeLog(fn: (e: LogEvent) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function logEvent(e: Omit<LogEvent, "at">): void {
  const ev: LogEvent = { at: Date.now(), ...e };
  ring.push(ev);
  if (ring.length > CAP) ring.splice(0, ring.length - CAP);
  subs.forEach((fn) => {
    try { fn(ev); } catch { /* subskrybent nie może zerwać logowania */ }
  });
}

/** Zaloguj błąd (skrót). Nie loguje treści użytkownika — tylko komunikat + kontekst techniczny. */
export function logError(scope: string, err: unknown, ctx?: string): void {
  logEvent({ scope, level: "error", message: err instanceof Error ? err.message : String(err), ctx });
}

/** Zarejestruj latencję operacji i jej wynik (ok/błąd) — metryki wydajności. */
export function recordLatency(scope: string, ms: number, ok: boolean, ctx?: string): void {
  logEvent({ scope, level: ok ? "info" : "warn", message: ok ? "ok" : "fail", ms, ctx });
}

/** Najnowsze zdarzenia (od najświeższego). */
export function getEvents(limit = 100): LogEvent[] {
  return ring.slice(-limit).reverse();
}

export interface ReliabilityStats {
  total: number;
  errors: number;
  warns: number;
  /** Liczba błędów per scope (np. ile na „provider:groq"). */
  byScope: Record<string, number>;
  /** Mediana i p95 latencji (ms) z zarejestrowanych pomiarów. */
  latencyP50?: number;
  latencyP95?: number;
  /** Wskaźnik powodzenia operacji z pomiarem latencji (0..1). */
  successRate?: number;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Zagregowane metryki niezawodności z bieżącego pierścienia (do ekranu diagnostyki). */
export function reliabilityStats(): ReliabilityStats {
  const errors = ring.filter((e) => e.level === "error");
  const warns = ring.filter((e) => e.level === "warn");
  const byScope: Record<string, number> = {};
  for (const e of errors) byScope[e.scope] = (byScope[e.scope] || 0) + 1;

  const timed = ring.filter((e) => typeof e.ms === "number");
  const lat = timed.map((e) => e.ms!).sort((a, b) => a - b);
  const oks = timed.filter((e) => e.message === "ok").length;

  return {
    total: ring.length,
    errors: errors.length,
    warns: warns.length,
    byScope,
    latencyP50: lat.length ? percentile(lat, 50) : undefined,
    latencyP95: lat.length ? percentile(lat, 95) : undefined,
    successRate: timed.length ? oks / timed.length : undefined,
  };
}

export function clearEvents(): void {
  ring.length = 0;
}

export interface ReliabilityVerdict { level: "ok" | "warn" | "bad"; text: string }

/** Pure: zamień surowe metryki na CZYTELNY werdykt zdrowia (do wyeksponowania użytkownikowi). */
export function reliabilityVerdict(s: ReliabilityStats): ReliabilityVerdict {
  const top = Object.entries(s.byScope).sort((a, b) => b[1] - a[1])[0];
  const where = top ? ` (najwięcej: ${top[0]} ×${top[1]})` : "";
  if (s.errors === 0) {
    if (typeof s.successRate === "number" && s.successRate < 0.9) {
      return { level: "warn", text: `⚠ Skuteczność operacji ${Math.round(s.successRate * 100)}% — coś bywa wolne/zawodne.` };
    }
    return { level: "ok", text: "✅ Stabilnie — brak błędów w tej sesji." };
  }
  if (s.errors >= 5) {
    return { level: "bad", text: `🔴 ${s.errors} błędów w tej sesji${where}. Sprawdź klucze/ustawienia albo użyj Strażnika.` };
  }
  return { level: "warn", text: `⚠ ${s.errors} ${s.errors === 1 ? "błąd" : "błędy"} w tej sesji${where}.` };
}
