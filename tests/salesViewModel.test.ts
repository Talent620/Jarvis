// === Model widoku sprzedaży (salesViewModel) — testy ===
// Domyślny widok „Do działania" nie pokazuje odrzuconych; główna akcja zależy od danych; Archiwum ma stare dane.
import { describe, it, expect } from "vitest";
import { primaryContactAction, buildSalesRows, leadPhone, leadEmailAddr, DEFAULT_SALES_BUCKET } from "../src/lib/salesViewModel";
import type { Lead } from "../src/types";

const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "Firma", status: "new", createdAt: 1, updatedAt: 1, ...over });

describe("salesViewModel — główna akcja z danych", () => {
  it("telefon → Zadzwoń; sam e-mail → Napisz; brak → Znajdź kontakt", () => {
    expect(primaryContactAction(lead({ contact: "600 100 200" })).kind).toBe("call");
    expect(primaryContactAction(lead({ email: "a@b.pl" })).kind).toBe("email");
    expect(primaryContactAction(lead({ contact: "a@b.pl" })).kind).toBe("email"); // contact z @ = e-mail
    expect(primaryContactAction(lead({})).kind).toBe("find");
  });
  it("telefon ma pierwszeństwo, nawet gdy jest też e-mail", () => {
    expect(primaryContactAction(lead({ contact: "600100200", email: "a@b.pl" })).kind).toBe("call");
  });
  it("leadPhone/leadEmailAddr wyłuskują właściwe pola", () => {
    expect(leadPhone(lead({ contact: "600 100 200" }))).toBe("600100200");
    expect(leadPhone(lead({ contact: "a@b.pl" }))).toBe("");
    expect(leadEmailAddr(lead({ email: "x@y.pl" }))).toBe("x@y.pl");
  });
});

describe("salesViewModel — domyślny widok bez odrzuconych", () => {
  const leads = [lead({ id: "a", status: "new" }), lead({ id: "b", status: "lost" }), lead({ id: "c", status: "won" }), lead({ id: "d", status: "offer" })];

  it("domyślny kubełek to Do działania i NIE zawiera odrzuconych (lost)", () => {
    expect(DEFAULT_SALES_BUCKET).toBe("actionable");
    const rows = buildSalesRows(leads);
    expect(rows.map((r) => r.lead.id).sort()).toEqual(["a", "d"]);
    expect(rows.some((r) => r.lead.status === "lost")).toBe(false);
  });

  it("Archiwum nadal zawiera stare odrzucone dane", () => {
    const rows = buildSalesRows(leads, "archive");
    expect(rows.map((r) => r.lead.id)).toEqual(["b"]);
  });
});
