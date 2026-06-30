import { describe, it, expect } from "vitest";
import { buildSentIndex, wasLeadEmailed } from "../src/lib/mailer";

// Perf O(n²)→O(n+m): „już mailowany" przez indeks Set. Zachowanie IDENTYCZNE z dawnym
// dopasowaniem (firma LUB adres, case/trim-insensitive).

describe("mailer — buildSentIndex / wasLeadEmailed", () => {
  const sent = [
    { company: "  Auto Serwis ", to: "Biuro@Firma.PL" },
    { company: "Pizza Roma", to: "" },
    { company: "", to: "kontakt@x.pl" },
  ];
  const idx = buildSentIndex(sent);

  it("indeks normalizuje (trim + lowercase) firmy i adresy", () => {
    expect(idx.companies.has("auto serwis")).toBe(true);
    expect(idx.companies.has("pizza roma")).toBe(true);
    expect(idx.addresses.has("biuro@firma.pl")).toBe(true);
    expect(idx.addresses.has("kontakt@x.pl")).toBe(true);
    expect(idx.companies.has("")).toBe(false); // puste pomijane
  });

  it("dopasowuje po FIRMIE (niezależnie od wielkości liter/spacji)", () => {
    expect(wasLeadEmailed(idx, "auto serwis", "")).toBe(true);
    expect(wasLeadEmailed(idx, "  AUTO SERWIS  ", "inny@mail.pl")).toBe(true);
  });

  it("dopasowuje po ADRESIE", () => {
    expect(wasLeadEmailed(idx, "Zupełnie Inna Firma", "BIURO@firma.pl")).toBe(true);
    expect(wasLeadEmailed(idx, "", "kontakt@x.pl")).toBe(true);
  });

  it("nowy lead (brak w indeksie) → false", () => {
    expect(wasLeadEmailed(idx, "Nowa Firma", "nowy@adres.pl")).toBe(false);
    expect(wasLeadEmailed(idx, "", "")).toBe(false);
  });

  it("pusty sentBox → nic nie dopasowane", () => {
    const empty = buildSentIndex([]);
    expect(wasLeadEmailed(empty, "X", "x@x.pl")).toBe(false);
  });

  it("równoważność ze starym skanem na losowych danych (regresja zachowania)", () => {
    const box = Array.from({ length: 50 }, (_, i) => ({ company: `Firma ${i}`, to: `f${i}@x.pl` }));
    const index = buildSentIndex(box);
    const old = (company: string, email: string) => {
      const c = company.trim().toLowerCase(), e = email.trim().toLowerCase();
      return box.some((m) => (!!c && (m.company || "").trim().toLowerCase() === c) || (!!e && (m.to || "").trim().toLowerCase() === e));
    };
    for (const [c, e] of [["Firma 7", ""], ["", "f12@x.pl"], ["Brak", "brak@x.pl"], ["FIRMA 3", "x@y.pl"]] as [string, string][]) {
      expect(wasLeadEmailed(index, c, e)).toBe(old(c, e));
    }
  });
});
