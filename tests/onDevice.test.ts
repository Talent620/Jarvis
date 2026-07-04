// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { routeOrder } from "../src/lib/brain";
import { store } from "../src/lib/store";

describe("Faza 8 — tryb on-device (routeOrder)", () => {
  beforeEach(() => {
    store.setSettings({
      onDeviceOnly: false,
      ollamaUrl: "",
      provider: "auto",
      model: "auto",
      keys: { ...store.settings.keys, gemini: "" },
    });
  });

  it("on-device + Ollama → łańcuch zawiera WYŁĄCZNIE model lokalny", () => {
    store.setSettings({ onDeviceOnly: true, ollamaUrl: "http://localhost:11434", keys: { ...store.settings.keys, gemini: "AIzaTEST" } });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order).toHaveLength(1);
    expect(order[0].provider).toBe("ollama");
  });

  it("on-device bez Ollamy → pusty łańcuch (brak chmury)", () => {
    store.setSettings({ onDeviceOnly: true, ollamaUrl: "", keys: { ...store.settings.keys, gemini: "AIzaTEST" } });
    expect(routeOrder([{ role: "user", content: "cześć" }])).toEqual([]);
  });

  it("bez trybu on-device chmura jest dozwolona", () => {
    store.setSettings({ onDeviceOnly: false, ollamaUrl: "", keys: { ...store.settings.keys, gemini: "AIzaTEST" } });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order.some((o) => o.provider === "gemini")).toBe(true);
  });
});
