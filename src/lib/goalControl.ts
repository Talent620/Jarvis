// Sterowanie jedną instancją aplikacji. Pauza obowiązuje na granicy kroków, nie przerywa I/O.
interface ActiveGoal { pause: boolean; stopped: boolean; controller: AbortController }
const active = new Map<string, ActiveGoal>();

export function beginGoalRun(id: string): { shouldStop: () => boolean; finish: () => void; signal: AbortSignal; wasStopped: () => boolean } {
  if (active.has(id)) throw new Error("Ten cel jest już wykonywany.");
  const state: ActiveGoal = { pause: false, stopped: false, controller: new AbortController() };
  active.set(id, state);
  return { wasStopped: () => state.stopped, signal: state.controller.signal, shouldStop: () => state.pause, finish: () => { if (active.get(id) === state) active.delete(id); } };
}
export function requestGoalPause(id: string): boolean {
  const state = active.get(id);
  if (!state) return false;
  state.pause = true;
  return true;
}
export function isGoalRunning(id: string): boolean { return active.has(id); }

/** Emergency STOP for active goals in this renderer. In-flight side effects remain unconfirmed. */
export function stopAllGoalRuns(): number {
  for (const state of active.values()) { state.pause = true; state.stopped = true; state.controller.abort(); }
  return active.size;
}

export function requestGoalStop(id: string): boolean {
  const state = active.get(id);
  if (!state) return false;
  state.pause = true; state.stopped = true; state.controller.abort();
  return true;
}
