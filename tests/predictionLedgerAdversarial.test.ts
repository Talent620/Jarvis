// === Atak na Dziennik Predykcji v2 — testy adwersarialne ===
// Każdy test sprawdza granicę WIDZIANĄ przez użytkownika przy danych sprzecznych, przestarzałych,
// zduplikowanych, z przyszłości, po cofnięciu zegara, po usunięciu leada i przy zmianie zdania.
// Silnik jest w 100% lokalny i deterministyczny (offline/koszt: benchmark) — tu integralność DANYCH.
import { describe, it, expect } from "vitest";
import {
  recordNeglectPrediction, resolveDuePredictions, shouldRecordNeglectPrediction, learnedWindowDays,
  calibratedConfidence, disputeEvidence, runPredictionCycle, verdictOf, PREDICTION_LOGIC_VERSION,
} from "../src/lib/predictionLedger";
import type { PredictionRecord, PredictionEvidence } from "../src/types";

const DAY = 86_400_000;
const NOW = 30_000_000_000;

const rec = (over: Partial<PredictionRecord> = {}): PredictionRecord => ({
  id: "p1", kind: "relationship_neglect", logicVersion: PREDICTION_LOGIC_VERSION,
  entityId: "L1", entityLabel: "Firma X", madeAt: NOW, checkAt: NOW + 7 * DAY,
  inputState: {}, claim: "test", successCriterion: "test", confidence: 0.7,
  assumptions: [], sources: [], basis: [], ...over,
});
const ev = (verdict: PredictionEvidence["verdict"], over: Partial<PredictionEvidence> = {}): PredictionEvidence => ({
  observedAt: NOW + 8 * DAY, outcome: "x", evidence: [], verdict, reason: "test", confidenceAfterResolution: 0.7, ...over,
});

describe("Atak: dane sprzeczne, przestarzałe i z przyszłości", () => {
  it("kontakt zapisany w PRZYSZŁOŚCI (zepsute dane) nie wysadza rozstrzygnięcia ani nie mówi absurdu", () => {
    const future = NOW + 999 * DAY;
    const [r] = resolveDuePredictions([rec()], NOW + 8 * DAY, { L1: { lastContactedAt: future, status: "contacted" } });
    expect(["correct", "prevented"]).toContain(verdictOf(r));
    expect(r.evidence!.outcome).not.toMatch(/NaN|undefined/);
  });

  it("sprzeczne źródła poprawione WSTECZ: pending zawsze liczy z NAJŚWIEŻSZEGO stanu, nie z cache", () => {
    // Najpierw brak kontaktu → zostaje pending.
    let ledger = resolveDuePredictions([rec()], NOW + 3 * DAY, { L1: { lastContactedAt: undefined, status: "contacted" } });
    expect(verdictOf(ledger[0])).toBe("pending");
    // Użytkownik retroaktywnie dopisuje kontakt (zapomniał zapisać) — silnik przelicza z aktualnych faktów.
    ledger = resolveDuePredictions(ledger, NOW + 3 * DAY, { L1: { lastContactedAt: NOW + 1 * DAY, status: "contacted" } });
    expect(verdictOf(ledger[0])).toBe("prevented");
  });

  it("cofnięty zegar urządzenia NIE odwraca zamkniętej prognozy i NIE tworzy fałszywego sukcesu", () => {
    // Rozstrzygnięta „correct" o czasie…
    const [closed] = resolveDuePredictions([rec()], NOW + 8 * DAY, { L1: { lastContactedAt: undefined, status: "contacted" } });
    expect(verdictOf(closed)).toBe("correct");
    // …zegar cofa się PRZED termin — zamknięta prognoza zostaje bajt w bajt (ta sama referencja).
    const [afterRollback] = resolveDuePredictions([closed], NOW + 1 * DAY, { L1: { lastContactedAt: NOW + 2 * DAY, status: "contacted" } });
    expect(afterRollback).toBe(closed);
    // A świeża prognoza przy cofniętym zegarze nie dostaje „correct" przed terminem.
    const [fresh] = resolveDuePredictions([rec({ id: "fresh" })], NOW - 5 * DAY, { L1: { lastContactedAt: undefined, status: "contacted" } });
    expect(verdictOf(fresh)).toBe("pending");
  });

  it("zmiana statusu W POŁOWIE okna (won) → moot, nawet jeśli potem status wróciłby do aktywnego", () => {
    const [mid] = resolveDuePredictions([rec()], NOW + 3 * DAY, { L1: { lastContactedAt: undefined, status: "won" } });
    expect(verdictOf(mid)).toBe("moot");
    const [after] = resolveDuePredictions([mid], NOW + 9 * DAY, { L1: { lastContactedAt: undefined, status: "contacted" } });
    expect(after).toBe(mid); // zamknięte zostaje zamknięte
  });
});

