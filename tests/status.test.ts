// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/lib/store";
import { statusFlags, failedExecCount, decisionItems } from "../src/lib/status";

const now = Date.now();

describe("Status Deck — flagi decyzji/błędów", () => {
  beforeEach(() => {
    store.setData((d) => { d.audit = []; d.leads = []; d.reminders = []; d.flashcards = []; });
  });

  it("brak spraw → brak flag", () => {
    expect(statusFlags(now)).toEqual([]);
  });

  it("liczy nieudane wykonania z ostatniej doby (FAILED EXEC)", () => {
    store.setData((d) => {
      d.audit = [
        { id: "a", tool: "x", input: {}, status: "error", at: now - 1000 } as any,
        { id: "b", tool: "y", input: {}, status: "error", at: now - 2 * 86400000 } as any, // stare
        { id: "c", tool: "z", input: {}, status: "ok", at: now } as any,
      ];
    });
    expect(failedExecCount(now)).toBe(1);
    expect(statusFlags(now).find((f) => f.id === "failed")?.label).toMatch(/1 FAILED EXEC/);
  });

  it("liczy decyzje do podjęcia (leady, oferty, zaległe przypomnienia)", () => {
    store.setData((d) => {
      d.leads = [
        { id: "1", company: "A", status: "new", createdAt: now, updatedAt: now } as any,
        { id: "2", company: "B", status: "offer", offer: "treść", createdAt: now, updatedAt: now } as any,
        { id: "3", company: "C", status: "won", createdAt: now, updatedAt: now } as any,
      ];
      d.reminders = [{ id: "r", text: "x", at: new Date(now - 1000).toISOString(), fired: false, createdAt: now } as any];
    });
    const di = decisionItems(now);
    expect(di.newLeads).toBe(1);
    expect(di.offersToSend).toBe(1);
    expect(di.overdueReminders).toBe(1);
    expect(di.total).toBe(3);
    expect(statusFlags(now).find((f) => f.id === "decisions")?.label).toMatch(/3 DECISIONS DUE/);
  });
});
