// === Pamięć Czasowa (Bi-Temporal) + Core Memory (max 30% budżetu kontekstu) ===
// Zgodne z architekturą docs/horizon-memory.md:
// 1) Każdy fakt niesie okno ważności [valid_from, invalid_at). Nowa, sprzeczna informacja
//    automatycznie zamyka stary fakt (invalid_at = now), zamiast go duplikować w RAG.
// 2) Core Memory składa kompaktowy blok aktywnych faktów/preferencji użytkownika z TWARDYM
//    limitem max 30% całkowitego budżetu kontekstu (nigdy nie wypycha rozmowy ani narzędzi).
import type { MemoryFact } from "../types";

export const CORE_MEMORY_MAX_RATIO = 0.30;

const TOPIC_SYNONYMS: Record<string, string> = {
  miasto: "miasto",
  miasto_zamieszkania: "miasto",
  lokalizacja: "miasto",
  miejscowosc: "miasto",
  adres: "adres",
  adres_zamieszkania: "adres",
  firma: "firma",
  nazwa_firmy: "firma",
  pracodawca: "firma",
  telefon: "telefon",
  nr_telefonu: "telefon",
  numer_telefonu: "telefon",
  email: "email",
  adres_email: "email",
  imie: "imie",
  dieta: "dieta",
  preferencje_diety: "dieta",
  jezyk: "jezyk",
  ulubiony_kolor: "kolor",
  kolor_ulubiony: "kolor",
};

/** Pure: sprowadź klucz faktu do kanonicznego tematu (wykrywa sprzeczne synonimy). */
export function normalizeFactTopic(key: string): string {
  const clean = (key || "")
    .toLowerCase()
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ł/g, "l")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/[źż]/g, "z")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return TOPIC_SYNONYMS[clean] || clean;
}

/** Pure: czy fakt obowiązuje w chwili `at` (okno [valid_from, invalid_at)). */
export function isFactValidAt(fact: MemoryFact, at = Date.now()): boolean {
  if (typeof fact.valid_from === "number" && fact.valid_from > at) return false;
  if (typeof fact.invalid_at === "number" && fact.invalid_at <= at) return false;
  return true;
}

/** Pure: odfiltruj wyłącznie aktywne (nieunieważnione) fakty na chwilę `at`. */
export function activeMemoryFacts(facts: MemoryFact[], at = Date.now()): MemoryFact[] {
  return (facts || []).filter((f) => isFactValidAt(f, at));
}

/**
 * Pure (mutuje przekazaną tablicę w miejscu): automatycznie unieważnij (`invalid_at = now`)
 * aktywne fakty z tego samego zakresu projektu, które dotyczą tego samego tematu co `incoming`,
 * ale mają sprzeczną (inną) wartość. Zwraca liczbę unieważnionych rekordów.
 */
export function invalidateConflictingFacts(
  facts: MemoryFact[],
  incoming: { id: string; key: string; value: string; projectId?: string },
  now = Date.now(),
): number {
  const topic = normalizeFactTopic(incoming.key);
  if (!topic) return 0;
  const scope = incoming.projectId || "";
  const valNorm = (incoming.value || "").trim().toLowerCase();
  let count = 0;
  for (const f of facts) {
    if (f.id === incoming.id) continue;
    if ((f.projectId || "") !== scope) continue;
    if (!isFactValidAt(f, now)) continue;
    if (normalizeFactTopic(f.key) !== topic) continue;
    if ((f.value || "").trim().toLowerCase() !== valNorm) {
      f.invalid_at = now;
      f.superseded_by = incoming.id;
      count++;
    }
  }
  return count;
}

export interface CoreMemoryResult {
  block: string;
  maxChars: number;
  usedChars: number;
  included: MemoryFact[];
}

/**
 * Pure: zbuduj kompaktowy blok `Core Memory` z aktywnych faktów/preferencji użytkownika.
 * Egzekwuje TWARDY limit max 30% przekazanego budżetu kontekstu (`totalContextBudgetChars`).
 */
export function buildCoreMemoryBlock(
  facts: MemoryFact[],
  totalContextBudgetChars: number,
  now = Date.now(),
): CoreMemoryResult {
  const maxChars = Math.max(0, Math.floor((totalContextBudgetChars || 0) * CORE_MEMORY_MAX_RATIO));
  const active = activeMemoryFacts(facts, now);
  if (!active.length || maxChars < 24) {
    return { block: "", maxChars, usedChars: 0, included: [] };
  }

  const ranked = [...active].sort(
    (a, b) =>
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      (b.useCount || 0) - (a.useCount || 0) ||
      (b.valid_from ?? b.createdAt ?? 0) - (a.valid_from ?? a.createdAt ?? 0),
  );

  const header = "Zapamiętane fakty (Core Memory):";
  if (header.length >= maxChars) {
    return { block: "", maxChars, usedChars: 0, included: [] };
  }

  const lines: string[] = [header];
  const included: MemoryFact[] = [];
  let used = header.length;

  for (const fact of ranked) {
    const cleanKey = String(fact.key || "").replace(/\s+/g, " ").trim();
    const cleanVal = String(fact.value || "").replace(/\s+/g, " ").trim();
    if (!cleanKey || !cleanVal) continue;
    const line = `- ${cleanKey}: ${cleanVal}`;
    if (used + 1 + line.length > maxChars) continue;
    lines.push(line);
    included.push(fact);
    used += 1 + line.length;
  }

  if (!included.length) {
    return { block: "", maxChars, usedChars: 0, included: [] };
  }
  const block = lines.join("\n");
  return { block, maxChars, usedChars: block.length, included };
}
