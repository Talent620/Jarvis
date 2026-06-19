import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock warstwy on-device — sterujemy chatLocal i wsparciem WebGPU.
vi.mock("../src/lib/webllm", () => ({
  chatLocal: vi.fn(),
  webllmSupported: vi.fn(() => true),
  webllmUsable: vi.fn(() => true),
  webllmReady: vi.fn(() => false),
  onWebllmProgress: vi.fn(() => () => {}),
  WEBLLM_DEFAULT_MODEL: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  WEBLLM_MODELS: [{ id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B" }],
}));

import { chatLocal, webllmSupported } from "../src/lib/webllm";
import { askWebllm } from "../src/lib/providers/webllm";
import { PROVIDERS, PROVIDER_LIST, emptyKeys } from "../src/lib/providers/registry";
import { routeOrder } from "../src/lib/brain";
import { store } from "../src/lib/store";

const mockChat = chatLocal as unknown as ReturnType<typeof vi.fn>;
const mockSupported = webllmSupported as unknown as ReturnType<typeof vi.fn>;

describe("Faza C — rejestracja providera webllm", () => {
  it("webllm jest w katalogu dostawców (bez klucza, najniższa ranga)", () => {
    expect(PROVIDERS.webllm).toBeDefined();
    expect(typeof PROVIDERS.webllm.impl).toBe("function");
    expect(PROVIDER_LIST.some((p) => p.id === "webllm")).toBe(true);
    expect(emptyKeys.webllm).toBe("");
    expect(PROVIDERS.webllm.rank).toBeLessThan(PROVIDERS.ollama.rank);
  });
});

describe("Faza C — adapter askWebllm (mapowanie we/wy)", () => {
  beforeEach(() => mockChat.mockReset());

  it("mapuje system+historię na messages i zwraca tekst (via webllm)", async () => {
    mockChat.mockResolvedValue("Dzień dobry, Sir.");
    const reply = await askWebllm({
      apiKey: "local",
      model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      system: "Jesteś JARVIS.",
      webSearch: false,
      tools: [],
      history: [
        { role: "user", content: "cześć" },
        { role: "assistant", content: "witaj" },
        { role: "user", content: "która godzina?" },
      ],
    });
    expect(reply.text).toBe("Dzień dobry, Sir.");
    expect(reply.via).toBe("webllm");
    expect(reply.tools).toEqual([]);
    const [, messages] = mockChat.mock.calls[0];
    expect(messages[0]).toEqual({ role: "system", content: "Jesteś JARVIS." });
    expect(messages).toHaveLength(4); // system + 3 z historii
    expect(messages[3]).toEqual({ role: "user", content: "która godzina?" });
  });

  it("gdy on-device niedostępne (chatLocal→null) → rzuca błąd (router spada do chmury)", async () => {
    mockChat.mockResolvedValue(null);
    await expect(
      askWebllm({ apiKey: "local", model: "m", system: "", webSearch: false, tools: [], history: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/WebGPU|on-device/i);
  });
});

describe("Faza C — router dokłada webllm jako lokalny ogon", () => {
  beforeEach(() => {
    mockSupported.mockReturnValue(true);
    store.setSettings({
      provider: "auto", model: "auto", webllmEnabled: true, webllmModel: "",
      onDeviceOnly: false, ollamaUrl: "",
      keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" },
    });
  });

  it("webllmEnabled + WebGPU → webllm w łańcuchu (lokalny ogon)", () => {
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order.some((o) => o.provider === "webllm")).toBe(true);
  });

  it("onDeviceOnly → wyłącznie webllm (PWA/APK bez serwera)", () => {
    store.setSettings({ onDeviceOnly: true });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order).toEqual([{ provider: "webllm", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" }]);
  });

  it("brak WebGPU → webllm pomijany (cichy fallback do chmury)", () => {
    mockSupported.mockReturnValue(false);
    store.setSettings({ onDeviceOnly: false });
    const order = routeOrder([{ role: "user", content: "cześć" }]);
    expect(order.some((o) => o.provider === "webllm")).toBe(false);
  });
});
