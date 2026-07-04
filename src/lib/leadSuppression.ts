// === Trwałe odrzucenie kandydatów (leadSuppression) — czyste, testowalne ===
// „Odrzuć" zapisuje firmę na liście wykluczeń (sourceId/nazwa, powód, data), żeby NIE wracała przy
// kolejnym wyszukiwaniu. Da się cofnąć (undo). To UI-utility (nie silnik) — czysty rdzeń na tablicy,
// cienki wrapper utrwala w store.data.suppressedLeads. Stare statusy „lost" pozostają niezależne. S9-safe.

export interface SuppressedLead {
  key: string;       // stabilny klucz dedupu (sourceId albo znormalizowana nazwa)
  company: string;
  reason: string;
  at: number;
  sourceId?: string;
}

/** Pure: znormalizuj nazwę firmy do klucza (te same reguły co keyOf w leadCandidates). S9-safe. */
function normCompany(company: string): string {
  return (company || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9ąćęłńóśźż-]/g, "");
}

/** Pure: stabilny klucz kandydata do wykluczeń — sourceId gdy jest, inaczej znormalizowana nazwa. */
export function suppressionKey(c: { sourceId?: string; company: string }): string {
  return c.sourceId ? `sid:${c.sourceId}` : `co:${normCompany(c.company)}`;
}

/** Pure: dodaj wykluczenie (dedup po kluczu — nie duplikujemy). */
export function addSuppression(list: SuppressedLead[], c: { sourceId?: string; company: string }, opts: { reason: string; now: number }): SuppressedLead[] {
  const key = suppressionKey(c);
  const rest = (list || []).filter((s) => s.key !== key);
  return [...rest, { key, company: c.company, reason: opts.reason, at: opts.now, sourceId: c.sourceId }];
}

/** Pure: cofnij wykluczenie po kluczu. */
export function removeSuppression(list: SuppressedLead[], key: string): SuppressedLead[] {
  return (list || []).filter((s) => s.key !== key);
}

/** Pure: czy kandydat jest wykluczony? */
export function isSuppressed(list: SuppressedLead[], c: { sourceId?: string; company: string }): boolean {
  const key = suppressionKey(c);
  return (list || []).some((s) => s.key === key);
}

/** Pure: odfiltruj wykluczonych z listy kandydatów (żeby nie wracali przy wyszukiwaniu). */
export function filterSuppressed<T extends { sourceId?: string; company: string }>(items: T[], list: SuppressedLead[]): T[] {
  if (!list || !list.length) return items || [];
  const keys = new Set(list.map((s) => s.key));
  return (items || []).filter((c) => !keys.has(suppressionKey(c)));
}
