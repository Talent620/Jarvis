// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeImportedSettings } from "../src/lib/backup";
import type { Settings } from "../src/types";

const cur = {
  provider: "auto",
  proxyUrl: "https://my-bff.workers.dev",
  syncUrl: "",
  salesOsUrl: "",
  smtpHost: "smtp.gmail.com",
  userName: "Sir",
  speak: true,
  keys: { anthropic: "real-key" },
} as unknown as Settings;

describe("sanitizeImportedSettings — anty-exfiltracja przy imporcie kopii", () => {
  it("odrzuca nieznane klucze (anty-injection)", () => {
    const out = sanitizeImportedSettings({ evil: "x", __proto__polluted: 1, userName: "Boss" }, cur, () => true) as Record<string, unknown>;
    expect(out).not.toHaveProperty("evil");
    expect(out.userName).toBe("Boss");
  });

  it("odrzuca pola o niezgodnym typie", () => {
    const out = sanitizeImportedSettings({ speak: "tak", userName: 123 }, cur, () => true) as Record<string, unknown>;
    expect(out).not.toHaveProperty("speak"); // boolean vs string
    expect(out).not.toHaveProperty("userName"); // string vs number
  });

  it("NIE podmienia adresów-endpointów, gdy użytkownik nie potwierdzi", () => {
    const out = sanitizeImportedSettings(
      { proxyUrl: "https://evil.example/relay", smtpHost: "evil.smtp", userName: "X" },
      cur,
      () => false, // użytkownik odmawia
    ) as Record<string, unknown>;
    expect(out).not.toHaveProperty("proxyUrl");
    expect(out).not.toHaveProperty("smtpHost");
    expect(out.userName).toBe("X"); // nie-endpointy przechodzą
  });

  it("podmienia adresy-endpointów po potwierdzeniu", () => {
    const seen: string[] = [];
    const out = sanitizeImportedSettings(
      { proxyUrl: "https://new.example/relay" },
      cur,
      (keys) => { seen.push(...keys); return true; },
    ) as Record<string, unknown>;
    expect(out.proxyUrl).toBe("https://new.example/relay");
    expect(seen).toContain("proxyUrl");
  });

  it("nie pyta, gdy endpointy się nie zmieniają", () => {
    let asked = false;
    const out = sanitizeImportedSettings({ proxyUrl: cur.proxyUrl, speak: false }, cur, () => { asked = true; return true; }) as Record<string, unknown>;
    expect(asked).toBe(false);
    expect(out.speak).toBe(false);
  });
});
