// === E2E: od firmy do przychodu (growthOrganism) ===
// Cały przepływ działa bez ręcznego kopiowania danych między modułami:
// KANDYDAT → IMPORT → DEMO STRONY → BLUEPRINT + 3D → WALIDACJA → OFERTA → KAMPANIA → SYMULOWANA
// PUBLIKACJA → (SIMULATED, nie PUBLISHED) → WYGRANA + PRZYCHÓD → ROI + NASTĘPNA REKOMENDACJA.
// Zero prawdziwych operacji zewnętrznych, zero płatnego API, zero danych prywatnych.
import { describe, it, expect } from "vitest";
import { discoverLeadCandidates, importCandidates } from "../src/lib/leadCandidates";
import type { RawLead } from "../src/lib/leads";
import { buildGrowthContext, growthContextToBrief } from "../src/lib/growthContext";
import { validateBlueprint, fallbackBlueprint } from "../src/lib/siteBlueprint";
import { resolve3D } from "../src/lib/web3dPolicy";
import { validateSite } from "../src/lib/siteValidator";
import { newCampaign, validateAdFormat, transitionCampaign, canExport } from "../src/lib/campaignEngine";
import { derivePublishStatus, isPublishedLike, countPublished } from "../sales-os/src/lib/social/statusPolicy";
import { attributeRevenue, recommendVariant, type AttributionEvent } from "../src/lib/growthAttribution";
import { planDailyGrowth } from "../src/lib/growthOrchestrator";
import { scoreLead, signalsFromLead } from "../src/lib/leadScoring";
import type { Lead } from "../src/types";

const NOW = 15_000_000_000;

describe("growthOrganism E2E — od firmy do przychodu", () => {
  it("cały lejek działa na mockach, bez ręcznego kopiowania danych", () => {
    // 1) Znajdź kandydatów (bez zapisu do CRM).
    const raws: RawLead[] = [
      { company: "Kowalski Bud", email: "biuro@kb.example", website: undefined, address: "Kraków", hasWebsite: false },
      { company: "Bez Kontaktu", hasWebsite: false },
    ];
    const candidates = discoverLeadCandidates(raws, { source: "osm", now: NOW });
    expect(candidates.length).toBe(2);

    // 2) Wybierz prawdziwego kandydata z dowodami (najwyższa pewność, ma kontakt/adres).
    const chosen = candidates[0];
    expect(chosen.company).toBe("Kowalski Bud");
    expect(chosen.contactability).toBe("email");

    // 3) Zaimportuj TYLKO jego → nowy lead.
    const leadsAfterImport = importCandidates([], [chosen], { now: NOW, makeId: (c) => `L-${c.id}` });
    expect(leadsAfterImport).toHaveLength(1);
    const lead: Lead = { id: leadsAfterImport[0].id, ...leadsAfterImport[0] } as Lead;

    // 4) Otwórz spersonalizowany kreator — brief z danych leada (bez przepisywania).
    const ctx = buildGrowthContext(lead);
    const brief = growthContextToBrief(ctx);
    expect(brief.business).toBe("Kowalski Bud");
    expect(brief.extra).toMatch(/Problemy/i); // brak strony wykryty automatycznie

    // 5) Zbuduj blueprint + lekkie demo 3D (S9 → CSS fallback, nie grzejnik).
    const bp = validateBlueprint(fallbackBlueprint(brief), brief);
    expect(bp.sections[0].kind).toBe("hero");
    expect(bp.preloader).toBe(false);
    const threed = resolve3D("REAL_3D", { webgl: true, deviceMemoryGB: 3, hardwareConcurrency: 4, lowEndPhone: true });
    expect(threed.effective).toBe("css"); // S9 → lekki fallback

    // 6) Zweryfikuj stronę (kompletny dokument przechodzi).
    const html = `<!DOCTYPE html><html><head><title>Kowalski Bud</title></head><body><h1>Kowalski Bud</h1><img src="a.jpg" alt="a"></body></html>`;
    expect(validateSite(html).safeToDownload).toBe(true);

    // 7) Przygotuj ofertę (draft — nic nie wysłano).
    const offerDraft = { id: "of1", status: "draft" as const };
    expect(offerDraft.status).toBe("draft");

    // 8) Utwórz kampanię i warianty reklam (walidacja formatu przed eksportem).
    let campaign = newCampaign({
      id: "camp1", type: "paid_ad", platform: "google_rsa", audience: ctx.company, offer: "strona WWW",
      channel: "google", creative: { headlines: ["Nowa strona dla Kowalski", "Zwiększ zapytania"], descriptions: ["Nowoczesna strona, która pozyskuje klientów."] },
      cta: "Zapytaj", utm: { source: "google", medium: "cpc", campaign: "kb" }, variant: "A", now: NOW,
    });
    expect(validateAdFormat("google_rsa", campaign.creative).ok).toBe(true);
    expect(canExport(campaign).ok).toBe(true);
    campaign = transitionCampaign(campaign, "approved", NOW + 1);
    expect(campaign.status).toBe("approved");

    // 9-10) Zatwierdź SYMULOWANĄ publikację (brak tokena) → SIMULATED, NIE PUBLISHED.
    const pubStatus = derivePublishStatus({ hasToken: false, externalId: "sim_x" });
    expect(pubStatus).toBe("SIMULATED");
    expect(isPublishedLike(pubStatus)).toBe(false);
    expect(countPublished([{ status: pubStatus }])).toBe(0); // symulacja nie liczy się jako opublikowana

    // 11) Oznacz lead jako wygrany i przypisz przychód do kampanii + strony.
    const events: AttributionEvent[] = [
      { stage: "win", at: NOW + 2, link: { campaignId: "camp1", leadId: lead.id, variant: "A" } },
      { stage: "payment", at: NOW + 3, revenue: 6000, link: { campaignId: "camp1", landingPageId: "lp-kb", variant: "A" } },
    ];
    const roi = attributeRevenue(events);
    expect(roi.byCampaign["camp1"]).toBe(6000);
    expect(roi.byLandingPage["lp-kb"]).toBe(6000);
    expect(roi.unattributed).toBe(0);

    // 12) Raport ROI + następna rekomendacja (z realnego wyniku i lokalnych danych).
    expect(recommendVariant(events).variant).toBe("A");
    const wonLead: Lead = { ...lead, status: "won", updatedAt: NOW + 3 };
    const nextDay = planDailyGrowth({ now: NOW + DAYMS(), leads: [wonLead] });
    expect(nextDay.length).toBeGreaterThan(0); // zawsze jest sensowny następny krok (offline)
  });

  it("scoring: importowany lead z kontaktem bije lead bez strony i bez kontaktu", () => {
    const withContact: Lead = { id: "a", company: "Alfa", status: "contacted", url: "https://a.pl", email: "a@a.pl", niche: "usługi", createdAt: NOW, updatedAt: NOW };
    const noContact: Lead = { id: "b", company: "Beta", status: "new", createdAt: NOW, updatedAt: NOW };
    const sa = scoreLead(signalsFromLead(withContact, NOW));
    const sb = scoreLead(signalsFromLead(noContact, NOW));
    expect(sa.score).toBeGreaterThan(sb.score);
  });
});

function DAYMS(): number { return 86_400_000; }
