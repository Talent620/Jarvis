// === Warstwa spinająca Cognitive OS (cognitiveRuntime) — testy realnej ścieżki ===
// Testujemy DOKŁADNIE te funkcje, które wołają panel/runtime (nie sklejamy niezależnych kawałków):
// dayInsights (proactiveOoda + businessSimulator), learnFromUserMessage (learningLoop),
// correctionRulesBlock i statusView (CognitiveStatus). To dowód produkcyjnego wpięcia.
import { describe, it, expect } from "vitest";
import { dayInsights, learnFromUserMessage, correctionRulesBlock, statusView } from "../src/lib/cognitiveRuntime";
import { acceptCorrection, type Correction } from "../src/lib/learningLoop";
import type { Lead } from "../src/types";

const NOW = 1_000_000_000;
const lead = (over: Partial<Lead>): Lead => ({ id: "L", company: "X", status: "new", createdAt: NOW, updatedAt: NOW, ...over });

describe("cognitiveRuntime — dayInsights (proactiveOoda + businessSimulator)", () => {
  it("leady bez kontaktu → bloker „brak kontaktowalnych leadów” + ryzyko w snapshotcie", () => {
    const r = dayInsights({ leads: [lead({ email: undefined })], finance: [] }, NOW);
    expect(r.blocker.blocker).toMatch(/kontaktowalnych leadów/);
    expect(r.risks.join(" ")).toMatch(/e-mail/);
  });

  it("brak danych → brak sugestii OODA (nic do zaproponowania)", () => {
    const r = dayInsights({ leads: [], finance: [] }, NOW);
    expect(r.suggestion).toBeNull();
    expect(typeof r.blocker.reason).toBe("string");
  });
});

describe("cognitiveRuntime — learningLoop (korekta z wiadomości)", () => {
  it("wykrywa korektę „nigdy nie wysyłaj w weekend” i dokłada ją do reguł", () => {
    const out = learnFromUserMessage([], "Nigdy nie wysyłaj maili w weekend", { id: "c1", source: "czat", now: NOW });
    expect(out.learned).toBe(true);
    expect(out.rules.length).toBe(1);
    expect(out.rules[0].kind).toBe("never");
  });

  it("brak korekty → nic nie dodaje", () => {
    const out = learnFromUserMessage([], "jaka jest pogoda?", { id: "c2", source: "czat", now: NOW });
    expect(out.learned).toBe(false);
    expect(out.rules.length).toBe(0);
  });

  it("correctionRulesBlock pokazuje TYLKO aktywne (zaakceptowane) reguły", () => {
    const one = learnFromUserMessage([], "Zawsze podpisuj się imieniem", { id: "c3", source: "czat", now: NOW });
    expect(correctionRulesBlock(one.rules)).toBe(""); // candidate, jeszcze nieaktywna
    const active: Correction[] = acceptCorrection(one.rules, "c3", NOW);
    expect(correctionRulesBlock(active)).toMatch(/podpisuj/);
  });
});

describe("cognitiveRuntime — statusView (CognitiveStatus)", () => {
  it("pusty wejściowo → minimalny, bezpieczny widok", () => {
    const v = statusView({});
    expect(v.canStop).toBe(false);
    expect(v.goal).toBeUndefined();
    expect(Array.isArray(v.sources)).toBe(true);
  });
});
