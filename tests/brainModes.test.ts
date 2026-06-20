// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { BRAIN_MODES, applyBrainMode, detectBrainMode } from "../src/lib/brainModes";
import { store } from "../src/lib/store";

beforeEach(() => store.setSettings({ provider: "auto", model: "auto", onDeviceOnly: false, localFirstSimple: false }));

describe("brainModes — katalog", () => {
  it("ma 4 jasno opisane tryby z kompletnym opisem", () => {
    expect(BRAIN_MODES.length).toBe(4);
    for (const m of BRAIN_MODES) expect(m.title && m.tagline && m.does && m.happens && m.needs).toBeTruthy();
    expect(BRAIN_MODES.map((m) => m.id).sort()).toEqual(["auto", "offline", "ollama", "online"]);
  });
});

describe("brainModes — applyBrainMode", () => {
  it("offline → blokada chmury + web-research wyłączony", () => {
    applyBrainMode("offline");
    expect(store.settings.onDeviceOnly).toBe(true);
    expect(store.settings.webSearch).toBe(false);
  });
  it("online → dostawca auto, bez on-device, bez lokalnie-najpierw", () => {
    applyBrainMode("online");
    expect(store.settings.provider).toBe("auto");
    expect(store.settings.onDeviceOnly).toBe(false);
    expect(store.settings.localFirstSimple).toBe(false);
  });
  it("ollama → dostawca ollama, model auto; przydziela role z zainstalowanych", () => {
    applyBrainMode("ollama", ["qwen3:4b", "gemma3:4b", "llava:7b"]);
    expect(store.settings.provider).toBe("ollama");
    expect(store.settings.model).toBe("auto");
    expect(store.settings.ollamaModelSimple).toBeTruthy();
  });
  it("auto → lokalnie-najpierw z dostawcą auto", () => {
    applyBrainMode("auto");
    expect(store.settings.provider).toBe("auto");
    expect(store.settings.localFirstSimple).toBe(true);
  });
});

describe("brainModes — detectBrainMode", () => {
  it("rozpoznaje aktywny tryb z ustawień", () => {
    applyBrainMode("offline"); expect(detectBrainMode()).toBe("offline");
    applyBrainMode("ollama", ["qwen3:4b"]); expect(detectBrainMode()).toBe("ollama");
    applyBrainMode("online"); expect(detectBrainMode()).toBe("online");
    applyBrainMode("auto"); expect(detectBrainMode()).toBe("auto");
  });
});
