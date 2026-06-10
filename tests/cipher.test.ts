import { describe, it, expect } from "vitest";
import { encryptText, decryptText } from "../src/lib/cipher";

describe("szyfr AES-256-GCM", () => {
  it("szyfruje i odszyfrowuje z poprawnym hasłem", async () => {
    const secret = "Spotkanie o 21:00, kod 4471.";
    const ct = await encryptText(secret, "haslo123");
    expect(ct.startsWith("JV1:")).toBe(true);
    expect(ct).not.toContain("Spotkanie");
    expect(await decryptText(ct, "haslo123")).toBe(secret);
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
