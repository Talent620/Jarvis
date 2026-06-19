// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setPin, verifyPin, clearPin, lockIsSet, lockoutRemainingMs } from "../src/lib/lock";

beforeEach(() => {
  localStorage.clear();
});

describe("Blokada PIN — skrót + sól", () => {
  it("bez ustawionego PIN-u dostęp jest otwarty", async () => {
    expect(lockIsSet()).toBe(false);
    expect(await verifyPin("")).toBe(true);
  });

  it("akceptuje poprawny, odrzuca błędny", async () => {
    await setPin("1234");
    expect(lockIsSet()).toBe(true);
    expect(await verifyPin("1234")).toBe(true);
    expect(await verifyPin("0000")).toBe(false);
  });

  it("PIN nie jest trzymany jawnie (tylko hash+sól)", async () => {
    await setPin("4321");
    const raw = localStorage.getItem("jarvis.lock.v1") || "";
    const rec = JSON.parse(raw) as Record<string, unknown>;
    expect(rec).toHaveProperty("salt");
    expect(rec).toHaveProperty("hash");
    expect(rec).toHaveProperty("iter");
    // Skrót i sól to czysty hex, iter to liczba — PIN nie może być przechowany jawnie.
    // (Uwaga: NIE testujemy `raw.not.toContain("4321")` — losowy hash hex potrafi przypadkiem
    //  zawierać dowolne 4 cyfry, co czyniło ten test niestabilnym.)
    expect(String(rec.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(rec.salt)).toMatch(/^[0-9a-f]+$/);
    expect(typeof rec.iter).toBe("number");
    expect(Object.values(rec)).not.toContain("4321"); // żadne POLE nie jest jawnym PIN-em
  });

  it("clearPin usuwa blokadę", async () => {
    await setPin("1111");
    clearPin();
    expect(lockIsSet()).toBe(false);
  });

  it("nowy PIN używa PBKDF2 (pole iter w rekordzie)", async () => {
    await setPin("1234");
    const rec = JSON.parse(localStorage.getItem("jarvis.lock.v1") || "{}");
    expect(rec.iter).toBeGreaterThan(0);
  });

  it("odrzuca zbyt krótki PIN", async () => {
    await expect(setPin("12")).rejects.toThrow();
  });

  it("weryfikuje stary rekord SHA-256 i migruje go do PBKDF2", async () => {
    // Zasymuluj starszy rekord (sól + jednokrotny SHA-256, bez pola iter).
    const enc = new TextEncoder();
    const salt = "abcd1234";
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(salt + "1234"));
    const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("jarvis.lock.v1", JSON.stringify({ salt, hash }));

    expect(await verifyPin("1234")).toBe(true); // stary skrót nadal działa
    const migrated = JSON.parse(localStorage.getItem("jarvis.lock.v1") || "{}");
    expect(migrated.iter).toBeGreaterThan(0); // po udanym wejściu rekord podniesiony do PBKDF2
    expect(await verifyPin("1234")).toBe(true); // i dalej weryfikuje poprawnie (już PBKDF2)
  });
});

describe("Rate-limit PIN — ochrona przed zgadywaniem", () => {
  it("po 5 błędach włącza chwilową blokadę", async () => {
    await setPin("1234");
    for (let i = 0; i < 5; i++) expect(await verifyPin("9999")).toBe(false);
    expect(lockoutRemainingMs()).toBeGreaterThan(0);
  });

  it("w czasie blokady odrzuca nawet poprawny PIN", async () => {
    await setPin("1234");
    for (let i = 0; i < 5; i++) await verifyPin("9999");
    // poprawny PIN, ale trwa blokada → false
    expect(await verifyPin("1234")).toBe(false);
  });

  it("udane wejście (przed blokadą) zeruje licznik prób", async () => {
    await setPin("1234");
    await verifyPin("0000");
    await verifyPin("0000");
    expect(await verifyPin("1234")).toBe(true);
    expect(lockoutRemainingMs()).toBe(0);
    // kolejna pomyłka nie powinna od razu blokować (licznik wyzerowany)
    await verifyPin("0000");
    expect(lockoutRemainingMs()).toBe(0);
  });
});
