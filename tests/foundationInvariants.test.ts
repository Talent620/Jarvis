// === Test integracyjny pięciu invariantów fundamentu (FABLE FAZA 3) ===
// Nie „czy funkcja zwraca X", ale: czy KAŻDA publiczna reprezentacja procesu (silnik etapów,
// ścieżka klienta, liczniki lejka, KPI finansów, teksty czatu/głosu) mówi to samo — i uczciwie.
import { describe, it, expect, beforeEach } from "vitest";
import { applyPayment, financeKpis, financeSummaryText } from "../src/lib/finance";
import { reachedStage, computeJourney, businessStatusText } from "../src/lib/businessFlow";
import { clientJourney, pipelineCounts } from "../src/lib/clientJourney";
import { simulatePriceChange, simulateSendOffers } from "../src/lib/businessSimulator";
import { classifyFailoverReason, sanitizeFailReason } from "../src/lib/aiHelpers";
import { fallbackNotice, fallbackVoiceLine, shouldAnnounceFallback } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";
import { runTool } from "../src/lib/tools";
import type { Lead, FinanceProject } from "../src/types";

const lead = (o: Partial<Lead>): Lead => ({ id: "l1", company: "Firma X", status: "new", ...o });
const proj = (o: Partial<FinanceProject>): FinanceProject => ({ id: "p1", name: "P", status: "lead", amount: 0, createdAt: 0, updatedAt: 0, ...o });

// ── Invariant 1: CZĘŚCIOWA WPŁATA (10 000 zł → 1 zł) nigdzie nie wygląda jak „opłacone/domknięte" ──
describe("Invariant 1 — projekt 10 000 zł, wpłata 1 zł: wszystkie reprezentacje mówią „czeka na płatność”", () => {
  const NOW = 1_700_000_000_000;
  let after: FinanceProject;
  const theLead = lead({ id: "l1", company: "Firma X" });

  beforeEach(() => {
    const before = proj({ id: "p1", client: "Firma X", leadId: "l1", status: "oczekuje_platnosci", amount: 10000 });
    after = applyPayment(before, { amount: 1 }, NOW);
  });

  it("finance.ts: status zostaje oczekuje_platnosci, paidAmount=1", () => {
    expect(after.status).toBe("oczekuje_platnosci");
    expect(after.paidAmount).toBe(1);
  });

  it("businessFlow.ts: etap ≠ paid, done=false, żadne pole nie mówi „Opłacone”, ekran ≠ content", () => {
    expect(reachedStage(theLead, [after], [])).toBe("finance_project_created");
    const j = computeJourney(theLead, [after], []);
    expect(j.done).toBe(false);
    expect(j.screen).not.toBe("content");
    // ŻADNE pole widoczne dla użytkownika nie twierdzi „Opłacone" (etykieta kroku = akcja).
    expect(j.label).not.toMatch(/^Opłacone/);
    expect(j.reason).not.toMatch(/^Opłacone/);
    expect(businessStatusText(theLead, [after], [])).not.toMatch(/Opłacone/);
  });

  it("clientJourney.ts: done=false, postęp <100%, nextReason nie sugeruje treści o realizacji", () => {
    const v = clientJourney(theLead, [after], []);
    expect(v.done).toBe(false);
    expect(v.progressPct).toBeLessThan(100);
    expect(v.nextReason).not.toMatch(/treść|realizacj/i);
    expect(v.screen).toBe("finance");
  });

  it("pipelineCounts: klient jest w „client” (aktywny), NIE w archiwum/zamkniętych", () => {
    const counts = pipelineCounts([theLead], [after], []);
    expect(counts.client).toBe(1);
    expect(counts.archive).toBe(0);
  });

  it("financeKpis: doneCount=0, projekt wciąż aktywny, unpaid=9999", () => {
    const k = financeKpis([after]);
    expect(k.doneCount).toBe(0);
    expect(k.openCount).toBe(1);
    expect(k.paid).toBe(1);
    expect(k.unpaid).toBe(9999);
  });

  it("czat/głos (business_status + business_next_step): mówi o płatności, nie o sukcesie", async () => {
    store.setData((d) => { d.leads = [theLead]; d.financeProjects = [after]; d.sentMail = []; });
    const status = await runTool("business_status", { company: "Firma X" });
    const next = await runTool("business_next_step", { company: "Firma X" });
    expect(status).not.toMatch(/Opłacone/);
    expect(next).toMatch(/płatnoś/i);
    expect(next).not.toMatch(/treść o realizacji/i);
    expect(String(next)).toContain("finance"); // kieruje do Finansów, nie do „treści o realizacji"
  });

  it("financeSummaryText: pokazuje realne „do zapłaty”, nie sukces", () => {
    const t = financeSummaryText([after]);
    expect(t).toMatch(/do zapłaty/);
  });

  it("pełna wpłata (drugie 9 999 zł) DOPIERO domyka proces wszędzie", () => {
    const paidFull = applyPayment(after, { amount: 9999 }, NOW + 1);
    expect(paidFull.status).toBe("oplacone");
    const j = computeJourney(theLead, [paidFull], []);
    expect(j.done).toBe(true);
    expect(j.screen).toBe("content");
    expect(pipelineCounts([theLead], [paidFull], []).client).toBe(1);
  });
});

