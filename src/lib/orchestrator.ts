// === Orkiestrator zadań — wykonanie grafowe (równoległość, retry, samokorekta, scalanie) ===
// Backbone architektury wieloagentowej: dekompozycja celu na graf podzadań z zależnościami,
// równoległe wykonanie gotowych węzłów, ponawianie przy błędach, pomijanie zależnych od porażki,
// scalanie wyników. Planowanie jest CZYSTE (topo/cykle); wykonawca dostarcza funkcję węzła.

export interface TaskNode {
  id: string;
  deps?: string[];      // ids, które muszą się ukończyć przed tym węzłem
  label?: string;       // opis (do UI/logów)
  meta?: unknown;       // dowolne dane dla wykonawcy (np. tool, prompt)
}

/** Pure: wykryj cykl w grafie zależności. Zwraca id-y w cyklu albo null. */
export function detectCycle(nodes: TaskNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=biały,1=szary,2=czarny
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (id: string): boolean => {
    if (cycle) return true;
    const st = state.get(id) || 0;
    if (st === 1) { const i = stack.indexOf(id); cycle = stack.slice(i); return true; }
    if (st === 2) return false;
    state.set(id, 1); stack.push(id);
    for (const d of byId.get(id)?.deps || []) if (byId.has(d) && visit(d)) return true;
    stack.pop(); state.set(id, 2);
    return false;
  };
  for (const n of nodes) if (visit(n.id)) break;
  return cycle;
}

/** Pure: kolejność topologiczna (rodzice przed dziećmi). Przy cyklu pomija zapętlone. */
export function topoOrder(nodes: TaskNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || visiting.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const d of byId.get(id)!.deps || []) visit(d);
    visiting.delete(id);
    seen.add(id); out.push(id);
  };
  for (const n of nodes) visit(n.id);
  return out;
}

export interface RunOptions {
  concurrency?: number;          // ile węzłów naraz (domyślnie 4)
  retries?: number;              // ponowienia na węzeł (domyślnie 0)
  signal?: { aborted: boolean }; // miękkie przerwanie
  onEvent?: (e: { type: "start" | "done" | "fail" | "skip"; id: string; attempt?: number }) => void;
}

export interface RunResult<R> {
  results: Record<string, R>; // wyniki ukończonych węzłów (scalone)
  failed: string[];           // węzły, które padły mimo ponowień
  skipped: string[];          // węzły pominięte (zależne od porażki / cykl / abort)
}

/**
 * Wykonaj graf: równolegle uruchamia węzły, których zależności są spełnione (do `concurrency`),
 * ponawia padające (`retries`), pomija zależne od porażki, scala wyniki. `exec(node, depResults)`
 * dostarcza logikę węzła (np. wywołanie narzędzia/modelu). Odporne na cykle i przerwanie.
 */
export async function runGraph<R = unknown>(
  nodes: TaskNode[],
  exec: (node: TaskNode, depResults: Record<string, R>) => Promise<R>,
  opts: RunOptions = {},
): Promise<RunResult<R>> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const retries = Math.max(0, opts.retries ?? 0);
  const done = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const results: Record<string, R> = {};
  const running = new Map<string, Promise<void>>();

  const depsResolved = (n: TaskNode) => (n.deps || []).every((d) => done.has(d));
  const depsBlocked = (n: TaskNode) => (n.deps || []).some((d) => failed.has(d) || skipped.has(d));
  const settled = (id: string) => done.has(id) || failed.has(id) || skipped.has(id);

  const attempt = async (n: TaskNode): Promise<void> => {
    const depResults: Record<string, R> = {};
    for (const d of n.deps || []) depResults[d] = results[d];
    for (let i = 0; i <= retries; i++) {
      if (opts.signal?.aborted) { failed.add(n.id); return; }
      try {
        opts.onEvent?.({ type: "start", id: n.id, attempt: i + 1 });
        results[n.id] = await exec(n, depResults);
        done.add(n.id);
        opts.onEvent?.({ type: "done", id: n.id });
        return;
      } catch {
        /* ponów lub poddaj się */
      }
    }
    failed.add(n.id);
    opts.onEvent?.({ type: "fail", id: n.id });
  };

  const markSkip = (id: string) => { if (!settled(id)) { skipped.add(id); opts.onEvent?.({ type: "skip", id }); } };

  while (done.size + failed.size + skipped.size < nodes.length) {
    if (opts.signal?.aborted) { for (const n of nodes) if (!running.has(n.id)) markSkip(n.id); }
    // Pomiń węzły, których zależność padła/pominięto.
    for (const n of nodes) if (!settled(n.id) && !running.has(n.id) && depsBlocked(n)) markSkip(n.id);

    const ready = nodes.filter((n) => !settled(n.id) && !running.has(n.id) && depsResolved(n));
    const slots = concurrency - running.size;
    for (const n of ready.slice(0, Math.max(0, slots))) {
      const p = attempt(n).finally(() => running.delete(n.id));
      running.set(n.id, p);
    }

    if (running.size) { await Promise.race(running.values()); continue; }

    // Brak biegnących i brak gotowych → blokada (cykl/osierocone deps): pomiń resztę.
    if (!ready.length) { for (const n of nodes) markSkip(n.id); break; }
  }

  return { results, failed: [...failed], skipped: [...skipped] };
}
