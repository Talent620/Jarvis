// === Dziennik misji Sztafety — trwały, ograniczony zapis stanów i dowodów ===
// localStorage przez lsJson (jak proactive): małe, bez blobów, S9-safe. Bounded:
// najnowsze 10 misji i 200 kwitów — starsze wypadają (dowody krytyczne i tak żyją
// w audycie permissions przy realnych narzędziach; to jest dziennik Sztafety).
import { loadJson, saveJson } from "../lsJson";
import type { EvidenceEntry, MissionState } from "./types";

const KEY = "jarvis.horizon.missions.v1";
const MAX_MISSIONS = 10;
const MAX_LEDGER = 200;

export interface MissionLog {
  states: MissionState[];
  ledger: EvidenceEntry[];
}

export function loadMissionLog(): MissionLog {
  const raw = loadJson<Partial<MissionLog>>(KEY, {});
  return {
    states: Array.isArray(raw.states) ? raw.states : [],
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
  };
}

export function saveMissionLog(log: MissionLog): void {
  saveJson(KEY, {
    states: log.states.slice(0, MAX_MISSIONS),
    ledger: log.ledger.slice(-MAX_LEDGER),
  });
}

/** Wstaw/zaktualizuj stan misji (najnowsza na przodzie) + scal rejestr dowodów. */
export function upsertMission(state: MissionState, ledger: EvidenceEntry[]): MissionLog {
  const log = loadMissionLog();
  const rest = log.states.filter((s) => s.mission.id !== state.mission.id);
  const next: MissionLog = { states: [state, ...rest], ledger };
  saveMissionLog(next);
  return next;
}

/** Reset (testy). */
export function clearMissionLog(): void {
  saveMissionLog({ states: [], ledger: [] });
}
