// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mapOutcome, mapStage, mapLeadStatus, mapSalesOsLead, mergeSnapshotLeads, leadToPublicPayload, leadToOutreachInput, metricsToText, type SalesOsLead } from "../src/lib/salesOs";
import type { Lead } from "../src/types";

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

  const baseLead = (over: Partial<Lead>): Lead => ({
    id: "l1", company: "Dent-Med", status: "new", createdAt: 0, updatedAt: 0, ...over,
  });

  it("leadToPublicPayload rozdziela e-mail od telefonu w polu contact", () => {
    const withEmail = leadToPublicPayload(baseLead({ contact: "biuro@dentmed.pl", url: "dentmed.pl", niche: "stomatolog", location: "Gdańsk" }));
    expect(withEmail.email).toBe("biuro@dentmed.pl");
    expect(withEmail.phone).toBeUndefined();
    expect(withEmail.companyName).toBe("Dent-Med");
    expect(withEmail.website).toBe("dentmed.pl");
    expect(withEmail.industry).toBe("stomatolog");
    expect(withEmail.region).toBe("Gdańsk");
    expect(withEmail.sourceDetail).toBe("JARVIS");

    const withPhone = leadToPublicPayload(baseLead({ contact: "+48 500 100 200" }));
    expect(withPhone.phone).toBe("+48 500 100 200");
    expect(withPhone.email).toBe("");
  });

  it("leadToPublicPayload preferuje pole email nad contact", () => {
    const p = leadToPublicPayload(baseLead({ email: "kontakt@x.pl", contact: "+48 111 222 333" }));
    expect(p.email).toBe("kontakt@x.pl");
    expect(p.phone).toBe("+48 111 222 333");
  });

  it("metricsToText liczy otwarte = total - won - lost i formatuje wartość", () => {
    const txt = metricsToText({ totalLeads: 10, byOutcome: { WON: 3, LOST: 2 }, wonValue: 12000 }, "Northstar");
    expect(txt).toContain("Northstar");
    expect(txt).toContain("10 leadów");
    expect(txt).toContain("otwarte 5");
    expect(txt).toContain("klienci 3");
    expect(txt).toContain("odrzuceni 2");
  });

  it("metricsToText bez metryk zwraca komunikat zastępczy", () => {
    expect(metricsToText(undefined)).toMatch(/Brak metryk/);
  });

  it("mapStage mapuje domyślne etapy lejka Sales OS 1:1", () => {
    expect(mapStage("New")).toBe("new");
    expect(mapStage("Contacted")).toBe("contacted");
    expect(mapStage("Qualified")).toBe("contacted");
    expect(mapStage("Proposal")).toBe("offer");
    expect(mapStage("Negotiation")).toBe("offer");
    expect(mapStage("Won")).toBe("won");
    expect(mapStage("Lost")).toBe("lost");
    expect(mapStage("")).toBeNull();
    expect(mapStage(null)).toBeNull();
    expect(mapStage("Coś dziwnego")).toBeNull();
  });

  it("mapStage rozumie polskie nazwy etapów", () => {
    expect(mapStage("Kontakt")).toBe("contacted");
    expect(mapStage("Oferta")).toBe("offer");
    expect(mapStage("Negocjacje")).toBe("offer");
    expect(mapStage("Wygrany")).toBe("won");
    expect(mapStage("Odrzucony")).toBe("lost");
  });

  it("mapLeadStatus: WON/LOST są definitywne, inaczej decyduje etap", () => {
    expect(mapLeadStatus("WON", "Proposal")).toBe("won");
    expect(mapLeadStatus("LOST", "Negotiation")).toBe("lost");
    expect(mapLeadStatus("OPEN", "Proposal")).toBe("offer");
    expect(mapLeadStatus("OPEN", "Contacted")).toBe("contacted");
    expect(mapLeadStatus("OPEN", null)).toBe("new");
    expect(mapLeadStatus(null, "Negotiation")).toBe("offer");
  });

  it("mapSalesOsLead używa etapu lejka, gdy outcome jest OPEN", () => {
    const lead = mapSalesOsLead({ id: "x", companyName: "ProMax", outcome: "OPEN", stage: "Proposal" });
    expect(lead.status).toBe("offer");
  });

  it("mapSalesOsLead oznacza pochodzenie i zapisuje etap + score w notatce", () => {
    const lead = mapSalesOsLead({ id: "x", companyName: "ProMax", stage: "Qualified", score: 78 });
    expect(lead.origin).toBe("salesos");
    expect(lead.note).toContain("Sales OS");
    expect(lead.note).toContain("Qualified");
    expect(lead.note).toContain("78");
  });

  it("mapSalesOsLead zachowuje crmId (do dwukierunkowej synchronizacji)", () => {
    const lead = mapSalesOsLead({ id: "crm_123", companyName: "ProMax" });
    expect(lead.crmId).toBe("crm_123");
  });

  it("leadToOutreachInput buduje ładunek outreachu z leada (e-mail z contact)", () => {
    const inp = leadToOutreachInput(baseLead({ contact: "biuro@dentmed.pl", url: "dentmed.pl", niche: "stomatolog", location: "Gdańsk", note: "Brak strony www" }), "Oferujemy stronę");
    expect(inp.email).toBe("biuro@dentmed.pl");
    expect(inp.phone).toBeUndefined();
    expect(inp.companyName).toBe("Dent-Med");
    expect(inp.industry).toBe("stomatolog");
    expect(inp.region).toBe("Gdańsk");
    expect(inp.context).toBe("Oferujemy stronę");
    expect(inp.send).toBe(true);
  });

  it("leadToOutreachInput: telefon w contact → phone, context spada na notatkę", () => {
    const inp = leadToOutreachInput(baseLead({ contact: "+48 500 100 200", note: "Brak strony www" }));
    expect(inp.phone).toBe("+48 500 100 200");
    expect(inp.email).toBeUndefined();
    expect(inp.context).toBe("Brak strony www");
  });

  it("mergeSnapshotLeads dodaje nowe leady z CRM-u", () => {
    const leads: Lead[] = [];
    const r = mergeSnapshotLeads(leads, [{ id: "c1", companyName: "Nowa Firma", stage: "New" }], 1000);
    expect(r).toEqual({ added: 1, updated: 0 });
    expect(leads).toHaveLength(1);
    expect(leads[0].crmId).toBe("c1");
  });

  it("mergeSnapshotLeads odświeża istniejący lead z CRM-u (po crmId, mimo zmiany nazwy)", () => {
    const leads: Lead[] = [baseLead({ id: "local1", crmId: "c1", origin: "salesos", company: "Stara Nazwa", status: "new", value: 1000 })];
    const r = mergeSnapshotLeads(leads, [{ id: "c1", companyName: "Stara Nazwa", stage: "Won", outcome: "WON", estimatedValue: 5000 }], 2000);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(1);
    expect(leads[0].status).toBe("won");
    expect(leads[0].value).toBe(5000);
    expect(leads[0].id).toBe("local1"); // id zachowane
  });

  it("mergeSnapshotLeads NIE nadpisuje własnego leada użytkownika o tej samej nazwie", () => {
    const own: Lead = baseLead({ id: "own1", company: "Dent-Med", status: "won", value: 9000 });
    const leads: Lead[] = [own];
    const r = mergeSnapshotLeads(leads, [{ id: "c9", companyName: "Dent-Med", stage: "New", estimatedValue: 100 }], 3000);
    expect(r.updated).toBe(0);
    expect(r.added).toBe(0);
    expect(leads[0].status).toBe("won"); // nietknięte
    expect(leads[0].value).toBe(9000);
    expect(leads[0].origin).toBeUndefined();
  });

  it("mergeSnapshotLeads bez zmian nie liczy aktualizacji", () => {
    const leads: Lead[] = [];
    mergeSnapshotLeads(leads, [{ id: "c1", companyName: "X", stage: "Proposal", estimatedValue: 200 }], 1000);
    const r2 = mergeSnapshotLeads(leads, [{ id: "c1", companyName: "X", stage: "Proposal", estimatedValue: 200 }], 1000);
    expect(r2).toEqual({ added: 0, updated: 0 });
  });
});
