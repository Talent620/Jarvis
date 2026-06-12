// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseSiteHtml, auditWeakPoints, scoreLead, scoreLabel, splitSections } from "../src/lib/leadIntel";
import { gcalEventUrl, gmailComposeUrl, splitOffer } from "../src/lib/glinks";

describe("teczka klienta — audyt strony (czyste funkcje)", () => {
  const GOOD = `<html><head><title>Salon Ola — fryzjer Kraków</title>
    <meta name="viewport" content="width=device-width">
    <meta name="description" content="Najlepszy salon fryzjerski w Krakowie, umów wizytę online.">
    <meta property="og:title" content="Salon Ola">
    </head><body><h1>Salon Ola</h1><a href="tel:+48600100200">Zadzwoń</a>
    <a href="https://facebook.com/salonola">FB</a></body></html>`;

  it("parseSiteHtml wykrywa sygnały jakości", () => {
    const a = parseSiteHtml(GOOD, "https://salonola.pl");
    expect(a.ok).toBe(true);
    expect(a.https).toBe(true);
    expect(a.viewport).toBe(true);
    expect(a.title).toContain("Salon Ola");
    expect(a.metaDesc).toBe(true);
    expect(a.h1).toBe(true);
    expect(a.og).toBe(true);
    expect(a.contact).toBe(true);
    expect(a.socials).toContain("facebook");
  });

  it("parseSiteHtml: słaba strona → braki wykryte", () => {
    const a = parseSiteHtml("<html><body>witamy</body></html>", "http://stara.pl");
    expect(a.https).toBe(false);
    expect(a.viewport).toBe(false);
    expect(a.metaDesc).toBe(false);
    expect(a.h1).toBe(false);
  });

  it("auditWeakPoints: brak strony = jeden najmocniejszy punkt", () => {
    const w = auditWeakPoints(undefined, false);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/BRAK STRONY/);
  });

  it("auditWeakPoints: słaba strona → konkretna lista problemów", () => {
    const a = parseSiteHtml("<html><body>x</body></html>", "http://stara.pl");
    const w = auditWeakPoints(a, true);
    expect(w.length).toBeGreaterThanOrEqual(4);
    expect(w.join(" ")).toMatch(/HTTPS/);
    expect(w.join(" ")).toMatch(/mobiln/);
  });
});

describe("scoring leadów", () => {
  it("brak strony + telefon = gorący lead", () => {
    const s = scoreLead({ url: undefined, contact: "+48 600 100 200" });
    expect(s).toBeGreaterThanOrEqual(75);
    expect(scoreLabel(s).label).toBe("gorący");
  });

  it("dobra strona = chłodny lead", () => {
    const a = parseSiteHtml(`<html><head><title>Firma profesjonalna</title><meta name="viewport"><meta name="description" content="Opis dłuższy niż dwadzieścia znaków."><meta property="og:x"></head><body><h1>x</h1><a href="tel:1">t</a><a href="https://instagram.com/x">i</a></body></html>`, "https://firma.pl");
    const s = scoreLead({ url: "https://firma.pl" }, a);
    expect(s).toBeLessThan(75);
  });

  it("strona istnieje ale słaba → cieplej niż dobra", () => {
    const bad = parseSiteHtml("<html><body>x</body></html>", "http://stara.pl");
    const sBad = scoreLead({ url: "http://stara.pl", contact: "600100200" }, bad);
    expect(sBad).toBeGreaterThanOrEqual(50);
  });
});

describe("parsowanie odpowiedzi AI (sekcje teczki)", () => {
  it("rozbija na analizę / e-mail / rozmowę", () => {
    const t = "=== ANALIZA ===\nSłabe punkty...\n=== EMAIL ===\nTemat: Strona\nDzień dobry...\n=== ROZMOWA ===\nOtwarcie: ...";
    const s = splitSections(t);
    expect(s.analysis).toContain("Słabe punkty");
    expect(s.email).toContain("Temat: Strona");
    expect(s.callScript).toContain("Otwarcie");
  });

  it("model bez formatu → wszystko trafia do analizy (nic nie ginie)", () => {
    const s = splitSections("Po prostu tekst bez znaczników.");
    expect(s.analysis).toBe("Po prostu tekst bez znaczników.");
    expect(s.email).toBe("");
  });
});

describe("integracja Google (linki bez klucza)", () => {
  it("gmailComposeUrl buduje poprawny adres", () => {
    const u = gmailComposeUrl("a@b.pl", "Oferta", "Treść");
    expect(u).toContain("mail.google.com");
    expect(u).toContain("to=a%40b.pl");
    expect(u).toContain("su=Oferta");
  });

  it("gcalEventUrl: wydarzenie całodniowe z poprawnym końcem (dzień+1)", () => {
    const u = gcalEventUrl("Zadzwonić do klienta", "Odpowiada: Marek", "2026-06-15");
    expect(u).toContain("calendar.google.com");
    expect(u).toContain("dates=20260615%2F20260616");
  });

  it("splitOffer wyciąga temat z pierwszej linii", () => {
    const { subject, body } = splitOffer("Temat: Nowa strona\nDzień dobry, zauważyłem…", "X");
    expect(subject).toBe("Nowa strona");
    expect(body).toMatch(/^Dzień dobry/);
  });
});
