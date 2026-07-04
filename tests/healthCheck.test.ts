// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { settingsFixes, runHealthCheck, featureChecks } from "../src/lib/healthCheck";
import { store } from "../src/lib/store";

// Centrum Sprawdzania: auto-naprawy ustawień + pełny przegląd (offline).

beforeEach(() => {
  store.setSettings({ provider: "auto", model: "auto", keys: { ...store.settings.keys, anthropic: "", groq: "", gemini: "" }, smtpUser: "", smtpPass: "", smtpPort: 465, ollamaUrl: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("settingsFixes — autonomiczne naprawy ustawień", () => {
  it("dostawca bez klucza → naprawa: przełącz na auto", () => {
    store.setSettings({ provider: "groq" }); // klucz groq pusty
    const fixes = settingsFixes();
    const f = fixes.find((x) => x.id === "provider-nokey")!;
    expect(f.status).toBe("err");
    f.fix!.apply();
    expect(store.settings.provider).toBe("auto");
  });

  it("model z innego dostawcy → naprawa: reset modelu", () => {
    store.setSettings({ provider: "anthropic", model: "gemini-2.5-flash", keys: { ...store.settings.keys, anthropic: "sk-ant-x" } });
    const f = settingsFixes().find((x) => x.id === "model-mismatch")!;
    expect(f).toBeDefined();
    f.fix!.apply();
    expect(store.settings.model).toBe("auto");
  });

  it("zły port SMTP → naprawa: 465", () => {
    store.setSettings({ smtpUser: "a@b.pl", smtpPort: 25 });
    const f = settingsFixes().find((x) => x.id === "smtp-port")!;
    f.fix!.apply();
    expect(store.settings.smtpPort).toBe(465);
  });

  it("brudny adres Ollamy → naprawa: czyszczenie", () => {
    store.setSettings({ ollamaUrl: " http://192.168.0.5:11434/ " });
    const f = settingsFixes().find((x) => x.id === "ollama-url")!;
    f.fix!.apply();
    expect(store.settings.ollamaUrl).toBe("http://192.168.0.5:11434");
  });

  it("poprawne ustawienia → zero napraw", () => {
    expect(settingsFixes()).toHaveLength(0);
  });
});

describe("runHealthCheck — pełny przegląd (offline)", () => {
  it("bez kluczy: mózg = błąd z instrukcją, reszta opisana po ludzku", async () => {
    const items = await runHealthCheck(undefined, false); // bez testów sieciowych
    const brain = items.find((i) => i.id === "brain")!;
    expect(brain.status).toBe("err");
    expect(brain.detail).toMatch(/sk-ant/);
    expect(items.find((i) => i.id === "tts")).toBeDefined();
    expect(items.find((i) => i.id === "mic")).toBeDefined();
    expect(items.find((i) => i.id === "sync")?.status).toBe("info");
  });

  it("klucz Claude + ręcznie wybrany inny dostawca → sugestia powrotu do Claude'a", async () => {
    store.setSettings({ provider: "gemini", model: "auto", keys: { ...store.settings.keys, gemini: "AIzaX", anthropic: "sk-ant-x" } });
    const items = await runHealthCheck(undefined, false);
    const sug = items.find((i) => i.id === "brain-claude")!;
    expect(sug).toBeDefined();
    sug.fix!.apply();
    expect(store.settings.provider).toBe("auto"); // Claude wygra rangą
  });

  it("wyłączony głos i wyszukiwanie → propozycje włączenia z naprawą", async () => {
    store.setSettings({ speak: false, webSearch: false });
    const items = await runHealthCheck(undefined, false);
    const tts = items.find((i) => i.id === "tts")!;
    const ws = items.find((i) => i.id === "websearch")!;
    expect(tts.fix).toBeDefined();
    expect(ws.fix).toBeDefined();
    ws.fix!.apply();
    expect(store.settings.webSearch).toBe(true);
    store.setSettings({ speak: true }); // przywróć
  });

  it("przegląd zawiera nowe pozycje funkcji (Studio, Research, Smart home, n8n)", async () => {
    const items = await runHealthCheck(undefined, false);
    for (const id of ["studio", "research", "smarthome", "n8n", "wake", "notifs", "device"]) {
      expect(items.find((i) => i.id === id), `brak pozycji ${id}`).toBeDefined();
    }
  });
});

describe("featureChecks — statusy funkcji", () => {
  beforeEach(() => {
    store.setSettings({ keys: { ...store.settings.keys, gemini: "" }, falApiKey: "", tavilyApiKey: "", homeAssistantUrl: "", homeAssistantToken: "", n8nUrl: "", n8nToken: "" });
  });

  it("Studio: bez klucza Gemini → info; z kluczem → ok", () => {
    expect(featureChecks().find((i) => i.id === "studio")!.status).toBe("info");
    store.setSettings({ keys: { ...store.settings.keys, gemini: "AIzaX" } });
    expect(featureChecks().find((i) => i.id === "studio")!.status).toBe("ok");
  });

  it("Smart home: oba pola wypełnione → ok", () => {
    store.setSettings({ homeAssistantUrl: "http://ha.local", homeAssistantToken: "tok" });
    expect(featureChecks().find((i) => i.id === "smarthome")!.status).toBe("ok");
  });

  it("Research/Tavily: z kluczem → ok", () => {
    store.setSettings({ tavilyApiKey: "tvly-x" });
    expect(featureChecks().find((i) => i.id === "research")!.status).toBe("ok");
  });

  it("każda pozycja ma tytuł, opis i poprawny status", () => {
    for (const it of featureChecks()) {
      expect(it.title).toBeTruthy();
      expect(it.detail).toBeTruthy();
      expect(["ok", "warn", "err", "info"]).toContain(it.status);
    }
  });
});
