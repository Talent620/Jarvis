// === Planista celów — dekompozycja LLM → graf → wykonanie (capstone orkiestratora) ===
// Cel użytkownika → graf podzadań (model) → równoległe rozwiązanie z zależnościami (orchestrator)
// → synteza w spójną odpowiedź. Parsowanie/walidacja planu są CZYSTE i testowalne; wykonanie
// deleguje do `askModel` (rozumowanie, bez akcji — bezpieczne).
import { askModel } from "./brain";
import { runGraph, detectCycle, type TaskNode } from "./orchestrator";

export interface GoalStep { id: string; task: string; deps: string[] }

/** Pure: prompt proszący model o rozłożenie celu na 2–6 podzadań z zależnościami (czysty JSON). */
export function goalDecompositionPrompt(goal: string): string {
  return [
    "Jesteś planistą. Rozłóż CEL użytkownika na 2–6 konkretnych podzadań, które RAZEM go realizują.",
    "Zaznacz zależności: które podzadanie potrzebuje wyniku innego (deps). Niezależne zostaw bez deps (pójdą równolegle).",
    'Zwróć WYŁĄCZNIE poprawny JSON, bez markdown: {"steps":[{"id":"s1","task":"...","deps":[]},{"id":"s2","task":"...","deps":["s1"]}]}',
    "- id: krótki unikat (s1, s2, …). task: jedno jasne zadanie po polsku. deps: lista istniejących id.",
    "- Maksymalnie 6 kroków. Bez cykli.",
    "",
    `Cel: ${(goal || "").slice(0, 2000)}`,
  ].join("\n");
}

/** Pure: wyłuskaj i zwaliduj plan z odpowiedzi modelu — id, zadania, zależności (bez cykli, z capem). */
export function parseGoalPlan(raw: string, maxSteps = 6): GoalStep[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let data: { steps?: { id?: string; task?: string; deps?: string[] }[] };
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const rawSteps = Array.isArray(data?.steps) ? data.steps : [];

  // Krok 1: zbierz prawidłowe kroki z unikalnym id i niepustym zadaniem.
  const steps: GoalStep[] = [];
  const ids = new Set<string>();
  for (const s of rawSteps) {
    const id = String(s?.id ?? "").trim();
    const task = String(s?.task ?? "").trim();
    if (!id || !task || ids.has(id)) continue;
    ids.add(id);
    steps.push({ id, task, deps: Array.isArray(s?.deps) ? s.deps.map((d) => String(d)) : [] });
    if (steps.length >= maxSteps) break;
  }
  // Krok 2: deps tylko do istniejących id (bez self-ref).
  const valid = new Set(steps.map((s) => s.id));
  for (const s of steps) s.deps = [...new Set(s.deps.filter((d) => d !== s.id && valid.has(d)))];
  // Krok 3: zerwij cykle (usuwaj krawędzie zamykające pętlę, aż czysto).
  for (let guard = 0; guard < steps.length + 1; guard++) {
    const cyc = detectCycle(steps.map((s) => ({ id: s.id, deps: s.deps })));
    if (!cyc) break;
    const last = steps.find((s) => s.id === cyc[cyc.length - 1]);
    if (last && last.deps.length) last.deps = last.deps.filter((d) => d !== cyc[0]);
    else break;
  }
  return steps;
}

export interface GoalRun { answer: string; steps: GoalStep[]; trace: Record<string, string>; skipped: string[] }

/**
 * Rozłóż cel, rozwiąż podzadania (równolegle wg zależności, z wynikami rodziców w kontekście)
 * i zsyntetyzuj spójną odpowiedź. Wykonanie używa `askModel` (rozumowanie, bez akcji — bezpieczne).
 */
export async function runGoal(goal: string, opts: { onEvent?: (e: { type: string; id: string }) => void; onPlan?: (steps: GoalStep[]) => void } = {}): Promise<GoalRun> {
  const g = (goal || "").trim();
  if (!g) return { answer: "", steps: [], trace: {}, skipped: [] };

  // Dekompozycja.
  let plan: GoalStep[] = [];
  try {
    const raw = await askModel({ system: "Planujesz rozwiązanie złożonego celu.", history: [{ role: "user", content: goalDecompositionPrompt(g) }] });
    plan = parseGoalPlan(raw);
  } catch { /* brak planu → odpowiedz wprost */ }
  if (plan.length >= 2) opts.onPlan?.(plan); // pokaż plan na żywo (UI) zanim ruszy wykonanie

  // Fallback: bez sensownego planu odpowiadamy bezpośrednio (jeden krok).
  if (plan.length < 2) {
    const answer = await askModel({ system: "Odpowiadasz konkretnie i kompletnie po polsku.", history: [{ role: "user", content: g }], heavy: true });
    return { answer, steps: plan, trace: {}, skipped: [] };
  }

  // Wykonanie grafu — każdy węzeł rozwiązuje swoje podzadanie z wynikami rodziców.
  const nodes: TaskNode[] = plan.map((s) => ({ id: s.id, deps: s.deps, meta: s.task }));
  const res = await runGraph<string>(nodes, async (n, deps) => {
    const ctx = Object.entries(deps).map(([id, txt]) => `Wynik [${id}]: ${String(txt).slice(0, 1500)}`).join("\n");
    return askModel({
      system: "Wykonaj jedno podzadanie zwięźle i konkretnie po polsku. Wykorzystaj podany kontekst, jeśli jest.",
      history: [{ role: "user", content: `${n.meta}${ctx ? `\n\nKontekst (wyniki wcześniejszych kroków):\n${ctx}` : ""}` }],
    });
  }, { concurrency: 3, retries: 1, onEvent: opts.onEvent });

  // Synteza.
  const stepsBlock = plan.map((s) => `[${s.id}] ${s.task}\n${res.results[s.id] || "(pominięte)"}`).join("\n\n");
  const answer = await askModel({
    system: "Połącz wyniki podzadań w JEDNĄ spójną, kompletną odpowiedź na cel — po polsku, bez powtórzania struktury kroków.",
    history: [{ role: "user", content: `Cel: ${g}\n\nWyniki podzadań:\n${stepsBlock}` }],
    heavy: true,
  });
  return { answer, steps: plan, trace: res.results, skipped: res.skipped };
}
