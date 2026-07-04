// === Walidator strony (siteValidator) — testy ===
// Pobranie jest blokowane albo jawnie ostrzegane przy błędach krytycznych. Wykrywamy: martwą
// kotwicę, fałszywy formularz, duplikaty ID, javascript: URL i ucięty dokument.
import { describe, it, expect } from "vitest";
import { validateSite, validationVerdict } from "../src/lib/siteValidator";

const wrap = (body: string, close = true) => `<!DOCTYPE html><html><head><title>x</title></head><body>${body}</body>${close ? "</html>" : ""}`;

describe("siteValidator — błędy krytyczne blokują pobranie", () => {
  it("ucięty dokument (brak </html>) → critical, nie wolno pobrać", () => {
    const v = validateSite(`<!DOCTYPE html><html><body><h1>Cześć</h1>`);
    expect(v.truncated).toBe(true);
    expect(v.safeToDownload).toBe(false);
    expect(v.issues.some((i) => i.code === "truncated" && i.severity === "critical")).toBe(true);
  });

  it("javascript: URL → critical", () => {
    const v = validateSite(wrap(`<a href="javascript:alert(1)">klik</a>`));
    expect(v.issues.some((i) => i.code === "js_url")).toBe(true);
    expect(v.safeToDownload).toBe(false);
  });

  it("formularz bez endpointu pokazujacy status wyslano → fałszywy sukces (critical)", () => {
    const v = validateSite(wrap(`<form><input name="email"><button>Wyślij</button></form><div>Wiadomość wysłana!</div>`));
    expect(v.issues.some((i) => i.code === "fake_form")).toBe(true);
    expect(v.safeToDownload).toBe(false);
  });
});

describe("siteValidator — ostrzeżenia (pobranie dozwolone)", () => {
  it("duplikaty ID → warning", () => {
    const v = validateSite(wrap(`<div id="a"></div><div id="a"></div>`));
    expect(v.issues.some((i) => i.code === "dup_id")).toBe(true);
    expect(v.safeToDownload).toBe(true);
  });

  it("martwa kotwica (#brak) → warning", () => {
    const v = validateSite(wrap(`<a href="#kontakt">Kontakt</a><div id="oferta"></div>`));
    expect(v.issues.some((i) => i.code === "dead_anchor")).toBe(true);
  });

  it("obraz bez alt → warning dostępności", () => {
    const v = validateSite(wrap(`<img src="x.jpg">`));
    expect(v.issues.some((i) => i.code === "img_no_alt")).toBe(true);
  });

  it("formularz bez endpointu (bez fałszywego statusu wyslano) → tylko info demonstracyjny", () => {
    const v = validateSite(wrap(`<form><input name="email"><button>Wyślij</button></form>`));
    expect(v.issues.some((i) => i.code === "demo_form")).toBe(true);
    expect(v.issues.some((i) => i.code === "fake_form")).toBe(false);
    expect(v.safeToDownload).toBe(true);
  });
});

describe("siteValidator — wyniki i werdykt", () => {
  it("czysta strona → brak krytycznych, werdykt OK", () => {
    const v = validateSite(wrap(`<h1>Alfa</h1><a href="#o"></a><div id="o"></div><img src="a.jpg" alt="a">`));
    expect(v.safeToDownload).toBe(true);
    expect(validationVerdict(v)).toMatch(/✅|poprawić/);
  });

  it("werdykt blokuje przy krytycznych", () => {
    const v = validateSite(`<!DOCTYPE html><html><body>ucięte`);
    expect(validationVerdict(v)).toMatch(/Nie pobieraj/);
    expect(v.scores.integrity).toBeLessThan(100);
  });
});
