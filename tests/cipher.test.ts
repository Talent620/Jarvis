import { describe, it, expect } from "vitest";
import { encryptText, decryptText } from "../src/lib/cipher";

describe("szyfr AES-256-GCM", () => {
  it("szyfruje i odszyfrowuje z poprawnym hasłem", async () => {
    const secret = "Spotkanie o 21:00, kod 4471.";
    const ct = await encryptText(secret, "haslo123");
    expect(ct.startsWith("JV2:")).toBe(true);
    expect(ct).not.toContain("Spotkanie");
    expect(await decryptText(ct, "haslo123")).toBe(secret);
  });

  it("czyta starszy format JV1 (kompatybilność wsteczna)", async () => {
    // Blob w starym układzie salt(16)+iv(12)+ct, PBKDF2 150k — zbudowany ręcznie.
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await crypto.subtle.importKey("raw", enc.encode("stare-haslo"), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode("stara tajemnica")));
    const out = new Uint8Array(28 + ct.length);
    out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
    const b64 = btoa(String.fromCharCode(...out));
    expect(await decryptText("JV1:" + b64, "stare-haslo")).toBe("stara tajemnica");
  });

  it("złe hasło → błąd (nie odszyfruje)", async () => {
    const ct = await encryptText("tajne", "dobre");
    await expect(decryptText(ct, "zle")).rejects.toBeTruthy();
  });

  it("każde szyfrowanie daje inny wynik (losowy salt/iv)", async () => {
    const a = await encryptText("x", "p");
    const b = await encryptText("x", "p");
    expect(a).not.toBe(b);
  });
});
