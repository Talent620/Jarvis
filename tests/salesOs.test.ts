// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mapOutcome, mapSalesOsLead, type SalesOsLead } from "../src/lib/salesOs";

describe("Łącznik AI Sales OS — mapowanie", () => {
  it("mapOutcome tłumaczy statusy Sales OS na statusy JARVIS-a", () => {
    expect(mapOutcome("WON")).toBe("won");
    expect(mapOutcome("LOST")).toBe("lost");
    expect(mapOutcome("DISQUALIFIED")).toBe("lost");
    expect(mapOutcome("IN_PROGRESS")).toBe("contacted");
    expect(mapOutcome("CONTACTED")).toBe("contacted");
    expect(mapOutcome("OPEN")).toBe("new");
    expect(mapOutcome(null)).toBe("new");
    expect(mapOutcome(undefined)).toBe("new");
  });

  it("mapSalesOsLead mapuje pola firmy/kontaktu/wartości", () => {
    const src: SalesOsLead = {
      id: "abc",
      name: "Anna Kowalska",
      email: "anna@dentmed.pl",
      phone: "+48 500 100 200",
      companyName: "Dent-Med",
      website: "https://dentmed.pl",
      industry: "stomatolog",
      region: "Gdańsk",
      outcome: "WON",
      estimatedValue: 4200,
      stage: "Oferta",
      updatedAt: "2026-01-02T10:00:00.000Z",
      createdAt: "2026-01-01T10:00:00.000Z",
    };
    const lead = mapSalesOsLead(src, 1700000000000);
    expect(lead.company).toBe("Dent-Med");
    expect(lead.email).toBe("anna@dentmed.pl");
    expect(lead.contact).toBe("+48 500 100 200");
    expect(lead.url).toBe("https://dentmed.pl");
    expect(lead.niche).toBe("stomatolog");
    expect(lead.location).toBe("Gdańsk");
    expect(lead.value).toBe(4200);
    expect(lead.status).toBe("won");
    expect(lead.createdAt).toBe(Date.parse("2026-01-01T10:00:00.000Z"));
  });

  it("mapSalesOsLead ma rozsądne wartości domyślne (brak firmy → name, brak dat → now)", () => {
    const now = 1700000000000;
    const lead = mapSalesOsLead({ id: "x", name: "Jan Bez Firmy" }, now);
    expect(lead.company).toBe("Jan Bez Firmy");
    expect(lead.status).toBe("new");
    expect(lead.createdAt).toBe(now);
    expect(lead.updatedAt).toBe(now);
  });

  it("mapSalesOsLead bez kontaktu i bez firmy nie wybucha", () => {
    const lead = mapSalesOsLead({ id: "x" });
    expect(lead.company).toBe("Bez nazwy");
    expect(lead.contact).toBeUndefined();
    expect(lead.value).toBeUndefined();
  });
});