describe("Atak: duplikaty klientów (ta sama nazwa firmy, różne rekordy CRM)", () => {
  it("narzędzie czatu NIE zgaduje, którego duplikatu dotyczy pytanie — mówi to wprost", async () => {
    const { runTool } = await import("../src/lib/tools");
    const { store } = await import("../src/lib/store");
    store.setData((d) => {
      d.leads = [
        { id: "dup1", company: "Acme", status: "new", createdAt: 1, updatedAt: 1 },
        { id: "dup2", company: "acme", status: "new", createdAt: 1, updatedAt: 1 },
      ];
      d.predictionLedger = [
        rec({ id: "a", entityId: "dup1", evidence: ev("correct") }),
        rec({ id: "b", entityId: "dup2", evidence: ev("prevented") }),
      ];
    });
    const res = await runTool("prediction_ledger_status", { company: "Acme" });
    expect(res).toMatch(/2 klientów/);
    expect(res).not.toMatch(/1 razy/); // nie podaje liczb JEDNEGO z nich, jakby to było pewne
  });

  it("silnik trzyma zupełnie niezależne rekordy per entityId, mimo identycznej etykiety", () => {
    const p1 = recordNeglectPrediction("dup1", "Acme", { id: "x", now: NOW, records: [] });
    const p2 = recordNeglectPrediction("dup2", "Acme", { id: "y", now: NOW, records: [p1] });
    expect(p1.entityId).not.toBe(p2.entityId);
    expect(shouldRecordNeglectPrediction([p1], "dup2", true)).toBe(true); // dup2 nie „zasłonięty" przez pending dup1
  });
});

describe("Atak: błędne/niekompletne daty", () => {
  it("brak lastContactedAt nie crashuje i daje uczciwą przesłankę", () => {
    const p = recordNeglectPrediction("L1", "Firma X", { id: "x", now: NOW, records: [] });
    expect(p.basis.join(" ")).toMatch(/brak zapisanego kontaktu/);
    expect(p.claim).not.toMatch(/NaN|undefined/);
  });

  it("kontakt „z przyszłości” przy tworzeniu (cofnięty zegar) nie daje ujemnych dni w przesłance", () => {
    const p = recordNeglectPrediction("L1", "Firma X", { id: "x", now: NOW, records: [], lastContactedAt: NOW + 5 * DAY });
    expect(p.basis.join(" ")).not.toMatch(/-\d+ dni temu/);
  });
});

describe("Atak: model NIE może fabrykować własnej historii trafności", () => {
  it("żadne narzędzie czatu nie potrafi ZAPISAĆ do predictionLedger (odczyt to jedyna droga modelu)", async () => {
    const { toolDefs } = await import("../src/lib/tools");
    const src = await import("node:fs").then((fs) => fs.readFileSync("src/lib/tools.ts", "utf8"));
    // Strażnik architektury (dodatkowy, nie główny dowód): zero zapisów predictionLedger w tools.ts.
    expect(src).not.toMatch(/d\.predictionLedger\s*=/);
    expect(toolDefs.filter((d) => d.name.startsWith("prediction_"))).toHaveLength(1);
  });

  it("werdykt pochodzi z deterministycznej reguły — evidence.reason zawsze cytuje regułę", () => {
    const out = resolveDuePredictions(
      [rec({ id: "a" }), rec({ id: "b", entityId: "L2" })],
      NOW + 8 * DAY,
      { L1: { lastContactedAt: NOW + DAY, status: "contacted" }, L2: { lastContactedAt: undefined, status: "contacted" } },
    );
    for (const r of out) expect(r.evidence!.reason).toMatch(/reguła:/);
  });
});

