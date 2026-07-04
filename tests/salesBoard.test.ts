import { describe, it, expect } from "vitest";
import { boardColumns, stageMoveNote, stageLabelOf } from "../src/lib/salesBoard";
import { PIPELINE_STAGES } from "../src/lib/clientRecord";
import type { Lead } from "../src/types";

// Tablica lejka: czyste grupowanie w kolumny etapów + sumy wartości.

const lead = (status: Lead["status"], value?: number): Lead =>
  ({ id: Math.random().toString(36).slice(2), company: "F", status, value, createdAt: 0, updatedAt: 0 } as Lead);

describe("boardColumns — kolumny etapów lejka", () => {
  it("kolejność kolumn = PIPELINE_STAGES; każdy etap ma swoją kolumnę", () => {
    const cols = boardColumns([]);
    expect(cols.map((c) => c.stage.id)).toEqual(PIPELINE_STAGES.map((s) => s.id));
    expect(cols.every((c) => c.leads.length === 0 && c.total === 0)).toBe(true);
  });
  it("grupuje leady wg statusu i sumuje wartość per kolumna", () => {
    const cols = boardColumns([lead("new", 1000), lead("new", 500), lead("offer", 8000), lead("won", 12000), lead("lost", 9000)]);
    const by = (id: string) => cols.find((c) => c.stage.id === id)!;
    expect(by("new").leads).toHaveLength(2);
    expect(by("new").total).toBe(1500);
    expect(by("offer").total).toBe(8000);
    expect(by("won").total).toBe(12000);
    expect(by("lost").leads).toHaveLength(1);
  });
  it("leady bez wartości nie psują sumy (traktowane jak 0)", () => {
    expect(boardColumns([lead("new"), lead("new", 300)]).find((c) => c.stage.id === "new")!.total).toBe(300);
  });
});

describe("pomocnicze", () => {
  it("stageMoveNote zawiera etykietę docelową", () => {
    expect(stageMoveNote("Oferta")).toContain("Oferta");
    expect(stageMoveNote("Oferta")).toMatch(/Etap zmieniony/);
  });
  it("stageLabelOf mapuje id → etykieta", () => {
    expect(stageLabelOf("offer")).toBe("Oferta");
    expect(stageLabelOf("won")).toBe("Klient");
  });
});
