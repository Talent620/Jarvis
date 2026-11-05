// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { askModel, hasUsableBrain } from "../src/lib/brain";
import { PROVIDERS } from "../src/lib/providers/registry";
import { store } from "../src/lib/store";

const emptyKeys = Object.fromEntries(Object.keys(store.settings.keys).map((key) => [key, ""]));
const baseline = {
  ...store.settings,
  provider: "gemini" as const,
  model: "gemini-2.5-flash",
  keys: emptyKeys,
  ollamaUrl: "",
  proxyUrl: "",
  onDeviceOnly: false,
  webllmEnabled: false,
};

describe("configured AI path", () => {
  it("does not treat a selected provider, empty keys or a proxy alone as usable", () => {
    expect(hasUsableBrain(baseline)).toBe(false);
    expect(hasUsableBrain({ ...baseline, proxyUrl: "https://proxy.example" })).toBe(false);
    expect(hasUsableBrain({ ...baseline, keys: { ...emptyKeys, gemini: " , \n , " } })).toBe(false);
  });

  it("uses the supplied settings, rather than silently reading the global provider", () => {
    expect(hasUsableBrain({ ...baseline, keys: { ...emptyKeys, gemini: "sample-key" } })).toBe(true);
    expect(hasUsableBrain(baseline)).toBe(false);
    expect(hasUsableBrain({ ...baseline, keys: { ...emptyKeys, gemini: "sample-key" }, proxyUrl: "https://proxy.example" })).toBe(true);
  });

  it("finds configured Ollama in auto or pinned mode even without cloud keys", () => {
    expect(hasUsableBrain({ ...baseline, provider: "auto", model: "auto", ollamaUrl: "http://localhost:11434" })).toBe(true);
    expect(hasUsableBrain({ ...baseline, provider: "ollama", ollamaUrl: "http://localhost:11434" })).toBe(true);
    expect(hasUsableBrain({ ...baseline, provider: "ollama", ollamaUrl: "  " })).toBe(false);
  });

  it("ignores cloud keys in on-device mode while retaining a configured local path", () => {
    const onDevice = { ...baseline, onDeviceOnly: true, keys: { ...emptyKeys, gemini: "sample-key" } };
    expect(hasUsableBrain(onDevice)).toBe(false);
    expect(hasUsableBrain({ ...onDevice, ollamaUrl: "http://localhost:11434" })).toBe(true);
  });

  it("lets auxiliary AI functions use Ollama in auto mode without a cloud account", async () => {
    const previous = { ...store.settings, keys: { ...store.settings.keys } };
    const local = vi.spyOn(PROVIDERS.ollama, "impl").mockResolvedValue({ text: "Lokalna odpowiedź", tools: [] });
    try {
      store.setSettings({ ...baseline, provider: "auto", model: "auto", ollamaUrl: "http://localhost:11434", onDeviceOnly: true });
      await expect(askModel({ system: "test", history: [{ role: "user", content: "Witaj" }] })).resolves.toBe("Lokalna odpowiedź");
      expect(local).toHaveBeenCalledOnce();
      expect(local.mock.calls[0][0].apiKey).toBe("local");
    } finally {
      local.mockRestore();
      store.setSettings(previous);
    }
  });

  it("reports an actionable error when a pinned cloud provider has no credentials", async () => {
    const previous = { ...store.settings, keys: { ...store.settings.keys } };
    try {
      store.setSettings(baseline);
      await expect(askModel({ system: "test", history: [{ role: "user", content: "Witaj" }] })).rejects.toThrow("Brak skonfigurowanego modelu AI");
    } finally {
      store.setSettings(previous);
    }
  });
});
