// === Kurator kontekstu (relevance-first) ===
// Nie wrzucamy do promptu WSZYSTKIEGO. Zbieramy kandydatów (pamięć, świat, rozmowa, projekty,
// leady, finanse, kalendarz, businessFlow), oceniamy każdego (trafność, świeżość, ważność,
// wiarygodność źródła), usuwamy duplikaty i sprzeczne stare fakty, a przy sprzeczności NIE
// zgadujemy — zaznaczamy ją. Gemini dostaje tylko wybrane minimum. Czyste i testowalne. S9-safe.

export interface ContextItem {
  text: string;
  source: string; // np. "pamięć", "lead:Firma X", "finanse"
  at: number; // znacznik czasu (świeżość)
  importance?: number; // 0..1 (domyślnie 0.5)
  key?: string; // temat/encja — do dedupu i wykrywania sprzeczności
}

export interface CuratedContext {
  items: (ContextItem & { score: number })[];
  contradictions: { key: string; items: ContextItem[] }[];
  usedChars: number;
}

const DAY = 86_400_000;
const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** S9-safe tokenizacja (litery PL + cyfry, bez /u). */
function tokens(s: string): string[] {
  return norm(s).split(/[^a-z0-9ąćęłńóśźż]+/).filter((w) => w.length > 2);
}

// Wiarygodność wg źródła (0..1) — fakty z pamięci/świata ważymy wyżej niż luźne ślady.
function credibility(source: string): number {
  const s = source.toLowerCase();
  if (s.startsWith("pamięć") || s.startsWith("pamiec") || s.startsWith("świat") || s.startsWith("swiat") || s.startsWith("profil")) return 1;
  if (s.startsWith("finanse") || s.startsWith("lead") || s.startsWith("projekt") || s.startsWith("kalendarz")) return 0.85;
  return 0.6;
}

/**
 * Pure: ocena kandydata (0..1) = trafność do zapytania + świeżość + ważność + wiarygodność.
 * Trafność = udział tokenów zapytania obecnych we fragmencie (semantyka przez pokrycie tokenów).
 */
export function scoreCandidate(item: ContextItem, queryTokens: string[], now: number): number {
  const itTok = new Set(tokens(item.text));
  const rel = queryTokens.length ? queryTokens.filter((t) => itTok.has(t)).length / queryTokens.length : 0;
  const ageDays = Math.max(0, (now - (item.at || 0)) / DAY);
  const fresh = 1 / (1 + ageDays / 14); // pół-życie ~2 tygodnie
  const imp = typeof item.importance === "number" ? Math.max(0, Math.min(1, item.importance)) : 0.5;
  const cred = credibility(item.source);
  // Wagi: trafność dominuje, ale świeżość/ważność/wiarygodność modulują.
  return rel * 0.5 + fresh * 0.2 + imp * 0.15 + cred * 0.15;
}

/**
 * Pure: wybierz minimalny, najtrafniejszy kontekst do budżetu znaków.
 * - grupuje po `key`: gdy w grupie są RÓŻNE treści → sprzeczność (zostaw najnowszą, zaznacz),
 * - usuwa duplikaty identycznej treści (zostaw najnowszą),
 * - sortuje po ocenie i bierze do budżetu.
 */
export function curateContext(
  candidates: ContextItem[],
  opts: { query: string; now: number; budgetChars: number },
): CuratedContext {
  const qTok = tokens(opts.query);
  const contradictions: CuratedContext["contradictions"] = [];

  // 1) Grupy po key — wykryj sprzeczności (różne treści dla tego samego tematu).
  const byKey = new Map<string, ContextItem[]>();
  const noKey: ContextItem[] = [];
  for (const c of candidates || []) {
    if (c.key) { const a = byKey.get(c.key) || []; a.push(c); byKey.set(c.key, a); }
    else noKey.push(c);
  }
  const resolved: ContextItem[] = [...noKey];
  for (const [key, group] of byKey) {
    const distinct = new Set(group.map((g) => norm(g.text)));
    const newest = [...group].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (distinct.size > 1) contradictions.push({ key, items: group });
    resolved.push(newest); // zostaw najnowszą wersję (sprzeczność i tak zaznaczona)
  }

  // 2) Dedup identycznej treści (zostaw najnowszą).
  const seen = new Map<string, ContextItem>();
  for (const c of resolved) {
    const k = norm(c.text);
    const prev = seen.get(k);
    if (!prev || (c.at || 0) > (prev.at || 0)) seen.set(k, c);
  }

  // 3) Ocena + sort malejąco.
  const scored = [...seen.values()]
    .map((c) => ({ ...c, score: scoreCandidate(c, qTok, opts.now) }))
    .sort((a, b) => b.score - a.score);

  // 4) Budżet znaków — bierz najlepsze, aż się zmieści.
  const picked: (ContextItem & { score: number })[] = [];
  let used = 0;
  for (const c of scored) {
    const cost = c.text.length + 1;
    if (used + cost > opts.budgetChars && picked.length) break;
    picked.push(c);
    used += cost;
  }
  return { items: picked, contradictions, usedChars: used };
}

/** Budżet znaków kontekstu wg modelu i zadania (proste → mniej, złożone → więcej). */
export function contextBudgetChars(opts: { complex?: boolean; bigModel?: boolean }): number {
  let base = opts.complex ? 6000 : 2500;
  if (opts.bigModel) base *= 2;
  return base;
}
