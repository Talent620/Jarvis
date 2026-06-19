// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { currentBrainMode } from "../src/lib/brainMode";
import { store } from "../src/lib/store";
import { logRouteDecision, clearRouteLog } from "../src/lib/modelRouter";

beforeEach(() => {
  clearRouteLog();
  store.setSettings({ onDeviceOnly: false, ollamaUrl: "", localFirstSimple: false, confidenceGate: false });
});

describe("brainMode — currentBrainMode", () => {
  it("offline → tryb offline/lokalny (mocniejszy niż cokolwiek)", () => {
    store.setSettings({ onDeviceOnly: false });
    const m = currentBrainMode(false);
    expect(m.kind).toBe("offline");
    expect(m.icon).toBe("🛡");
  });

  it("on-device → lokalnie, nawet online", () => {
    store.setSettings({ onDeviceOnly: true });
    expect(currentBrainMode(true).kind).toBe("local");
  });

  it("ostatnia trasa lokalna (ollama) → kind local", () => {
    logRouteDecision({ provider: "ollama", model: "qwen3:1.7b", kind: "simple", reason: "x", fellBack: false });
    const m = currentBrainMode(true);
    expect(m.kind).toBe("local");
    expect(m.label).toMatch(/Refleks/);
  });

  it("ostatnia trasa chmurowa (anthropic) → kind cloud", () => {
    logRouteDecision({ provider: "anthropic", model: "claude", kind: "complex", reason: "x", fellBack: false });
    const m = currentBrainMode(true);
    expect(m.kind).toBe("cloud");
    expect(m.icon).toBe("☁");
  });

  it("najnowsza trasa wygrywa (kolejność wpisów)", () => {
    logRouteDecision({ provider: "anthropic", model: "claude", kind: "complex", reason: "x", fellBack: false });
    logRouteDecision({ provider: "ollama", model: "qwen", kind: "simple", reason: "y", fellBack: false });
    expect(currentBrainMode(true).kind).toBe("local"); // ollama wpisana ostatnia → na szczycie
  });

  it("bez historii, ale Ollama + localFirstSimple → skłonność lokalna", () => {
    store.setSettings({ ollamaUrl: "http://localhost:11434", localFirstSimple: true });
    expect(currentBrainMode(true).kind).toBe("local");
  });

  it("bez historii i bez local-first → chmura (domyślnie)", () => {
    expect(currentBrainMode(true).kind).toBe("cloud");
  });
});
