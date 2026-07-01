// === Dziennik Predykcji v2 — testy silnika ===
// Pętla: obserwacja → FALSYFIKOWALNA prognoza (termin, pewność, założenia, zamrożone wejście) →
// realny wynik → DOWÓD zapisany OSOBNO (deterministyczna reguła, nie model) → kalibracja per encja
// (ograniczony krok, minimum obserwacji, wyłączalna) → lepsza następna decyzja.
import { describe, it, expect } from "vitest";
import {
  learnedWindowDays, calibratedConfidence, shouldRecordNeglectPrediction, recordNeglectPrediction,
  resolveDuePredictions, disputeEvidence, compactLedger, runPredictionCycle,
  calibrationSummary, calibrationText, explainLearning, verdictOf, PREDICTION_LOGIC_VERSION,
} from "../src/lib/predictionLedger";
import type { PredictionRecord, PredictionEvidence } from "../src/types";

const DAY = 86_400_000;
const NOW = 10_000_000_000;

const rec = (over: Partial<PredictionRecord> = {}): PredictionRecord => ({
  id: "p1", kind: "relationship_neglect", logicVersion: PREDICTION_LOGIC_VERSION,
  entityId: "L1", entityLabel: "Firma X", madeAt: NOW, checkAt: NOW + 7 * DAY,
  inputState: {}, claim: "test", successCriterion: "test", confidence: 0.7,
  assumptions: [], sources: [], basis: [], ...over,
});
const ev = (verdict: PredictionEvidence["verdict"], over: Partial<PredictionEvidence> = {}): PredictionEvidence => ({
  observedAt: NOW + 8 * DAY, outcome: "x", evidence: [], verdict, reason: "test", confidenceAfterResolution: 0.7, ...over,
});
const resolved = (verdict: PredictionEvidence["verdict"], over: Partial<PredictionRecord> = {}): PredictionRecord =>
  rec({ evidence: ev(verdict), ...over });

describe("verdictOf — pending, dopóki nie ma DOWODU", () => {
  it("brak evidence → pending; evidence → jego werdykt", () => {
    expect(verdictOf(rec())).toBe("pending");
    expect(verdictOf(resolved("correct"))).toBe("correct");
  });
});

describe("learnedWindowDays — uczone per encja, z bezpiecznikami", () => {
  it("za mało próbek (<2) → domyślne 7 dni, bez zgadywania", () => {
    expect(learnedWindowDays([], "L1")).toBe(7);
    expect(learnedWindowDays([resolved("correct", { id: "a" })], "L1")).toBe(7);
  });

  it("klient reagujący po ostrzeżeniu (większość prevented) → krótsze okno; krok ograniczony (-2)", () => {
    const history = [resolved("prevented", { id: "a" }), resolved("prevented", { id: "b" }), resolved("correct", { id: "c" })];
    expect(learnedWindowDays(history, "L1")).toBe(5);
  });

  it("klient, u którego przerwy bywają (większość correct) → standard 7 dni", () => {
    expect(learnedWindowDays([resolved("correct", { id: "a" }), resolved("correct", { id: "b" })], "L1")).toBe(7);
  });

  it("nie miesza historii różnych klientów", () => {
    const other = [resolved("prevented", { id: "a", entityId: "OTHER" }), resolved("prevented", { id: "b", entityId: "OTHER" })];
    expect(learnedWindowDays(other, "L1")).toBe(7);
  });

  it("uczenie WYŁĄCZONE → zawsze domyślne, mimo pełnej historii", () => {
    const history = [resolved("prevented", { id: "a" }), resolved("prevented", { id: "b" })];
    expect(learnedWindowDays(history, "L1", { learningEnabled: false })).toBe(7);
  });

  it("Finanse podnoszą stawkę: czekająca płatność → okno krótsze o 2 dni (z twardym minimum)", () => {
    expect(learnedWindowDays([], "L1", { awaitingPaymentAmount: 5000 })).toBe(5);
    const fast = [resolved("prevented", { id: "a" }), resolved("prevented", { id: "b" })];
    expect(learnedWindowDays(fast, "L1", { awaitingPaymentAmount: 5000 })).toBe(3); // 5-2, w granicach [3,21]
  });

  it("werdykty ZAKWESTIONOWANE (disputedAt) nie liczą się do uczenia", () => {
    const disputed = [
      resolved("prevented", { id: "a", evidence: ev("prevented", { disputedAt: NOW }) }),
      resolved("prevented", { id: "b", evidence: ev("prevented", { disputedAt: NOW }) }),
    ];
    expect(learnedWindowDays(disputed, "L1")).toBe(7); // efektywnie 0 próbek
  });
});

