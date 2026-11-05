import type { GoalRecord } from "./goalState";
import { outcomeLabel } from "./actionOutcome";

/** Wąski zestaw lokalnych komend; nie przechwytuje zwykłych pytań o zadania. */
export function isGoalProgressRequest(text: string): boolean {
  const q = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l")
    .replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim().replace(/^jarvis\s+/, "");
  return /^(pokaz (mi )?(dotychczasowe )?wyniki|daj (mi )?(to co juz znalazles|pierwsze wyniki)|pospiesz sie(?: potrzebuje (pierwszych )?wynikow)?)$/.test(q);
}

/** Raportuje tylko zapisane rezultaty, bez wymyślania cen ani ukończonych kroków. */
export function formatGoalProgress(goals: GoalRecord[]): string {
  const g = goals.find((goal) => goal.status !== "completed" && goal.status !== "failed") || goals[0];
  if (!g) return "Nie mam zapisanych zadań ani wyników do pokazania.";
  const steps = g.plan.steps || [];
  const done = steps.filter((step) => g.results[step.id]?.state === "CONFIRMED").length;
  const reported = steps.filter((step) => !!g.results[step.id]).slice(0, 6);
  const lines = reported.map((step) => {
    const result = g.results[step.id];
    return `• ${step.intent}: ${outcomeLabel(result)}${result.evidence?.message ? ` — ${result.evidence.message}` : ""}`;
  });
  return [`Cel: ${g.goal}. Potwierdzone kroki: ${done}/${steps.length}.`,
    lines.length ? lines.join("\n") : "Nie ma jeszcze zapisanych wyników.",
    "Wyniki bez potwierdzenia wymagają sprawdzenia. To podgląd postępu — tempo wykonywania się nie zmieniło.",
  ].join("\n");
}
