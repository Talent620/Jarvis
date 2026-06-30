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
    // zmiana statusu na opłacone
    const upd = await runTool("finance_set_status", { name: "Test E2E", status: "oplacone" });
    expect(upd).toContain("Test E2E");
  });
});