describe("calibratedConfidence — ograniczony krok, minimum obserwacji, wyłączalna", () => {
  it("bez historii / za mało próbek → bazowe 0.7", () => {
    expect(calibratedConfidence([], "L1")).toBe(0.7);
    expect(calibratedConfidence([resolved("correct", { id: "a" })], "L1")).toBe(0.7);
  });

  it("seria correct podnosi pewność STOPNIOWO (nigdy skokowo po jednym przypadku)", () => {
    const h2 = [resolved("correct", { id: "a" }), resolved("correct", { id: "b" })];
    const h3 = [...h2, resolved("correct", { id: "c" })];
    const c2 = calibratedConfidence(h2, "L1");
    const c3 = calibratedConfidence(h3, "L1");
    expect(c2).toBeGreaterThan(0.7);
    expect(c3).toBeGreaterThan(c2);
    expect(c3 - c2).toBeLessThan(0.15); // ograniczony krok
    expect(c3).toBeLessThanOrEqual(0.95);
  });

  it("seria błędów (prevented = ostrzeżenie nadgorliwe) OBNIŻA pewność, w granicach", () => {
    const h = [resolved("prevented", { id: "a" }), resolved("prevented", { id: "b" }), resolved("prevented", { id: "c" })];
    const c = calibratedConfidence(h, "L1");
    expect(c).toBeLessThan(0.7);
    expect(c).toBeGreaterThanOrEqual(0.35);
  });

  it("moot nic nie mówi o trafności — pomijane", () => {
    const h = [resolved("moot", { id: "a" }), resolved("moot", { id: "b" }), resolved("moot", { id: "c" })];
    expect(calibratedConfidence(h, "L1")).toBe(0.7);
  });

  it("uczenie wyłączone → bazowa pewność", () => {
    const h = [resolved("correct", { id: "a" }), resolved("correct", { id: "b" })];
    expect(calibratedConfidence(h, "L1", { learningEnabled: false })).toBe(0.7);
  });
});

describe("shouldRecordNeglectPrediction — bez duplikatów, stare rekordy nie blokują nowych okresów", () => {
  it("nie zaleca zapisu, gdy nie overdue", () => {
    expect(shouldRecordNeglectPrediction([], "L1", false)).toBe(false);
  });
  it("zaleca zapis, gdy overdue i brak czekającej prognozy", () => {
    expect(shouldRecordNeglectPrediction([], "L1", true)).toBe(true);
  });
  it("NIE duplikuje, gdy już jest pending dla tej encji", () => {
    expect(shouldRecordNeglectPrediction([rec()], "L1", true)).toBe(false);
  });
  it("rozstrzygnięta prognoza NIE blokuje nowej na inny okres", () => {
    expect(shouldRecordNeglectPrediction([resolved("correct")], "L1", true)).toBe(true);
    expect(shouldRecordNeglectPrediction([resolved("moot")], "L1", true)).toBe(true);
  });
});

