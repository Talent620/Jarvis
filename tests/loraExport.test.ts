import { describe, it, expect } from "vitest";
import { anonymize, buildLoraCorpus, corpusToJsonl } from "../src/lib/loraExport";
import type { Lead } from "../src/types";

const lead = (p: Partial<Lead>): Lead => ({
  id: "1", company: "Firma X", status: "new", createdAt: 0, updatedAt: 0, ...p,
});

describe("loraExport — anonymize (usuwa PII)", () => {
  it("nazwa klienta i miasto → tokeny", () => {
    const out = anonymize("Zajrzałem do Pizza Roma w Krakowie.", { company: "Pizza Roma", location: "Kraków" });
    expect(out).toBe("Zajrzałem do <KLIENT> w <MIASTO>.");
  });
  it("e-mail, www i telefon → tokeny", () => {
    const out = anonymize("Pisz: biuro@roma.pl, roma.pl, tel. +48 600 700 800.");
    expect(out).toContain("<EMAIL>");
    expect(out).toContain("<WWW>");
    expect(out).toContain("<TELEFON>");
    expect(out).not.toContain("600");
    expect(out).not.toContain("biuro@roma.pl");
  });
  it("krótka nazwa (<3 znaki) nie jest podmieniana (uniknij fałszywych trafień)", () => {
    expect(anonymize("AB testuje", { company: "AB" })).toBe("AB testuje");
  });
});

describe("loraExport — buildLoraCorpus", () => {
  it("bierze tylko leady z ofertą/mailem i anonimizuje wyjście", () => {
    const leads = [
      lead({ company: "Salon Ola", niche: "fryzjer", location: "Gdańsk", offer: "Dzień dobry Salon Ola w Gdańsku…" }),
      lead({ company: "Bez Oferty" }), // pominięty — brak offer/intel.email
    ];
    const corpus = buildLoraCorpus(leads);
    expect(corpus).toHaveLength(1);
    expect(corpus[0].instruction).toBe("Napisz krótki cold-mail oferty do firmy z branży: fryzjer.");
    expect(corpus[0].output).toContain("<KLIENT>");
    expect(corpus[0].output).toContain("<MIASTO>");
    expect(corpus[0].output).not.toContain("Salon Ola");
  });

  it("używa intel.email gdy brak offer; instrukcja generyczna bez niszy", () => {
    const leads = [lead({ company: "Dent", intel: { score: 50, email: "Oferta dla Dent.", updatedAt: 0 } })];
    const corpus = buildLoraCorpus(leads);
    expect(corpus[0].instruction).toBe("Napisz krótki cold-mail oferty do lokalnej firmy.");
    expect(corpus[0].output).toBe("Oferta dla <KLIENT>.");
  });

  it("brak strony → kontekst 'brak strony www'", () => {
    const corpus = buildLoraCorpus([lead({ company: "A B C", offer: "x", url: undefined })]);
    expect(corpus[0].input).toContain("brak strony www");
  });
});

describe("loraExport — corpusToJsonl", () => {
  it("jedna linia na przykład, zakończone newline", () => {
    const jsonl = corpusToJsonl([{ instruction: "i", input: "in", output: "o" }]);
    expect(jsonl).toBe('{"instruction":"i","input":"in","output":"o"}\n');
  });
  it("pusty korpus → pusty string", () => {
    expect(corpusToJsonl([])).toBe("");
  });
});
