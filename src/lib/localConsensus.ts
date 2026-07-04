// === Lokalna self-consistency (best-of-N) — pionierskie wyciskanie pewności z modelu lokalnego ===
// Najtrudniejsze pytania: model lokalny odpowiada KILKA razy, a my wybieramy odpowiedź najbardziej
// „środkową" (najmniejsza suma rozbieżności do pozostałych) — czyli tę, z którą zgadza się większość
// własnych prób. Odporne na pojedyncze halucynacje/odjazdy. W całości na PC, działa offline. Opt-in.
import type { JarvisReply } from "./providers/types";
import { divergence } from "./speculative";

/** Indeks odpowiedzi najbardziej spójnej z resztą (centroid wg rozbieżności). Czysta. */
export function mostConsistent(candidates: string[]): number {
  if (candidates.length <= 1) return 0;
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    let sum = 0;
    for (let j = 0; j < candidates.length; j++) if (i !== j) sum += divergence(candidates[i], candidates[j]);
    if (sum < bestScore) { bestScore = sum; best = i; }
  }
  return best;
}

export interface ConsensusResult {
  reply: JarvisReply;
  samples: number; // ile prób faktycznie zebrano
}

/**
 * Zbierz dodatkowe próbki (oprócz już posiadanej) i wybierz najbardziej spójną.
 * `first` to pierwsza, już policzona odpowiedź; `run` generuje kolejne. Graceful na błędy prób.
 */
export async function localSelfConsistency(opts: {
  first: JarvisReply;
  run: () => Promise<JarvisReply>;
  extra?: number; // ile DODATKOWYCH prób (domyślnie 2 → łącznie 3)
}): Promise<ConsensusResult> {
  const extra = Math.max(0, Math.min(4, opts.extra ?? 2));
  const all: JarvisReply[] = [opts.first];
  for (let k = 0; k < extra; k++) {
    try {
      const r = await opts.run();
      if (r?.text?.trim()) all.push(r);
    } catch { /* pojedyncza próba padła — pomijamy */ }
  }
  const texts = all.map((r) => r.text || "");
  if (all.length <= 1) return { reply: opts.first, samples: all.length };
  const idx = mostConsistent(texts);
  return { reply: all[idx], samples: all.length };
}
