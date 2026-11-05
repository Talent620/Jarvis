// === Wydajność i kompatybilność S9 (FABLE FAZA 8) — Dziennik Predykcji na TYSIĄCACH rekordów ===
// Realny pomiar czasu (Date.now), twarde progi z zapasem dla najsłabszego sprzętu. Do tego:
// stare dane bez pola predictionLedger, ograniczony rozmiar dziennika i brak pracy przy renderze
// (to ostatnie ma test zachowania w predictionBehavior.test.ts — tu ścieżka danych).
import { describe, it, expect } from "vitest";
import { runPredictionCycle, resolveDuePredictions, recordNeglectPrediction, compactLedger, calibrationSummary, verdictOf, type CycleLeadInput } from "../src/lib/predictionLedger";
import type { PredictionRecord, AppData } from "../src/types";

const DAY = 86_400_000;
const NOW = 40_000_000_000;

/** 3000 leadów: co piąty realnie zaległy (600 prognoz na pierwszym przebiegu). */
function makeLeads(n: number): CycleLeadInput[] {
  const out: CycleLeadInput[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `lead-${i}`,
      company: `Firma ${i}`,
      status: "contacted",
      lastContactedAt: NOW - ((i % 30) + 1) * DAY,
      overdue: i % 5 === 0,
    });
  }
  return out;
}

describe("Wydajność S9 — tysiące leadów i rekordów, realny czas wykonania", () => {
  it("pierwszy cykl na 3000 leadów (600 nowych prognoz) < 300 ms; kolejny IDEMPOTENTNY cykl < 150 ms", () => {
    const leads = makeLeads(3000);
    let n = 0;
    const t0 = Date.now();
    const first = runPredictionCycle({ ledger: [], leads, awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => `p${++n}` });
    const firstMs = Date.now() - t0;
    expect(first.created.length).toBe(600);
    expect(firstMs, `pierwszy cykl: ${firstMs} ms`).toBeLessThan(300);

    const t1 = Date.now();
    const second = runPredictionCycle({ ledger: first.ledger, leads, awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => `p${++n}` });
    const secondMs = Date.now() - t1;
    expect(second.changed).toBe(false); // stabilność: nic do zrobienia = zero zmian
    expect(secondMs, `cykl bez zmian: ${secondMs} ms`).toBeLessThan(150);
  });

  it("dziennik z 5000 rozstrzygnięć: kompakcja trzyma twardy sufit i NIE gubi żadnej czekającej prognozy", () => {
    const big: PredictionRecord[] = [];
    for (let i = 0; i < 5000; i++) {
      big.push({
        id: `r${i}`, kind: "relationship_neglect", logicVersion: 2,
        entityId: `lead-${i % 400}`, entityLabel: `Firma ${i % 400}`,
        madeAt: NOW - (5000 - i) * 3_600_000, checkAt: NOW - (5000 - i) * 3_600_000 + 7 * DAY,
        inputState: {}, claim: "c", successCriterion: "s", confidence: 0.7,
        assumptions: [], sources: [], basis: [],
        evidence: i % 10 === 0 ? undefined : { observedAt: NOW, outcome: "o", evidence: [], verdict: i % 2 ? "correct" : "prevented", reason: "r", confidenceAfterResolution: 0.7 },
      });
    }
    const pendingBefore = big.filter((r) => !r.evidence).length;
    const t0 = Date.now();
    const compacted = compactLedger(big);
    const ms = Date.now() - t0;
    expect(ms, `kompakcja 5000 rekordów: ${ms} ms`).toBeLessThan(150);
    expect(compacted.length).toBeLessThanOrEqual(Math.max(500, pendingBefore));
    expect(compacted.filter((r) => !r.evidence).length).toBe(pendingBefore); // pending nietykalne
    // Statystyki nadal liczą się szybko na skompaktowanym dzienniku.
    const t1 = Date.now();
    const s = calibrationSummary(compacted);
    expect(Date.now() - t1).toBeLessThan(50);
    expect(s.total).toBe(compacted.length);
  });

  it("30 kolejnych cykli (miesiąc życia aplikacji) na 1000 leadów nie rozdyma dziennika ponad sufit", () => {
    const leadsBase = makeLeads(1000);
    let ledger: PredictionRecord[] = [];
    let n = 0;
    const t0 = Date.now();
    for (let day = 0; day < 30; day++) {
      const now = NOW + day * DAY;
      // każdy dzień: wszyscy zaległi wg prostej kadencji 7 dni (nikt nie odpisuje — najgorszy przypadek)
      const leads = leadsBase.map((l) => ({ ...l, overdue: true }));
      const r = runPredictionCycle({ ledger, leads, awaitingPaymentByLead: {}, now, learningEnabled: true, makeId: () => `x${++n}` });
      ledger = r.ledger;
    }
    const ms = Date.now() - t0;
    expect(ms, `30 cykli × 1000 leadów: ${ms} ms`).toBeLessThan(3000);
    expect(ledger.filter((r) => !r.evidence).length).toBeLessThanOrEqual(1000); // maks. 1 pending per lead
    // rozstrzygnięte podlegają limitom kompakcji (nie rosną bez końca)
    expect(ledger.length).toBeLessThanOrEqual(1000 + 500);
  });
});

