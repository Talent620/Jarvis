// Podgląd „mózgu na żywo" (Refleks i Kora) — czyste formatowanie dziennika tras routera
// do diagnostyki/telemetrii LOKALNEJ (nic nie wychodzi do chmury). Tylko odczyt z modelRouter.
import { getRouteLog, type RouteLogEntry, type TaskKind, type Tier } from "./modelRouter";

const KIND_PL: Record<TaskKind, string> = { simple: "proste", complex: "złożone", vision: "wizja" };
const TIER_PL: Record<Tier, string> = { reflex: "Refleks (lokalny)", cortex: "Kora (chmura)" };

export interface RouteLine {
  at: number;
  when: string; // „12s temu", „3 min temu"
  kind: string; // po polsku
  tier: string; // „Refleks (lokalny)" / „Kora (chmura)"
  badge: "🟢" | "🟡" | "🧠"; // ok / eskalacja|fallback / kora
  provider: string;
  outcome: string; // „eskalacja→Kora" / „fallback" / „ok"
  meta: string; // „~820 ms · pewność 41%"
}

/** Czas względny, deterministyczny (przyjmuje `now`, by dało się testować). */
export function relTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s temu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h temu`;
  return `${Math.round(h / 24)} dni temu`;
}

/** Sformatuj pojedynczy wpis dziennika do czytelnej linii. Czysta. */
export function describeRoute(e: RouteLogEntry, now = Date.now()): RouteLine {
  const tier: Tier = e.tier ?? (e.provider === "ollama" || e.provider === "webllm" ? "reflex" : "cortex");
  const escalated = !!e.escalated;
  const fellBack = !!e.fellBack;
  const outcome = escalated ? "eskalacja→Kora" : fellBack ? "fallback" : "ok";
  const badge: RouteLine["badge"] = escalated || fellBack ? "🟡" : tier === "cortex" ? "🧠" : "🟢";

  const metaParts: string[] = [];
  if (typeof e.latencyMs === "number") metaParts.push(`~${e.latencyMs} ms`);
  if (typeof e.localConfidence === "number") metaParts.push(`pewność ${Math.round(e.localConfidence * 100)}%`);

  return {
    at: e.at,
    when: relTime(e.at, now),
    kind: KIND_PL[e.kind] ?? e.kind,
    tier: TIER_PL[tier],
    badge,
    provider: e.provider,
    outcome,
    meta: metaParts.join(" · "),
  };
}

/** Ostatnie N decyzji jako gotowe linie (najnowsze pierwsze). Czysta (czyta dziennik). */
export function recentRoutes(limit = 12, now = Date.now()): RouteLine[] {
  return getRouteLog()
    .slice(0, Math.max(0, limit))
    .map((e) => describeRoute(e, now));
}
