// Sterowanie jedną instancją aplikacji. Pauza obowiązuje na granicy kroków, nie przerywa I/O.
interface ActiveGoal { pause: boolean }
const active = new Map<string, ActiveGoal>();

export function beginGoalRun(id: string): { shouldStop: () => boolean; finish: () => void } {
  if (active.has(id)) throw new Error("Ten cel jest już wykonywany.");
  const state: ActiveGoal = { pause: false };
  active.set(id, state);
  return { shouldStop: () => state.pause, finish: () => { if (active.get(id) === state) active.delete(id); } };
}
export function requestGoalPause(id: string): boolean {
  const state = active.get(id);
  if (!state) return false;
  state.pause = true;
  return true;
}
export function isGoalRunning(id: string): boolean { return active.has(id); }
