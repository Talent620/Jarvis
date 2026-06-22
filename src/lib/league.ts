// === 🏆 Liga modeli — który z TWOICH mózgów jest realnie najlepszy ===
// Łączy orientacyjny poziom (modelIntel) z wynikiem zmierzonym u Ciebie (iqProbe) i wskazuje
// najmocniejszy gotowy model. „Auto-router" może z tego skorzystać do trudnych rozkazów.
import { intelForModel } from "./modelIntel";
import type { IqResult } from "./iqProbe";

export interface LeagueEntry {
  provider: string;
  model: string;
  label: string;
  iq: number; // orientacyjny (0–100)
  score: number; // ranking: zmierzony jeśli jest, inaczej orientacyjny
  measured?: number; // % z testu u Ciebie (jeśli mierzono)
  ms?: number; // średni czas odpowiedzi (jeśli mierzono)
  ready: boolean; // czy jest klucz/gotowość
}

export interface LeagueInput {
  provider: string;
  model: string; // model, który realnie zadziała (zwykle defaultModel)
  label: string;
  ready: boolean;
}

/**
 * Ranking ligi (pure). Bierze listę dostawców z ich modelem domyślnym + mapę zmierzonych
 * wyników (klucz „provider:model"). Sortuje: gotowe i wyżej ocenione na górze.
 */
export function leagueRanking(inputs: LeagueInput[], results: Record<string, IqResult>): LeagueEntry[] {
  const rows = inputs.map((it) => {
    const iq = intelForModel(it.model).iq;
    const m = results[`${it.provider}:${it.model}`];
    // Zmierzony wynik ma pierwszeństwo; lekko premiujemy szybkość przy remisie.
    const score = m ? m.pct + Math.max(0, 2 - (m.ms || 0) / 2000) : iq;
    return { provider: it.provider, model: it.model, label: it.label, iq, score, measured: m?.pct, ms: m?.ms, ready: it.ready };
  });
  return rows.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1; // gotowe najpierw
    return b.score - a.score;
  });
}

/** Najmocniejszy GOTOWY mózg (do auto-routera trudnych zadań). Null, gdy żaden nie gotowy. */
export function bestBrain(inputs: LeagueInput[], results: Record<string, IqResult>): LeagueEntry | null {
  const ranked = leagueRanking(inputs, results).filter((r) => r.ready);
  return ranked[0] ?? null;
}
