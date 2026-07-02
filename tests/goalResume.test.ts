// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  offerableGoals,
  resumeNudgeText,
  refreshResumableGoals,
  cachedResumableGoals,
  resetGoalResumeCache,
  RESUME_MAX_AGE_MS,
} from "../src/lib/goalResume";
import { nextNudge, resetProactive } from "../src/lib/proactive";
import { newGoal, GOALS_KEY, type GoalRecord, type GoalStorage } from "../src/lib/goalState";
import { confirmed } from "../src/lib/actionOutcome";
import type { AgentPlan } from "../src/lib/agentPlanner";

// Kieszonkowa Ciągłość: oferta wznowienia trwałego celu po restarcie — pierwszy
// KONSUMENT resumableGoalsNewestFirst (dotąd wznowienie było wyłącznie ręczne).

const NOW = 1_700_000_000_000;

const plan = (goal: string): AgentPlan => ({
  goal,
  steps: [
    { id: "k1", intent: "przygotuj teczkę", tool: "lead_dossier" },
    { id: "k2", intent: "wyślij ofertę", tool: "send_mail" },
  ],
});

function goalRec(goal: string, status: GoalRecord["status"], updatedAt: number, confirmedSteps = 0): GoalRecord {
  const rec = { ...newGoal(goal, plan(goal), "corr-" + goal, updatedAt), status, updatedAt };
  if (confirmedSteps >= 1) rec.results = { k1: confirmed({ confirmedAt: updatedAt }) };
  return rec;
}

/** Trwały magazyn w pamięci (kontrakt GoalStorage jak IndexedDB). */
function memStorage(goals: GoalRecord[]): GoalStorage {
  const db = new Map<string, unknown>([[GOALS_KEY, goals]]);
  return {
    get: async <T,>(k: string) => (db.get(k) as T) ?? null,
    set: async (k, v) => {
      db.set(k, v);
      return true;
    },
  };
}

beforeEach(() => {
  resetGoalResumeCache();
  resetProactive();
});

describe("offerableGoals — świeżość oferty", () => {
  it("cel sprzed tygodnia+ wypada z oferty (nie nękamy o starocie)", () => {
    const fresh = goalRec("świeży", "running", NOW - 3_600_000);
    const stale = goalRec("staroć", "running", NOW - RESUME_MAX_AGE_MS - 1);
    expect(offerableGoals([fresh, stale], NOW)).toEqual([fresh]);
  });
});

describe("resumeNudgeText — uczciwa treść oferty", () => {
  it("brak celów → null (żadnego wymyślania)", () => {
    expect(resumeNudgeText([], NOW)).toBeNull();
  });

  it("mówi prawdę o postępie i uspokaja o idempotencji", () => {
    const g = goalRec("Domknij ofertę dla Acme", "running", NOW - 60_000, 1);
    const t = resumeNudgeText([g], NOW)!;
    expect(t).toContain("Domknij ofertę dla Acme");
    expect(t).toContain("1/2 kroków potwierdzonych");
    expect(t).toMatch(/Nic nie wykona się podwójnie/);
  });

  it("status waiting_consent → „czeka na Twoją zgodę” (nie udaje, że tylko przerwane)", () => {
    const g = goalRec("Wyślij raport", "waiting_consent", NOW - 60_000);
    expect(resumeNudgeText([g], NOW)).toMatch(/czeka na Twoją zgodę/);
  });
});

describe("refreshResumableGoals — cache z trwałego magazynu", () => {
  it("bierze wznawialne i świeże; pomija ukończone/nieudane/stare", async () => {
    const goals = [
      goalRec("wznawialny", "running", NOW - 1000),
      goalRec("ukończony", "completed", NOW - 1000),
      goalRec("nieudany", "failed", NOW - 1000),
      goalRec("staroć", "paused", NOW - RESUME_MAX_AGE_MS - 1),
    ];
    const got = await refreshResumableGoals(NOW, memStorage(goals));
    expect(got.map((g) => g.goal)).toEqual(["wznawialny"]);
    expect(cachedResumableGoals().map((g) => g.goal)).toEqual(["wznawialny"]);
  });

  it("błąd magazynu nie wybucha — zostaje poprzedni cache", async () => {
    const boom: GoalStorage = {
      get: async () => {
        throw new Error("IDB down");
      },
      set: async () => false,
    };
    await refreshResumableGoals(NOW, memStorage([goalRec("a", "running", NOW)]));
    const before = cachedResumableGoals();
    await refreshResumableGoals(NOW, boom);
    expect(cachedResumableGoals()).toBe(before);
  });
});

describe("nextNudge — integracja: oferta wznowienia w silniku proaktywnym", () => {
  it("świeży wznawialny cel w cache → nudge goalResume z ekranem goals", async () => {
    await refreshResumableGoals(NOW, memStorage([goalRec("Domknij ofertę", "running", NOW - 1000, 1)]));
    const n = nextNudge(NOW);
    expect(n?.kind).toBe("goalResume");
    expect(n?.screen).toBe("goals");
    expect(n?.text).toContain("Domknij ofertę");
  });

  it("pusty cache → brak nudge'a goalResume", async () => {
    await refreshResumableGoals(NOW, memStorage([]));
    const n = nextNudge(NOW);
    expect(n?.kind).not.toBe("goalResume");
  });
});
