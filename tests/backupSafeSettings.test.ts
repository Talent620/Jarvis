// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { buildNormalPayload, applyParsed, pickSafeSettings, sanitizeSafeSettings } from "../src/lib/backup";
import { store } from "../src/lib/store";

describe("zwykła kopia — bezpieczne ustawienia biznesowe (marka + podpisy)", () => {
  beforeEach(() => {
    store.setData((d) => { d.tasks = []; d.notes = []; });
  });

  it("pickSafeSettings bierze tylko markę i podpisy — żadnych sekretów", () => {
    const safe = pickSafeSettings({
      keys: { anthropic: "tajny" },
      smtpPass: "haslo-smtp",
      syncToken: "token",
      salesOsToken: "t2",
      proxyUrl: "http://zly",
      emailSignature: "Marcin Kubicki",
      signatures: [{ id: "s1", name: "Główny", body: "Pozdrawiam" }],
      brandKit: { tone: "pro" },
    } as any);
    expect(safe).toHaveProperty("emailSignature", "Marcin Kubicki");
    expect((safe as any).signatures?.[0]?.name).toBe("Główny");
    expect((safe as any).brandKit?.tone).toBe("pro");
    // sekrety NIE przechodzą
    expect(safe).not.toHaveProperty("keys");
    expect(safe).not.toHaveProperty("smtpPass");
    expect(safe).not.toHaveProperty("syncToken");
    expect(safe).not.toHaveProperty("salesOsToken");
    expect(safe).not.toHaveProperty("proxyUrl");
  });

  it("ładunek zwykłej kopii nie zawiera kluczy / tokenów / hasła SMTP", () => {
    store.setSettings({ keys: { anthropic: "SEKRET-API" }, smtpPass: "SEKRET-SMTP", syncToken: "SEKRET-TOKEN" } as any);
    const payload = buildNormalPayload();
    const json = JSON.stringify(payload);
    expect(json).not.toContain("SEKRET-API");
    expect(json).not.toContain("SEKRET-SMTP");
    expect(json).not.toContain("SEKRET-TOKEN");
    expect(payload).not.toHaveProperty("settings"); // zwykła kopia nie ma pełnych ustawień
  });

  it("round-trip: marka i podpisy przeżywają eksport→import", () => {
    store.setSettings({
      emailSignature: "Marcin Kubicki\nJARVIS",
      signatures: [{ id: "s1", name: "Biznes", body: "Z poważaniem" }],
      brandKit: { tone: "ekspercki", primary: "#0af" } as any,
    });
    const payload = buildNormalPayload();
    // wyczyść stan i odtwórz z kopii
    store.setSettings({ emailSignature: "", signatures: [], brandKit: undefined } as any);
    const msg = applyParsed(payload);
    expect(msg).toMatch(/markę i podpisy|Dane/);
    expect(store.settings.emailSignature).toContain("Marcin Kubicki");
    expect(store.settings.signatures?.[0]?.name).toBe("Biznes");
    expect((store.settings.brandKit as any)?.primary).toBe("#0af");
  });

  it("sanitizeSafeSettings odrzuca wstrzyknięte sekrety", () => {
    const out = sanitizeSafeSettings({ emailSignature: "ok", keys: { x: "y" }, smtpPass: "p", proxyUrl: "z" });
    expect(out).toHaveProperty("emailSignature", "ok");
    expect(out).not.toHaveProperty("keys");
    expect(out).not.toHaveProperty("smtpPass");
    expect(out).not.toHaveProperty("proxyUrl");
  });

  it("import starej zwykłej kopii bez safeSettings nadal działa", () => {
    store.setSettings({ emailSignature: "ZACHOWAJ" } as any);
    const msg = applyParsed({ app: "jarvis", version: 1, data: { tasks: [], notes: [] } });
    expect(msg).toMatch(/Dane przywrócone/);
    expect(store.settings.emailSignature).toBe("ZACHOWAJ"); // brak safeSettings → nie nadpisuje
  });
});
