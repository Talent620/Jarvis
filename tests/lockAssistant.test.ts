// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { runTool, toolDefs } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setSettings({ provider: "auto", model: "auto", keys: {}, voicePinned: false, voiceLock: false, voiceMode: "system", geminiVoice: "" } as any);
});

describe("lock_assistant — stały umysł + premium głos", () => {
  it("jest zarejestrowane i sklasyfikowane jako write", () => {
    expect(toolDefs.some((d) => d.name === "lock_assistant")).toBe(true);
    expect(riskOf("lock_assistant")).toBe("write");
  });

  it("bez żadnego klucza → instrukcja dodania darmowego Gemini (nic nie psuje)", async () => {
    const r = await runTool("lock_assistant", {});
    expect(r).toMatch(/aistudio\.google\.com|DARMOWY klucz/i);
    expect(store.settings.provider).toBe("auto"); // nic nie zmienione bez klucza
  });

  it("z kluczem Gemini → pinuje Gemini 2.5 Flash + premium głos JARVISA", async () => {
    store.setSettings({ keys: { gemini: "AIza-test" } } as any);
    const r = await runTool("lock_assistant", {});
    expect(store.settings.provider).toBe("gemini");
    expect(store.settings.model).toBe("gemini-2.5-flash");
    expect(store.settings.voiceMode).toBe("gemini");
    expect(store.settings.voicePinned).toBe(true);
    expect(store.settings.voiceLock).toBe(false); // biometria „tylko mój głos" — NIE włączamy bez profilu
    expect(store.settings.geminiVoice).toBe("Charon"); // stały, głęboki głos
    expect(r).toMatch(/STAŁY umysł/);
  });

  it("bez Gemini, ale z Groq → pinuje Groq + stały głos systemowy", async () => {
    store.setSettings({ keys: { groq: "gsk-test" } } as any);
    await runTool("lock_assistant", {});
    expect(store.settings.provider).toBe("groq");
    expect(store.settings.model).toContain("llama");
    expect(store.settings.voiceMode).toBe("system");
    expect(store.settings.voicePinned).toBe(true);
  });

  it("Gemini ma pierwszeństwo nad Groq (najlepszy darmowy)", async () => {
    store.setSettings({ keys: { groq: "gsk", gemini: "AIza" } } as any);
    await runTool("lock_assistant", {});
    expect(store.settings.provider).toBe("gemini");
  });
});
