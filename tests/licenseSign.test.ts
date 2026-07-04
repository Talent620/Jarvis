// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePrivateJwk,
  privateMatchesApp,
  signLicense,
  decodeLicense,
  licenseStatus,
  issueLocalLicense,
  extendLocalLicense,
  listLocalLicenses,
  saveLocalLicense,
  removeLocalLicense,
  type LicenseRecord,
} from "../src/lib/licenseSign";
import { PUBLIC_JWK } from "../src/lib/license";

// Para kluczy testowych (NIE klucz aplikacji) — do round-tripu podpis→weryfikacja.
async function genKeypair() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { priv, pub };
}
async function verifyToken(token: string, pubJwk: JsonWebKey): Promise<boolean> {
  const [data, sig] = token.split(".");
  const key = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const toBytes = (s: string) => {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  };
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, toBytes(sig), new TextEncoder().encode(data));
}

describe("licenseSign — parsowanie i dopasowanie klucza", () => {
  it("parsePrivateJwk akceptuje EC P-256 z polem d, odrzuca śmieci", () => {
    expect(parsePrivateJwk("nie-json")).toBeNull();
    expect(parsePrivateJwk(JSON.stringify({ kty: "RSA" }))).toBeNull();
    expect(parsePrivateJwk(JSON.stringify({ kty: "EC", crv: "P-256", x: "a", y: "b" }))).toBeNull(); // brak d
    const ok = parsePrivateJwk(JSON.stringify({ kty: "EC", crv: "P-256", d: "d", x: "a", y: "b" }));
    expect(ok).not.toBeNull();
  });

  it("privateMatchesApp: true tylko gdy x/y zgodne z kluczem publicznym aplikacji", () => {
    expect(privateMatchesApp({ kty: "EC", crv: "P-256", d: "x", x: PUBLIC_JWK.x, y: PUBLIC_JWK.y })).toBe(true);
    expect(privateMatchesApp({ kty: "EC", crv: "P-256", d: "x", x: "inny", y: "inny" })).toBe(false);
  });
});

describe("licenseSign — podpis i odczyt", () => {
  it("signLicense tworzy token, który weryfikuje się kluczem publicznym pary", async () => {
    const { priv, pub } = await genKeypair();
    const token = await signLicense(priv, "Tester", 30);
    expect(token).toContain(".");
    expect(await verifyToken(token, pub)).toBe(true);
  });

  it("payload ma właściciela, typ i exp (term) albo brak exp (perpetual)", async () => {
    const { priv } = await genKeypair();
    const term = decodeLicense(await signLicense(priv, "Młody", 7));
    expect(term?.n).toBe("Młody");
    expect(term?.t).toBe("term");
    expect(typeof term?.exp).toBe("number");

    const perp = decodeLicense(await signLicense(priv, "Szef", 0));
    expect(perp?.t).toBe("perpetual");
    expect(perp?.exp).toBeUndefined();
  });

  it("decodeLicense odporne na śmieci", () => {
    expect(decodeLicense("")).toBeNull();
    expect(decodeLicense("bezkropki")).toBeNull();
  });
});

describe("licenseSign — status wg daty", () => {
  const now = 1_000_000_000_000;
  it("bezterminowy / aktywny / wygasa wkrótce / wygasły", () => {
    expect(licenseStatus(null, now).tone).toBe("ok");
    expect(licenseStatus(now + 40 * 86400000, now).tone).toBe("ok");
    expect(licenseStatus(now + 3 * 86400000, now).tone).toBe("warn");
    expect(licenseStatus(now - 86400000, now).tone).toBe("err");
  });
});

describe("licenseSign — lokalny rejestr (kto · na ile)", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });

  it("issueLocalLicense zapisuje rekord z właścicielem i tokenem", async () => {
    const { priv } = await genKeypair();
    const rec = await issueLocalLicense(priv, "tester młody", 30);
    expect(rec.owner).toBe("tester młody");
    expect(rec.token).toContain(".");
    expect(rec.exp).toBeGreaterThan(Date.now());
    const all = listLocalLicenses();
    expect(all).toHaveLength(1);
    expect(all[0].owner).toBe("tester młody");
  });

  it("extendLocalLicense przedłuża TEN SAM wpis (to samo id, nowy token/exp)", async () => {
    const { priv } = await genKeypair();
    const rec = await issueLocalLicense(priv, "szef", 30);
    const before = rec.exp!;
    const up = await extendLocalLicense(priv, rec, 365);
    expect(up.id).toBe(rec.id); // ten sam właściciel/wpis
    expect(up.exp!).toBeGreaterThan(before);
    expect(listLocalLicenses()).toHaveLength(1); // nie dubluje
  });

  it("przedłużenie na 0 dni → bezterminowy", async () => {
    const { priv } = await genKeypair();
    const rec = await issueLocalLicense(priv, "vip", 30);
    const up = await extendLocalLicense(priv, rec, 0);
    expect(up.type).toBe("perpetual");
    expect(up.exp).toBeNull();
  });

  it("removeLocalLicense usuwa z rejestru po id", async () => {
    const { priv } = await genKeypair();
    const a = await issueLocalLicense(priv, "A", 10);
    await issueLocalLicense(priv, "B", 10);
    removeLocalLicense(a.id);
    const all = listLocalLicenses();
    expect(all.map((r: LicenseRecord) => r.owner)).toEqual(["B"]);
  });

  it("saveLocalLicense robi upsert (po id), nie duplikuje", async () => {
    const { priv } = await genKeypair();
    const rec = await issueLocalLicense(priv, "X", 10);
    saveLocalLicense({ ...rec, owner: "X-zmienione" });
    const all = listLocalLicenses();
    expect(all).toHaveLength(1);
    expect(all[0].owner).toBe("X-zmienione");
  });
});
