// === Runtime trwałych celów (goalRuntime) — testy ===
// Uruchomienie celu tworzy TRWAŁY rekord, wykonuje plan na prawdziwym narzędziu (list_tasks, read),
// zapisuje wynik i finalny status. Cel jest potem wczytywalny (przeżyłby restart). Zero płatnego API.
import { describe, it, expect } from "vitest";
import { startAndRunGoal, loadGoalsNewestFirst, resumableGoalsNewestFirst, resumeAndRunGoal } from "../src/lib/goalRuntime";
import { newGoal, recordStepOutcome, upsertGoal, type GoalStorage } from "../src/lib/goalState";
import { confirmed } from "../src/lib/actionOutcome";
import type { AgentPlan } from "../src/lib/agentPlanner";

const NOW = 16_000_000_000;
function memStore(): GoalStorage {
  const m = new Map<string, unknown>();
  return { get: async (k) => (m.has(k) ? (m.get(k) as never) : null), set: async (k, v) => { m.set(k, v); return true; } };
}

describe("goalRuntime — trwały cel od uruchomienia do zapisu", () => {
  it("wykonuje realne narzędzie, zapisuje wynik i finalny status; cel jest wczytywalny", async () => {
    const store = memStore();
    const plan: AgentPlan = { goal: "pokaż zadania", steps: [{ id: "a", intent: "lista zadań", tool: "list_tasks" }] };
    const { record, result } = await startAndRunGoal({ goal: "Przegląd zadań", plan, correlationId: "G1", now: NOW }, store);

    expect(result.verdict.canClaimSuccess).toBe(true);
    expect(record.status).toBe("completed");

    // Trwałość: po ponownym wczytaniu (≈ restart) cel i jego potwierdzony wynik są zachowane.
    const loaded = await loadGoalsNewestFirst(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("G1");
    expect(loaded[0].results["a"].state).toBe("CONFIRMED");
    expect(loaded[0].goal).toBe("Przegląd zadań");
  });

  it("ukończony cel nie jest na liście do wznowienia", async () => {
    const store = memStore();
    const plan: AgentPlan = { goal: "x", steps: [{ id: "a", intent: "lista", tool: "list_tasks" }] };
    await startAndRunGoal({ goal: "gotowe", plan, correlationId: "G2", now: NOW }, store);
    const resumable = await resumableGoalsNewestFirst(store);
    expect(resumable.map((g) => g.id)).not.toContain("G2"); // completed → nie do wznowienia
  });

  it("wznów i dokończ: dograja pozostałe kroki, NIE ruszając potwierdzonych", async () => {
    const store = memStore();
    const plan: AgentPlan = { goal: "dwa kroki", steps: [
      { id: "a", intent: "krok a", tool: "list_tasks" },
      { id: "b", intent: "krok b", tool: "list_leads", dependsOn: ["a"] },
    ] };
    // Cel częściowo wykonany: a potwierdzone (z rozpoznawalnym śladem), b jeszcze nie.
    let g = newGoal("częściowy cel", plan, "G4", NOW);
    g = recordStepOutcome(g, "a", confirmed({ message: "zrobione wcześniej" }), NOW);
    await upsertGoal(g, store);

    const { record } = await resumeAndRunGoal(g, { now: NOW + 1 }, store);
    expect(record.status).toBe("completed");
    expect(record.results["a"].evidence?.message).toBe("zrobione wcześniej"); // a NIE wykonane ponownie
    expect(record.results["b"].state).toBe("CONFIRMED");                      // b dograne
  });

  it("cel z krokiem outbound bez zgody (headless) → wstrzymany, nie ogłasza sukcesu", async () => {
    const store = memStore();
    const plan: AgentPlan = { goal: "wyślij", steps: [{ id: "a", intent: "mail", tool: "gmail_send", requiresConsent: true }] };
    const { record, result } = await startAndRunGoal({ goal: "wysyłka", plan, correlationId: "G3", now: NOW }, store);
    expect(result.verdict.canClaimSuccess).toBe(false); // brak potwierdzenia → nie sukces
    expect(["waiting_consent", "failed", "running"]).toContain(record.status);
  });
});
