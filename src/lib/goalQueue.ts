import { loadGoals, newGoal, subscribeGoals, upsertGoal, type GoalRecord } from "./goalState";
import { isGoalRunning, resumeAndRunGoal } from "./goalRuntime";
import { validatePlan, type AgentPlan } from "./agentPlanner";
import { toolDefs } from "./tools";
import { riskOf } from "./permissions";
import { store, uid } from "./store";
import { selectToolsForIntent } from "./toolSelector";

export function parseQueuePlan(raw: string): AgentPlan {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const plan = JSON.parse(cleaned) as AgentPlan;
  if (!Array.isArray(plan?.steps) || plan.steps.length > 40) throw new Error("Plan musi zawierać od 1 do 40 kroków. Podziel cel na etapy.");
  if (typeof plan.goal !== "string" || plan.steps.some((step) => !step || typeof step.id !== "string" || typeof step.intent !== "string" || !step.intent.trim() || (step.tool !== undefined && typeof step.tool !== "string") || (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) || step.dependsOn.some((id) => typeof id !== "string")))) || (plan.missingInformation !== undefined && (!Array.isArray(plan.missingInformation) || plan.missingInformation.some((item) => typeof item !== "string")))) throw new Error("Model zwrócił niepełny plan. Doprecyzuj cel i spróbuj ponownie.");
  const validation = validatePlan(plan, { toolExists: (name) => toolDefs.some((tool) => tool.name === name), riskOf });
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  if (validation.question) throw new Error(validation.question);
  return plan;
}

export async function planAndEnqueueGoal(goal: string): Promise<GoalRecord> {
  const { askModel, hasUsableBrain } = await import("./brain");
  if (!hasUsableBrain()) throw new Error("Podłącz dostawcę AI w Ustawieniach albo uruchom lokalny model Ollama. Kolejka nie wymaga osobnego konta.");
  const tools = selectToolsForIntent(goal, toolDefs);
  const raw = await askModel({
    system: [
      "Zaplanuj realne wykonanie celu. Zwróć wyłącznie JSON: {goal, steps:[{id,intent,tool?,arguments?,dependsOn?,requiresConsent?}]}.",
      "Maksymalnie 40 konkretnych kroków. tool wyłącznie z listy. Bez tool oznacza prawdziwą analizę LLM z wynikami zależności.",
      "Dla operacji zewnętrznych requiresConsent:true. Nie wymyślaj danych, ścieżek ani dostępu do usług.",
      "W arguments możesz użyć obiektu {\"$result\":\"id\"} jako wartości: otrzyma pełny tekst wyniku jawnej zależności dependsOn.",
      "Opcjonalne pole path w takim obiekcie odczyta pole z wyniku JSON, np. {\"$result\":\"s1\",\"path\":\"content\"}.",
      "Najpierw sprawdź zasoby. Po zmianie pliku uruchom odpowiedni test. Zakończ syntezą wyników opartą na dependsOn.",
      "Jeśli brakuje niezbędnej informacji, dodaj missingInformation:[jedno konkretne pytanie].",
      JSON.stringify(tools),
    ].join("\n"),
    history: [{ role: "user", content: goal.slice(0, 4000) }], heavy: true,
  });
  const plan = parseQueuePlan(raw);
  const record = newGoal(goal.trim(), plan, uid(), Date.now());
  await upsertGoal(record);
  return record;
}

let working = false;
/** Jedna kolejka FIFO; zamknięcie panelu nie przerywa wykonania. */
export function startGoalQueue(onError: (message: string) => void): () => void {
  let disposed = false;
  const drain = async () => {
    if (working || disposed || store.settings.autonomousQueue === false) return;
    working = true;
    try {
      const run = async () => {
        while (!disposed && store.settings.autonomousQueue !== false) {
          const next = (await loadGoals()).filter((goal) =>
            (goal.status === "queued" || goal.status === "running") && !isGoalRunning(goal.id)
          ).sort((a, b) => a.createdAt - b.createdAt)[0];
          if (!next) break;
          try { await resumeAndRunGoal(next, { now: Date.now() }); }
          catch (error) { onError(error instanceof Error ? error.message : "Nie udało się wykonać zadania."); break; }
        }
      };
      if (typeof navigator !== "undefined" && navigator.locks) {
        await navigator.locks.request("jarvis-goal-worker", { ifAvailable: true }, async (lock) => { if (lock) await run(); });
      } else await run();
    } catch (error) { onError(error instanceof Error ? error.message : "Nie można odczytać kolejki."); }
    finally { working = false; }
  };
  const unsubscribe = subscribeGoals(() => { void drain(); });
  const timer = setInterval(() => { void drain(); }, 5000);
  void drain();
  return () => { disposed = true; clearInterval(timer); unsubscribe(); };
}
