// === Handoff Klient → Finanse → Marketing (growthHandoff) — testy ===
// „Utwórz projekt" wypełnia nazwę/wartość/powiązanie z danych klienta; nie duplikuje projektu;
// płatność (projekt opłacony) automatycznie przesuwa etap klienta (przez businessFlow/clientJourney).
import { describe, it, expect } from "vitest";
import { leadToProjectDraft, hasProjectForClient } from "../src/lib/growthContext";
import { clientJourney } from "../src/lib/clientJourney";
import type { Lead, FinanceProject } from "../src/types";

const NOW = 2_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "Alfa", status: "won", createdAt: NOW, updatedAt: NOW, ...over });

describe("handoff Klient → Finanse", () => {
  it("draft projektu wypełnia nazwę, klienta i wartość z leada (bez przepisywania firmy)", () => {
    const d = leadToProjectDraft(lead({ value: 4200 }), NOW);
    expect(d.name).toContain("Alfa");
    expect(d.client).toBe("Alfa");
    expect(d.amount).toBe(4200);
    expect(d.status).toBe("w_realizacji");
  });

  it("brak wartości → amount 0 (nic nie zmyślamy)", () => {
    expect(leadToProjectDraft(lead({}), NOW).amount).toBe(0);
  });

  it("nie duplikuje: hasProjectForClient wykrywa istniejący projekt po nazwie klienta", () => {
    const projects: FinanceProject[] = [{ id: "p", name: "X", client: "Alfa", status: "w_realizacji", amount: 100 } as FinanceProject];
    expect(hasProjectForClient(projects, lead({}))).toBe(true);
    expect(hasProjectForClient(projects, lead({ company: "Beta" }))).toBe(false);
  });
});

describe("handoff Finanse → etap klienta (płatność)", () => {
  it("opłacony projekt przesuwa klienta do etapu Klient (domknięte)", () => {
    const unpaid: FinanceProject[] = [{ id: "p", name: "X", client: "Alfa", status: "w_realizacji", amount: 5000 } as FinanceProject];
    const paid: FinanceProject[] = [{ id: "p", name: "X", client: "Alfa", status: "oplacone", amount: 5000, paidAmount: 5000 } as FinanceProject];
    // status leada „contacted" (nie won), więc etap wynika z projektu — dowód, że płatność steruje etapem.
    const l = lead({ status: "contacted" });
    expect(clientJourney(l, unpaid, []).done).toBe(false);
    const after = clientJourney(l, paid, []);
    expect(after.done).toBe(true);
    expect(after.stage).toBe("client");
  });
});