describe("recordNeglectPrediction — kompletny, falsyfikowalny rekord (FABLE 5A)", () => {
  it("zawiera WSZYSTKO: zamrożone wejście, kryterium, termin, pewność, założenia, źródła, wersję logiki", () => {
    const p = recordNeglectPrediction("L1", "Firma X", { id: "n1", now: NOW, records: [], lastContactedAt: NOW - 10 * DAY, leadStatus: "contacted" });
    expect(p.logicVersion).toBe(PREDICTION_LOGIC_VERSION);
    expect(p.inputState).toEqual({ lastContactedAt: NOW - 10 * DAY, leadStatus: "contacted" });
    expect(p.claim).toContain("Firma X");
    expect(p.claim).toMatch(/7 dni/);
    expect(p.successCriterion).toMatch(/correct/);
    expect(p.successCriterion).toMatch(/prevented/);
    expect(p.successCriterion).toMatch(/moot/);
    expect(p.checkAt).toBe(NOW + 7 * DAY);
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThanOrEqual(1);
    expect(p.assumptions.length).toBeGreaterThan(0);
    expect(p.sources.join(" ")).toMatch(/lastContactedAt/);
    expect(p.basis.join(" ")).toMatch(/10 dni temu/);
    expect(p.evidence).toBeUndefined(); // pending — dowód powstaje później, OSOBNO
  });

  it("bez zapisanego kontaktu — przesłanka mówi to wprost, nie zmyśla daty", () => {
    const p = recordNeglectPrediction("L1", "Firma X", { id: "n1", now: NOW, records: [] });
    expect(p.basis.join(" ")).toMatch(/brak zapisanego kontaktu/);
    expect(p.claim).not.toMatch(/NaN|undefined/);
  });

  it("czekająca płatność (Finanse) trafia do wejścia, przesłanek i źródeł — i skraca okno", () => {
    const p = recordNeglectPrediction("L1", "Firma X", { id: "n1", now: NOW, records: [], awaitingPaymentAmount: 7000 });
    expect(p.inputState.awaitingPaymentAmount).toBe(7000);
    expect(p.basis.join(" ")).toMatch(/płatność/);
    expect(p.sources.join(" ")).toMatch(/Finanse/);
    expect(p.checkAt).toBe(NOW + 5 * DAY); // 7-2
  });
});

