// === E2E: od firmy do przychodu przez PRAWDZIWY koordynator (growthOrganism) ===
// Test wywołuje DOKŁADNIE ten koordynator, którego używa aplikacja (runGrowthFlow / runGrowthFlowOnStore),
// a nie ręcznie sklejone funkcje. Mockujemy tylko wejścia sieciowe (surowy kandydat, gotowy HTML/oferta).
// Sprawdzamy: zmiany realnego store, blokadę bez zgody, SIMULATED vs PUBLISHED_CONFIRMED, S9 (CSS 3D)
// oraz przejście głosem (ta sama decyzja co tekst). Zero operacji zewnętrznych, zero płatnego API.
import { describe, it, expect } from "vitest";
import { runGrowthFlow, runGrowthFlowOnStore, type GrowthFlowInput } from "../src/lib/growthFlowCoordinator";
import type { RawLead } from "../src/lib/leads";
import type { CampaignPlan } from "../src/lib/campaignEngine";
import { voiceCognition, parseVoiceGoalCommand } from "../src/lib/voiceCognition";
import { classifyCognitionLocal } from "../src/lib/cognitiveController";
import { scoreLead, signalsFromLead } from "../src/lib/leadScoring";
import type { Lead } from "../src/types";

const NOW = 15_000_000_000;
const DAY = 86_400_000;
const RAW: RawLead = { company: "Kowalski Bud", email: "biuro@kb.example", address: "Kraków", hasWebsite: false };
const HTML = `<!DOCTYPE html><html><head><title>Kowalski Bud</title></head><body><h1>Kowalski Bud</h1><img src="a.jpg" alt="a"></body></html>`;
const S9_CAPS = { webgl: true, deviceMemoryGB: 3, hardwareConcurrency: 4, lowEndPhone: true };

const baseInput = (over: Partial<GrowthFlowInput> = {}): GrowthFlowInput => ({
  raw: RAW, source: "osm", now: NOW,
  three: { requested: "REAL_3D", caps: S9_CAPS },
  html: HTML, offer: "Nowoczesna strona dla Kowalski Bud", consent: true,
  makeId: (seed) => `id-${seed}`,
  ...over,
});

describe("growthOrganism E2E — przez koordynator używany przez aplikację", () => {
  it("pełny lejek: import → scoring → blueprint → S9 3D → walidacja → kampania → SIMULATED → ROI", () => {
    const r = runGrowthFlow(baseInput({ won: { revenue: 6000 } }), { leads: [], campaigns: [] });
    // Import realnie zmienił kolekcję (dowód, nie sklejka).
    expect(r.imported).toBe(true);
    expect(r.leads).toHaveLength(1);
    expect(r.lead.company).toBe("Kowalski Bud");
    // Blueprint bez wymuszonego preloadera; S9 → CSS (nie grzejnik).
    expect(r.blueprint.preloader).toBe(false);
    expect(r.threeD.effective).toBe("css");
    expect(r.siteSafe).toBe(true);
    // Kampania zatwierdzona, ale publikacja to SIMULATED (brak tokena) — NIGDY published bez LIVE.
    expect(r.publish.state).toBe("SIMULATED");
    expect(r.campaign.status).not.toBe("published_confirmed");
    // Przychód wygranej przypisany do kampanii (wspólne ID) → ROI.
    expect(r.roi.attribution.total).toBe(6000);
    expect(r.roi.attribution.byCampaign[r.campaign.id]).toBe(6000);
    expect(r.recommendationVariant).toBe("A");
  });

  it("BEZ zgody publikacja jest ZABLOKOWANA (nie symulacja, nie publikacja)", () => {
    const r = runGrowthFlow(baseInput({ consent: false }), { leads: [], campaigns: [] });
    expect(r.publish.state).toBe("BLOCKED");
    expect(r.campaign.status).not.toBe("published_confirmed");
  });

  it("PUBLISHED_CONFIRMED tylko z potwierdzonym LIVE (token + uprawnienia + zdrowe API)", () => {
    const r = runGrowthFlow(
      baseInput({ channel: { hasToken: true, hasRequiredPermissions: true, healthy: true, receiptApiState: "LIVE" } }),
      { leads: [], campaigns: [] },
    );
    expect(r.publish.state).toBe("PUBLISHED_CONFIRMED");
    expect(r.campaign.status).toBe("published_confirmed");
  });

  it("kandydat przykładowy (mock/no_persist) NIE trafia do CRM jako prawdziwy lead", () => {
    const r = runGrowthFlow(baseInput({ source: "mock" }), { leads: [], campaigns: [] });
    expect(r.imported).toBe(false);
    expect(r.leads).toHaveLength(0);
  });

  it("wrapper na store realnie utrwala leady i kampanie (zmiana store)", () => {
    const fake = { data: { leads: [] as Lead[], campaigns: [] as CampaignPlan[] } };
    const store = { data: fake.data, setData: (fn: (d: { leads: Lead[]; campaigns?: CampaignPlan[] }) => void) => fn(fake.data) };
    const r = runGrowthFlowOnStore(baseInput({ won: { revenue: 3000 } }), store);
    expect(fake.data.leads).toHaveLength(1);
    expect(fake.data.leads[0].status).toBe("won");
    expect(fake.data.campaigns).toHaveLength(1);
    expect(r.roi.attribution.total).toBe(3000);
  });

  it("regresja: usunięcie połączenia lead↔kampania psuje atrybucję (test łapie rozspojenie)", () => {
    const r = runGrowthFlow(baseInput({ won: { revenue: 5000 } }), { leads: [], campaigns: [] });
    // Lead niesie campaignId kampanii — to jest wspólne ID, bez którego przychód byłby nieprzypisany.
    expect(r.lead.campaignId).toBe(r.campaign.id);
    expect(r.roi.attribution.unattributed).toBe(0);
  });
});

describe("growthOrganism — przejście głosem (parytet decyzji)", () => {
  it("głos używa TEJ SAMEJ decyzji poznawczej co tekst", () => {
    const text = "zaplanuj kampanię i wyślij ofertę do najlepszego leada";
    expect(voiceCognition(text)).toEqual(classifyCognitionLocal(text));
  });
  it("komenda głosowa startu celu jest rozpoznawana", () => {
    const cmd = parseVoiceGoalCommand("rozpocznij cel: zdobądź 3 klientów");
    expect(cmd?.intent).toBe("start_goal");
    expect(cmd?.payload).toMatch(/klient/);
  });
});

describe("growthOrganism — scoring", () => {
  it("importowany lead z kontaktem bije lead bez strony i bez kontaktu", () => {
    const withContact: Lead = { id: "a", company: "Alfa", status: "contacted", url: "https://a.pl", email: "a@a.pl", niche: "usługi", createdAt: NOW, updatedAt: NOW };
    const noContact: Lead = { id: "b", company: "Beta", status: "new", createdAt: NOW, updatedAt: NOW };
    expect(scoreLead(signalsFromLead(withContact, NOW)).score).toBeGreaterThan(scoreLead(signalsFromLead(noContact, NOW + DAY)).score);
  });
});
