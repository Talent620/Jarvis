// === Trwały store heartbeatów węzłów (localStorage, S9-safe) ===
// Cienki adapter nad czystym silnikiem deviceHealth.ts. Trzyma ostatnie sygnały życia
// węzłów między sesjami (jak proactive/missionLog). Zero logiki decyzyjnej tutaj.
import { loadJson, saveJson } from "../lsJson";
import { recordHeartbeat, fleetStory, anyDead, type HeartbeatState } from "./deviceHealth";
import type { MissionNode } from "./types";

const KEY = "jarvis.horizon.heartbeats.v1";

function load(): HeartbeatState {
  const raw = loadJson<HeartbeatState>(KEY, { lastSeen: {} });
  return { lastSeen: raw && raw.lastSeen ? raw.lastSeen : {} };
}
function save(s: HeartbeatState): void {
  saveJson(KEY, s);
}

/** Zapisz sygnał życia węzła (np. po udanym CONFIRMED tego węzła w sztafecie). */
export function beat(node: MissionNode, now = Date.now()): void {
  save(recordHeartbeat(load(), node, now));
}

/** Czy któryś węzeł jest martwy (sygnał dla sztafety, by się wstrzymać)? */
export function fleetHasDead(now = Date.now()): boolean {
  return anyDead(load(), now);
}

/** Raport zdrowia floty po ludzku (dla narzędzia mission_devices / panelu). */
export function fleetReportText(now = Date.now()): string {
  return fleetStory(load(), now);
}

/** Reset (testy). */
export function resetHeartbeats(): void {
  save({ lastSeen: {} });
}
