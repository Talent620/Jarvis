import { describe, it, expect } from "vitest";
import {
  detectPersonalityMode,
  resolvePersonalityMode,
  parseVoicePersonalityCommand,
  formatForSpokenPolish,
  buildSoulPromptBlock,
  VOICE_MODE_DIRECTIVE,
} from "../src/lib/soulModes";
import { applyVoiceModeToOpenAiBody, VOICE_MODE_SYSTEM_RULE } from "../proxy/lib/voiceProtocol.js";

describe("Sprint 2 / Moduł 1 — Protokół Mówionej Polszczyzny + 3 Tryby Osobowości", () => {
  describe("automatyczny dobór trybu osobowości (router Refleks/Kora)", () => {
    it("wybiera BOJOWY dla błędów, awarii, kodu i szybkich komend", () => {
      expect(detectPersonalityMode("Serwer padł, mam HTTP 502 na nginx, napraw to")).toBe("BOJOWY");
      expect(detectPersonalityMode("Błąd w git deploy i testy CI/CD nie przechodzą")).toBe("BOJOWY");
      expect(detectPersonalityMode("Szybko sprawdź logi docker!")).toBe("BOJOWY");
    });

    it("wybiera ADWOKAT_DIABLA dla decyzji, wydatków, umów i pomysłów biznesowych", () => {
      expect(detectPersonalityMode("Zastanawiam się czy podpisać tę umowę na leasing")).toBe("ADWOKAT_DIABLA");
      expect(detectPersonalityMode("Mam pomysł na inwestycję 50 tys., czy warto i jaka marża?")).toBe("ADWOKAT_DIABLA");
      expect(detectPersonalityMode("Sprawdź mój wydatek i budżet na nową kampanię")).toBe("ADWOKAT_DIABLA");
    });

    it("wybiera KUMPEL dla luźnej rozmowy i jazdy w trasie", () => {
      expect(detectPersonalityMode("Siema Jarvis, jadę w trasę, co tam u Ciebie?")).toBe("KUMPEL");
      expect(detectPersonalityMode("Pogadajmy o jakimś dobrym filmie na weekend")).toBe("KUMPEL");
      expect(detectPersonalityMode("")).toBe("KUMPEL");
    });
  });

  describe("rozstrzyganie ręczne vs AUTO i komendy głosowe", () => {
    it("ręczny wybór w UI nadpisuje autodetekcję", () => {
      expect(resolvePersonalityMode("BOJOWY", "Siema, pogadajmy w trasie")).toBe("BOJOWY");
      expect(resolvePersonalityMode("ADWOKAT_DIABLA", "Siema, jak leci?")).toBe("ADWOKAT_DIABLA");
      expect(resolvePersonalityMode("KUMPEL", "Awaria serwera 500!")).toBe("KUMPEL");
      expect(resolvePersonalityMode("AUTO", "Awaria serwera 500!")).toBe("BOJOWY");
    });

    it("rozpoznaje głosowe przełączanie trybów osobowości", () => {
      expect(parseVoicePersonalityCommand("Przełącz tryb bojowy")).toBe("BOJOWY");
      expect(parseVoicePersonalityCommand("Włącz tryb kumpla")).toBe("KUMPEL");
      expect(parseVoicePersonalityCommand("Zmień na adwokata diabła")).toBe("ADWOKAT_DIABLA");
      expect(parseVoicePersonalityCommand("Włącz tryb auto osobowości")).toBe("AUTO");
      expect(parseVoicePersonalityCommand("Ile kosztuje ten serwer?")).toBeNull();
    });
  });

  describe("Protokół Mówionej Polszczyzny (voice_mode)", () => {
    it("wstrzykuje VOICE_MODE_DIRECTIVE tylko gdy voiceMode=true", () => {
      const off = buildSoulPromptBlock({ mode: "BOJOWY", voiceMode: false });
      expect(off.mode).toBe("BOJOWY");
      expect(off.block).toContain("BOJOWY");
      expect(off.block).not.toContain("voice_mode");

      const on = buildSoulPromptBlock({ mode: "ADWOKAT_DIABLA", voiceMode: true });
      expect(on.mode).toBe("ADWOKAT_DIABLA");
      expect(on.block).toContain("ADWOKAT DIABŁA");
      expect(on.block).toContain(VOICE_MODE_DIRECTIVE);
    });

    it("czyści markdown, listy punktowane, linki URL i ucina do max 3 zdań", () => {
      const raw = [
        "### Plan działania",
        "- **Pierwszy** krok na https://example.com/secret?a=1.",
        "- Drugi krok z `komendą`.",
        "3. Trzeci krok zamyka temat.",
        "4. Czwarty krok nie powinien zostać przeczytany.",
      ].join("\n");
      const spoken = formatForSpokenPolish(raw, 3);
      expect(spoken).not.toContain("###");
      expect(spoken).not.toContain("**");
      expect(spoken).not.toContain("https://");
      expect(spoken).not.toContain("`");
      expect(spoken).not.toContain("Czwarty krok");
      expect(spoken).toContain("Plan działania");
    });

    it("proxy/lib/voiceProtocol wstrzykuje regułę voice_mode do payloadu OpenAI i usuwa pole voice_mode", () => {
      const payload = JSON.stringify({
        model: "Qwen/Qwen3-32B-AWQ",
        voice_mode: true,
        messages: [
          { role: "system", content: "Jesteś Jarvis." },
          { role: "user", content: "Co słychać?" },
        ],
      });
      const out = applyVoiceModeToOpenAiBody(payload, false);
      const parsed = JSON.parse(out);
      expect(parsed.voice_mode).toBeUndefined();
      expect(parsed.messages[0].content).toContain(VOICE_MODE_SYSTEM_RULE);
    });

    it("proxy/lib/voiceProtocol aktywuje się także z nagłówka x-voice-mode i dodaje system message jeśli brak", () => {
      const payload = JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hej" }],
      });
      const out = applyVoiceModeToOpenAiBody(payload, true);
      const parsed = JSON.parse(out);
      expect(parsed.messages[0].role).toBe("system");
      expect(parsed.messages[0].content).toContain("PROTOKÓŁ MÓWIONEJ POLSZCZYZNY");
    });
  });
});
