import { describe, it, expect } from "vitest";
import {
  clientRecord, pipelineProgress, stageLabel, PIPELINE_STAGES,
  normalizeTag, normalizeTags, addTag, removeTag, suggestedTags,
} from "../src/lib/clientRecord";
import type { Lead, SentMail, FinanceProject } from "../src/types";

// Panel Klienta (CRM): rekord składany z ISTNIEJĄCYCH źródeł. Testy pilnują uczciwości
// (puste pola puste, kanały poprawnie wyłuskane) i higieny etykiet (bez duplikatów/pustych).

const NOW = new Date(2026, 6, 3, 12, 0, 0).getTime();
const mkLead = (o: Partial<Lead> = {}): Lead => ({
  id: "L1", company: "Stolarnia Dąb", status: "offer", email: "biuro@dab.pl", contact: "+48 500 100 200",
  url: "https://dab.pl", address: "ul. Leśna 1, Poznań", niche: "stolarz", location: "Poznań",
  value: 8000, createdAt: NOW - 10 * 86400_000, updatedAt: NOW,
  notes: [{ at: NOW - 2 * 86400_000, text: "Wstępnie zainteresowany schodami." }], ...o,
} as Lead);

describe("lejek sprzedaży (pipeline)", () => {
  it("etapy mają rosnący postęp; won=1, lost=0", () => {
    expect(pipelineProgress("new")).toBeLessThan(pipelineProgress("contacted"));
    expect(pipelineProgress("contacted")).toBeLessThan(pipelineProgress("offer"));
    expect(pipelineProgress("won")).toBe(1);
    expect(pipelineProgress("lost")).toBe(0);
    expect(stageLabel("offer")).toBe("Oferta");
    expect(PIPELINE_STAGES.filter((s) => s.open).map((s) => s.id)).toEqual(["new", "contacted", "offer"]);
  });
});

describe("clientRecord — kompletny rekord z uczciwych źródeł", () => {
  it("wyłuskuje kanały: e-mail, telefon, www, adres; etap i postęp", () => {
    const r = clientRecord(mkLead(), [], [], NOW);
    expect(r.email).toBe("biuro@dab.pl");
    expect(r.phone).toBe("+48 500 100 200");
    expect(r.url).toBe("https://dab.pl");
    expect(r.address).toContain("Poznań");
    expect(r.stageLabel).toBe("Oferta");
    expect(r.progress).toBeCloseTo(0.7);
  });
  it("telefon z pola contact TYLKO gdy nie jest e-mailem; brak → undefined", () => {
    expect(clientRecord(mkLead({ contact: "kontakt@x.pl", email: "" }), [], [], NOW).phone).toBeUndefined();
    expect(clientRecord(mkLead({ contact: "kontakt@x.pl", email: "" }), [], [], NOW).email).toBe("kontakt@x.pl");
  });
  it("łączy kartę i oś czasu (maile + finanse) z istniejących danych", () => {
    const mail: SentMail = { id: "m", to: "biuro@dab.pl", subject: "Oferta schodów", company: "Stolarnia Dąb", via: "SMTP", at: NOW - 86400_000 } as SentMail;
    const fin: FinanceProject = { id: "f", name: "Schody", leadId: "L1", status: "w_realizacji", amount: 8000, createdAt: NOW - 3 * 86400_000, updatedAt: NOW } as FinanceProject;
    const r = clientRecord(mkLead(), [mail], [fin], NOW);
    expect(r.card.emailCount).toBe(1);
    expect(r.card.financeTotal).toBe(8000);
    expect(r.timeline.some((e) => e.kind === "email")).toBe(true);
    expect(r.timeline.some((e) => e.kind === "finance")).toBe(true);
    expect(r.timeline.some((e) => e.kind === "note")).toBe(true);
  });
  it("flagi zgodności kontaktu przenoszą się do rekordu", () => {
    const r = clientRecord(mkLead({ doNotContact: true, optOut: true }), [], [], NOW);
    expect(r.doNotContact).toBe(true);
    expect(r.optOut).toBe(true);
  });
});

describe("etykiety/segmenty — higiena danych", () => {
  it("normalizacja: trim, zbite spacje, limit długości", () => {
    expect(normalizeTag("  gorący   lead  ")).toBe("gorący lead");
    expect(normalizeTag("x".repeat(50)).length).toBe(30);
  });
  it("normalizeTags usuwa puste i duplikaty (case-insensitive), max 12", () => {
    expect(normalizeTags(["VIP", "vip", " VIP ", "", "polecenie"])).toEqual(["VIP", "polecenie"]);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length).toBe(12);
  });
  it("addTag idempotentnie (case-insensitive); removeTag usuwa", () => {
    let t = addTag([], "Gorący");
    t = addTag(t, "gorący"); // duplikat — bez zmian
    expect(t).toEqual(["Gorący"]);
    t = addTag(t, "VIP");
    expect(t).toEqual(["Gorący", "VIP"]);
    expect(removeTag(t, "gorący")).toEqual(["VIP"]);
  });
  it("suggestedTags: z niszy/lokalizacji + kanoniczne, bez już posiadanych", () => {
    const s = suggestedTags({ niche: "stolarz", location: "Poznań", tags: ["VIP"] });
    expect(s).toContain("stolarz");
    expect(s).toContain("Poznań");
    expect(s.map((x) => x.toLowerCase())).not.toContain("vip"); // już ma
    expect(s.length).toBeLessThanOrEqual(6);
  });
});
