// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { vaultExists, vaultUnlocked, unlockVault, lockVault, listCreds, saveCred, removeCred, genPassword } from "../src/lib/vault";
import { lockIsSet, setPin, verifyPin, clearPin } from "../src/lib/lock";

beforeEach(() => {
  localStorage.clear();
  lockVault();
});

describe("sejf haseł", () => {
  it("tworzy sejf, zapisuje i odczytuje po odblokowaniu", async () => {
    expect(vaultExists()).toBe(false);
    expect(await unlockVault("master123")).toBe(true);
    expect(vaultUnlocked()).toBe(true);
    await saveCred({ name: "Gmail", login: "ja@gmail.com", password: "tajne!" });
    expect(listCreds()[0].login).toBe("ja@gmail.com");
    expect(vaultExists()).toBe(true);
  });

  it("złe hasło główne nie odblokuje", async () => {
    await unlockVault("dobre");
    await saveCred({ name: "X", login: "a", password: "b" });
    lockVault();
    expect(await unlockVault("zle")).toBe(false);
    expect(vaultUnlocked()).toBe(false);
    expect(await unlockVault("dobre")).toBe(true);
    expect(listCreds()).toHaveLength(1);
  });

  it("usuwa wpis i utrzymuje szyfrowanie na dysku", async () => {
    await unlockVault("m");
    await saveCred({ name: "A", login: "UNIKALNY_LOGIN_XYZ", password: "UNIKALNE_HASLO_XYZ" });
    const blob = localStorage.getItem("jarvis.vault.v1")!;
    expect(blob).not.toContain("UNIKALNY_LOGIN_XYZ"); // nic w jawnej formie
    expect(blob).not.toContain("UNIKALNE_HASLO_XYZ");
    const id = listCreds()[0].id;
    await removeCred(id);
    expect(listCreds()).toHaveLength(0);
  });

  it("generator daje hasła o zadanej długości i losowe", () => {
    const a = genPassword(20);
    expect(a).toHaveLength(20);
    expect(a).not.toBe(genPassword(20));
  });
});

describe("blokada PIN", () => {
  it("ustawia i weryfikuje PIN; zły PIN odrzucony", async () => {
    expect(lockIsSet()).toBe(false);
    await setPin("1234");
    expect(lockIsSet()).toBe(true);
    expect(await verifyPin("1234")).toBe(true);
    expect(await verifyPin("0000")).toBe(false);
  });

  it("PIN przechowywany jako skrót, nie jawnie", async () => {
    await setPin("9876");
    expect(localStorage.getItem("jarvis.lock.v1")).not.toContain("9876");
    clearPin();
    expect(lockIsSet()).toBe(false);
  });
});
