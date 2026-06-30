import { describe, it, expect } from "vitest";
import { financeKpis, monthlyRevenue, clientRanking, FINANCE_STATUSES } from "../src/lib/finance";
import type { FinanceProject } from "../src/types";

const P = (o: Partial<FinanceProject>): FinanceProject => ({
  id: o.id || "x", name: o.name || "P", status: o.status || "w_realizacji",
  amount: o.amount ?? 0, createdAt: 0, updatedAt: 0, ...o,
});

describe("finance — financeKpis", () => {
  it("liczy przychód, koszt, zysk, marżę, ROI, VAT", () => {
    const k = financeKpis([
      P({ amount: 10000, cost: 4000, vatRate: 23, hours: 50, client: "A", paidAmount: 10000, status: "oplacone" }),
      P({ amount: 5000, cost: 1000, hours: 20, client: "B", paidAmount: 0, status: "oczekuje_platnosci" }),
    ]);
    expect(k.revenue).toBe(15000);
    expect(k.costs).toBe(5000);
    expect(k.profit).toBe(10000);
    expect(k.margin).toBeCloseTo(66.67, 1);
    expect(k.roi).toBe(200);
    expect(k.vat).toBe(2300); // 23% z 10000
    expect(k.paid).toBe(10000);
    expect(k.unpaid).toBe(5000);
    expect(k.clients).toBe(2);
    expect(k.effectiveHourlyRate).toBeCloseTo(15000 / 70, 1);
    expect(k.topClient?.name).toBe("A");
    expect(k.bestProject?.profit).toBe(6000);
  });

  it("anulowane wyłączone z przychodu, liczone osobno", () => {
    const k = financeKpis([P({ amount: 9999, status: "anulowane" }), P({ amount: 100, status: "oplacone" })]);
    expect(k.revenue).toBe(100);
    expect(k.cancelledCount).toBe(1);
  });

  it("LEJEK (lead/oferta/negocjacje) NIE liczy się do przychodu — osobny pipelineValue", () => {
    const k = financeKpis([
      P({ amount: 10000, status: "lead" }),
      P({ amount: 20000, status: "oferta" }),
      P({ amount: 5000, status: "negocjacje" }),
      P({ amount: 8000, cost: 2000, status: "oplacone", paidAmount: 8000 }),
    ]);
    expect(k.revenue).toBe(8000); // tylko opłacony projekt
    expect(k.pipelineValue).toBe(35000); // 10000 + 20000 + 5000
    expect(k.profit).toBe(6000); // 8000 - 2000 (koszt lejka nie wchodzi)
    expect(k.collectedValue).toBe(8000);
  });

  it("contractedValue i invoicedValue rozdzielają realizację od płatności", () => {
    const k = financeKpis([
      P({ amount: 4000, status: "w_realizacji" }),
      P({ amount: 3000, status: "oczekuje_platnosci" }),
      P({ amount: 2000, status: "oplacone", paidAmount: 2000 }),
    ]);
    expect(k.contractedValue).toBe(7000); // w_realizacji + oczekuje_platnosci (nie-zamknięte)
    expect(k.invoicedValue).toBe(5000); // oczekuje_platnosci + oplacone
    expect(k.revenue).toBe(9000); // wszystkie nie-pipeline
  });

  it("monthlyRevenue pomija lejek", () => {
    const now = new Date("2026-06-15").getTime();
    const m = monthlyRevenue([
      P({ amount: 9999, status: "oferta", doneAt: new Date("2026-06-10").getTime() }),
      P({ amount: 1000, status: "oplacone", doneAt: new Date("2026-06-10").getTime() }),
    ], now, 6);
    expect(m[m.length - 1].revenue).toBe(1000); // oferta (lejek) nie wchodzi
  });

  it("pusta lista → zera, bez dzielenia przez 0", () => {
    const k = financeKpis([]);
    expect(k.revenue).toBe(0);
    expect(k.margin).toBe(0);
    expect(k.roi).toBe(0);
    expect(k.effectiveHourlyRate).toBe(0);
    expect(k.topClient).toBeNull();
  });
});

describe("finance — monthlyRevenue + ranking", () => {
  const now = new Date("2026-06-15").getTime();
  it("rozbija przychód na miesiące", () => {
    const m = monthlyRevenue([
      P({ amount: 1000, doneAt: new Date("2026-06-10").getTime(), status: "oplacone" }),
      P({ amount: 500, doneAt: new Date("2026-05-10").getTime(), status: "oplacone" }),
    ], now, 6);
    expect(m).toHaveLength(6);
    expect(m[m.length - 1].revenue).toBe(1000); // bieżący miesiąc
    expect(m[m.length - 2].revenue).toBe(500); // poprzedni
  });
  it("ranking klientów malejąco", () => {
    const r = clientRanking([
      P({ amount: 3000, client: "Duży" }), P({ amount: 1000, client: "Mały" }), P({ amount: 2000, client: "Duży" }),
    ]);
    expect(r[0]).toEqual({ name: "Duży", revenue: 5000, projects: 2 });
    expect(r[1].name).toBe("Mały");
  });
});

describe("finance — statusy", () => {
  it("ma komplet statusów pipeline → koniec", () => {
    expect(FINANCE_STATUSES.find((s) => s.id === "oplacone")).toBeTruthy();
    expect(FINANCE_STATUSES.some((s) => s.group === "pipeline")).toBe(true);
    expect(FINANCE_STATUSES.some((s) => s.group === "koniec")).toBe(true);
  });
});
