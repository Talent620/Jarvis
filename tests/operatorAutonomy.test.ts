// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAutonomyProfile,
  setAutonomyProfile,
  isHardRiskGuardBlocked,
  isOperatorAutoAllowed,
  requestConsent,
  setConsentHandler,
  setAutoConsent,
  clearOutboundScope,
} from "../src/lib/permissions";
import { systemPrompt } from "../src/lib/brain";
import { store } from "../src/lib/store";

describe("Sprint 3 / Moduł 3 — Direct Style + Tryb Autonomii OPERATOR + twardy RiskGuard", () => {
  beforeEach(() => {
    setConsentHandler(null);
    setAutoConsent(false);
    clearOutboundScope();
    store.setSettings({ requireConsentAlways: false, autonomyProfile: "STANDARD" });
    localStorage.clear();
  });

  afterEach(() => {
    setConsentHandler(null);
    setAutoConsent(false);
    clearOutboundScope();
    store.setSettings({ requireConsentAlways: false, autonomyProfile: "STANDARD" });
  });

  it("prompt bazowy wymusza Direct Style (bez korporacyjnego tonu i moralizowania) i szczerość techniczną", () => {
    const prompt = systemPrompt({ userText: "Sprawdź konfigurację serwera" });
    expect(prompt).toContain("STYL BEZPOŚREDNI");
    expect(prompt).toContain("SZCZEROŚĆ TECHNICZNA");
    expect(prompt).toContain("SAMOWIEDZA SYSTEMOWA");
  });

  it("w trybie OPERATOR codzienne narzędzia i bezpieczne akcje UI przechodzą płynnie bez popupów", async () => {
    expect(getAutonomyProfile()).toBe("STANDARD");
    // W STANDARD outbound bez UI jest blokowany (fail-closed)
    expect(await requestConsent("navigate_to", { destination: "Kraków" })).toBe(false);
    expect(await requestConsent("android_open_app", { app: "Spotify" })).toBe(false);

    setAutonomyProfile("OPERATOR");
    expect(getAutonomyProfile()).toBe("OPERATOR");
    expect(isOperatorAutoAllowed("navigate_to", { destination: "Kraków" })).toBe(true);

    // Płynne wykonanie bez popupów w OPERATOR
    expect(await requestConsent("navigate_to", { destination: "Kraków" })).toBe(true);
    expect(await requestConsent("open_url", { url: "https://example.com" })).toBe(true);
    expect(await requestConsent("android_open_app", { app: "Spotify" })).toBe(true);
    expect(await requestConsent("android_scroll", { direction: "down" })).toBe(true);
    expect(await requestConsent("android_back", {})).toBe(true);
    expect(await requestConsent("android_tap_id", { id: 3, expectedLabel: "Odtwórz playlistę" })).toBe(true);
    expect(await requestConsent("update_jarvis_settings", { voiceRate: 1.1 })).toBe(true);
  });

  it("twardy RiskGuard NIGDY nie puszcza pól haseł (isPassword) nawet w trybie OPERATOR i z handlerem pozwalającym na wszystko", async () => {
    setAutonomyProfile("OPERATOR");
    setAutoConsent(true);
    setConsentHandler(async () => ({ allow: true, remember: true }));

    expect(isHardRiskGuardBlocked("android_type", { isPassword: true, text: "tajne" })).toBe(true);
    expect(await requestConsent("android_type", { isPassword: true, text: "tajne" })).toBe(false);
    expect(await requestConsent("android_tap_id", { expectedLabel: "[PASSWORD_BLOCKED]" })).toBe(false);
  });

  it("twardy RiskGuard w trybie OPERATOR nadal wymaga jawnego potwierdzenia dla płatności, usuwania i wysyłek na zewnątrz", async () => {
    setAutonomyProfile("OPERATOR");

    // Bez UI: krytyczne akcje MUSZĄ zostać zablokowane (fail-closed)
    expect(await requestConsent("gmail_send", { to: "a@b.pl", subject: "Oferta" })).toBe(false);
    expect(await requestConsent("send_sms", { to: "+48500000000", text: "Hej" })).toBe(false);
    expect(await requestConsent("make_call", { phone: "+48500000000" })).toBe(false);
    expect(await requestConsent("clear_tally", {})).toBe(false);
    expect(await requestConsent("android_tap_id", { id: 5, expectedLabel: "Zapłać BLIK 500 zł" })).toBe(false);
    expect(await requestConsent("android_tap_id", { id: 6, expectedLabel: "Usuń wszystkie dane" })).toBe(false);
    expect(await requestConsent("android_tap_id", { id: 7, expectedLabel: "Wyślij wiadomość" })).toBe(false);

    // Z handlerem UI: krytyczne akcje pytają z freshOnly=true
    let asked = 0;
    setConsentHandler(async (req) => {
      asked += 1;
      expect(req.freshOnly).toBe(true);
      return { allow: true, remember: true };
    });
    expect(await requestConsent("gmail_send", { to: "a@b.pl" })).toBe(true);
    expect(await requestConsent("android_tap_id", { id: 5, expectedLabel: "Zapłać BLIK 500 zł" })).toBe(true);
    expect(asked).toBe(2);
  });
});
