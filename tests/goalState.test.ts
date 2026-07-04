// === Trwałe cele (goalState) — testy ===
// Cel ma przeżyć restart: zapis/odczyt przez wstrzykiwany backend (in-memory ≈ IndexedDB),
// wznowienie z właściwego miejsca, BRAK podwójnego wykonania CONFIRMED, ATTEMPTED wymaga
// sprawdzenia (nie ślepego ponowienia → brak podwójnego maila), stop/wznów/anuluj, stare rekordy.
import { describe, it, expect } from "vitest";
import {
  newGoal, recordStepOutcome, nextRunnableStep, isStepDone, attemptedSteps, resumableGoals,
  pauseGoal, resumeGoal, cancelGoal, normalizeGoal, loadGoals, upsertGoal, removeGoal,
  type GoalStorage, type GoalRecord,
} from "../src/lib/goalState";
import type { AgentPlan } from "../src/lib/agentPlanner";
import { confirmed, attempted, simulated } from "../src/lib/actionOutcome";

const NOW = 1_000_000;
const plan: AgentPlan = { goal: "lead → oferta → mail", steps: [
  { id: "a", intent: "znajdź leady", tool: "list_leads" },
  { id: "b", intent: "przygotuj ofertę", tool: "lead_dossier", dependsOn: ["a"] },
  { id: "c", intent: "wyślij mail", tool: "gmail_send", dependsOn: ["b"], requiresConsent: true },
] };

// Prosty backend in-memory spełniający kontrakt GoalStorage (≈ IndexedDB w przeglądarce).
function memStore(): GoalStorage & { dump(): Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return { get: async (k) => (m.has(k) ? (m.get(k) as never) : null), set: async (k, v) => { m.set(k, v); return true; }, dump: () => m };
}

describe("goalState — postęp i brak podwójnego wykonania", () => {
  it("nextRunnableStep idzie po kolei i pomija CONFIRMED", () => {
    let g = newGoal("x", plan, "G1", NOW);
    expect(nextRunnableStep(g)?.id).toBe("a");
    g = recordStepOutcome(g, "a", confirmed(), NOW + 1);
    expect(isStepDone(g, "a")).toBe(true);
    expect(nextRunnableStep(g)?.id).toBe("b"); // a pominięte, bo CONFIRMED
  });

  it("CONFIRMED nie wykona się drugi raz (recordStepOutcome nie nadpisuje)", () => {
    let g = newGoal("x", plan, "G1", NOW);
    g = recordStepOutcome(g, "a", confirmed({ message: "pierwsze" }), NOW + 1);
    g = recordStepOutcome(g, "a", confirmed({ message: "drugie" }), NOW + 2);
    expect(g.results.a.evidence?.message).toBe("pierwsze"); // niezmienione
  });

  it("ATTEMPTED wymaga sprawdzenia — nie jest ponawiany (brak podwójnego maila)", () => {
    let g = newGoal("x", plan, "G1", NOW);
    g = recordStepOutcome(g, "a", confirmed(), NOW + 1);
    g = recordStepOutcome(g, "b", confirmed(), NOW + 2);
    g = recordStepOutcome(g, "c", attempted("gmail"), NOW + 3);
    expect(attemptedSteps(g)).toEqual(["c"]);
    expect(nextRunnableStep(g)).toBeNull();   // c NIE jest ponawiany
    expect(g.status).toBe("waiting_user");    // czeka na potwierdzenie dostarczenia
  });

  it("krok zależny od niepotwierdzonego (SIMULATED) nie rusza — dependent zablokowany", () => {
    let g = newGoal("x", plan, "G1", NOW);
    g = recordStepOutcome(g, "a", simulated(), NOW + 1);
    // a (bez zależności, tylko zasymulowane) może być wykonane naprawdę; b zależne od a NIE rusza.
    expect(nextRunnableStep(g)?.id).toBe("a");
    expect(nextRunnableStep(g)?.id).not.toBe("b");
  });
});

describe("goalState — restart i trwałość", () => {
  it("restart między krokami: zapis → odczyt zachowuje wyniki i wskazuje następny krok", async () => {
    const store = memStore();
    let g = newGoal("x", plan, "G1", NOW);
    g = recordStepOutcome(g, "a", confirmed(), NOW + 1);
    await upsertGoal(g, store);
    // „restart" — czytamy od zera z backendu.
    const reloaded = await loadGoals(store);
    expect(reloaded).toHaveLength(1);
    expect(isStepDone(reloaded[0], "a")).toBe(true);
    expect(nextRunnableStep(reloaded[0])?.id).toBe("b");
  });

  it("restart podczas zgody: waiting_consent przetrwa i jest wznawialny", async () => {
    const store = memStore();
    let g = newGoal("x", plan, "G1", NOW);
    g = recordStepOutcome(g, "a", confirmed(), NOW + 1);
    g = recordStepOutcome(g, "b", confirmed(), NOW + 2);
    g = { ...g, status: "waiting_consent" };
    await upsertGoal(g, store);
    const reloaded = await loadGoals(store);
    expect(reloaded[0].status).toBe("waiting_consent");
    expect(resumableGoals(reloaded).map((x) => x.id)).toContain("G1");
    expect(nextRunnableStep(reloaded[0])?.id).toBe("c"); // wznawiamy na kroku ze zgodą
  });

  it("anulowanie usuwa cel z wznawialnych; removeGoal kasuje z backendu", async () => {
    const store = memStore();
    const g = newGoal("x", plan, "G1", NOW);
    await upsertGoal(g, store);
    const cancelled = cancelGoal(g, NOW + 5);
    expect(resumableGoals([cancelled])).toHaveLength(0);
    await removeGoal("G1", store);
    expect(await loadGoals(store)).toHaveLength(0);
  });

  it("stop → paused, wznów → przelicza status", () => {
    let g = newGoal("x", plan, "G1", NOW);
    g = pauseGoal(g, NOW + 1);
    expect(g.status).toBe("paused");
    expect(resumableGoals([g])).toHaveLength(1);
    g = resumeGoal(g, NOW + 2);
    expect(g.status).toBe("running"); // są jeszcze kroki do zrobienia
  });
});

describe("goalState — kompatybilność wstecz", () => {
  it("stary rekord bez results/status/stepIndex jest normalizowany", () => {
    const old = { id: "OLD", goal: "stare", plan } as Partial<GoalRecord> & { id: string; goal: string; plan: AgentPlan };
    const n = normalizeGoal(old);
    expect(n.status).toBe("queued");
    expect(n.results).toEqual({});
    expect(n.correlationId).toBe("OLD");
    expect(nextRunnableStep(n)?.id).toBe("a");
  });
});
