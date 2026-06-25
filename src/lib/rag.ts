// Zaawansowany RAG — narzędzia rerankingu (czyste, testowalne, bez zależności). Used do
// pamięci długoterminowej i przyszłych „umiejętności". Dwa produkcyjne standardy:
//  • MMR (Maximal Marginal Relevance, Carbonell & Goldstein 1998) — wybór k elementów
//    balansujący TRAFNOŚĆ z RÓŻNORODNOŚCIĄ (koniec marnowania budżetu kontekstu na duplikaty).
//  • RRF (Reciprocal Rank Fusion, Cormack 2009) — łączenie wielu list rankingowych
//    (semantyczna + leksykalna + świeżość) w jeden ranking, bez strojenia wag.

/** Cosine podobieństwo (samowystarczalne — rag.ts bez zależności od memory). 0 dla pustych/0-wektorów. */
export function cosineSim(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Tokenizacja (litery PL/cyfry, ≥3 znaki) — wspólna dla miar leksykalnych. S9-safe: bez /u i \p{L}. */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[A-Za-z0-9ąćęłńóśźż]+/g) || []).filter((t) => t.length > 2);
}

/** Leksykalne podobieństwo (Jaccard po tokenach) — tani fallback, gdy brak wektorów. */
export function jaccardSim(a: string, b: string): number {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Pure: leksykalna trafność dokumentu do zapytania = ułamek RÓŻNYCH słów zapytania obecnych w tekście.
 * Łapie dokładne dopasowania słów kluczowych, które czysto semantyczne (embeddingowe) wyszukiwanie
 * gubi (np. nazwy własne, numery, skróty). 0..1.
 */
export function keywordScore(query: string, text: string): number {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return 0;
  const inText = new Set(tokenize(text));
  let hit = 0;
  for (const t of q) if (inText.has(t)) hit++;
  return hit / q.length;
}

export interface MmrItem { id: string; relevance: number; vector?: number[]; text?: string }

/**
 * Pure: MMR. Wybiera k elementów maksymalizując  λ·trafność − (1−λ)·max_podobieństwo_do_wybranych.
 * λ∈[0,1]: wyżej = bliżej czystej trafności, niżej = więcej różnorodności (mniej duplikatów).
 * Podobieństwo: wektory (cosine) lub tekst (Jaccard) — gdy brak obu, degraduje do top-k po trafności.
 */
export function mmrSelect<T extends MmrItem>(candidates: T[], k: number, lambda = 0.7): T[] {
  if (k <= 0 || !candidates.length) return [];
  const sim = (x: T, y: T): number => {
    if (x.vector && y.vector) return Math.max(0, cosineSim(x.vector, y.vector));
    if (x.text != null && y.text != null) return jaccardSim(x.text, y.text);
    return 0;
  };
  const remaining = candidates.slice();
  const selected: T[] = [];
  while (selected.length < k && remaining.length) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let maxSim = 0;
      for (const s of selected) maxSim = Math.max(maxSim, sim(c, s));
      const score = lambda * c.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}

/**
 * Pure: Reciprocal Rank Fusion. Łączy wiele list ID (każda posortowana malejąco wg trafności)
 * w jeden ranking: score(id) = Σ 1/(k + rank). Odporne na różne skale wyników poszczególnych
 * retrieverów (nie trzeba normalizować). Zwraca ID malejąco wg zsumowanego score.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank];
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
