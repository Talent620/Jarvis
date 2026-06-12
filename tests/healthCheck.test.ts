// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { settingsFixes, runHealthCheck } from "../src/lib/healthCheck";
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
});
