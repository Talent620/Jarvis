import { describe, it, expect } from "vitest";
import { buildVerifyUser, verifyVerdict, VERIFY_SYSTEM } from "../src/lib/verify";

describe("verify — buildVerifyUser", () => {
  it("zawiera pytanie i odpowiedź do sprawdzenia", () => {
    const u = buildVerifyUser("ile to 2+2", "5");
    expect(u).toMatch(/Pytanie:/);
    expect(u).toMatch(/2\+2/);
    expect(u).toMatch(/Odpowiedź do sprawdzenia:/);
    expect(u).toMatch(/5/);
  });
  it("przycina bardzo długie wejścia", () => {
    const u = buildVerifyUser("p".repeat(9000), "a".repeat(9000));
    expect(u.length).toBeLessThan(11000);
  });
});

describe("verify — verifyVerdict", () => {
  const original = "Wynik to 4.";
  it("OK → bez korekty (zostaje oryginał)", () => {
    expect(verifyVerdict("OK", original)).toEqual({ corrected: false, text: original });
    expect(verifyVerdict("ok, wszystko się zgadza", original).corrected).toBe(false);
  });
  it("potwierdzenia (poprawna/zgadza się/bez błędów) → bez korekty", () => {
    expect(verifyVerdict("Poprawna odpowiedź.", original).corrected).toBe(false);
    expect(verifyVerdict("Zgadza się.", original).corrected).toBe(false);
    expect(verifyVerdict("Bez błędów.", original).corrected).toBe(false);
  });
  it("poprawiona odpowiedź → korekta (zwraca nową treść)", () => {
    const fixed = "Poprawny wynik to 4, nie 5: 2+2=4.";
    expect(verifyVerdict(fixed, "Wynik to 5.")).toEqual({ corrected: true, text: fixed });
  });
  it("regresja: potwierdzenie ze slowem nie NIE jest korekta", () => {
    expect(verifyVerdict("Wszystko poprawne, nic nie trzeba zmieniać.", original).corrected).toBe(false);
    expect(verifyVerdict("Nie ma błędu, odpowiedź jest dobra.", original).corrected).toBe(false);
    expect(verifyVerdict("Wszystko dobrze, nie zmieniam.", original).corrected).toBe(false);
  });
  it("pusty / niepewny werdykt nie zastępuje sensownej odpowiedzi", () => {
    expect(verifyVerdict("", original).corrected).toBe(false);
    const longOrig = "Szczegółowa, poprawna odpowiedź na pytanie o całki i ich własności w analizie.";
    expect(verifyVerdict("nie wiem", longOrig).corrected).toBe(false);
  });
  it("VERIFY_SYSTEM instruuje zwrot OK albo poprawionej odpowiedzi", () => {
    expect(VERIFY_SYSTEM).toMatch(/OK/);
    expect(VERIFY_SYSTEM).toMatch(/POPRAWION/i);
  });
});