describe("resolveDuePredictions — DOWÓD osobno, prognoza nietknięta (FABLE 5B)", () => {
  const facts = (lastContactedAt?: number, status?: "contacted" | "won" | "lost") =>
    ({ L1: { lastContactedAt, status: status || ("contacted" as const) } });

  it("zostaje pending, gdy termin nie minął i brak kontaktu", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 1 * DAY, facts(undefined));
    expect(verdictOf(r)).toBe("pending");
  });

  it("prevented: kontakt w oknie — dowód z regułą, prognoza bajt w bajt nietknięta", () => {
    const original = rec();
    const [r] = resolveDuePredictions([original], NOW + 3 * DAY, facts(NOW + 2 * DAY));
    expect(verdictOf(r)).toBe("prevented");
    expect(r.evidence!.reason).toMatch(/reguła/);
    expect(r.evidence!.observedAt).toBe(NOW + 3 * DAY);
    expect(r.evidence!.evidence.length).toBeGreaterThan(0);
    // Treść PROGNOZY niezmieniona — wynik żyje wyłącznie w evidence.
    const { evidence: _e1, ...predictionPart } = r;
    const { evidence: _e2, ...originalPart } = original;
    expect(predictionPart).toEqual(originalPart);
  });

  it("correct: termin minął bez kontaktu — outcome faktograficzny", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 8 * DAY, facts(undefined));
    expect(verdictOf(r)).toBe("correct");
    expect(r.evidence!.outcome).toMatch(/Brak jakiegokolwiek kontaktu/);
  });

  it("correct także przy kontakcie spóźnionym (po terminie)", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 10 * DAY, facts(NOW + 9 * DAY));
    expect(verdictOf(r)).toBe("correct");
    expect(r.evidence!.outcome).toMatch(/spóźniony/);
  });

  it("moot, gdy sprawa zamknięta (won/lost) przed terminem", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 2 * DAY, facts(undefined, "won"));
    expect(verdictOf(r)).toBe("moot");
  });

  it("nieznana encja przy CZĘŚCIOWEJ wiedzy → pending (nie zgaduj)", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 30 * DAY, {});
    expect(verdictOf(r)).toBe("pending");
  });

  it("nieznana encja przy PEŁNYM stanie (factsComplete) → moot „usunięty lead”", () => {
    const [r] = resolveDuePredictions([rec()], NOW + 30 * DAY, {}, { factsComplete: true });
    expect(verdictOf(r)).toBe("moot");
    expect(r.evidence!.outcome).toMatch(/nie istnieje/);
  });

  it("zamknięta prognoza NIGDY nie otwiera się ponownie ani nie zmienia werdyktu", () => {
    const closed = resolved("correct");
    const [r] = resolveDuePredictions([closed], NOW + 30 * DAY, facts(NOW + 1));
    expect(r).toBe(closed); // ta sama referencja — zero ponownego przeliczania
  });

  it("cofnięty zegar NIE tworzy fałszywego sukcesu: przed checkAt nie ma „correct”", () => {
    // Zegar cofnięty do momentu przed terminem — mimo że kiedyś było „po terminie".
    const [r] = resolveDuePredictions([rec()], NOW + 1 * DAY, facts(undefined));
    expect(verdictOf(r)).toBe("pending");
  });

  it("idempotencja: brak zmian → TA SAMA referencja tablicy (wołający nie zapisuje store)", () => {
    const list = [rec()];
    const out = resolveDuePredictions(list, NOW + 1 * DAY, facts(undefined));
    expect(out).toBe(list);
  });

  it("duplikaty klientów (ta sama nazwa, różne ID) mają NIEZALEŻNE rozstrzygnięcia", () => {
    const recs = [rec({ id: "a", entityId: "L1", entityLabel: "Acme" }), rec({ id: "b", entityId: "L2", entityLabel: "Acme" })];
    const out = resolveDuePredictions(recs, NOW + 8 * DAY, {
      L1: { lastContactedAt: NOW + 1 * DAY, status: "contacted" },
      L2: { lastContactedAt: undefined, status: "contacted" },
    });
    expect(verdictOf(out.find((r) => r.entityId === "L1")!)).toBe("prevented");
    expect(verdictOf(out.find((r) => r.entityId === "L2")!)).toBe("correct");
  });
});

describe("disputeEvidence — użytkownik oznacza dowód jako błędny (FABLE 5F)", () => {
  it("ustawia disputedAt, zachowuje rekord i werdykt (audyt), wyklucza z uczenia", () => {
    const list = [resolved("correct", { id: "a" }), resolved("correct", { id: "b" })];
    const out = disputeEvidence(list, "a", NOW + 9 * DAY);
    expect(out[0].evidence!.disputedAt).toBe(NOW + 9 * DAY);
    expect(out[0].evidence!.verdict).toBe("correct"); // werdykt zostaje — tylko wypada z liczenia
    expect(calibrationSummary(out).correct).toBe(1);
    expect(calibrationSummary(out).disputed).toBe(1);
  });
  it("pending i już zakwestionowanych nie da się „zakwestionować” ponownie", () => {
    const list = [rec({ id: "p" })];
    expect(disputeEvidence(list, "p", NOW)).toBe(list);
    const once = disputeEvidence([resolved("correct", { id: "a" })], "a", NOW);
    expect(disputeEvidence(once, "a", NOW + 1)).toBe(once);
  });
});

