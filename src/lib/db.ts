// Warstwa IndexedDB (Dexie) — zdejmuje sufit ~5 MB localStorage z kolekcji, które rosną
// (embeddingi pamięci, logi sentMail/contentPosts). Patrz AUDIT.md dług #1.
//
// PROJEKT: to wyłącznie warstwa TRWAŁOŚCI. `store.data` pozostaje w RAM i synchroniczne dla
// reszty kodu (zero zmian u callerów) — tutaj tylko zapisujemy/odczytujemy duże kolekcje do/z
// IndexedDB zamiast do localStorage. Gdy IndexedDB jest niedostępny (np. środowisko node w
// testach, stary WebView), wszystko płynnie wraca do localStorage — dokładnie jak dotąd.
//
// Format: jedna tabela klucz→wartość (`kv`), gdzie wartością jest cała tablica kolekcji.
// Kolekcje zmieniają się rzadko (dodanie faktu/maila), więc zapis całej tablicy jest tani,
// a kod prosty i łatwo odwracalny (rollback = czytaj z localStorage).

import Dexie, { type Table } from "dexie";

interface KvRow {
  k: string;
  v: unknown;
}

class JarvisDB extends Dexie {
  kv!: Table<KvRow, string>;
  constructor() {
    super("jarvis");
    this.version(1).stores({ kv: "k" });
  }
}

let db: JarvisDB | null = null;
let initFailed = false;

// IndexedDB bywa niedostępny (node w testach, tryb prywatny przeglądarki, stary WebView).
function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function getDb(): JarvisDB | null {
  if (initFailed || !hasIndexedDb()) return null;
  if (!db) {
    try {
      db = new JarvisDB();
    } catch {
      initFailed = true;
      return null;
    }
  }
  return db;
}

/** Czy trwałość w IndexedDB jest dostępna (inaczej store używa localStorage). */
export function idbAvailable(): boolean {
  return getDb() !== null;
}

/** Odczyt kolekcji z IndexedDB. Zwraca null przy braku/niedostępności/błędzie. */
export async function idbGet<T = unknown>(key: string): Promise<T | null> {
  const d = getDb();
  if (!d) return null;
  try {
    const row = await d.kv.get(key);
    return (row ? (row.v as T) : null);
  } catch {
    return null;
  }
}

/** Zapis kolekcji do IndexedDB. Zwraca false przy niedostępności/błędzie (caller może spaść do localStorage). */
export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const d = getDb();
  if (!d) return false;
  try {
    await d.kv.put({ k: key, v: value });
    return true;
  } catch {
    return false;
  }
}

/** Usunięcie klucza (np. czyszczenie po migracji/rollbacku). */
export async function idbDelete(key: string): Promise<void> {
  const d = getDb();
  if (!d) return;
  try {
    await d.kv.delete(key);
  } catch {
    /* ignore */
  }
}

// Tylko do testów — pozwala zresetować uchwyt po podmianie globalnego indexedDB.
export function __resetDbForTests(): void {
  db = null;
  initFailed = false;
}
