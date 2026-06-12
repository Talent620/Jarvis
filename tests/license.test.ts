// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { verifyLicense, deviceId } from "../src/lib/license";

// Ważny klucz „master" podpisany kluczem prywatnym właściciela (pod kluczem
// publicznym wbudowanym w aplikację). Klucza nie da się podrobić bez prywatnego.
const MASTER =
  "eyJuIjoiQXJ0dXIgSsOzemVmY3phayIsInQiOiJtYXN0ZXIiLCJpYXQiOjE3ODEyMjE5MzA0MDN9.3xeGqPdNatvtGO0vhLzEotOBjGC1nuySdyqyxJzochsvxWg5DZyItGVer-pNp5uwlEUqfy5oEC7WoyW5HERI-A";

describe("Licencja — weryfikacja ECDSA", () => {
  it("akceptuje ważny klucz właściciela i czyta dane", async () => {
    const r = await verifyLicense(MASTER);
    expect(r.valid).toBe(true);
    expect(r.name).toBe("Artur Józefczak");
    expect(r.type).toBe("master");
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
