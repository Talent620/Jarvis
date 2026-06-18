import { describe, it, expect } from "vitest";
import { safeCalc } from "../src/lib/calc";

describe("safeCalc — bezpieczny ewaluator arytmetyczny (bez Function/eval)", () => {
  it("podstawowa arytmetyka z priorytetami i nawiasami", () => {
    expect(safeCalc("23*1.23+10")).toBeCloseTo(38.29, 5);
    expect(safeCalc("2+3*4")).toBe(14);
    expect(safeCalc("(2+3)*4")).toBe(20);
    expect(safeCalc("240*15/100")).toBe(36); // „15% z 240" po normalizacji
    expect(safeCalc("10/4")).toBe(2.5);
    expect(safeCalc("10%3")).toBe(1);
  });

  it("jednoargumentowy minus/plus", () => {
    expect(safeCalc("-5")).toBe(-5);
    expect(safeCalc("-2*3")).toBe(-6);
    expect(safeCalc("2*-3")).toBe(-6);
    expect(safeCalc("-(2+3)")).toBe(-5);
    expect(safeCalc("+7")).toBe(7);
  });

  it("przecinek jako separator dziesiętny", () => {
    expect(safeCalc("1,5+2,5")).toBe(4);
  });

  it("odrzuca błędne/niebezpieczne wejście", () => {
    expect(safeCalc("")).toBeNull();
    expect(safeCalc("2+")).toBeNull();
    expect(safeCalc("(2+3")).toBeNull();
    expect(safeCalc("2+3)")).toBeNull();
    expect(safeCalc("1.2.3")).toBeNull();
    expect(safeCalc("alert(1)")).toBeNull();   // identyfikatory niedozwolone
    expect(safeCalc("2**3")).toBeNull();        // brak operatora potęgowania
  });

  it("dzielenie przez zero → null (nieskończoność)", () => {
    expect(safeCalc("1/0")).toBeNull();
  });
});
