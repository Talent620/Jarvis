import { describe, it, expect } from "vitest";
import { scoreDeliverability, deliverabilityLabel } from "../src/lib/emailDeliverability";

describe("scoreDeliverability — ryzyko spamu / jakość zimnego maila", () => {
  it("dobry, spersonalizowany, krótki mail z pytaniem → niskie ryzyko", () => {
    const r = scoreDeliverability(
      "Pytanie o stronę Państwa kawiarni",
      "Dzień dobry, zauważyłem na stronie Państwa kawiarni, że brakuje menu na mobile. Mogę to poprawić w jeden dzień. Czy mogę przesłać krótką propozycję?",
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.risk).toBe("low");
  });

  it("spamowy mail (CAPS, słowa-wyzwalacze, wykrzykniki, linki) → wysokie ryzyko + poprawki", () => {
    const r = scoreDeliverability(
      "DARMOWA PROMOCJA WYGRAJ TERAZ!!!",
      "Kliknij tutaj gratis oferta specjalna bez ryzyka!!! http://a.pl http://b.pl http://c.pl kup teraz okazja",
    );
    expect(r.score).toBeLessThan(55);
    expect(r.risk).toBe("high");
    expect(r.issues.length).toBeGreaterThan(2);
    expect(r.fixes.length).toBeGreaterThan(0);
  });

  it("brak tematu i pustej treści → mocno karane", () => {
    const r = scoreDeliverability("", "");
    expect(r.score).toBeLessThan(55);
    expect(r.issues).toContain("Brak tematu.");
  });

  it("brak personalizacji i CTA obniża wynik", () => {
    const r = scoreDeliverability("Współpraca", "Oferujemy usługi tworzenia stron internetowych dla biznesu. Zapraszamy do kontaktu w tej sprawie zawsze i wszędzie bardzo chętnie dziękujemy.");
    expect(r.issues.some((i) => /personalizacj/i.test(i))).toBe(true);
    expect(r.issues.some((i) => /CTA/i.test(i))).toBe(true);
  });

  it("deliverabilityLabel — czytelna etykieta", () => {
    expect(deliverabilityLabel(scoreDeliverability("Pytanie o stronę firmy", "Widzę u was brak formularza, mogę pomóc — czy mogę przesłać szczegóły dotyczące tej propozycji?"))).toMatch(/Dostarczalność: \d+\/100/);
  });
});
