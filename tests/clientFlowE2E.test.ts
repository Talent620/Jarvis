// === E2E realnego przepływu klienta (clientFlowE2E) — bez prawdziwych usług ===
// Kandydat → import → kontakt → oferta → potwierdzony mail → projekt → częściowa/pełna wpłata →
// szkic treści → SIMULATED publikacji. Używa TYCH SAMYCH czystych funkcji co UI/narzędzia. Zero sieci,
// zero płatnego API, zero prawdziwych maili/płatności/publikacji. SIMULATED nigdy nie staje się PUBLISHED.
import { describe, it, expect } from "vitest";
import { discoverLeadCandidates, importCandidates } from "../src/lib/leadCandidates";
import type { RawLead } from "../src/lib/leads";
import { telHref, hasPhone } from "../src/lib/contactActions";
import { leadToProjectDraft, hasProjectForClient } from "../src/lib/growthContext";
import { clientJourney } from "../src/lib/clientJourney";
import { derivePublishStatus, isPublishedLike } from "../sales-os/src/lib/social/statusPolicy";
import type { Lead, FinanceProject, SentMail } from "../src/types";

const NOW = 30_000_000_000;

describe("clientFlowE2E — od kandydata do przychodu i treści", () => {
  it("cały proces działa na czystych funkcjach, bez usług zewnętrznych", () => {
    // 1) Kandydat z telefonem (podgląd, bez zapisu).
    const raws: RawLead[] = [{ company: "Kowalski Bud", phone: "600 100 200", email: "biuro@kb.example", address: "Kraków", hasWebsite: false }];
    const candidates = discoverLeadCandidates(raws, { source: "osm", now: NOW });
    const cand = candidates[0];
    expect(hasPhone(cand)).toBe(true);

    // 2) Kontakt — „kliknij telefon" daje realny tel: (widoczna akcja).
    expect(telHref(cand.phone)).toBe("tel:600100200");

    // 3) Import → lead w CRM.
    const added = importCandidates([], [cand], { now: NOW, makeId: (c) => `L-${c.id}` });
    expect(added).toHaveLength(1);
    let lead: Lead = { id: added[0].id, ...added[0] } as Lead;
    expect(clientJourney(lead, [], []).stage).toBe("candidate");

    // 4) Oferta (draft) → etap „Oferta".
    lead = { ...lead, offer: "Cześć, proponuję nowoczesną stronę…" };
    expect(clientJourney(lead, [], []).stage).toBe("offer");

    // 5) Potwierdzony mail (skrzynka wysłanych) — dowód wysyłki, nie udawanie.
    const sent: SentMail[] = [{ id: "m1", to: "biuro@kb.example", subject: "Oferta", company: "Kowalski Bud", at: NOW + 1, via: "smtp" } as SentMail];
    expect(clientJourney(lead, [], sent).reached).toBe("email_sent");

    // 6) Projekt finansowy z klienta (draft, bez duplikatu).
    expect(hasProjectForClient([], lead)).toBe(false);
    const draft = leadToProjectDraft(lead, NOW + 2);
    expect(draft.client).toBe("Kowalski Bud");
    const projects: FinanceProject[] = [{ id: "p1", ...draft }];
    expect(hasProjectForClient(projects, lead)).toBe(true);

    // 7) Bez wpłaty → jeszcze nie domknięte; po wpłacie (częściowej lub pełnej) → Klient (etap opłacone).
    const unpaid: FinanceProject[] = [{ ...projects[0], amount: 6000 }];
    expect(clientJourney(lead, unpaid, sent).done).toBe(false);
    const partial: FinanceProject[] = [{ ...projects[0], amount: 6000, paidAmount: 2000 }];
    expect(clientJourney(lead, partial, sent).stage).toBe("client"); // wpłata przesuwa etap
    const full: FinanceProject[] = [{ ...projects[0], amount: 6000, paidAmount: 6000, status: "oplacone" }];
    const paidView = clientJourney(lead, full, sent);
    expect(paidView.done).toBe(true);
    expect(paidView.stage).toBe("client");

    // 8) Szkic treści o realizacji + SIMULATED publikacja (brak tokena) — NIGDY published.
    const pub = derivePublishStatus({ hasToken: false, externalId: "sim_x" });
    expect(pub).toBe("SIMULATED");
    expect(isPublishedLike(pub)).toBe(false);
  });

  it("SIMULATED z realnym potwierdzeniem NIE zmienia się magicznie w published", () => {
    // Nawet z externalId — bez tokena/uprawnień to wciąż symulacja.
    expect(isPublishedLike(derivePublishStatus({ hasToken: false }))).toBe(false);
  });
});
