// === Runtime trwałych celów (goalRuntime) — testy ===
// Uruchomienie celu tworzy TRWAŁY rekord, wykonuje plan na prawdziwym narzędziu (list_tasks, read),
// zapisuje wynik i finalny status. Cel jest potem wczytywalny (przeżyłby restart). Zero płatnego API.
import { describe, it, expect } from "vitest";
import { startAndRunGoal, loadGoalsNewestFirst, resumableGoalsNewestFirst, resumeAndRunGoal } from "../src/lib/goalRuntime";
import { isGoalRunning, requestGoalPause } from "../src/lib/goalControl";
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


describe("goalRuntime — pauza i kontynuacja", () => {
  it("utrwala wynik bieżącego kroku i wznawia bez ponowienia go", async () => {
    const store = memStore();
    const plan: AgentPlan = { goal: "odczyty", steps: [
      { id: "a", intent: "zadania", tool: "list_tasks" },
      { id: "b", intent: "leady", tool: "list_leads", dependsOn: ["a"] },
    ] };
    const { record, result } = await startAndRunGoal({ goal: "odczyty", plan, correlationId: "PAUSE1", now: NOW, onStep: () => { expect(requestGoalPause("PAUSE1")).toBe(true); } }, store);
    expect(isGoalRunning("PAUSE1")).toBe(false);
    expect(result.status).toBe("stopped");
    expect(record.status).toBe("paused");
    expect(record.results.a.state).toBe("CONFIRMED");
    expect(record.results.b).toBeUndefined();
    const saved = (await loadGoalsNewestFirst(store))[0];
    const resumed = await resumeAndRunGoal(saved, { now: NOW + 1 }, store);
    expect(resumed.record.status).toBe("completed");
    expect(resumed.record.results.b.state).toBe("CONFIRMED");
  });
});

describe("goalRuntime — bezpieczeństwo zapisu postępu", () => {
  it("nie uruchamia celu, gdy nie można zapisać rekordu początkowego", async () => {
    let calls = 0;
    const storage: GoalStorage = { get: async () => null, set: async () => { calls++; return false; } };
    const plan: AgentPlan = { goal: "zadania", steps: [{ id: "a", intent: "zadania", tool: "list_tasks" }] };
    await expect(startAndRunGoal({ goal: "zadania", plan, correlationId: "FAIL-PERSIST", now: NOW, onStep: () => { throw new Error("krok nie powinien wystartować"); } }, storage)).rejects.toThrow(/Nie udało się zapisać/);
    expect(calls).toBe(1);
    expect(isGoalRunning("FAIL-PERSIST")).toBe(false);
  });
  it("zatrzymuje przed następnym krokiem, jeśli zapis wyniku się nie uda", async () => {
    const backing = memStore();
    let writes = 0;
    const storage: GoalStorage = { get: backing.get, set: async (k, v) => { writes++; return writes === 1 ? backing.set(k, v) : false; } };
    const plan: AgentPlan = { goal: "dwa odczyty", steps: [
      { id: "a", intent: "zadania", tool: "list_tasks" },
      { id: "b", intent: "leady", tool: "list_leads", dependsOn: ["a"] },
    ] };
    const executed: string[] = [];
    await expect(startAndRunGoal({ goal: "dwa odczyty", plan, correlationId: "FAIL-CHECKPOINT", now: NOW, onStatus: (s) => executed.push(s) }, storage)).rejects.toThrow(/Nie udało się zapisać/);
    expect(executed).toHaveLength(1);
    expect(writes).toBe(2);
    expect(isGoalRunning("FAIL-CHECKPOINT")).toBe(false);
  });
});
