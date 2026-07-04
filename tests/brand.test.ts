// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { brand, DEFAULT_BRAND } from "../src/lib/brand";
import { store } from "../src/lib/store";

describe("white-label — brand()", () => {
  beforeEach(() => store.setSettings({ brandName: "" }));

  it("domyślnie JARVIS", () => {
    expect(brand()).toBe(DEFAULT_BRAND);
  });

  it("używa własnej nazwy, gdy ustawiona (przycięta i bez białych znaków)", () => {
    store.setSettings({ brandName: "  Aria  " });
    expect(brand()).toBe("Aria");
  });

  it("pusta/biała nazwa → domyślna", () => {
    store.setSettings({ brandName: "   " });
    expect(brand()).toBe(DEFAULT_BRAND);
  });

  it("ogranicza długość do 32 znaków", () => {
    store.setSettings({ brandName: "x".repeat(50) });
    expect(brand().length).toBe(32);
  });
});
