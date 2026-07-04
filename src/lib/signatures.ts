// === Biblioteka podpisów e-mail (Email OS / PHASE 3) ===
// Wiele podpisów + wybór przed wysyłką. NIEINWAZYJNE: AKTYWNY podpis to nadal `emailSignature`
// (wszystkie istniejące wysyłki używają go bez zmian) — tu tylko dajemy listę i przełączanie,
// który zapisany podpis go wypełnia. Pure helpery (na tablicach) + cienkie wrappery na store.

import { store } from "./store";
import type { Signature } from "../types";

export type { Signature };

let seq = 0;
function genId(): string {
  seq += 1;
  return `sig_${seq}_${Math.round(performance.now?.() ?? 0)}`;
}

// --- Pure (testowalne) ---

/** Pure: dodaj lub zaktualizuj podpis po id (upsert). */
export function upsertSignature(list: Signature[], sig: Signature): Signature[] {
  const i = list.findIndex((s) => s.id === sig.id);
  if (i < 0) return [...list, sig];
  const copy = list.slice();
  copy[i] = sig;
  return copy;
}

/** Pure: usuń podpis po id. */
export function removeSignatureFrom(list: Signature[], id: string): Signature[] {
  return list.filter((s) => s.id !== id);
}

// --- Wrappery na store (aktywny = emailSignature) ---

export function listSignatures(): Signature[] {
  return store.settings.signatures || [];
}

export function activeSignatureBody(): string {
  return store.settings.emailSignature || "";
}

/** Dodaj nowy podpis i zwróć go. */
export function addSignature(name: string, body: string): Signature {
  const sig: Signature = { id: genId(), name: name.trim() || "Podpis", body };
  store.setSettings({ signatures: upsertSignature(listSignatures(), sig) });
  return sig;
}

export function updateSignature(id: string, patch: Partial<Pick<Signature, "name" | "body">>): void {
  const cur = listSignatures().find((s) => s.id === id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  store.setSettings({ signatures: upsertSignature(listSignatures(), next) });
  // Jeśli edytujemy aktywny (po treści) — odśwież aktywną treść.
  if (cur.body === activeSignatureBody() && patch.body != null) store.setSettings({ emailSignature: patch.body });
}

export function removeSignature(id: string): void {
  store.setSettings({ signatures: removeSignatureFrom(listSignatures(), id) });
}

/** Ustaw wybrany podpis jako AKTYWNY (wypełnia emailSignature — używany przez wszystkie wysyłki). */
export function useSignature(id: string): void {
  const sig = listSignatures().find((s) => s.id === id);
  if (sig) store.setSettings({ emailSignature: sig.body });
}

/** Migracja: jeśli lista pusta, a jest aktywny podpis — zasiej go jako pierwszy zapisany. */
export function seedSignatures(): void {
  if (listSignatures().length) return;
  const body = activeSignatureBody().trim();
  if (body) addSignature("Mój podpis", body);
}
