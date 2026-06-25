import { describe, it, expect } from "vitest";
import { composerInstruction, COMPOSER_ACTIONS } from "../src/lib/emailComposer";

describe("emailComposer — akcje kompozytora", () => {
  it("każda akcja ma niepustą, sensowną instrukcję", () => {
    for (const a of COMPOSER_ACTIONS) {
      expect(composerInstruction(a.id).length).toBeGreaterThan(20);
    }
  });
  it("instrukcje pasują do intencji akcji", () => {
    expect(composerInstruction("shorten")).toMatch(/skróć|60–90/i);
    expect(composerInstruction("cta")).toMatch(/CTA|wezwani/i);
    expect(composerInstruction("formal")).toMatch(/formaln/i);
    expect(composerInstruction("casual")).toMatch(/swobod|ciepł/i);
    expect(composerInstruction("personalize")).toMatch(/personalizacj/i);
  });
  it("lista akcji ma unikalne id i etykiety", () => {
    const ids = COMPOSER_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of COMPOSER_ACTIONS) expect(a.label.length).toBeGreaterThan(0);
  });
});
