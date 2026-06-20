// Wiele kluczy API na dostawcę + automatyczna rotacja i krótki „cooldown".
//
// Użytkownik może wpisać KILKA kluczy jednego dostawcy (każdy w nowej linii lub po
// przecinku). JARVIS używa ich po kolei, a gdy któryś zwróci limit/awarię, odkłada
// go na chwilę i sięga po następny — dzięki temu rozmowa nie wywala się przez jeden
// wyczerpany klucz. Klucze trzymane są lokalnie w ustawieniach; cooldown żyje tylko
// w pamięci (nie zapisujemy go), więc po restarcie wszystkie klucze są znów świeże.
import { store } from "./store";
import type { ProviderId } from "./providers/types";

/** Rozbij surowy tekst na klucze (nowa linia lub przecinek), bez duplikatów/pustych. */
export function parseKeys(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw || "").split(/[\n,]+/)) {
    const k = part.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Pure: czy to klucz Tavily (research). Mają stały prefiks `tvly-` — pewne rozpoznanie. */
export function isTavilyKey(key: string): boolean {
  return /^tvly-/i.test((key || "").trim());
}

/** Lista kluczy danego dostawcy (rozdziel nową linią lub przecinkiem, bez duplikatów). */
export function keyList(provider: ProviderId): string[] {
  return parseKeys(store.settings.keys[provider] || "");
}

/**
 * Osobna pula kluczy Gemini dla Studia Obrazów (niezależna od czatu), w kolejności
 * prób: najpierw świeże, potem te w „cooldownie". Pusta, gdy użytkownik nic nie wpisał
 * — wtedy Studio korzysta ze zwykłych kluczy Gemini (orderedKeys("gemini")).
 */
export function studioKeyList(): string[] {
  const all = parseKeys(store.settings.studioKeys || "");
  const fresh = all.filter((k) => !isCoolingDown("gemini", k));
  const cooled = all.filter((k) => isCoolingDown("gemini", k));
  return [...fresh, ...cooled];
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