// ── Invariant 2: leadId end-to-end — auto-łączenie TYLKO jednoznaczne ──
describe("Invariant 2 — leadId: dwie firmy o tej samej nazwie → NIE zgadujemy", () => {
  it("czat finance_add_project przy duplikatach nazwy NIE ustawia leadId i mówi to wprost", async () => {
    store.setData((d) => {
      d.leads = [
        lead({ id: "a1", company: "Acme" }),
        lead({ id: "a2", company: "acme" }), // duplikat (inna wielkość liter)
      ];
      d.financeProjects = [];
    });
    const res = await runTool("finance_add_project", { name: "Strona", client: "Acme", amount: 5000 });
    const created = (store.data.financeProjects || [])[0];
    expect(created.leadId).toBeUndefined(); // niepewność oznaczona, rekord zachowany
    expect(created.client).toBe("Acme");
    expect(res).toMatch(/nie zgaduję/i);
  });

  it("jednoznaczne dopasowanie → leadId ustawione (czat/głos ma tę samą siłę co formularz)", async () => {
    store.setData((d) => { d.leads = [lead({ id: "solo", company: "Beta" })]; d.financeProjects = []; });
    await runTool("finance_add_project", { name: "Logo", client: "Beta", amount: 900 });
    expect((store.data.financeProjects || [])[0].leadId).toBe("solo");
  });

  it("zmiana nazwy firmy w CRM nie zrywa powiązania po leadId", () => {
    const renamed = lead({ id: "l9", company: "Nowa Nazwa Sp. z o.o." });
    const p = proj({ leadId: "l9", client: "Stara Nazwa", status: "w_realizacji" });
    expect(reachedStage(renamed, [p], [])).toBe("finance_project_created");
  });

  it("projekt z leadId wskazującym USUNIĘTEGO leada nie psuje ścieżek innych leadów", () => {
    const alive = lead({ id: "alive", company: "Żywy Klient" });
    const orphan = proj({ id: "orph", leadId: "deleted-lead", client: "Ktoś Inny", status: "oplacone", paidAmount: 1000, amount: 1000 });
    expect(reachedStage(alive, [orphan], [])).toBe("lead_found"); // cudzy osierocony projekt nie podnosi etapu
  });

  it("stare dane bez leadId: dopasowanie po nazwie działa jak dawniej (fallback bezwarunkowy)", () => {
    expect(reachedStage(lead({ id: "x", company: "Firma X" }), [proj({ client: "firma x", status: "w_realizacji" })], [])).toBe("finance_project_created");
  });
});