describe("compactLedger — ograniczony rozmiar (S9), pending nietykalne", () => {
  it("w granicach limitów → ta sama referencja (zero pracy)", () => {
    const list = [rec(), resolved("correct", { id: "b" })];
    expect(compactLedger(list)).toBe(list);
  });
  it("nadmiar rozstrzygniętych per encja → zostają najnowsze, pending nigdy nie wypada", () => {
    const many: PredictionRecord[] = [];
    for (let i = 0; i < 20; i++) many.push(resolved("correct", { id: `r${i}`, madeAt: NOW + i * DAY, checkAt: NOW + (i + 7) * DAY }));
    many.push(rec({ id: "pending1", madeAt: NOW + 100 * DAY }));
    const out = compactLedger(many);
    expect(out.length).toBe(13); // 12 najnowszych rozstrzygniętych + 1 pending
    expect(out.some((r) => r.id === "pending1")).toBe(true);
    expect(out.some((r) => r.id === "r19")).toBe(true);
    expect(out.some((r) => r.id === "r0")).toBe(false); // najstarsze wypadły
  });
});

describe("runPredictionCycle — pełny, idempotentny cykl (FABLE 5C)", () => {
  const leads = (overdue: boolean) => [
    { id: "L1", company: "Firma X", status: "contacted" as const, lastContactedAt: NOW - 10 * DAY, overdue },
  ];

  it("overdue lead bez prognozy → tworzy JEDNĄ; drugi przebieg z tymi samymi danymi → zero zmian", () => {
    let n = 0;
    const first = runPredictionCycle({ ledger: [], leads: leads(true), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => `id${++n}` });
    expect(first.changed).toBe(true);
    expect(first.created).toHaveLength(1);
    const second = runPredictionCycle({ ledger: first.ledger, leads: leads(true), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => `id${++n}` });
    expect(second.changed).toBe(false);
    expect(second.ledger).toBe(first.ledger); // ta sama referencja — restart/wielokrotny cykl bez duplikatów
  });

  it("nie-overdue → nic nie tworzy; pusty stan → zero zmian", () => {
    const r = runPredictionCycle({ ledger: [], leads: leads(false), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => "x" });
    expect(r.changed).toBe(false);
    expect(r.created).toHaveLength(0);
  });

  it("czekająca płatność z Finansów zmienia treść prognozy (okno/przesłanki) — realna integracja, nie import", () => {
    const withPay = runPredictionCycle({ ledger: [], leads: leads(true), awaitingPaymentByLead: { L1: 8000 }, now: NOW, learningEnabled: true, makeId: () => "a" });
    const without = runPredictionCycle({ ledger: [], leads: leads(true), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => "a" });
    expect(withPay.created[0].checkAt).toBeLessThan(without.created[0].checkAt);
    expect(withPay.created[0].basis.join(" ")).toMatch(/płatność/);
  });

  it("po terminie: cykl rozstrzyga i (nadal overdue) zakłada nową na NOWY okres", () => {
    let n = 0;
    const makeId = () => `id${++n}`;
    const day0 = runPredictionCycle({ ledger: [], leads: leads(true), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId });
    const day8 = runPredictionCycle({ ledger: day0.ledger, leads: leads(true), awaitingPaymentByLead: {}, now: NOW + 8 * DAY, learningEnabled: true, makeId });
    expect(day8.resolvedNow).toHaveLength(1);
    expect(verdictOf(day8.resolvedNow[0])).toBe("correct");
    expect(day8.created).toHaveLength(1); // nowa prognoza na nowy okres — stara nie blokuje
    expect(day8.ledger).toHaveLength(2);
  });

  it("usunięty lead: prognoza rozstrzyga się jako moot (pełny stan danych), bez crasha", () => {
    let n = 0;
    const start = runPredictionCycle({ ledger: [], leads: leads(true), awaitingPaymentByLead: {}, now: NOW, learningEnabled: true, makeId: () => `id${++n}` });
    const afterDelete = runPredictionCycle({ ledger: start.ledger, leads: [], awaitingPaymentByLead: {}, now: NOW + 1 * DAY, learningEnabled: true, makeId: () => `id${++n}` });
    expect(afterDelete.resolvedNow).toHaveLength(1);
    expect(verdictOf(afterDelete.resolvedNow[0])).toBe("moot");
  });
});

