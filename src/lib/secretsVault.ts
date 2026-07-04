// Szyfrowanie kluczy API w spoczynku (opcjonalne, hasłem). Domyślnie WYŁĄCZONE —
// wtedy zero zmian względem dotychczasowego zachowania.
//
// Model bezpieczeństwa i zgodności:
//  • Klucze w PAMIĘCI pozostają jawne (wszyscy czytelnicy `store.settings.keys` działają bez zmian).
//  • Na DYSK (localStorage) klucze trafiają tylko zaszyfrowane (AES-256-GCM + PBKDF2, format JV2),
//    w osobnym kluczu `jarvis.secrets.v1`; w `jarvis.settings.v2` pola wrażliwe są WYMAZANE.
//  • Odzyskiwalność: zapomniane hasło = po prostu wpisujesz klucze ponownie (są odtwarzalne
//    z konsoli dostawcy) — to NIE jest nieodwracalna utrata danych.
//
// Pola wrażliwe: `keys` (per-dostawca), `studioKeys`.

import { store, setSettingsPersistTransform } from "./store";
import { encryptText, decryptText } from "./cipher";
import { emptyKeys } from "./providers/registry";
import type { Settings } from "../types";

const BLOB_KEY = "jarvis.secrets.v1";

// Stan sesji (w pamięci, nigdy na dysk):
let sessionPass: string | null = null;
let unlocked = false; // czy jawne klucze są w pamięci (po odblokowaniu lub włączeniu)
let syncTimer: ReturnType<typeof setTimeout> | undefined;

/** Czy szyfrowanie w spoczynku jest włączone (z ustawień). */
export function isAtRestEnabled(): boolean {
  return !!store.settings.secretsAtRest;
}

/** Czy klucze są zablokowane (włączone, a jeszcze nieodblokowane w tej sesji). */
export function isLocked(): boolean {
  return isAtRestEnabled() && !unlocked;
}

/** Czy w localStorage istnieje zaszyfrowany blob kluczy. */
export function hasBlob(): boolean {
  try {
    return !!localStorage.getItem(BLOB_KEY);
  } catch {
    return false;
  }
}

/** Wytnij pola wrażliwe z kopii ustawień (do zapisu na dysk). Czysta. */
export function blankSensitive(s: Settings): Settings {
  return { ...s, keys: { ...emptyKeys }, studioKeys: "" };
}

/** Serializowalny zrzut pól wrażliwych. */
function sensitivePayload(): string {
  return JSON.stringify({ keys: store.settings.keys, studioKeys: store.settings.studioKeys || "" });
}

/** Zapisz (zaszyfruj) bieżące pola wrażliwe do blobu. Wymaga hasła sesji. */
async function writeBlob(): Promise<void> {
  if (!sessionPass) return;
  try {
    const blob = await encryptText(sensitivePayload(), sessionPass);
    localStorage.setItem(BLOB_KEY, blob);
  } catch {
    /* brak miejsca / crypto — nie wywracaj aplikacji */
  }
}

// Po zmianie kluczy w stanie odblokowanym odśwież blob (debounce — edycje bywają seryjne).
function scheduleBlobSync(): void {
  if (!isAtRestEnabled() || !unlocked || !sessionPass) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void writeBlob(), 600);
}

/**
 * Włącz szyfrowanie w spoczynku bieżącym hasłem. Klucze pozostają w pamięci (działają dalej),
 * a na dysk od teraz idą tylko zaszyfrowane. Zwraca komunikat.
 */
export async function enableAtRest(pass: string): Promise<string> {
  const p = (pass || "").trim();
  if (p.length < 4) return "Hasło musi mieć co najmniej 4 znaki.";
  sessionPass = p;
  unlocked = true;
  await writeBlob(); // najpierw bezpiecznie zaszyfruj klucze…
  store.setSettings({ secretsAtRest: true }); // …potem włącz (zapis wymaże jawne klucze z dysku)
  return "✅ Klucze API zaszyfrowane w spoczynku. Zapamiętaj hasło — przy starcie trzeba będzie odblokować (zapomniane = wpisz klucze ponownie).";
}

/** Odblokuj klucze w tej sesji (odszyfruj blob do pamięci). Zwraca true przy sukcesie. */
export async function unlock(pass: string): Promise<boolean> {
  const p = (pass || "").trim();
  if (!p || !hasBlob()) return false;
  try {
    const json = await decryptText(localStorage.getItem(BLOB_KEY)!, p);
    const data = JSON.parse(json) as { keys?: Record<string, string>; studioKeys?: string };
    // Wgraj do pamięci (zapis na dysk i tak wymaże te pola, dopóki at-rest jest włączone).
    store.setSettings({
      keys: { ...emptyKeys, ...(data.keys || {}) },
      studioKeys: data.studioKeys || "",
    });
    sessionPass = p;
    unlocked = true;
    return true;
  } catch {
    return false; // złe hasło / uszkodzony blob
  }
}

/**
 * Wyłącz szyfrowanie w spoczynku — wraca do jawnego zapisu kluczy. Wymaga, by klucze były
 * dostępne w pamięci (po odblokowaniu lub w tej samej sesji). Zwraca komunikat.
 */
export function disableAtRest(): string {
  if (isLocked()) return "Najpierw odblokuj klucze hasłem, zanim wyłączysz szyfrowanie.";
  store.setSettings({ secretsAtRest: false }); // od teraz zapis jest jawny (transform przestaje wymazywać)
  try {
    localStorage.removeItem(BLOB_KEY);
  } catch {
    /* ignore */
  }
  sessionPass = null;
  return "Szyfrowanie kluczy w spoczynku wyłączone — klucze zapisywane jawnie.";
}

let installed = false;
/** Podłącz vault do store: wymazywanie pól wrażliwych przy zapisie + auto-odświeżanie blobu. */
export function installSecretsVault(): void {
  if (installed) return;
  installed = true;
  setSettingsPersistTransform((s) => (s.secretsAtRest ? blankSensitive(s) : s));
  store.subscribe(scheduleBlobSync);
}

// Testowe/wewnętrzne: reset stanu sesji.
export function _resetSession(): void {
  sessionPass = null;
  unlocked = false;
  if (syncTimer) clearTimeout(syncTimer);
}
