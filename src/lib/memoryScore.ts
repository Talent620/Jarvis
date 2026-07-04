// === Pamięć ludzka: rozpad (decay), wzmocnienie (reinforcement), wynik trwałości ===
// Czyste funkcje modelujące, jak wspomnienia słabną z czasem, a wzmacniają się przez użycie.
// Wykorzystywane do RANKINGU (co podać modelowi) i opcjonalnego zapominania słabych wspomnień.
// Local-first, deterministyczne, w pełni testowalne — bez żadnej zewnętrznej bazy/infrastruktury.

export interface ScorableFact {
  pinned?: boolean;
  createdAt: number;
  lastUsedAt?: number; // ostatnie przypomnienie/użycie
  useCount?: number;   // ile razy wzmocnione (przypomniane/powtórzone)
}

const DAY = 86_400_000;

/** Pure: świeżość 0..1 — maleje wykładniczo z czasem (połowiczny rozpad ~halfLifeDays). Pin = 1. */
export function recencyWeight(fact: ScorableFact, now = Date.now(), halfLifeDays = 30): number {
  if (fact.pinned) return 1;
  const last = fact.lastUsedAt || fact.createdAt;
  const days = Math.max(0, (now - last) / DAY);
  return Math.pow(0.5, days / Math.max(1, halfLifeDays));
}

/** Pure: wzmocnienie 0..1 — rośnie z liczbą użyć, z nasyceniem (~20 użyć ≈ pełne). */
export function reinforcementWeight(fact: ScorableFact): number {
  const n = Math.max(0, fact.useCount || 0);
  return Math.min(1, Math.log1p(n) / Math.log1p(20));
}

/**
 * Pure: łączny wynik 0..1 łączący TRAFNOŚĆ do bieżącego zapytania (relevance 0..1) z TRWAŁOŚCIĄ
 * wspomnienia (świeżość + wzmocnienie). Trafność waży najwięcej; trwałość rozstrzyga remisy i
 * podtrzymuje ważne, często wracające fakty. Pin = 1.
 */
export function memoryScore(fact: ScorableFact, relevance = 0, now = Date.now()): number {
  if (fact.pinned) return 1;
  const rel = Math.max(0, Math.min(1, relevance));
  const recency = recencyWeight(fact, now);
  const reinforce = reinforcementWeight(fact);
  return Math.min(1, 0.55 * rel + 0.3 * recency + 0.15 * reinforce);
}

/** Pure: czy wspomnienie powinno zostać ZAPOMNIANE (bardzo słabe i stare, niepinowane). */
export function shouldForget(fact: ScorableFact, now = Date.now(), threshold = 0.04): boolean {
  if (fact.pinned) return false;
  const durability = recencyWeight(fact, now) * (0.5 + 0.5 * reinforcementWeight(fact));
  return durability < threshold;
}

/** Pure: wspomnienie po WZMOCNIENIU (użyciu) — inkrement licznika i odświeżenie czasu. */
export function reinforced<T extends ScorableFact>(fact: T, now = Date.now()): T {
  return { ...fact, useCount: (fact.useCount || 0) + 1, lastUsedAt: now };
}

/** Pure: trwałość wspomnienia 0..1 (bez trafności) — do prune i diagnostyki. */
export function durability(fact: ScorableFact, now = Date.now()): number {
  if (fact.pinned) return 1;
  return recencyWeight(fact, now) * (0.5 + 0.5 * reinforcementWeight(fact));
}
