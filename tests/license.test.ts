// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { verifyLicense, deviceId, normalizeKey, licenseStatus, licenseExpiryNudge } from "../src/lib/license";

describe("licenseStatus + licenseExpiryNudge — trial i licencja czasowa", () => {
  const NOW = 1_800_000_000_000;
  const days = (n: number) => NOW + n * 86_400_000;

  it("bezterminowa / otwarta → brak odliczania i zachęty", () => {
    expect(licenseStatus({ valid: true, type: "perpetual" }, NOW).kind).toBe("perpetual");
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "perpetual" }, NOW))).toBeNull();
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "open" }, NOW))).toBeNull();
  });
  it("trial: liczy dni i ZAWSZE pokazuje zachętę", () => {
    const st = licenseStatus({ valid: true, type: "trial", exp: days(10) }, NOW);
    expect(st.kind).toBe("trial");
    expect(st.daysLeft).toBe(10);
    expect(licenseExpiryNudge(st)).toMatch(/Trial — zostało 10 dni/);
  });
  it("licencja czasowa: zachęta tylko przy końcu (≤3 dni)", () => {
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "term", exp: days(30) }, NOW))).toBeNull();
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "term", exp: days(2) }, NOW))).toMatch(/Przedłuż/);
  });
  it("ostatni dzień / wygasło — czytelne komunikaty", () => {
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "trial", exp: days(1) }, NOW))).toMatch(/ostatni dzień/);
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "trial", exp: NOW + 3600_000 }, NOW))).toMatch(/ostatni dzień/);
    expect(licenseExpiryNudge(licenseStatus({ valid: true, type: "trial", exp: days(-1) }, NOW))).toMatch(/wygasł/);
  });
});

// Ważny klucz testowy (fixture) podpisany kluczem prywatnym właściciela pod kluczem
// publicznym wbudowanym w aplikację. Klucza nie da się podrobić bez prywatnego.
const MASTER =
  "eyJuIjoiRklYVFVSRSBURVNUT1dZIiwidCI6InBlcnBldHVhbCIsImlhdCI6MTc4MTIyMTkzMDQwM30.ThGeY2Iw7qNJ31oQz32SImiVICML-4TM8N5lRtHvO1J728d9B4lvTSnIX8x8t61sNUFbLqqEPLHulVa-8zmc5A";

describe("Licencja — weryfikacja ECDSA", () => {
  it("akceptuje ważny klucz właściciela i czyta dane", async () => {
    const r = await verifyLicense(MASTER);
    expect(r.valid).toBe(true);
    expect(r.name).toBe("FIXTURE TESTOWY");
    expect(r.type).toBe("perpetual");
  });

  it("odrzuca podrobiony podpis (zmieniony znak)", async () => {
    const tampered = MASTER.slice(0, -3) + (MASTER.endsWith("AAA") ? "BBB" : "AAA");
    expect((await verifyLicense(tampered)).valid).toBe(false);
  });

  it("odrzuca podmienioną treść (inny payload, ten sam podpis)", async () => {
    const [, sig] = MASTER.split(".");
    const fakePayload = Buffer.from(JSON.stringify({ n: "Haker", t: "master" })).toString("base64url");
    expect((await verifyLicense(`${fakePayload}.${sig}`)).valid).toBe(false);
  });

  it("odrzuca śmieci i pusty klucz", async () => {
    expect((await verifyLicense("losowy-klucz")).valid).toBe(false);
    expect((await verifyLicense("")).valid).toBe(false);
    expect((await verifyLicense("a.b")).valid).toBe(false);
  });

  it("deviceId jest stabilny (limit urządzeń + podgląd kto korzysta)", () => {
    const a = deviceId();
    const b = deviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  // Regresja: użytkownik nie mógł aktywować, bo wklejenie z telefonu wstawiało
  // niewidoczne znaki/spacje. normalizeKey ma je usuwać, a verify — przyjąć klucz.
  it("normalizeKey usuwa spacje, nowe linie i znaki zero-width/BOM", () => {
    expect(normalizeKey("  ab c\n d\t")).toBe("abcd");
    expect(normalizeKey("a​b­c﻿d⁠")).toBe("abcd");
  });

  it("akceptuje ważny klucz mimo brudnego wklejenia (spacje + zero-width)", async () => {
    const dirty = "  " + MASTER.slice(0, 20) + "​ \n" + MASTER.slice(20) + "﻿";
    expect((await verifyLicense(dirty)).valid).toBe(true);
  });
});
