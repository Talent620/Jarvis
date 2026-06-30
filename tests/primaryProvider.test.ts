import { describe, it, expect } from "vitest";
import { computePrimaryProvider } from "../src/lib/brain";
import type { ProviderId } from "../src/lib/providers/types";

const ord = (...ids: ProviderId[]) => ids.map((provider) => ({ provider }));

describe("brain — computePrimaryProvider (kto jest głównym mózgiem dla etykiety 'zapasowy')", () => {
  it("przypięty dostawca jest zawsze główny (jego odpowiedź NIE jest zapasowa)", () => {
    // order ma przed gemini coś lokalnego, ale user przypiął gemini → primary=gemini
    const p = computePrimaryProvider(ord("ollama", "gemini", "groq"), "gemini", () => true);
    expect(p).toBe("gemini");
  });

  it("auto: bierze pierwszego UŻYWALNEGO (pomija order[0] bez klucza)", () => {
    // order[0]=anthropic bez klucza (nieużywalny), gemini ma klucz → primary=gemini, nie anthropic
    const usable = (id: ProviderId) => id !== "anthropic";
    const p = computePrimaryProvider(ord("anthropic", "gemini", "groq"), null, usable);
    expect(p).toBe("gemini");
  });

  it("auto: gdy nikt nie używalny → fallback do order[0]", () => {
    const p = computePrimaryProvider(ord("anthropic", "gemini"), null, () => false);
    expect(p).toBe("anthropic");
  });

  it("auto: order[0] używalny → on jest główny", () => {
    const p = computePrimaryProvider(ord("gemini", "groq"), null, () => true);
    expect(p).toBe("gemini");
  });
});
