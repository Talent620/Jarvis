// === Benchmark Dziennika Predykcji (v2) — z baseline, ground truth i progami regresji ===
// To NIE jest „zbiór testów jednostkowych nazwany benchmarkiem": scenariusz jest WERSJONOWANY
// (SCENARIO_VERSION), ground truth DETERMINISTYCZNY (spisany z góry, per klient), progi regresji
// TWARDE (przekroczenie = czerwone CI), a raport dla człowieka żyje w
// docs/benchmarks/prediction-ledger.md (liczby tam muszą zgadzać się z progami tutaj).
//
// Pomiar odbywa się na PRAWDZIWYM silniku produkcyjnym (runPredictionCycle — dokładnie ta funkcja,
// którą woła cykl aplikacji), dzień po dniu, z symulacją restartu aplikacji (serializacja JSON
// każdego dnia) i wielokrotnego uruchomienia tego samego cyklu (każdy dzień liczony DWA razy).
//
// Baseline „przed zmianą": Dziennik Predykcji nie istniał — JARVIS nie miał ŻADNEJ pamięci
// własnych przewidywań ani celności (wszystkie metryki poniżej: brak możliwości pomiaru).
// „Po zmianie": każda metryka ma zmierzoną wartość i próg.
//
// Świadomie NIEZMIERZONE (bez fałszywych liczb): koszt tokenów modelu (silnik nie woła modelu —
// koszt 0 z konstrukcji, potwierdzone zatrutym fetch) i realny wpływ biznesowy (wymaga tygodni
// prawdziwego użycia — nie da się uczciwie zmierzyć w CI).
import { describe, it, expect } from "vitest";
import { runPredictionCycle, verdictOf, calibrationSummary, calibrationText } from "../src/lib/predictionLedger";
import type { PredictionRecord, LeadStatus } from "../src/types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const START = 20_000_000_000;

export const SCENARIO_VERSION = "v2 (2026-07)";

// ── Scenariusz: 10 klientów × 90 dni. Obejmuje wymagane przypadki: reakcja szybka/nigdy,
// zmiana statusu w połowie okresu (won/lost), kontakt TUŻ PRZED i TUŻ PO terminie, czekająca
// płatność (Finanse), duplikat nazwy, usunięty lead, brak historii. Dzień 14 globalnie POMINIĘTY
// (aplikacja zamknięta) — dzięki temu gałąź „kontakt spóźniony po terminie" jest realnie osiągalna.
interface ClientTimeline {
  id: string;
  label: string;
  /** Momenty kontaktu w ms względem START. */
  contacts: number[];
  statusAtDay?: number;
  statusTo?: LeadStatus;
  deletedAtDay?: number;
  awaitingPayment?: number;
}
const SCENARIO: ClientTimeline[] = [
  { id: "A", label: "Klient A (reaguje po ostrzeżeniu)", contacts: [0, 8, 9, 17, 18, 26, 27, 35, 36, 44, 45, 53, 54, 62, 63, 71, 72, 80, 81, 89].map((d) => d * DAY) },
  { id: "B", label: "Klient B (nigdy nie reaguje)", contacts: [0] },
  { id: "C", label: "Klient C (wygrana w połowie okresu)", contacts: [0], statusAtDay: 10, statusTo: "won" },
  { id: "D", label: "Klient D (przegrana w połowie okresu)", contacts: [0], statusAtDay: 10, statusTo: "lost" },
  { id: "E", label: "Klient E (zero historii kontaktu)", contacts: [] },
  { id: "F", label: "Klient F (kontakt TUŻ PRZED terminem)", contacts: [0, 14 * DAY] }, // dokładnie na checkAt (madeAt d7 + 7 dni)
  { id: "G", label: "Klient G (kontakt TUŻ PO terminie)", contacts: [0, 14 * DAY + HOUR] }, // godzinę po checkAt
  { id: "H", label: "Klient H (czeka płatność 8000 zł)", contacts: [0], awaitingPayment: 8000 },
  { id: "I", label: "Klient B (nigdy nie reaguje)", contacts: [0, 20 * DAY] }, // DUPLIKAT NAZWY klienta B, inne ID
  { id: "J", label: "Klient J (usunięty w trakcie)", contacts: [0], deletedAtDay: 12 },
];
const SKIPPED_DAYS = new Set([14]); // aplikacja zamknięta — cykl tego dnia nie działa

