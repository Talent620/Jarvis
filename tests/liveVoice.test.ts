import { describe, it, expect } from "vitest";
import { closeReason } from "../src/lib/liveVoice";

describe("closeReason (diagnostyka rozmowy na żywo)", () => {
  it("rozpoznaje przekroczony limit", () => {
    expect(closeReason(1011, "Resource has been exhausted")).toMatch(/limit/i);
    expect(closeReason(1008, "quota exceeded")).toMatch(/limit/i);
  });
  it("rozpoznaje problem z kluczem", () => {
    expect(closeReason(1008, "API key invalid")).toMatch(/klucz/i);
    expect(closeReason(1008, "permission denied")).toMatch(/klucz/i);
  });
  it("rozpoznaje błąd serwera (kod 1011)", () => {
    expect(closeReason(1011, "")).toMatch(/serwer/i);
  });
  it("rozpoznaje zerwanie sieci (kod 1006)", () => {
    expect(closeReason(1006, "")).toMatch(/sieć|internet/i);
  });
  it("zwraca surową treść, gdy nic nie pasuje", () => {
    expect(closeReason(1000, "do widzenia")).toBe("do widzenia");
  });
  it("zwraca undefined przy braku treści i normalnym kodzie", () => {
    expect(closeReason(1000, "")).toBeUndefined();
  });
});