describe("Atak: użytkownik zmienia zdanie / poprawia błędny dowód", () => {
  it("po moot (sprawa zamknięta) i ponownym otwarciu klienta nowa zaległość znów jest przewidywalna", () => {
    const ledger = [rec({ evidence: ev("moot") })];
    expect(shouldRecordNeglectPrediction(ledger, "L1", true)).toBe(true);
  });

  it("oznaczenie dowodu jako błędnego ZMIENIA następną decyzję (okno wraca do domyślnego) — uczenie realnie reaguje", () => {
    const history = [rec({ id: "a", evidence: ev("prevented") }), rec({ id: "b", evidence: ev("prevented") })];
    expect(learnedWindowDays(history, "L1")).toBe(5); // nauczone: krótsze okno
    const corrected = disputeEvidence(history, "a", NOW + 9 * DAY);
    expect(learnedWindowDays(corrected, "L1")).toBe(7); // 1 ważna próbka < minimum → domyślne
  });

  it("wyczyszczenie historii zeruje uczenie (okno i pewność wracają do domyślnych)", () => {
    const history = [rec({ id: "a", evidence: ev("correct") }), rec({ id: "b", evidence: ev("correct") })];
    expect(calibratedConfidence(history, "L1")).toBeGreaterThan(0.7);
    expect(calibratedConfidence([], "L1")).toBe(0.7);
    expect(learnedWindowDays([], "L1")).toBe(7);
  });
});

describe("Atak: uczenie nie oszaleje przy skrajnej liczbie próbek", () => {
  it("dokładnie 2 próbki (minimalny próg) — bez wyjątku, w granicach", () => {
    const history = [rec({ id: "a", evidence: ev("prevented") }), rec({ id: "b", evidence: ev("prevented") })];
    const w = learnedWindowDays(history, "L1");
    expect(w).toBeGreaterThanOrEqual(3);
    expect(w).toBeLessThanOrEqual(21);
  });

  it("setki próbek (długoletni klient) — okno i pewność nadal w twardych granicach", () => {
    const history = Array.from({ length: 300 }, (_, i) => rec({ id: `h${i}`, evidence: ev(i % 2 === 0 ? "prevented" : "correct", { observedAt: NOW + i * DAY }) }));
    const w = learnedWindowDays(history, "L1");
    expect(w).toBeGreaterThanOrEqual(3);
    expect(w).toBeLessThanOrEqual(21);
    const c = calibratedConfidence(history, "L1");
    expect(c).toBeGreaterThanOrEqual(0.35);
    expect(c).toBeLessThanOrEqual(0.95);
  });
});

describe("Atak: częściowa wpłata i Finanse w prognozach", () => {
  it("częściowa wpłata NIE zeruje stawki: nadal czekająca płatność → okno pozostaje skrócone", () => {
    // awaitingPayment liczone z (amount - paidAmount) w adapterze; tu granica silnika: kwota > 0 → skrócenie.
    const p = recordNeglectPrediction("L1", "Firma X", { id: "x", now: NOW, records: [], awaitingPaymentAmount: 9999 });
    expect(p.checkAt - p.madeAt).toBe(5 * DAY);
    // pełna wpłata (0 do zapłaty) → standardowe okno, bez fałszywej pilności
    const paid = recordNeglectPrediction("L1", "Firma X", { id: "y", now: NOW, records: [], awaitingPaymentAmount: 0 });
    expect(paid.checkAt - paid.madeAt).toBe(7 * DAY);
  });

  it("cykl produkcyjny: adapterowa mapa płatności wpływa na prognozę TYLKO dla właściwego leada", () => {
    const leads = [
      { id: "L1", company: "Z płatnością", status: "contacted" as const, lastContactedAt: NOW - 10 * DAY, overdue: true },
      { id: "L2", company: "Bez płatności", status: "contacted" as const, lastContactedAt: NOW - 10 * DAY, overdue: true },
    ];
    let n = 0;
    const r = runPredictionCycle({ ledger: [], leads, awaitingPaymentByLead: { L1: 5000 }, now: NOW, learningEnabled: true, makeId: () => `i${++n}` });
    const p1 = r.created.find((p) => p.entityId === "L1")!;
    const p2 = r.created.find((p) => p.entityId === "L2")!;
    expect(p1.checkAt - p1.madeAt).toBe(5 * DAY);
    expect(p2.checkAt - p2.madeAt).toBe(7 * DAY);
  });
});