describe("calibrationSummary / calibrationText / explainLearning — uczciwe podsumowania", () => {
  it("zero predykcji → jasny komunikat, nie zmyślona statystyka", () => {
    const s = calibrationSummary([]);
    expect(s.total).toBe(0);
    expect(calibrationText(s)).toMatch(/Jeszcze żadnych/);
  });

  it("liczy każdy werdykt; zakwestionowane OSOBNO", () => {
    const recs = [
      resolved("correct", { id: "a" }), resolved("prevented", { id: "b" }), rec({ id: "c" }), resolved("moot", { id: "d" }),
      resolved("correct", { id: "e", evidence: ev("correct", { disputedAt: NOW }) }),
    ];
    const s = calibrationSummary(recs);
    expect(s).toEqual({ total: 5, pending: 1, correct: 1, prevented: 1, moot: 1, disputed: 1 });
    expect(calibrationText(s)).toMatch(/1 razy przerwa faktycznie się pogłębiła/);
    expect(calibrationText(s)).toMatch(/oznaczyłeś jako błędne/);
  });

  it("filtruje po entityId, gdy podane", () => {
    const recs = [resolved("correct", { id: "a", entityId: "L1" }), resolved("correct", { id: "b", entityId: "L2" })];
    expect(calibrationSummary(recs, "L1").total).toBe(1);
  });

  it("explainLearning: mówi wprost, gdy za mało danych / uczenie wyłączone / czego się nauczył", () => {
    expect(explainLearning([], "L1")).toMatch(/Za mało rozstrzygnięć/);
    expect(explainLearning([], "L1", { learningEnabled: false })).toMatch(/Uczenie wyłączone/);
    const h = [resolved("prevented", { id: "a" }), resolved("prevented", { id: "b" })];
    const text = explainLearning(h, "L1");
    expect(text).toMatch(/okno ostrzeżenia 5 dni/);
    expect(text).toMatch(/prognozy, nie fakty/);
  });
});

// Wpięcie do czatu/głosu — narzędzie tylko CZYTA dziennik (zero zapisu, zero sieci).
describe("predictionLedger — narzędzie czatu (prediction_ledger_status)", () => {
  it("jest w toolDefs i sklasyfikowane read", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const { riskOf } = await import("../src/lib/permissions");
    expect(toolDefs.some((d) => d.name === "prediction_ledger_status")).toBe(true);
    expect(riskOf("prediction_ledger_status")).toBe("read");
  });

  it("bez zapisanych predykcji zwraca uczciwy komunikat, nie zmyśloną statystykę", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => { d.predictionLedger = []; d.leads = []; });
    const res = await runTool("prediction_ledger_status", {});
    expect(res).toMatch(/Jeszcze żadnych/);
  });

  it("liczy REALNE dane store + wyjaśnia uczenie dla klienta", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => {
      d.leads = [{ id: "l1", company: "Delta", status: "new", createdAt: 1, updatedAt: 1 }];
      d.predictionLedger = [resolved("correct", { id: "x", entityId: "l1", entityLabel: "Delta" })];
    });
    const res = String(await runTool("prediction_ledger_status", { company: "Delta" }));
    expect(res).toMatch(/1 razy przerwa faktycznie się pogłębiła/);
    expect(res).toMatch(/Za mało rozstrzygnięć|okno ostrzeżenia/);
  });

  it("nieznany klient → jasny komunikat, nie zerowe udawanie danych", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => { d.leads = []; });
    const res = await runTool("prediction_ledger_status", { company: "Nieistniejąca Firma" });
    expect(res).toMatch(/Nie znalazłem klienta/);
  });
});
