// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { councilMembers } from "../src/lib/council";
import { store } from "../src/lib/store";

const noKeys = { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" };

describe("Tryb Konsylium — dobór członków", () => {
  beforeEach(() => store.setSettings({ keys: { ...noKeys }, ollamaUrl: "" }));

  it("bez kluczy → brak członków (konsylium nieaktywne)", () => {
    expect(councilMembers()).toEqual([]);
  });

  it("jeden klucz → jeden członek (degradacja do pojedynczego modelu)", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "AIzaX" } });
    const m = councilMembers();
    expect(m).toHaveLength(1);
    expect(m[0].provider).toBe("gemini");
  });

  it("wielu dostawców → max 3 RÓŻNE, posortowane wg rangi jakości", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "AIzaX", groq: "gsk_x", cerebras: "csk-x", mistral: "mk" } });
    const m = councilMembers(3);
    expect(m).toHaveLength(3);
    const ids = m.map((x) => x.provider);
    expect(new Set(ids).size).toBe(3); // bez duplikatów dostawcy
    expect(ids[0]).toBe("gemini"); // rank 80
    expect(ids).toContain("cerebras"); // rank 72
    expect(ids).not.toContain("mistral"); // rank 55 wypada poza top3
  });

  it("Ollama nigdy nie wchodzi do konsylium (lokalny, bez klucza)", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "AIzaX" }, ollamaUrl: "http://localhost:11434" });
    expect(councilMembers().some((m) => m.provider === "ollama")).toBe(false);
  });

  it("kilka kluczy jednego dostawcy liczy się jako JEDEN członek", () => {
    store.setSettings({ keys: { ...noKeys, gemini: "AIzaA\nAIzaB" } });
    expect(councilMembers()).toHaveLength(1);
  });
});