// ── Invariant 3: symulator — liczby skończone, low ≤ value ≤ high, low ≥ 0, NaN/Infinity-safe ──
describe("Invariant 3 — symulator: tabela własności (żadna kombinacja nie łamie widełek)", () => {
  const DELTAS = [NaN, -Infinity, -1e9, -90, -60, -10, 0, 10, 50, 200, 1e9, Infinity];
  const ELASTICITIES = [NaN, -5, 0, 0.5, 1, 2, 3, 42, Infinity];
  const BASES = [NaN, -100, 0, 1, 100000, Infinity];

  it("simulatePriceChange: wszystkie kombinacje wejść dają skończone, spójne widełki", () => {
    for (const baselineRevenue of BASES) {
      for (const deltaPct of DELTAS) {
        for (const demandElasticity of ELASTICITIES) {
          const r = simulatePriceChange({ baselineRevenue, deltaPct, demandElasticity });
          const label = `base=${baselineRevenue} delta=${deltaPct} e=${demandElasticity}`;
          expect(Number.isFinite(r.value), `value skończone: ${label}`).toBe(true);
          expect(Number.isFinite(r.low), `low skończone: ${label}`).toBe(true);
          expect(Number.isFinite(r.high), `high skończone: ${label}`).toBe(true);
          expect(r.low, `low<=value: ${label}`).toBeLessThanOrEqual(r.value);
          expect(r.high, `value<=high: ${label}`).toBeGreaterThanOrEqual(r.value);
          expect(r.low, `low>=0 (przychód nie bywa ujemny): ${label}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("simulateSendOffers: NaN/Infinity/ujemne wejścia nie zatruwają wyniku", () => {
    for (const offers of [NaN, -5, 0, 3, 1e6, Infinity]) {
      for (const conversionRate of [NaN, -1, 0, 0.05, 1, 5, Infinity]) {
        for (const avgDealValue of [NaN, -100, 0, 4000, Infinity]) {
          const r = simulateSendOffers({ offers, conversionRate, avgDealValue });
          expect(Number.isFinite(r.value)).toBe(true);
          expect(Number.isFinite(r.low)).toBe(true);
          expect(Number.isFinite(r.high)).toBe(true);
          expect(r.low).toBeLessThanOrEqual(r.value);
          expect(r.high).toBeGreaterThanOrEqual(r.value);
          expect(r.low).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("zerowe dane nie tworzą fałszywej precyzji: baseline 0 → wynik 0 z widełkami 0–0", () => {
    const r = simulatePriceChange({ baselineRevenue: 0, deltaPct: 20 });
    expect(r.value).toBe(0);
    expect(r.low).toBe(0);
    expect(r.high).toBe(0);
  });
});

// ── Invariant 4: zysk/h — klient bez godzin w OSOBNEJ sekcji, nigdy „najbardziej efektywny" ──
describe("Invariant 4 — ranking zysku na godzinę (czat) rozdziela klientów bez godzin", () => {
  it("sekcja rankingu zawiera tylko realne zł/h; brak godzin → osobna sekcja z komunikatem", async () => {
    store.setData((d) => {
      d.financeProjects = [
        proj({ id: "a", client: "Bez Godzin", amount: 50000, cost: 0, hours: 0, status: "oplacone" }),
        proj({ id: "b", client: "Ze Stawką", amount: 4000, cost: 0, hours: 10, status: "oplacone" }),
      ];
    });
    const res = String(await runTool("rank_clients_by_efficiency", {}));
    const [rankingSection, noHoursSection] = res.split("Poza rankingiem");
    expect(rankingSection).toContain("Ze Stawką");
    expect(rankingSection).not.toContain("Bez Godzin"); // nie konkuruje liczbowo w rankingu zł/h
    expect(noHoursSection).toContain("Bez Godzin");
    expect(noHoursSection).toMatch(/nie da się porównać/);
  });

  it("gdy NIKT nie ma godzin — mówi wprost, że rankingu zł/h nie da się policzyć", async () => {
    store.setData((d) => { d.financeProjects = [proj({ id: "a", client: "X", amount: 1000, hours: 0, status: "oplacone" })]; });
    const res = String(await runTool("rank_clients_by_efficiency", {}));
    expect(res).toMatch(/nie da się policzyć zysku na godzinę/i);
  });
});

// ── Invariant 5: failover — strukturalny powód, odkażony tekst, rozsądna natarczywość ──
describe("Invariant 5 — failover: klasa powodu z realnego błędu, bez sekretów, ogłaszany przy zmianie", () => {
  it("classifyFailoverReason mapuje realne błędy na klasy — a nieznane uczciwie na unknown", () => {
    expect(classifyFailoverReason("Request timed out after 30000ms")).toBe("timeout");
    expect(classifyFailoverReason("429 rate limit exceeded")).toBe("quota");
    expect(classifyFailoverReason("401 unauthorized: invalid api key")).toBe("auth");
    expect(classifyFailoverReason("503 service unavailable")).toBe("unavailable");
    expect(classifyFailoverReason("Failed to fetch")).toBe("offline");
    expect(classifyFailoverReason("coś zupełnie dziwnego")).toBe("unknown");
  });

  it("sanitizeFailReason: bez kluczy, bez stack trace, bez ścian tekstu", () => {
    expect(sanitizeFailReason("error sk-abc123def456ghi789 rejected")).not.toContain("abc123def456ghi789");
    expect(sanitizeFailReason("boom\n  at askJarvis (brain.ts:984)\n  at ...")).not.toContain("at askJarvis");
    expect(sanitizeFailReason("x".repeat(500)).length).toBeLessThanOrEqual(140);
    expect(sanitizeFailReason("api key AIzaSyD-1234567890abcdefghijk was invalid")).not.toContain("1234567890");
  });

  it("fallbackNotice z samą klasą (bez tekstu) daje ludzki, faktograficzny komunikat", () => {
    const msg = fallbackNotice({ via: "groq", fellBack: true, fellBackReasonKind: "quota" });
    expect(msg).toMatch(/limit/);
    expect(msg).not.toMatch(/zajęty/i);
  });

  it("fallbackVoiceLine: krótka linia mówiona bez emoji (tryb bez patrzenia na ekran)", () => {
    const line = fallbackVoiceLine({ via: "groq", fellBack: true });
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/[\uD800-\uDFFF]/); // bez emoji (żadnych par zastępczych — to idzie do TTS)
    expect(line).toMatch(/zapasowy/);
  });

  it("shouldAnnounceFallback: ogłasza wejście w failover i zmianę zapasu — NIE każdą turę", () => {
    const onGroq = { via: "groq" as const, fellBack: true };
    expect(shouldAnnounceFallback(null, onGroq)).toBe(true);       // wejście w failover → ogłoś
    expect(shouldAnnounceFallback("groq", onGroq)).toBe(false);    // kolejna tura na tym samym zapasie → cisza
    expect(shouldAnnounceFallback("groq", { via: "cerebras", fellBack: true })).toBe(true); // zmiana zapasu → ogłoś
    expect(shouldAnnounceFallback("groq", { via: "gemini", fellBack: false })).toBe(false); // powrót do głównego → bez toastu
  });
});
