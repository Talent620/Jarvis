// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { verifyLicense, deviceId } from "../src/lib/license";

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
});