describe("Indeksowanie historii — zachowanie dowodów i kolejności cyklu", () => {
  const prediction = (id: string, entityId = "a"): PredictionRecord =>
    recordNeglectPrediction(entityId, `Firma ${entityId}`, { id, now: NOW - 8 * DAY, records: [] });
  const historical = (id: string, verdict: "correct" | "prevented" | "moot", observedAt: number, entityId = "a"): PredictionRecord => ({
    ...prediction(id, entityId),
    evidence: { observedAt, outcome: "wynik", evidence: [], verdict, reason: "historia", confidenceAfterResolution: 0.7 },
  });

  it("pewność dowodu uwzględnia tylko wcześniejsze rekordy tej encji, bez zmiany zapisanej historii", () => {
    const disputed = historical("disputed", "prevented", NOW - 4 * DAY);
    disputed.evidence!.disputedAt = NOW - 3 * DAY;
    const ledger = [
      prediction("first"),
      historical("old", "correct", NOW - 2 * DAY),
      historical("other", "prevented", NOW - 3 * DAY, "b"),
      prediction("second"),
      disputed,
      historical("moot", "moot", NOW - 3 * DAY),
      prediction("third"),
      historical("later-in-ledger", "prevented", NOW - 3 * DAY),
    ];
    const original = JSON.stringify(ledger);
    const resolved = resolveDuePredictions(ledger, NOW, { a: { status: "contacted" }, b: { status: "contacted" } });

    expect(resolved.map((r) => r.id)).toEqual(ledger.map((r) => r.id));
    expect([resolved[0], resolved[3], resolved[6]].map((r) => r.evidence!.confidenceAfterResolution)).toEqual([0.7, 0.82, 0.84]);
    expect(JSON.stringify(ledger)).toBe(original);
    for (let i = 0; i < ledger.length; i++) {
      if (ledger[i].evidence) expect(resolved[i]).toBe(ledger[i]);
      else {
        const { evidence, ...unchangedPrediction } = resolved[i];
        expect(evidence!.verdict).toBe("correct");
        expect(unchangedPrediction).toEqual(ledger[i]);
      }
    }
  });

  it("nowa prognoza korzysta z historii swojego klienta, a duplikat leada nie tworzy drugiej", () => {
    const ledger = [
      historical("a-first", "prevented", NOW - 2 * DAY),
      historical("b-first", "correct", NOW - 2 * DAY, "b"),
      historical("a-second", "prevented", NOW - DAY),
      historical("b-second", "correct", NOW - DAY, "b"),
    ];
    const original = JSON.stringify(ledger);
    const leads: CycleLeadInput[] = [
      { id: "a", company: "Pierwsza nazwa", status: "contacted", overdue: true },
      { id: "b", company: "Inny klient", status: "contacted", overdue: true },
      { id: "a", company: "Powtórzony wpis", status: "contacted", overdue: true },
    ];
    let ids = 0;
    const result = runPredictionCycle({ ledger, leads, awaitingPaymentByLead: { a: 100 }, now: NOW,
      learningEnabled: true, makeId: () => `new-${++ids}` });

    expect(ids).toBe(2);
    expect(result.created.map((r) => [r.id, r.entityId, r.entityLabel, r.confidence, r.checkAt - NOW])).toEqual([
      ["new-1", "a", "Pierwsza nazwa", 0.51, 3 * DAY],
      ["new-2", "b", "Inny klient", 0.78, 7 * DAY],
    ]);
    expect(result.resolvedNow).toEqual([]);
    expect(result.ledger.map((r) => r.id)).toEqual([...ledger.map((r) => r.id), "new-1", "new-2"]);
    expect(JSON.stringify(ledger)).toBe(original);
    ledger.forEach((r, i) => expect(result.ledger[i]).toBe(r));
    const repeated = runPredictionCycle({ ledger: result.ledger, leads, awaitingPaymentByLead: { a: 100 }, now: NOW,
      learningEnabled: true, makeId: () => `new-${++ids}` });
    expect(repeated.changed).toBe(false);
    expect(repeated.ledger).toBe(result.ledger);
    expect(ids).toBe(2);
  });
});

describe("Kompatybilność wsteczna — stare dane bez nowego pola", () => {
  it("AppData sprzed tej fali (bez predictionLedger) działa: cykl startuje od pustego dziennika", () => {
    const oldData = { leads: [], financeProjects: [] } as unknown as AppData;
    expect(oldData.predictionLedger).toBeUndefined();
    const r = runPredictionCycle({
      ledger: oldData.predictionLedger || [],
      leads: [{ id: "a", company: "X", status: "contacted", lastContactedAt: NOW - 10 * DAY, overdue: true }],
      awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => "id1",
    });
    expect(r.created).toHaveLength(1);
    expect(verdictOf(r.created[0])).toBe("pending");
  });

  it("adapter store'a nie wybucha na braku pola i zapisuje je dopiero, gdy jest co zapisać", async () => {
    const { store } = await import("../src/lib/store");
    const { runPredictionCycleOnStore } = await import("../src/lib/predictionCycle");
    store.setData((d) => {
      (d as Partial<AppData>).predictionLedger = undefined; // stare dane: pola nie ma wcale
      d.leads = []; d.financeProjects = [];
    });
    const r = runPredictionCycleOnStore(NOW);
    expect(r.changed).toBe(false);
    expect(store.data.predictionLedger).toBeUndefined(); // zero zbędnych zapisów/migracji na siłę
  });
});
