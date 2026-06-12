import { describe, it, expect } from "vitest";
import { looksComplete, shouldFinalize } from "../src/lib/endpoint";

describe("semantyczny endpointing — kompletność zdania", () => {
  it("zdanie domknięte = kompletne", () => {
    expect(looksComplete("zadzwoń do mamy")).toBe(true);
    expect(looksComplete("ile to kosztuje")).toBe(true);
    expect(looksComplete("dodaj zadanie kup mleko")).toBe(true);
  });
  it("urwane na spójniku/przyimku/wahaniu = NIE kończ (nie przerywaj)", () => {
    expect(looksComplete("zadzwoń do")).toBe(false);
    expect(looksComplete("kup mleko i")).toBe(false);
    expect(looksComplete("bo")).toBe(false);
    expect(looksComplete("chcę żebyś")).toBe(false);
    expect(looksComplete("no wiesz yyy")).toBe(false);
  });
  it("urwane na przecinku/wielokropku = kontynuacja", () => {
    expect(looksComplete("kup mleko, jajka,")).toBe(false);
    expect(looksComplete("myślę że…")).toBe(false);
  });
  it("pusty = niekompletny", () => {
    expect(looksComplete("")).toBe(false);
  });
});

describe("decyzja o zakończeniu tury", () => {
  const cfg = { shortMs: 900, longMs: 2600 };
  it("kompletne zdanie + krótka cisza → kończ", () => {
    expect(shouldFinalize("kup mleko", 1000, cfg)).toBe(true);
  });
  it("niekompletne + krótka cisza → czekaj (nie przerywaj)", () => {
    expect(shouldFinalize("kup mleko i", 1000, cfg)).toBe(false);
  });
  it("niekompletne ale długa cisza → twardy limit kończy", () => {
    expect(shouldFinalize("kup mleko i", 2700, cfg)).toBe(true);
  });
  it("pusty transkrypt nigdy nie kończy", () => {
    expect(shouldFinalize("", 9000, cfg)).toBe(false);
  });
});
