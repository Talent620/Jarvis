// === Dostępność modala (modalA11y) — testy ===
// Modal musi: pułapkować Tab (fokus nie ucieka), mieć role=dialog/aria-modal, przenosić fokus po
// otwarciu i przywracać po zamknięciu, oraz respektować niezapisane zmiany. Logikę pułapki i „dirty"
// testujemy czysto; obecność zachowań a11y w Modal.tsx pilnujemy skanem źródła (brak renderera React).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { nextTrapIndex, FOCUSABLE_SELECTOR } from "../src/lib/a11y";
import { confirmDiscardClose } from "../src/hooks/useDirtyClose";

describe("nextTrapIndex — zawijanie fokusu", () => {
  it("Tab przesuwa w przód, z zawinięciem na początek", () => {
    expect(nextTrapIndex(3, 0, false)).toBe(1);
    expect(nextTrapIndex(3, 2, false)).toBe(0); // za ostatnim → pierwszy
  });
  it("Shift+Tab przesuwa w tył, z zawinięciem na koniec", () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2); // przed pierwszym → ostatni
    expect(nextTrapIndex(3, 2, true)).toBe(1);
  });
  it("brak elementów → -1", () => {
    expect(nextTrapIndex(0, 0, false)).toBe(-1);
  });
  it("FOCUSABLE_SELECTOR obejmuje button/input/link, pomija tabindex=-1", () => {
    expect(FOCUSABLE_SELECTOR).toMatch(/button/);
    expect(FOCUSABLE_SELECTOR).toMatch(/tabindex="-1"/); // wykluczenie
  });
});

describe("confirmDiscardClose — niezapisane zmiany", () => {
  it("czysty → zamyka bez pytania; brudny → pyta", () => {
    expect(confirmDiscardClose(false, () => false)).toBe(true);
    expect(confirmDiscardClose(true, () => false)).toBe(false); // odmowa = nie zamykaj
    expect(confirmDiscardClose(true, () => true)).toBe(true);
  });
});

describe("Modal.tsx — obecność zachowań a11y (skan źródła)", () => {
  const src = readFileSync("src/components/Modal.tsx", "utf8");
  it('ma role="dialog" i aria-modal', () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
  });
  it("przenosi fokus po otwarciu (querySelector FOCUSABLE) i przywraca po zamknięciu", () => {
    expect(src).toMatch(/querySelector<HTMLElement>\(FOCUSABLE_SELECTOR\)/);
    expect(src).toMatch(/prevFocus/);
  });
  it("pułapka fokusu na Tab (onKeyDown + nextTrapIndex)", () => {
    expect(src).toMatch(/onKeyDown/);
    expect(src).toMatch(/nextTrapIndex/);
  });
});
