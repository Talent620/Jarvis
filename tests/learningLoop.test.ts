// === Pętla uczenia (learningLoop) — testy ===
// JARVIS uczy się, ale zostaje kontrolowalny. Sprawdzamy: korekta jednorazowa (NIE staje się regułą),
// powtarzana preferencja (propozycja utrwalenia), konflikt preferencji, pozytywny/negatywny rezultat,
// usunięcie nauczonej reguły, oraz BRAK uczenia z SIMULATED/niepotwierdzonego.
import { describe, it, expect } from "vitest";
import {
  detectCorrection, upsertCorrection, acceptCorrection, removeCorrection, activeRules,
  detectConflict, canLearnFromOutcome, learnFromOutcome, type Correction, type ActionStat,
} from "../src/lib/learningLoop";
import { confirmed, simulated, attempted } from "../src/lib/actionOutcome";

const NOW = 5_000_000;

describe("learningLoop — wykrywanie korekt", () => {
  it("rozpoznaje never/always/prefer/negative", () => {
    expect(detectCorrection("nie wysyłaj nic bez pytania")?.kind).toBe("never");
    expect(detectCorrection("zawsze dodawaj podpis")?.kind).toBe("always");
    expect(detectCorrection("wolę krótkie maile")?.kind).toBe("prefer");
    expect(detectCorrection("nie tak, źle to zrobiłeś")?.kind).toBe("negative");
    expect(detectCorrection("dziękuję")).toBeNull();
  });
});

describe("learningLoop — jednorazowa vs powtarzana (kontrola)", () => {
  it("jednorazowa korekta = candidate, NIE obowiązująca reguła", () => {
    const det = detectCorrection("zawsze dodawaj podpis")!;
    const { list, proposal } = upsertCorrection([], det, { id: "c1", source: "czat", now: NOW });
    expect(list[0].scope).toBe("candidate");
    expect(list[0].active).toBe(false);
    expect(proposal).toBeUndefined();      // jednorazowo nie proponujemy utrwalenia
    expect(activeRules(list)).toHaveLength(0);
  });

  it("powtórzona korekta → propozycja utrwalenia; dopiero akceptacja czyni regułę", () => {
    const det = detectCorrection("zawsze dodawaj podpis")!;
    const r1 = upsertCorrection([], det, { id: "c1", source: "czat", now: NOW });
    const r2 = upsertCorrection(r1.list, det, { id: "c1b", source: "czat", now: NOW + 100 });
    expect(r2.proposal).toBeDefined();
    expect(activeRules(r2.list)).toHaveLength(0); // wciąż nie obowiązuje bez akceptacji
    const accepted = acceptCorrection(r2.list, r2.proposal!.id, NOW + 200);
    expect(activeRules(accepted)).toHaveLength(1);
  });

  it("usunięcie nauczonej reguły cofa naukę", () => {
    const det = detectCorrection("zawsze dodawaj podpis")!;
    let { list } = upsertCorrection([], det, { id: "c1", source: "czat", now: NOW });
    list = acceptCorrection(list, "c1", NOW);
    expect(activeRules(list)).toHaveLength(1);
    list = removeCorrection(list, "c1");
    expect(list).toHaveLength(0);
  });
});

describe("learningLoop — konflikt preferencji (nie rozstrzyga po cichu)", () => {
  it("nowa sprzeczna preferencja na ten sam temat → konflikt do decyzji użytkownika", () => {
    const rule: Correction = { id: "r", kind: "prefer", directive: "wolę krótkie maile", source: "czat", scope: "rule", count: 3, active: true, createdAt: NOW, lastSeenAt: NOW };
    const conflict = detectConflict([rule], { kind: "prefer", directive: "wolę długie maile" });
    expect(conflict?.id).toBe("r"); // wspólny temat „maile", inna treść → konflikt
  });
});

describe("learningLoop — uczenie z REZULTATÓW (tylko potwierdzone)", () => {
  it("NIE uczy się z SIMULATED ani ATTEMPTED", () => {
    expect(canLearnFromOutcome(simulated())).toBe(false);
    expect(canLearnFromOutcome(attempted("gmail"))).toBe(false);
    const stats = learnFromOutcome([], { actionType: "cold_mail", outcome: simulated(), signal: "offer_won", now: NOW });
    expect(stats).toHaveLength(0); // nic się nie nauczyło z symulacji
  });

  it("uczy się z POTWIERDZONEGO rezultatu — pozytyw podnosi wagę, negatyw obniża", () => {
    let stats: ActionStat[] = [];
    stats = learnFromOutcome(stats, { actionType: "cold_mail", outcome: confirmed(), signal: "offer_won", now: NOW });
    expect(stats[0].positives).toBe(1);
    expect(stats[0].weight).toBeGreaterThan(0);
    stats = learnFromOutcome(stats, { actionType: "cold_mail", outcome: confirmed(), signal: "no_effect", now: NOW + 1 });
    expect(stats[0].negatives).toBe(1);
  });

  it("waga jest ograniczona (nie ucieka w nieskończoność)", () => {
    let stats: ActionStat[] = [];
    for (let i = 0; i < 50; i++) stats = learnFromOutcome(stats, { actionType: "x", outcome: confirmed(), signal: "payment", now: NOW + i });
    expect(stats[0].weight).toBeLessThanOrEqual(1);
  });
});
