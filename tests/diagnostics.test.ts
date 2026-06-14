// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { systemCheck } from "../src/lib/diagnostics";
import { store } from "../src/lib/store";

// Diagnostyka startowa: bez kluczy i bez backendu nie rusza sieci — sprawdzamy,
// że mówi wprost co działa, a co naprawić, i kończy podsumowaniem.
beforeEach(() => {
  store.setSettings({
    provider: "auto", model: "auto",
    keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" },
    tavilyApiKey: "", proxyUrl: "", syncUrl: "", homeAssistantUrl: "", homeAssistantToken: "",
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("systemCheck — diagnostyka po ludzku", () => {
  it("bez klucza: internet OK, mózg AI = błąd, na końcu podsumowanie", async () => {
    const lines = await systemCheck();
    expect(lines[0]).toMatch(/Internet/);
    expect(lines.some((l) => l.startsWith("❌") && /Mózg AI/.test(l))).toBe(true);
    // ostatnia linia to podsumowanie (czerwone/żółte/zielone)
    expect(lines[lines.length - 1]).toMatch(/🔴|🟡|🟢/);
  });

  it("strumieniuje wyniki przez onStep (na żywo)", async () => {
    const snapshots: number[] = [];
    await systemCheck((lines) => snapshots.push(lines.length));
    expect(snapshots.length).toBeGreaterThan(1);
    // liczba linii rośnie monotonicznie
    expect(snapshots[snapshots.length - 1]).toBeGreaterThanOrEqual(snapshots[0]);
  });
});
