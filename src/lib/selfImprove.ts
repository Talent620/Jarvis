// === Pętla samodoskonalenia: Observe → Analyze → Learn (→ Improve) ===
// Czysta analiza telemetrii (decyzje routera, latencja, fallback/eskalacje, błędy dostawców) →
// metryki + uszeregowane wnioski z możliwością naprawy jednym kliknięciem. JARVIS ocenia, jak mu
// idzie, i sam proponuje optymalizacje. Deterministyczne, testowalne, bez sieci.
import type { RouteLogEntry } from "./modelRouter";

export interface PerfMetrics {
  total: number;
  fallbackRate: number;   // odsetek odpowiedzi z zapasowego dostawcy
  escalationRate: number; // odsetek eskalacji refleks→kora
  localShare: number;     // udział modelu lokalnego (reflex)
  latencyP50?: number;
  latencyP95?: number;
  providerErrors: number; // suma błędów dostawców chmury
}

export type InsightSeverity = "info" | "warn" | "high";
export type ImproveAction = "faster" | "smarter" | "goLocal" | "connectServers";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  action?: ImproveAction; // naprawa jednym kliknięciem (klucz akcji Strażnika)
}

export interface SelfAssessment { metrics: PerfMetrics; insights: Insight[] }

const SEV: Record<InsightSeverity, number> = { high: 3, warn: 2, info: 1 };
const isReflex = (e: RouteLogEntry) => e.tier === "reflex" || e.provider === "ollama" || e.provider === "webllm";
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * Pure: oceń skuteczność z telemetrii i wytwórz wnioski poprawiające jakość/szybkość/koszt.
 * `providerErrors` — błędy per scope „provider:*" (z errorLog); `env.ollamaReady` — czy jest lokalny model.
 */
export function analyzePerformance(
  routes: RouteLogEntry[],
  providerErrors: Record<string, number> = {},
  _now = Date.now(),
  env: { ollamaReady?: boolean } = {},
): SelfAssessment {
  const total = routes.length;
  const fallback = routes.filter((r) => r.fellBack).length;
  const reflex = routes.filter(isReflex);
  const escalated = reflex.filter((r) => r.escalated).length;
  const lat = routes.map((r) => r.latencyMs).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  const cloudErrors = Object.entries(providerErrors)
    .filter(([k]) => k.startsWith("provider:") && !/ollama|webllm/.test(k))
    .reduce((n, [, v]) => n + v, 0);

  const metrics: PerfMetrics = {
    total,
    fallbackRate: total ? fallback / total : 0,
    escalationRate: reflex.length ? escalated / reflex.length : 0,
    localShare: total ? reflex.length / total : 0,
    latencyP50: lat.length ? percentile(lat, 50) : undefined,
    latencyP95: lat.length ? percentile(lat, 95) : undefined,
    providerErrors: cloudErrors,
  };

  const insights: Insight[] = [];
  const enough = total >= 8; // poniżej — za mało danych na twarde wnioski

  if (!enough) {
    insights.push({ id: "warmup", severity: "info", title: "Za mało danych, by się oceniać", detail: `Zebrano ${total} decyzji — używaj dalej, a podam konkretne usprawnienia.` });
  }

  if (enough && metrics.fallbackRate > 0.3) {
    insights.push({ id: "fallback", severity: "high", title: `Główny mózg często zawodzi (${Math.round(metrics.fallbackRate * 100)}%)`, detail: "Odpowiada model zapasowy — sprawdź klucz/limit głównego dostawcy albo dodaj drugi klucz.", action: env.ollamaReady ? "goLocal" : "connectServers" });
  }
  if (enough && (metrics.latencyP95 || 0) > 9000) {
    insights.push({ id: "latency", severity: "warn", title: `Odpowiedzi bywają wolne (p95 ${Math.round((metrics.latencyP95 || 0) / 1000)} s)`, detail: "Tryb szybki (bez myślenia/dodatkowych tur) wyraźnie skróci czas.", action: "faster" });
  }
  if (enough && reflex.length >= 5 && metrics.escalationRate > 0.5) {
    insights.push({ id: "reflex", severity: "warn", title: `Model lokalny często ustępuje chmurze (${Math.round(metrics.escalationRate * 100)}%)`, detail: "Dograj mocniejszy model lokalny (tryb Mądrzej) — mniej eskalacji, więcej prywatności.", action: "smarter" });
  }
  if (enough && cloudErrors >= 4 && env.ollamaReady && metrics.localShare < 0.3) {
    insights.push({ id: "go-local", severity: "info", title: `Chmura sypie błędami (${cloudErrors}), a masz lokalny model`, detail: "Przełączenie na lokalny zwiększy niezawodność i obniży koszt.", action: "goLocal" });
  }
  if (enough && !insights.length) {
    insights.push({ id: "healthy", severity: "info", title: "Działa wzorowo", detail: `Fallback ${Math.round(metrics.fallbackRate * 100)}%, lokalnie ${Math.round(metrics.localShare * 100)}%${metrics.latencyP50 ? `, mediana ${Math.round(metrics.latencyP50)} ms` : ""}. Brak zaleceń.` });
  }

  insights.sort((a, b) => SEV[b.severity] - SEV[a.severity]);
  return { metrics, insights };
}

/** Pure: krótkie podsumowanie oceny (do referowania/toastu). */
export function assessmentSummary(a: SelfAssessment): string {
  const m = a.metrics;
  const head = `Decyzji: ${m.total} · fallback ${Math.round(m.fallbackRate * 100)}% · lokalnie ${Math.round(m.localShare * 100)}%${m.latencyP50 ? ` · mediana ${Math.round(m.latencyP50)} ms` : ""}`;
  const tips = a.insights.slice(0, 3).map((i) => `${i.severity === "high" ? "🔴" : i.severity === "warn" ? "🟡" : "•"} ${i.title}`);
  return [head, ...tips].join("\n");
}
