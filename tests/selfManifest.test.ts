// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  JARVIS_VERSION,
  buildSelfManifest,
  buildSelfAwarenessPromptBlock,
  validateAndApplyJarvisSettings,
  rollbackJarvisSettings,
  clearSettingsRollbackHistory,
} from "../src/lib/selfManifest";
import { store } from "../src/lib/store";
import { runTool, toolDefs } from "../src/lib/tools";

describe("Sprint 3 / Moduł 2 — Samowiedza (selfManifest) + Autonomiczna zmiana ustawień + Rollback", () => {
  beforeEach(() => {
    clearSettingsRollbackHistory();
    store.setSettings({
      provider: "gemini",
      model: "gemini-2.5-flash",
      voiceMode: "system",
      voiceRate: 1.0,
      voicePitch: 0.9,
      personalityMode: "AUTO",
      autonomyProfile: "STANDARD",
      modalUrl: "",
      modalVoiceUrl: "",
    });
    store.setData((d) => {
      d.proactive_budget = { date: "2026-11-24", usedToday: 0, dailyLimit: 3, quietStartHour: 22, quietEndHour: 7 };
    });
  });

  it("buduje prawdziwy manifest samowiedzy bez wyciekania sekretów", () => {
    store.setSettings({
      provider: "modal",
      model: "Qwen/Qwen3-32B-AWQ",
      modalUrl: "https://example--jarvis-brain-serve.modal.run/v1",
      keys: { ...store.settings.keys, modal: "jvllm_SUPER_SECRET_KEY_12345" },
      personalityMode: "BOJOWY",
      autonomyProfile: "OPERATOR",
    });

    const manifest = buildSelfManifest(toolDefs.map((t) => t.name));
    expect(manifest.version).toBe(JARVIS_VERSION);
    expect(manifest.ai.provider).toBe("modal");
    expect(manifest.ai.model).toBe("Qwen/Qwen3-32B-AWQ");
    expect(manifest.ai.modalBrainConfigured).toBe(true);
    expect(manifest.soul.personalityMode).toBe("BOJOWY");
    expect(manifest.soul.autonomyProfile).toBe("OPERATOR");
    expect(manifest.capabilities.activeToolsCount).toBe(toolDefs.length);

    const block = buildSelfAwarenessPromptBlock(toolDefs.map((t) => t.name));
    expect(block).toContain("SAMOWIEDZA SYSTEMOWA");
    expect(block).toContain("Qwen/Qwen3-32B-AWQ");
    expect(block).toContain("OPERATOR");
    expect(block).not.toContain("jvllm_SUPER_SECRET_KEY_12345");
  });

  it("waliduje i stosuje ustawienia własne (AI, TTS, osobowość, Budżet Ciszy, autonomia) oraz cofa 1 kliknięciem (undo)", () => {
    const res = validateAndApplyJarvisSettings({
      provider: "modal",
      model: "Qwen/Qwen3-32B-AWQ",
      voiceMode: "openai",
      openaiTtsModel: "gpt-4o-mini-tts",
      openaiTtsVoice: "ash",
      voiceRate: 1.25,
      personalityMode: "ADWOKAT_DIABLA",
      autonomyProfile: "OPERATOR",
      proactiveDailyLimit: 2,
      quietStartHour: 21,
      quietEndHour: 8,
    });

    expect(res.ok).toBe(true);
    expect(res.rollbackAvailable).toBe(true);
    expect(store.settings.provider).toBe("modal");
    expect(store.settings.voiceMode).toBe("openai");
    expect(store.settings.voiceRate).toBe(1.25);
    expect(store.settings.personalityMode).toBe("ADWOKAT_DIABLA");
    expect(store.settings.autonomyProfile).toBe("OPERATOR");
    expect(store.data.proactive_budget?.dailyLimit).toBe(2);
    expect(store.data.proactive_budget?.quietStartHour).toBe(21);

    // 1-klikowe cofnięcie przywraca dokładny stan sprzed zmiany
    const undo = rollbackJarvisSettings();
    expect(undo.ok).toBe(true);
    expect(store.settings.provider).toBe("gemini");
    expect(store.settings.voiceMode).toBe("system");
    expect(store.settings.voiceRate).toBe(1.0);
    expect(store.settings.personalityMode).toBe("AUTO");
    expect(store.settings.autonomyProfile).toBe("STANDARD");
    expect(store.data.proactive_budget?.dailyLimit).toBe(3);
    expect(store.data.proactive_budget?.quietStartHour).toBe(22);

    // Kolejne cofnięcie na pustym stosie → czytelny komunikat bez błędu
    expect(rollbackJarvisSettings().ok).toBe(false);
  });

  it("odrzuca atomowo błędny lub pusty URL i wartości spoza schematu bez psucia konfiguracji", () => {
    const bad1 = validateAndApplyJarvisSettings({ modalUrl: "", provider: "modal" });
    expect(bad1.ok).toBe(false);
    expect(bad1.errors.join(" ")).toContain("modalUrl");
    expect(store.settings.provider).toBe("gemini"); // atomowo nic nie zmienione!

    const bad2 = validateAndApplyJarvisSettings({ modalVoiceUrl: "ftp://evil.local" });
    expect(bad2.ok).toBe(false);

    const bad3 = validateAndApplyJarvisSettings({ voiceRate: 9.5, provider: "nieistniejacy" });
    expect(bad3.ok).toBe(false);
    expect(store.settings.voiceRate).toBe(1.0);
  });

  it("narzędzia get_jarvis_status, update_jarvis_settings i rollback_jarvis_settings działają end-to-end przez runTool", async () => {
    const statusRaw = await runTool("get_jarvis_status", {});
    const status = JSON.parse(statusRaw);
    expect(status.version).toBe(JARVIS_VERSION);
    expect(status.capabilities.activeToolsCount).toBeGreaterThan(20);

    const upd = await runTool("update_jarvis_settings", { personalityMode: "BOJOWY", voiceRate: 1.15 });
    expect(upd).toContain("Zaktualizowano");
    expect(store.settings.personalityMode).toBe("BOJOWY");
    expect(store.settings.voiceRate).toBe(1.15);

    const rb = await runTool("rollback_jarvis_settings", {});
    expect(rb).toContain("Cofnięto");
    expect(store.settings.personalityMode).toBe("AUTO");
    expect(store.settings.voiceRate).toBe(1.0);
  });
});
