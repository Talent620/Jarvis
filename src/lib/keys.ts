// Wiele kluczy API na dostawcę + automatyczna rotacja i krótki „cooldown".
//
// Użytkownik może wpisać KILKA kluczy jednego dostawcy (każdy w nowej linii lub po
// przecinku). JARVIS używa ich po kolei, a gdy któryś zwróci limit/awarię, odkłada
// go na chwilę i sięga po następny — dzięki temu rozmowa nie wywala się przez jeden
// wyczerpany klucz. Klucze trzymane są lokalnie w ustawieniach; cooldown żyje tylko
// w pamięci (nie zapisujemy go), więc po restarcie wszystkie klucze są znów świeże.
import { store } from "./store";
import type { ProviderId } from "./providers/types";

/** Lista kluczy danego dostawcy (rozdziel nową linią lub przecinkiem, bez duplikatów). */
export function keyList(provider: ProviderId): string[] {
  const raw = store.settings.keys[provider] || "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const k = part.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Ile kluczy ma dany dostawca (do podpowiedzi w UI). */
export const keyCount = (provider: ProviderId): number => keyList(provider).length;

// --- Cooldown kluczy, które właśnie zwróciły limit/awarię ---
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 60_000; // 1 min — tyle odpoczywa klucz po błędzie limitu
const ck = (p: ProviderId, k: string) => `${p}::${k}`;

export function isCoolingDown(provider: ProviderId, key: string): boolean {
  const t = cooldownUntil.get(ck(provider, key));
  return !!t && t > Date.now();
}

export function coolDownKey(provider: ProviderId, key: string): void {
  cooldownUntil.set(ck(provider, key), Date.now() + COOLDOWN_MS);
}

/**
 * Klucze w kolejności prób: najpierw świeże, potem te „w odpoczynku" (jako ostatnia
 * deska ratunku — lepiej spróbować wyczerpanego klucza niż nie odpowiedzieć wcale).
 */
export function orderedKeys(provider: ProviderId): string[] {
  const all = keyList(provider);
  const fresh = all.filter((k) => !isCoolingDown(provider, k));
  const cooled = all.filter((k) => isCoolingDown(provider, k));
  return [...fresh, ...cooled];
}

/** Pierwszy użyteczny klucz dostawcy (świeży, jeśli się da) — do pojedynczych wywołań. */
export function primaryKey(provider: ProviderId): string {
  const ordered = orderedKeys(provider);
  return ordered[0] || "";
}
