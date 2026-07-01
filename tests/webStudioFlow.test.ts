// === Kreator w 4 krokach (webStudioFlow) — testy ===
// Krok bieżący i jedna główna akcja wynikają jednoznacznie ze stanu; postęp 0..3.
import { describe, it, expect } from "vitest";
import { currentStep, stepIndex, currentStepInfo, WEB_STEPS } from "../src/lib/webStudioFlow";

describe("webStudioFlow — bieżący krok", () => {
  it("pusty stan → Brief; z briefem → Plan; z planem → Budowa; z gotową stroną → Dostarczenie", () => {
    expect(currentStep({ hasBrief: false, hasBlueprint: false, hasSafeHtml: false })).toBe("brief");
    expect(currentStep({ hasBrief: true, hasBlueprint: false, hasSafeHtml: false })).toBe("plan");
    expect(currentStep({ hasBrief: true, hasBlueprint: true, hasSafeHtml: false })).toBe("build");
    expect(currentStep({ hasBrief: true, hasBlueprint: true, hasSafeHtml: true })).toBe("deliver");
  });

  it("gotowa strona ma pierwszeństwo (od końca) nawet bez planu", () => {
    expect(currentStep({ hasBrief: false, hasBlueprint: false, hasSafeHtml: true })).toBe("deliver");
  });
});

describe("webStudioFlow — postęp i główna akcja", () => {
  it("stepIndex zwraca 0..3 w kolejności", () => {
    expect(stepIndex("brief")).toBe(0);
    expect(stepIndex("deliver")).toBe(3);
    expect(WEB_STEPS).toHaveLength(4);
  });

  it("currentStepInfo daje etykietę i JEDNĄ główną akcję", () => {
    const info = currentStepInfo({ hasBrief: true, hasBlueprint: false, hasSafeHtml: false });
    expect(info.id).toBe("plan");
    expect(info.index).toBe(1);
    expect(info.mainAction).toBe("Zbuduj stronę");
  });
});
