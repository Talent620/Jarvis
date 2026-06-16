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
    expect(raw).not.toContain("4321");
    expect(JSON.parse(raw)).toHaveProperty("salt");
    expect(JSON.parse(raw)).toHaveProperty("hash");
  });

  it("clearPin usuwa blokadę", async () => {
    await setPin("1111");
    clearPin();
    expect(lockIsSet()).toBe(false);
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