// ── GROUND TRUTH (deterministyczny, spisany z góry — silnik ma go ODTWORZYĆ, nie zdefiniować) ──
const GROUND_TRUTH: Record<string, { correctMin: number; preventedMin: number; mootExact?: number; forbidden: string[] }> = {
  A: { correctMin: 0, preventedMin: 4, forbidden: ["correct"] },
  B: { correctMin: 3, preventedMin: 0, forbidden: ["prevented", "moot"] },
  C: { correctMin: 0, preventedMin: 0, mootExact: 1, forbidden: ["correct", "prevented"] },
  D: { correctMin: 0, preventedMin: 0, mootExact: 1, forbidden: ["correct", "prevented"] },
  E: { correctMin: 3, preventedMin: 0, forbidden: ["prevented", "moot"] },
  F: { correctMin: 1, preventedMin: 1, forbidden: [] }, // pierwsza prevented (kontakt na styk), potem correct
  G: { correctMin: 2, preventedMin: 0, forbidden: ["prevented"] }, // spóźniony kontakt to NADAL przerwa
  H: { correctMin: 1, preventedMin: 0, forbidden: ["prevented"] },
  I: { correctMin: 1, preventedMin: 1, forbidden: [] }, // niezależnie od duplikatu nazwy B
  J: { correctMin: 0, preventedMin: 0, mootExact: 1, forbidden: ["correct", "prevented"] },
};

/** Pełny przebieg scenariusza na PRODUKCYJNYM cyklu: restart (JSON) co dzień, każdy dzień 2×. */
function runScenario(): { ledger: PredictionRecord[]; makeIdCalls: number } {
  let ledger: PredictionRecord[] = [];
  let n = 0;
  const makeId = () => `pred-${++n}`;
  for (let day = 0; day <= 90; day++) {
    if (SKIPPED_DAYS.has(day)) continue;
    const now = START + day * DAY;
    const leads = SCENARIO
      .filter((c) => c.deletedAtDay == null || day < c.deletedAtDay)
      .map((c) => {
        const lastContactedAt = c.contacts.filter((t) => START + t <= now).map((t) => START + t).pop();
        const status: LeadStatus = c.statusAtDay != null && day >= c.statusAtDay ? (c.statusTo as LeadStatus) : "contacted";
        const active = status === "contacted" || status === "offer";
        const overdue = active && (lastContactedAt == null || now - lastContactedAt >= 7 * DAY);
        return { id: c.id, company: c.label, status, lastContactedAt, overdue };
      });
    const awaitingPaymentByLead: Record<string, number> = {};
    for (const c of SCENARIO) if (c.awaitingPayment) awaitingPaymentByLead[c.id] = c.awaitingPayment;
    // Restart aplikacji: stan przechodzi przez serializację (jak IndexedDB/localStorage).
    ledger = JSON.parse(JSON.stringify(ledger)) as PredictionRecord[];
    // Ten sam cykl DWA razy (podwójny tick) — drugi przebieg nie ma prawa nic zmienić.
    const first = runPredictionCycle({ ledger, leads, awaitingPaymentByLead, now, learningEnabled: true, makeId });
    const second = runPredictionCycle({ ledger: first.ledger, leads, awaitingPaymentByLead, now, learningEnabled: true, makeId });
    if (second.changed) throw new Error(`Dzień ${day}: drugi przebieg tego samego cyklu coś zmienił (duplikaty!)`);
    ledger = second.ledger;
  }
  return { ledger, makeIdCalls: n };
}

const forClient = (ledger: PredictionRecord[], id: string) => ledger.filter((r) => r.entityId === id);
const verdicts = (ledger: PredictionRecord[], id: string) => forClient(ledger, id).map(verdictOf);

