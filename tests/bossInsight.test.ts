import { describe, it, expect } from "vitest";
import {
  confidencePct, confidencePreface, isRiskyCommand,
  isExplainRequest, explainTrace, predictNext, type BossTrace,
} from "../src/lib/bossInsight";

const LONG = "Policzyłem to dokładnie krok po kroku i wynik jest jednoznaczny oraz w pełni sprawdzony, zgodny z danymi.";

describe("confidencePct — skalibrowana pewność", () => {
  it("0–100, wielokrotność 5", () => {
    const p = confidencePct(LONG, "none");
    expect(p % 5).toBe(0);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(100);
  });
  it("pozytywna weryfikacja podnosi pewność", () => {
    expect(confidencePct(LONG, "pass")).toBeGreaterThanOrEqual(confidencePct(LONG, "none"));
  });
  it("wahanie obniża pewność", () => {
    expect(confidencePct("Chyba tak, ale nie jestem pewien.", "none")).toBeLessThan(confidencePct(LONG, "none"));
  });
});

describe("confidencePreface — mówi pewność, gdy istotna", () => {
  it("ryzykowna akcja + niższa pewność → prosi o potwierdzenie", () => {
    expect(confidencePreface(70, true)).toMatch(/potwierd[źz]/i);
  });
  it("ryzykowna + wysoka pewność → bez przedmowy", () => {
    expect(confidencePreface(85, true)).toBe("");
  });
  it("nieryzykowna, naprawdę niska → krótka uwaga", () => {
    expect(confidencePreface(50, false)).toMatch(/nie jestem w pe[łl]ni pewien/i);
    expect(confidencePreface(70, false)).toBe("");
  });
});

describe("isRiskyCommand / isExplainRequest", () => {
  it("ryzyko: wyślij/zadzwoń/przelej; nie: pytanie o stan", () => {
    expect(isRiskyCommand("wyślij maila do Marka")).toBe(true);
    expect(isRiskyCommand("zadzwoń do klienta")).toBe(true);
    expect(isRiskyCommand("ile mam zadań na dziś")).toBe(false);
  });
  it("prośba o wyjaśnienie", () => {
    expect(isExplainRequest("dlaczego tak odpowiedziałeś")).toBe(true);
    expect(isExplainRequest("jakim modelem to zrobiłeś")).toBe(true);
    expect(isExplainRequest("dodaj zadanie")).toBe(false);
  });
});

describe("explainTrace — czarna skrzynka", () => {
  it("zawiera mózg, sposób weryfikacji, pewność i czas", () => {
    const t: BossTrace = { brain: "Gemini", verify: "fixed", conf: 85, ms: 2300, tools: ["add_task"] };
    const e = explainTrace(t);
    expect(e).toMatch(/Gemini/);
    expect(e).toMatch(/poprawi/i);
    expect(e).toMatch(/~85%/);
    expect(e).toMatch(/~2\.3 s/);
    expect(e).toMatch(/add_task/);
  });
});

describe("predictNext — antycypacja kroku dalej", () => {
  it("mapuje intencję na sensowną propozycję", () => {
    expect(predictNext("dodaj zadanie kup mleko")).toMatch(/przypomnieni/i);
    expect(predictNext("napisz maila do klienta")).toMatch(/wys[łl]a[ćc]/i);
    expect(predictNext("opowiedz dowcip")).toBeNull();
  });
});
