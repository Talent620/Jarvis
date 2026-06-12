// === Semantyczny endpointing (wykrywanie końca wypowiedzi) ===
// Problem: zwykłe rozpoznawanie mowy ucina Cię, gdy na chwilę zamilkniesz, by
// pomyśleć. Rozwiązanie (state-of-the-art): nie kończ tury na samej ciszy —
// przeczytaj transkrypt i sprawdź, czy zdanie BRZMI kompletnie. Jeśli urywa się
// na „bo…”, „i…”, „yyy…”, czekaj dłużej. (AssemblyAI/Decagon — turn detection.)

// Słowa, po których zdanie zwykle NIE jest skończone (spójniki, przyimki, wahania).
const INCOMPLETE = new Set<string>([
  // wahania / wypełniacze
  "yyy", "yy", "eee", "ee", "mmm", "hmm", "no", "tego", "ten", "yhm", "uh", "um",
  // spójniki
  "i", "oraz", "ale", "bo", "że", "więc", "lub", "albo", "czy", "a", "ani", "lecz", "ponieważ", "gdyż", "jak",
  // przyimki
  "do", "na", "w", "we", "z", "ze", "o", "po", "u", "od", "dla", "przez", "pod", "nad", "przy", "bez", "ku", "wobec",
  // zaimki względne / spójniki podrzędne
  "to", "gdy", "kiedy", "który", "która", "które", "którego", "której", "żeby", "żebyś", "żebym", "aby", "abyś", "by", "byś", "jeśli", "jeżeli", "co", "gdzie",
  // czasowniki posiłkowe / urwane
  "chcę", "muszę", "mam", "będę", "jest", "są", "może",
]);

/** Czy transkrypt wygląda na DOKOŃCZONĄ myśl (a nie urwaną w połowie). */
export function looksComplete(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  // Urwane na przecinku/myślniku/wielokropku → użytkownik kontynuuje.
  if (/[,–—-]$|\.\.\.$|…$/.test(t)) return false;
  const words = t.replace(/[.!?]+$/, "").split(/\s+/);
  const last = words[words.length - 1];
  if (INCOMPLETE.has(last)) return false;
  return true;
}

export interface EndpointConfig {
  /** Cisza wystarczająca, gdy zdanie wygląda na kompletne (ms). */
  shortMs: number;
  /** Cisza, po której kończymy turę NIEZALEŻNIE od treści (twardy limit, ms). */
  longMs: number;
}
export const DEFAULT_ENDPOINT: EndpointConfig = { shortMs: 900, longMs: 2600 };

/**
 * Decyzja o zakończeniu tury: kończ, gdy zdanie kompletne i minęła krótka cisza,
 * albo gdy cisza przekroczyła twardy limit (ratunek). To kasuje przerywanie w
 * połowie zdania — krótka pauza na myślenie nie kończy wypowiedzi.
 */
export function shouldFinalize(text: string, silenceMs: number, cfg: EndpointConfig = DEFAULT_ENDPOINT): boolean {
  if (!(text || "").trim()) return false;
  if (silenceMs >= cfg.longMs) return true;
  if (silenceMs >= cfg.shortMs && looksComplete(text)) return true;
  return false;
}
