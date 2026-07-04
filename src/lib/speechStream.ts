// === Strumieniowy głos — mów zdania, gdy tylko się pojawią (nie czekaj na całą odpowiedź) ===
// Z narastającego tekstu (tokeny modelu) wyłuskuje KOMPLETNE zdania gotowe do wypowiedzenia i mówi
// kursor (ile znaków już skierowano do mowy). Dzięki temu rozmowa na żywo brzmi błyskawicznie:
// JARVIS zaczyna mówić pierwsze zdanie, gdy reszta jeszcze się generuje. Czyste i testowalne.
//
// Świadomie BEZ lookbehind w regexach — stary Android System WebView (np. Samsung S9) potrafi nie
// wspierać (?<=…) i rzuciłby wyjątek przy ładowaniu. Używamy tylko lookahead (uniwersalnie wspierany).

export interface SpeakableResult {
  chunks: string[]; // kompletne zdania do wypowiedzenia (po kolei)
  nextIndex: number; // nowa pozycja kursora w pełnym tekście
}

/**
 * Wytnij gotowe do wypowiedzenia zdania z `full`, zaczynając od `fromIndex`.
 * - final=false: zwraca tylko KOMPLETNE zdania (zakończone . ! ? …); resztę zostawia na później.
 * - final=true: zwraca całą resztę (domknięcie — ostatni fragment nawet bez kropki).
 */
export function speakableChunks(full: string, fromIndex: number, final: boolean): SpeakableResult {
  let segment = full.slice(fromIndex);
  if (!final) {
    const m = segment.match(/^[\s\S]*[.!?…](?=\s|$)/); // do ostatniej granicy zdania (lookahead, nie lookbehind)
    if (!m) return { chunks: [], nextIndex: fromIndex };
    segment = m[0];
  }
  const consumed = segment.length;
  // Podział na zdania bez lookbehind: ciągi do terminatora włącznie, plus ewentualny ogon bez kropki.
  const matches = segment.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [segment];
  const chunks = matches.map((s) => s.trim()).filter(Boolean);
  return { chunks, nextIndex: fromIndex + consumed };
}
