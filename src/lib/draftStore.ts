// === Trwałe szkice robocze (draftStore) — „sesja funkcji nie ginie" ===
// PO CO: praca w toku każdej funkcji (budowana strona, opis reklamy, szkic maila, wpisany, lecz
// niewysłany tekst czatu…) żyła DOTĄD wyłącznie w ulotnym stanie Reacta (useState) i znikała po
// zamknięciu aplikacji ALBO po wyjściu z panelu (odmontowanie komponentu). Ten moduł daje jedno,
// odporne miejsce, gdzie stan roboczy jest lustrzany do localStorage i odtwarzany przy powrocie —
// SYNCHRONICZNIE (dostępny już w pierwszym renderze, bez mignięcia pustego pola).
//
// Zasady:
//   • CZYSTE, testowalne rdzenie (serializacja/parsowanie/wygaśnięcie/limit) — bez efektów ubocznych.
//   • Best-effort I/O: prywatny tryb / brak miejsca / SSR nie mogą wywrócić aplikacji (try/catch).
//   • Bezpiecznik rozmiaru: pojedynczy szkic nie może zapchać localStorage (limit ~5 MB na origin).
//   • Higiena: szkice starsze niż TTL są traktowane jak nieobecne (i czyszczone przy odczycie),
//     żeby stary śmieć nie wracał po miesiącach.
// S9-safe: bez /u, \p{...}, lookbehind. Cudzysłowy tylko „…” (curly-close).

export const DRAFT_NS = "jarvis.draft.";
/** Górny limit ROZMIARU jednego szkicu (w znakach JSON). ~1.5 MB zostawia zapas w puli ~5 MB. */
export const DRAFT_MAX_CHARS = 1_500_000;
/** Szkic starszy niż to jest ignorowany i czyszczony (30 dni). */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Wersja formatu rekordu — pozwala w przyszłości migrować bez czytania śmieci. */
export const DRAFT_VERSION = 1 as const;

export interface DraftRecord<T> {
  v: typeof DRAFT_VERSION;
  at: number; // znacznik zapisu (do TTL)
  value: T;
}

/** Pure: pełny klucz localStorage dla nazwanego szkicu (namespacing, żeby nie kolidować). */
export function draftKey(name: string): string {
  return DRAFT_NS + name;
}

/** Pure: zbuduj rekord szkicu (do zapisu). */
export function makeRecord<T>(value: T, now: number): DraftRecord<T> {
  return { v: DRAFT_VERSION, at: now, value };
}

/** Pure: czy rekord szkicu wygasł (starszy niż TTL)? Brak/uszkodzony znacznik → traktuj jak świeży. */
export function isDraftExpired(rec: { at?: number } | null | undefined, now: number, ttlMs = DRAFT_TTL_MS): boolean {
  if (!rec || typeof rec.at !== "number") return false;
  return now - rec.at >= ttlMs;
}

/** Pure: serializuj rekord; zwraca null, gdy wartość jest nieserializowalna (cykl) LUB za duża. */
export function serializeDraft<T>(value: T, now: number, maxChars = DRAFT_MAX_CHARS): string | null {
  let json: string;
  try {
    json = JSON.stringify(makeRecord(value, now));
  } catch {
    return null; // np. cykliczna referencja — nie zapisujemy śmiecia
  }
  if (typeof json !== "string" || json.length > maxChars) return null; // bezpiecznik rozmiaru
  return json;
}

/**
 * Pure: sparsuj surowy tekst na wartość szkicu. Zwraca `fallback`, gdy: brak danych, uszkodzony JSON,
 * zły kształt rekordu albo szkic wygasł. Nigdy nie rzuca.
 */
export function parseDraft<T>(raw: string | null, fallback: T, now: number, ttlMs = DRAFT_TTL_MS): T {
  if (!raw) return fallback;
  let rec: unknown;
  try {
    rec = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!rec || typeof rec !== "object") return fallback;
  const r = rec as Partial<DraftRecord<T>>;
  if (r.v !== DRAFT_VERSION || !("value" in r)) return fallback;
  if (isDraftExpired(r as { at?: number }, now, ttlMs)) return fallback;
  return r.value as T;
}

// — Odporne I/O (best-effort; nie wywala aplikacji w prywatnym trybie / bez miejsca / SSR) —

function ls(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // dostęp do storage bywa rzucający (iframe/polityka prywatności)
  }
}

/**
 * Odczytaj szkic. Odtwarza pracę w toku. Wygasły/uszkodzony → `fallback` (i sprząta wpis).
 * Synchroniczny — nadaje się do leniwej inicjalizacji useState (brak mignięcia).
 */
export function readDraft<T>(name: string, fallback: T, now = Date.now(), ttlMs = DRAFT_TTL_MS): T {
  const store = ls();
  if (!store) return fallback;
  let raw: string | null = null;
  try {
    raw = store.getItem(draftKey(name));
  } catch {
    return fallback;
  }
  const val = parseDraft(raw, fallback, now, ttlMs);
  // Sprzątanie: jeśli był surowy wpis, ale rozwiązał się do fallbacku (wygasł/zepsuty) — usuń.
  if (raw && val === fallback) { try { store.removeItem(draftKey(name)); } catch { /* pomiń */ } }
  return val;
}

/**
 * Zapisz szkic (lustrzane odbicie stanu roboczego). Zwraca true, gdy realnie zapisano.
 * false = pominięto (za duży / nieserializowalny / brak storage) — praca zostaje w pamięci sesji.
 */
export function writeDraft<T>(name: string, value: T, now = Date.now(), maxChars = DRAFT_MAX_CHARS): boolean {
  const store = ls();
  if (!store) return false;
  const json = serializeDraft(value, now, maxChars);
  if (json == null) return false;
  try {
    store.setItem(draftKey(name), json);
    return true;
  } catch {
    return false; // QuotaExceeded / prywatny tryb — best-effort
  }
}

/** Usuń szkic (np. po realnym zapisaniu/wysłaniu pracy — żeby nie odtwarzać ukończonego). */
export function clearDraft(name: string): void {
  const store = ls();
  if (!store) return;
  try {
    store.removeItem(draftKey(name));
  } catch {
    /* pomiń */
  }
}

/** Pure: czy dana wartość zmieści się w limicie (do decyzji UI „nie da się utrwalić tak dużego")? */
export function draftFits(value: unknown, maxChars = DRAFT_MAX_CHARS): boolean {
  return serializeDraft(value, 0, maxChars) != null;
}
