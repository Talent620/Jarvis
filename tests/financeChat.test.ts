import { describe, it, expect } from "vitest";
import { financeSummaryText, financeKpis } from "../src/lib/finance";
import type { FinanceProject } from "../src/types";

const mk = (over: Partial<FinanceProject>): FinanceProject => ({
  id: Math.random().toString(36).slice(2),
  name: "Projekt",
  status: "lead",
  amount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("financeSummaryText — czyste podsumowanie do czatu", () => {
  it("pusta lista → podpowiedź jak dodać projekt", () => {
    expect(financeSummaryText([])).toContain("Brak projektów");
    expect(financeSummaryText(undefined as unknown as FinanceProject[])).toContain("Brak projektów");
  });

  it("liczy przychód, zysk i wymienia najlepszego klienta", () => {
    const projects = [
      mk({ name: "Sklep", client: "Firma A", amount: 8000, cost: 2000, status: "oplacone", paidAmount: 8000 }),
      mk({ name: "Strona", client: "Firma B", amount: 5000, cost: 1000, status: "w_realizacji" }),
    ];
    const txt = financeSummaryText(projects);
    expect(txt).toContain("13"); // 8000 + 5000 = 13 000 przychodu
    expect(txt).toContain("Firma A");
    expect(txt).toContain("zł");
    // spójność z silnikiem KPI
    const k = financeKpis(projects);
    expect(k.revenue).toBe(13000);
    expect(k.profit).toBe(10000);
  });
});

describe("narzędzia finansowe zarejestrowane w czacie", () => {
  it("finance_add_project, finance_set_status, finance_summary są w toolDefs", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const names = toolDefs.map((d) => d.name);
    expect(names).toContain("finance_add_project");
    expect(names).toContain("finance_set_status");
    expect(names).toContain("finance_summary");
  });

  it("finance_add_project wymaga nazwy i kwoty", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const def = toolDefs.find((d) => d.name === "finance_add_project")!;
    expect(def.input_schema.required).toContain("name");
    expect(def.input_schema.required).toContain("amount");
  });
});

describe("finance_add_project + finance_summary (integracja ze store przez runTool)", () => {
  it("dodaje projekt i widać go w podsumowaniu", async () => {
    const { runTool } = await import("../src/lib/tools");
    const res = await runTool("finance_add_project", { name: "Test E2E", amount: 4321, client: "Klient Z" });
    expect(res).toContain("Test E2E");
    const sum = await runTool("finance_summary", {});
    expect(sum).toContain("zł");
    // zmiana statusu na opłacone WYMAGA realnej kwoty wpłaty (paid_amount) — patrz opis niżej.
    const upd = await runTool("finance_set_status", { name: "Test E2E", status: "oplacone", paid_amount: 4321 });
    expect(upd).toContain("Test E2E");
  });
});

// Bug-fix: finance_set_status(status="oplacone") wcześniej ZAWSZE ustawiał paidAmount = amount,
// bez pytania o realną kwotę — inaczej niż UI (FinancialDashboard.setStatus), które wymusza
// window.prompt() i przechodzi przez applyPayment() (nigdy nie zakłada 100% samodzielnie).
// Narzędzie czatu/głosu musi mieć TĘ SAMĄ ochronę, żeby nie zawyżać przychodu bez dowodu.
describe("finance_set_status(oplacone) — wymaga realnej kwoty (parytet z UI/applyPayment)", () => {
  it("BEZ paid_amount: odmawia i NIE zmienia statusu (nie zgaduje pełnej kwoty)", async () => {
    const { runTool } = await import("../src/lib/tools");
    await runTool("finance_add_project", { name: "Bez Kwoty", amount: 5000 });
    const res = await runTool("finance_set_status", { name: "Bez Kwoty", status: "oplacone" });
    expect(res).not.toContain("✅");
    expect(res.toLowerCase()).toContain("kwot");
    const sum = await runTool("finance_summary", {});
    expect(sum).not.toContain("Brak projektów"); // projekt nadal istnieje, tylko nieopłacony
  });

  it("z pełną paid_amount: status → oplacone (jak applyPayment)", async () => {
    const { runTool } = await import("../src/lib/tools");
    await runTool("finance_add_project", { name: "Pełna Kwota", amount: 3000 });
    const res = await runTool("finance_set_status", { name: "Pełna Kwota", status: "oplacone", paid_amount: 3000 });
    expect(res).toContain("Pełna Kwota");
    expect(res.toLowerCase()).toMatch(/opłac/);
  });

  it("z CZĘŚCIOWĄ paid_amount: NIE przeskakuje do oplacone — zostaje częściowa wpłata (jak UI)", async () => {
    const { runTool } = await import("../src/lib/tools");
    await runTool("finance_add_project", { name: "Częściowa Kwota", amount: 10000 });
    const res = await runTool("finance_set_status", { name: "Częściowa Kwota", status: "oplacone", paid_amount: 2000 });
    expect(res).toContain("Częściowa Kwota");
    expect(res.toLowerCase()).not.toMatch(/→ status opłacon/); // to nie jest pełna zapłata
  });

  it("status inny niż oplacone (np. w_realizacji) nie wymaga paid_amount", async () => {
    const { runTool } = await import("../src/lib/tools");
    await runTool("finance_add_project", { name: "W Realizacji Test", amount: 1000 });
    const res = await runTool("finance_set_status", { name: "W Realizacji Test", status: "w_realizacji" });
    expect(res).toContain("W Realizacji Test");
    expect(res).toContain("✅");
  });
});
