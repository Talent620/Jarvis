import { describe, it, expect } from "vitest";
import { needsVerification } from "../src/lib/selfVerify";

describe("needsVerification — kiedy warto sprawdzić wynik drugim modelem", () => {
  it("łapie liczenie / logikę / plany / pieniądze", () => {
    for (const t of [
      "oblicz ile to 17 procent z 4200",
      "napisz funkcję sortującą w JavaScript",
      "zaplanuj krok po kroku wejście na rynek",
      "porównaj dwie oferty i powiedz dlaczego",
      "ile dni zostało do terminu 31 grudnia",
    ]) expect(needsVerification(t)).toBe(true);
  });

  it("pomija zwykłą rozmowę / krótkie", () => {
    for (const t of ["cześć, jak leci", "opowiedz dowcip", "dzień dobry", "ok"]) {
      expect(needsVerification(t)).toBe(false);
    }
  });
});
