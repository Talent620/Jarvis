import { describe, it, expect } from "vitest";
import { confirmDiscardClose } from "../src/hooks/useDirtyClose";

describe("useDirtyClose — confirmDiscardClose (czysta decyzja)", () => {
  it("czysty formularz → zamyka bez pytania", () => {
    let asked = false;
    expect(confirmDiscardClose(false, () => { asked = true; return false; })).toBe(true);
    expect(asked).toBe(false); // nie pytano
  });

  it("brudny + użytkownik potwierdza → zamyka", () => {
    expect(confirmDiscardClose(true, () => true)).toBe(true);
  });

  it("brudny + użytkownik anuluje → NIE zamyka", () => {
    expect(confirmDiscardClose(true, () => false)).toBe(false);
  });
});
