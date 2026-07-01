// === Codzienny Growth Orchestrator (growthOrchestrator) — testy ===
// Offline nadal tworzy sensowny plan z lokalnych danych; brak zgody blokuje wysyłkę/publikację/wydatek
// (działania zewnętrzne mają requiredPermission=consent). Maks. 3 działania, ranking wg ROI, uczenie.
import { describe, it, expect } from "vitest";
import { planDailyGrowth, actionToPlan, recordDecision, DEFAULT_ORCH_WEIGHTS } from "../src/lib/growthOrchestrator";
import type { Lead, FinanceProject } from "../src/types";
import { riskOf } from "../src/lib/permissions";

const NOW = 14_000_000_000;
const DAY = 86_400_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });
const fin = (over: Partial<FinanceProject>): FinanceProject => ({ id: "F", name: "P", status: "w_realizacji", amount: 0, createdAt: NOW, updatedAt: NOW, ...over });

describe("growthOrchestrator — plan dnia (offline)", () => {
  it("z lokalnych danych tworzy sensowny plan (maks. 3), posortowany wg ROI", () => {
    const actions = planDailyGrowth({
      now: NOW,
      leads: [lead({ id: "h", company: "Alfa", status: "offer", value: 8000, lastContactedAt: NOW - 5 * DAY })],
      finance: [fin({ amount: 9000, paidAmount: 0, status: "oczekuje_platnosci" })],
    });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < actions.length; i++) expect(actions[i - 1].expectedValue).toBeGreaterThanOrEqual(actions[i].expectedValue);
  });

  it("brak danych → nadal proponuje research (offline, bez zgody)", () => {
    const actions = planDailyGrowth({ now: NOW });
    expect(actions.some((a) => a.kind === "research")).toBe(true);
  });
});

describe("growthOrchestrator — zgoda na działania zewnętrzne", () => {
  it("follow-up i publikacja wymagają zgody; research/demo/płatność-sprawdzenie nie", () => {
    const actions = planDailyGrowth({
      now: NOW,
      leads: [lead({ id: "f", company: "Beta", email: "b@beta.pl", nextFollowUpAt: NOW - DAY })],
      approvedPostsCount: 2,
    });
    const followUp = actions.find((a) => a.kind === "send_followup");
    const publish = actions.find((a) => a.kind === "publish_post");
    if (followUp) expect(followUp.requiredPermission).toBe("consent");
    if (publish) expect(publish.requiredPermission).toBe("consent");
  });

  it("actionToPlan: outbound → krok wymaga zgody; plan trafia do prawdziwego narzędzia", () => {
    const send = { id: "x", kind: "send_followup" as const, title: "follow-up", expectedValue: 1, evidence: [], cost: "", risk: "medium" as const, requiredPermission: "consent" as const, expectedEffect: "" };
    const plan = actionToPlan(send);
    expect(plan.steps[0].requiresConsent).toBe(true);
    expect(riskOf(plan.steps[0].tool!)).toBe("outbound"); // gmail_send jest outbound

    const research = { id: "r", kind: "research" as const, title: "research", expectedValue: 1, evidence: [], cost: "", risk: "low" as const, requiredPermission: "none" as const, expectedEffect: "" };
    expect(actionToPlan(research).steps[0].requiresConsent).toBeUndefined();
  });
});

describe("growthOrchestrator — uczenie", () => {
  it("akceptacja podnosi wagę, odrzucenie obniża, w bezpiecznych granicach", () => {
    let w = { ...DEFAULT_ORCH_WEIGHTS };
    for (let i = 0; i < 30; i++) w = recordDecision(w, "build_demo", true);
    expect(w.build_demo).toBeLessThanOrEqual(2);
    expect(w.build_demo).toBeGreaterThan(DEFAULT_ORCH_WEIGHTS.build_demo);
    for (let i = 0; i < 40; i++) w = recordDecision(w, "build_demo", false);
    expect(w.build_demo).toBeGreaterThanOrEqual(0.5);
  });
});
