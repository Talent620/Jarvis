import { describe, it, expect } from "vitest";
import { pickLocalModel } from "../src/lib/privateMode";

describe("Tryb Prywatny — wybór modelu lokalnego", () => {
  it("preferuje model bez cenzury (dolphin), gdy dostępny", () => {
    expect(pickLocalModel(["llama3.2:latest", "dolphin-mistral:latest", "qwen2.5"])).toMatch(/dolphin/);
  });
  it("bierze pierwszy dostępny, gdy brak uncensored", () => {
    expect(pickLocalModel(["llama3.2:latest", "qwen2.5"])).toBe("llama3.2:latest");
  });
  it("zwraca null, gdy brak modeli", () => {
    expect(pickLocalModel([])).toBeNull();
  });
});
