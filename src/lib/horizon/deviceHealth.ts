// === Strażnik węzłów: heartbeat i zdrowie floty (Project Horizon) ===
// Każdy węzeł Sztafety (telefon / komputer EXE / urządzenie) bije „sygnał życia".
// Ten silnik klasyfikuje stan z CZASU od ostatniego heartbeatu — czysto i deterministycznie:
//   • zdrowy   — sygnał świeży (≤ warnMs);
//   • opóźniony — sygnał starszy niż warnMs, ale ≤ deadMs (uwaga, jeszcze nie panika);
//   • martwy   — brak sygnału > deadMs (węzeł prawdopodobnie odpadł);
//   • nieznany — nigdy nie widziany.
// ZASADA BEZPIECZEŃSTWA: wykrycie martwego węzła NIE wywołuje żadnej akcji wychodzącej.
// Strażnik tylko RAPORTUJE i pozwala sztafecie się wstrzymać — decyzja należy do człowieka
// (albo do bezpiecznego, odwracalnego failoveru w warstwie wyżej). Zero efektów ubocznych.
import type { MissionNode } from "./types";

export type NodeHealth = "healthy" | "delayed" | "dead" | "unknown";

export interface HeartbeatState {
  /** Ostatni sygnał życia per węzeł (epoch ms). Brak wpisu = nigdy nie widziany. */
  lastSeen: Partial<Record<MissionNode, number>>;
}

export interface HealthThresholds {
  /** Powyżej tego bez sygnału = „opóźniony" (domyślnie 30 s). */
  warnMs: number;
  /** Powyżej tego bez sygnału = „martwy" (domyślnie 90 s). */
  deadMs: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = { warnMs: 30_000, deadMs: 90_000 };

/** Pure: zapisz heartbeat węzła. Zwraca NOWY stan (niemutujący). */
export function recordHeartbeat(state: HeartbeatState, node: MissionNode, now: number): HeartbeatState {
  return { lastSeen: { ...state.lastSeen, [node]: now } };
}

/** Pure: sklasyfikuj zdrowie węzła na podstawie czasu od ostatniego sygnału. */
export function nodeHealth(state: HeartbeatState, node: MissionNode, now: number, th: HealthThresholds = DEFAULT_THRESHOLDS): NodeHealth {
  const last = state.lastSeen[node];
  if (last == null) return "unknown";
  const age = now - last;
  if (age <= th.warnMs) return "healthy";
  if (age <= th.deadMs) return "delayed";
  return "dead";
}

export interface NodeReport {
  node: MissionNode;
  health: NodeHealth;
  ageMs: number | null; // null = nigdy nie widziany
}

const NODE_ORDER: MissionNode[] = ["phone", "exe", "device"];

/** Pure: raport zdrowia wszystkich znanych węzłów (zawsze w stałej kolejności). */
export function fleetReport(state: HeartbeatState, now: number, th: HealthThresholds = DEFAULT_THRESHOLDS): NodeReport[] {
  return NODE_ORDER.map((node) => {
    const last = state.lastSeen[node];
    return { node, health: nodeHealth(state, node, now, th), ageMs: last == null ? null : now - last };
  });
}

/** Pure: czy któryś węzeł jest MARTWY? (sygnał dla sztafety, by się wstrzymać). */
export function anyDead(state: HeartbeatState, now: number, th: HealthThresholds = DEFAULT_THRESHOLDS): boolean {
  return fleetReport(state, now, th).some((r) => r.health === "dead");
}

const NODE_LABEL: Record<MissionNode, string> = { phone: "telefon", exe: "komputer", device: "urządzenie" };
const HEALTH_LABEL: Record<NodeHealth, string> = {
  healthy: "✅ zdrowy",
  delayed: "⏳ opóźniony",
  dead: "❌ martwy",
  unknown: "· nieznany",
};

/** Pure: czytelny raport floty po ludzku (bez efektów ubocznych). */
export function fleetStory(state: HeartbeatState, now: number, th: HealthThresholds = DEFAULT_THRESHOLDS): string {
  const rows = fleetReport(state, now, th).map((r) => {
    const age = r.ageMs == null ? "nigdy" : `${Math.round(r.ageMs / 1000)} s temu`;
    return `${NODE_LABEL[r.node]}: ${HEALTH_LABEL[r.health]} (ostatni sygnał: ${age})`;
  });
  const dead = anyDead(state, now, th);
  const head = dead
    ? "⚠ Strażnik węzłów: co najmniej jeden węzeł jest MARTWY — sztafeta powinna się wstrzymać (żadnej akcji wychodzącej nie ponawiam sam)."
    : "🛡 Strażnik węzłów: flota w porządku.";
  return [head, ...rows].join("\n");
}
