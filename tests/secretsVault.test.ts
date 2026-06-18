// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/lib/store";
import { emptyKeys } from "../src/lib/providers/registry";
import {
  installSecretsVault,
  enableAtRest,
  unlock,
  disableAtRest,
  isLocked,
  isAtRestEnabled,
  hasBlob,
  blankSensitive,
  _resetSession,
} from "../src/lib/secretsVault";

const SETTINGS_KEY = "jarvis.settings.v2";
const BLOB_KEY = "jarvis.secrets.v1";

installSecretsVault();

describe("secretsVault — szyfrowanie kluczy w spoczynku", () => {
  beforeEach(() => {
    _resetSession();
    localStorage.removeItem(BLOB_KEY);
    store.setSettings({ secretsAtRest: false, keys: { ...emptyKeys, gemini: "AIzaSEKRET" }, studioKeys: "" });
  });

  it("blankSensitive wymazuje klucze (czysta)", () => {
    const out = blankSensitive({ ...store.settings });
    expect(out.keys.gemini).toBe("");
    expect(out.studioKeys).toBe("");
  });

  it("po włączeniu: dysk NIE zawiera jawnego klucza, blob istnieje, pamięć działa", async () => {
    await enableAtRest("haslo123");
    expect(isAtRestEnabled()).toBe(true);
    expect(hasBlob()).toBe(true);
    // pamięć: klucz nadal dostępny dla działania
    expect(store.settings.keys.gemini).toBe("AIzaSEKRET");
    // dysk: klucz wymazany
    const onDisk = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(onDisk.keys.gemini).toBe("");
    // blob nie zawiera jawnego klucza
    expect(localStorage.getItem(BLOB_KEY)!).not.toContain("AIzaSEKRET");
  });

  it("krótkie hasło odrzucone", async () => {
    const msg = await enableAtRest("ab");
    expect(msg).toMatch(/co najmniej/i);
    expect(isAtRestEnabled()).toBe(false);
  });

  it("unlock poprawnym hasłem przywraca klucze do pamięci", async () => {
    await enableAtRest("haslo123");
    // symuluj nową sesję: klucze wymazane z pamięci + zablokowane
    _resetSession();
    store.setSettings({ keys: { ...emptyKeys }, studioKeys: "" });
    expect(isLocked()).toBe(true);
    const ok = await unlock("haslo123");
    expect(ok).toBe(true);
    expect(isLocked()).toBe(false);
    expect(store.settings.keys.gemini).toBe("AIzaSEKRET");
  });

  it("unlock złym hasłem zwraca false i nie odblokowuje", async () => {
    await enableAtRest("haslo123");
    _resetSession();
    store.setSettings({ keys: { ...emptyKeys } });
    expect(await unlock("zle-haslo")).toBe(false);
    expect(isLocked()).toBe(true);
  });

  it("disableAtRest wraca do jawnego zapisu i usuwa blob", async () => {
    await enableAtRest("haslo123");
    const msg = disableAtRest();
    expect(msg).toMatch(/wyłączone/i);
    expect(isAtRestEnabled()).toBe(false);
    expect(hasBlob()).toBe(false);
    const onDisk = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(onDisk.keys.gemini).toBe("AIzaSEKRET"); // znów jawnie
  });

  it("disableAtRest gdy zablokowane — wymaga najpierw odblokowania", async () => {
    await enableAtRest("haslo123");
    _resetSession();
    store.setSettings({ keys: { ...emptyKeys } });
    expect(isLocked()).toBe(true);
    expect(disableAtRest()).toMatch(/odblokuj/i);
    expect(isAtRestEnabled()).toBe(true); // nadal włączone
  });
});
