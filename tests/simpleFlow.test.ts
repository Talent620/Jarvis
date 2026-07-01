// === Tryb prosty (simpleFlow) — testy ===
// Domyślny przepływ Cel → Rekomendacja → Podgląd → Zatwierdź, spójne nazewnictwo, puste stany z
// jednym działaniem, metadane wyniku (źródło/stan/następna akcja).
import { describe, it, expect } from "vitest";
import { SIMPLE_STEPS, stepLabel, nextStep, prevStep, stepIndex, resultMeta, emptyStateSuggestion } from "../src/lib/simpleFlow";

describe("simpleFlow — kroki", () => {
  it("kolejność i etykiety po polsku", () => {
    expect(SIMPLE_STEPS).toEqual(["goal", "recommendation", "preview", "approve"]);
    expect(stepLabel("goal")).toBe("Cel");
    expect(stepLabel("approve")).toBe("Zatwierdź");
  });

  it("nawigacja nie wychodzi poza zakres", () => {
    expect(nextStep("goal")).toBe("recommendation");
    expect(nextStep("approve")).toBe("approve"); // ostatni
    expect(prevStep("goal")).toBe("goal");       // pierwszy
    expect(stepIndex("preview")).toBe(3);
  });
});

describe("simpleFlow — wyniki i puste stany", () => {
  it("każdy wynik ma źródło, stan i następną akcję", () => {
    const m = resultMeta("OpenStreetMap", "szkic", "Zaimportuj");
    expect(m.source).toBe("OpenStreetMap");
    expect(m.state).toBe("szkic");
    expect(m.nextAction).toBe("Zaimportuj");
  });

  it("pusty stan proponuje JEDNO działanie", () => {
    expect(emptyStateSuggestion("leads").action).toBe("Znajdź leady");
    expect(emptyStateSuggestion("sites").action).toBe("Zbuduj demo");
    expect(emptyStateSuggestion("campaigns").message).toMatch(/kampani/i);
  });
});
