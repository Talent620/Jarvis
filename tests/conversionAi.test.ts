import { describe, it, expect } from "vitest";
import { conversionAudit, ctaCount, conversionFixInstruction } from "../src/lib/conversionAi";

const STRONG = `<!doctype html><html lang="pl"><body>
  <h1>Zdobądź więcej klientów dzięki nowej stronie</h1>
  <a href="#kontakt">Umów bezpłatną wycenę</a>
  <section>Opinie klientów: 250+ zadowolonych firm, gwarancja zwrotu, RODO.
    Dzięki temu zyskasz więcej zapytań. ★★★★★</section>
  <section>Cennik: pakiety od 1900 zł.</section>
  <details>FAQ — często zadawane pytania</details>
  <form><input type="email"></form>
  <footer><a href="tel:123">Zadzwoń</a> kontakt@firma.pl <a href="#start">Zacznij teraz</a></footer>
</body></html>`;

const WEAK = `<!doctype html><html><body>
  <h1>Firma</h1><p>Tworzymy strony internetowe.</p><div>Oferujemy usługi.</div>
</body></html>`;

describe("ctaCount — realne CTA (przyciski/linki ze słowem akcji)", () => {
  it("liczy tylko elementy z czasownikiem akcji", () => {
    expect(ctaCount(STRONG)).toBeGreaterThanOrEqual(2);
    expect(ctaCount('<a href="#">O nas</a>')).toBe(0);
  });
});

describe("conversionAudit — scoring CRO", () => {
  it("mocna strona sprzedażowa → wysoki wynik i ocena A/B", () => {
    const a = conversionAudit(STRONG);
    expect(a.score).toBeGreaterThanOrEqual(80);
    expect(["A", "B"]).toContain(a.grade);
    expect(a.checks.find((c) => c.area === "Dowód społeczny (opinie/logo)")?.ok).toBe(true);
  });

  it("uboga strona → niski wynik i priorytetowy plan poprawy", () => {
    const a = conversionAudit(WEAK);
    expect(a.score).toBeLessThan(40);
    expect(a.grade).toBe("D");
    expect(a.topFixes.length).toBeGreaterThan(0);
    // Najcięższe braki (waga 3) na górze planu — np. CTA / dowód społeczny / lead capture.
    expect(a.topFixes.join(" ")).toMatch(/CTA|przycisk|opinie|formularz|H1|korzy/i);
  });

  it("pusty HTML nie wywala się", () => {
    expect(() => conversionAudit("")).not.toThrow();
    expect(conversionAudit("").score).toBe(0);
  });
});

describe("conversionFixInstruction — plan dla generatora", () => {
  it("składa instrukcję z braków audytu", () => {
    const ins = conversionFixInstruction(conversionAudit(WEAK));
    expect(ins).toMatch(/CRO|konwersj/i);
    expect(ins).toMatch(/•/);
  });
});
