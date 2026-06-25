// Brama Pewności (Zadanie 8) — metakognicja Refleksu. Czysta, browser-safe heurystyka
// (bez ML): ocenia, na ile można ufać lokalnej odpowiedzi. Niska pewność → caller eskaluje
// do Kory (mocniejszego dostawcy). Zwraca 0..1.

import type { TaskKind } from "./modelRouter";

// Markery wahania — model „nie jest pewien".
const HEDGE = /(nie jestem pewien|nie jestem pewna|nie wiem|nie mam pewności|trudno powiedzieć|być może|możliwe,? że|przypuszczam|wydaje mi się|chyba|raczej nie wiem|nie potrafię odpowiedzieć)/i;
// Odmowy / asekuracja modelu.
const REFUSE = /(nie mogę (ci )?pomóc|nie jestem w stanie|jako (model|sztuczna inteligencja|asystent ai)|nie mam dostępu do|przepraszam,? ale nie)/i;
// Powtórzony token ≥3 razy pod rząd (pętla/degeneracja małego modelu).
// S9-safe: bez flagi /u i \p{L} (stary WebView Galaxy S9 by się wywalił) — jawny zestaw
// liter PL + znaki słowne. Zachowanie takie samo dla typowego tekstu.
const REPEAT = /(\b[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9_]{3,}\b)(\s+\1){2,}/i;

/**
 * Oszacuj pewność odpowiedzi (0..1). Im wyżej, tym bardziej można jej ufać.
 * Sygnały: wahanie, odmowa, pustka/zbyt krótka vs złożoność, ucięcie, degeneracja.
 */
export function estimateConfidence(text: string, kind: TaskKind): number {
  const t = (text || "").trim();
  if (!t) return 0; // pustka = zero zaufania
  if (t === "…" || t.length < 2) return 0.05;

  let score = 0.8; // baza dla sensownej odpowiedzi
  if (HEDGE.test(t)) score -= 0.35;
  if (REFUSE.test(t)) score -= 0.3;
  if (REPEAT.test(t)) score -= 0.25;

  // Zbyt krótko jak na złożoność pytania.
  if (kind === "complex" && t.length < 80) score -= 0.3;
  if (t.length < 12) score -= 0.25;

  // Ucięte zdanie (krótkie, bez domknięcia interpunkcją) — możliwy timeout/limit tokenów.
  if (t.length < 200 && !/[.!?…)"'\]}]$/.test(t)) score -= 0.12;

  return Math.max(0, Math.min(1, score));
}

/** Czy pewność jest poniżej progu (próg ≤ 0 wyłącza bramę). */
export function isLowConfidence(conf: number, threshold: number): boolean {
  return threshold > 0 && conf < threshold;
}