describe(`Benchmark Dziennika Predykcji — scenariusz ${SCENARIO_VERSION}, 10 klientów × 90 dni`, () => {
  it("1) odsetek poprawnie rozwiązanych: KAŻDY klient zgodny z ground truth (wymagane 10/10)", () => {
    const { ledger } = runScenario();
    for (const [id, gt] of Object.entries(GROUND_TRUTH)) {
      const vs = verdicts(ledger, id);
      const count = (v: string) => vs.filter((x) => x === v).length;
      expect(count("correct"), `klient ${id}: correct`).toBeGreaterThanOrEqual(gt.correctMin);
      expect(count("prevented"), `klient ${id}: prevented`).toBeGreaterThanOrEqual(gt.preventedMin);
      if (gt.mootExact != null) expect(count("moot"), `klient ${id}: moot`).toBe(gt.mootExact);
      for (const f of gt.forbidden) expect(count(f), `klient ${id}: zakazany werdykt ${f}`).toBe(0);
    }
  });

  it("2) false-positive rate = 0: każde „prevented” ma REALNY kontakt w oknie (wprost z surowych danych)", () => {
    const { ledger } = runScenario();
    const byId = new Map(SCENARIO.map((c) => [c.id, c]));
    const falsePositives = ledger.filter((r) => {
      if (verdictOf(r) !== "prevented") return false;
      const c = byId.get(r.entityId)!;
      return !c.contacts.some((t) => START + t > r.madeAt && START + t <= r.checkAt);
    });
    expect(falsePositives).toHaveLength(0);
  });

  it("3) ZERO fałszywych „correct” — twardy próg regresji CI (kontakt w oknie wyklucza correct)", () => {
    const { ledger } = runScenario();
    const byId = new Map(SCENARIO.map((c) => [c.id, c]));
    const falseClaims = ledger.filter((r) => {
      if (verdictOf(r) !== "correct") return false;
      const c = byId.get(r.entityId)!;
      return c.contacts.some((t) => START + t > r.madeAt && START + t <= r.checkAt);
    });
    expect(falseClaims).toHaveLength(0); // wzrost powyżej 0 = PADA CI
  });

  it("4) ZERO duplikatów — twardy próg: unikalne ID, maks. jedna czekająca prognoza per klient", () => {
    const { ledger } = runScenario();
    expect(new Set(ledger.map((r) => r.id)).size).toBe(ledger.length);
    const pendingPerEntity = new Map<string, number>();
    for (const r of ledger) {
      if (r.evidence) continue;
      pendingPerEntity.set(r.entityId, (pendingPerEntity.get(r.entityId) || 0) + 1);
    }
    for (const [id, n] of pendingPerEntity) expect(n, `pending dla ${id}`).toBeLessThanOrEqual(1);
  });

  it("5) zero nieaktualnego kontekstu: przesłanki każdej prognozy zgodne z surowymi danymi w chwili utworzenia", () => {
    const { ledger } = runScenario();
    const byId = new Map(SCENARIO.map((c) => [c.id, c]));
    for (const r of ledger) {
      const c = byId.get(r.entityId)!;
      const lastBefore = c.contacts.filter((t) => START + t <= r.madeAt).map((t) => START + t).pop();
      // Zamrożony stan wejściowy musi odpowiadać REALNEMU stanowi w chwili madeAt — nie późniejszemu.
      expect(r.inputState.lastContactedAt, `inputState ${r.id}`).toBe(lastBefore);
      if (lastBefore != null) {
        const days = Math.round((r.madeAt - lastBefore) / DAY);
        expect(r.basis[0], `basis ${r.id}`).toContain(`${days} dni temu`);
      } else {
        expect(r.basis[0]).toMatch(/brak zapisanego kontaktu/);
      }
    }
  });

  it("6) szczegóły graniczne: F (na styk) prevented; G (godzinę po) correct-spóźniony; H krótsze okno z Finansów", () => {
    const { ledger } = runScenario();
    expect(verdicts(ledger, "F")[0]).toBe("prevented"); // kontakt DOKŁADNIE na checkAt = jeszcze w oknie
    const g = forClient(ledger, "G")[0];
    expect(verdictOf(g)).toBe("correct");
    expect(g.evidence!.outcome).toMatch(/spóźniony/);
    const h = forClient(ledger, "H")[0];
    expect(h.checkAt - h.madeAt).toBe(5 * DAY); // okno 7-2 (czekająca płatność)
    expect(h.basis.join(" ")).toMatch(/płatność/);
    // Duplikat nazwy: I ma własne, niezależne werdykty (nie miesza się z B mimo tej samej etykiety).
    expect(verdicts(ledger, "I")).toContain("prevented");
    expect(verdicts(ledger, "B")).not.toContain("prevented");
  });

  it("7) kalibracja: prognozy o wysokiej pewności trafniejsze niż o niskiej (twardy próg)", () => {
    const { ledger } = runScenario();
    const resolvedRecs = ledger.filter((r) => r.evidence && verdictOf(r) !== "moot");
    const accuracy = (recs: PredictionRecord[]) => recs.filter((r) => verdictOf(r) === "correct").length / Math.max(1, recs.length);
    const high = resolvedRecs.filter((r) => r.confidence >= 0.75);
    const low = resolvedRecs.filter((r) => r.confidence <= 0.65);
    expect(high.length, "za mało prognoz wysokiej pewności — scenariusz nie ćwiczy kalibracji").toBeGreaterThanOrEqual(2);
    expect(low.length, "za mało prognoz niskiej pewności — scenariusz nie ćwiczy kalibracji").toBeGreaterThanOrEqual(2);
    expect(accuracy(high)).toBeGreaterThan(accuracy(low));
    // Uczenie per encja: pewność dla B (nigdy nie reaguje) ROŚNIE, dla A (zawsze reaguje) SPADA.
    const lastB = forClient(ledger, "B").slice(-1)[0];
    const lastA = forClient(ledger, "A").slice(-1)[0];
    expect(lastB.confidence).toBeGreaterThan(0.7);
    expect(lastA.confidence).toBeLessThan(0.7);
  });

  it("8) narzędzia/zgody: prediction_ledger_status jest read i NIGDY nie rusza leads/finance", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    const { riskOf } = await import("../src/lib/permissions");
    expect(riskOf("prediction_ledger_status")).toBe("read");
    const { ledger } = runScenario();
    store.setData((d) => {
      d.predictionLedger = ledger;
      d.leads = [{ id: "A", company: "Klient A (reaguje po ostrzeżeniu)", status: "new", createdAt: 1, updatedAt: 1 }];
      d.financeProjects = [];
    });
    const leadsBefore = JSON.stringify(store.data.leads);
    const financeBefore = JSON.stringify(store.data.financeProjects);
    await runTool("prediction_ledger_status", {});
    expect(JSON.stringify(store.data.leads)).toBe(leadsBefore);
    expect(JSON.stringify(store.data.financeProjects)).toBe(financeBefore);
  });

  it("9) czas lokalnego przetwarzania: pełny scenariusz (10 klientów × 90 dni, restarty, 2× cykle) < 250 ms", () => {
    const t0 = Date.now();
    runScenario();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(250); // szczodry budżet S9; realny pomiar w raporcie benchmarku
  });

  it("10) koszt zero / offline: cały przebieg z ZATRUTYM fetch — silnik nie dotyka sieci ani modelu", () => {
    const realFetch = global.fetch;
    global.fetch = (() => Promise.reject(new Error("Dziennik Predykcji nie może dotykać sieci"))) as unknown as typeof fetch;
    try {
      const { ledger } = runScenario();
      expect(ledger.length).toBeGreaterThan(0);
    } finally {
      global.fetch = realFetch;
    }
  });

  it("baseline przed/po: przed zmianą JARVIS nie miał ŻADNEJ pamięci własnej celności; po — konkretne liczby", () => {
    // Przed: taki silnik nie istniał — jedyny uczciwy stan „przed" to pusty (bez zmyślonych liczb).
    expect(calibrationText(calibrationSummary([]))).toMatch(/Jeszcze żadnych/);
    // Po: realne, policzalne wyniki z realnego silnika.
    const { ledger } = runScenario();
    const after = calibrationSummary(ledger);
    expect(after.total).toBeGreaterThan(10);
    expect(after.correct).toBeGreaterThan(0);
    expect(after.prevented).toBeGreaterThan(0);
    expect(after.moot).toBeGreaterThan(0);
    expect(calibrationText(after)).not.toMatch(/Jeszcze żadnych/);
  });
});
