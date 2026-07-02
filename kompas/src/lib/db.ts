// KOMPAS — wspólny rdzeń danych: sql.js (SQLite w WASM) + trwałość w IndexedDB.
// Jedno źródło prawdy: baza SQL; po każdej mutacji pełny snapshot bajtów idzie do
// IndexedDB (zapis atomowy na poziomie transakcji IndexedDB → „raz albo wcale").
// Jedyne źródło czasu: now() — UI nigdy nie przyjmuje czasu od użytkownika.
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const IDB_NAME = "kompas";
const IDB_STORE = "sqlite";
const IDB_KEY = "main";

let db: Database | null = null;
const listeners = new Set<() => void>();
let persistChain: Promise<void> = Promise.resolve();

/** Jedyne źródło czasu w produkcie (testy sterują nim przez zegar strony). */
export function now(): number {
  return Date.now();
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (starsze WebView): losowe 128 bitów w formacie uuid-podobnym.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbLoad(): Promise<Uint8Array | null> {
  return idbOpen().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => {
          const v = req.result;
          resolve(v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null);
        };
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSave(bytes: Uint8Array): Promise<void> {
  return idbOpen().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL CHECK(length(trim(text)) > 0),
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  prediction TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','ai')),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','resolved')),
  outcome TEXT CHECK(outcome IN ('hit','miss','unclear')),
  learned TEXT,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS proofs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('file','note','link')),
  note TEXT, url TEXT, file_name TEXT, file_mime TEXT, file_blob BLOB,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  bet_id TEXT NOT NULL REFERENCES bets(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  proof_id TEXT REFERENCES proofs(id),
  CHECK ((done_at IS NULL) = (proof_id IS NULL))
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

/** Idempotentna inicjalizacja: wczytaj snapshot z IndexedDB albo utwórz schemat. */
export async function initDb(): Promise<void> {
  if (db) return;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | null = null;
  try {
    bytes = await idbLoad();
  } catch {
    bytes = null; // uszkodzony/niedostępny IndexedDB → świeża baza (starych danych nie da się odzyskać)
  }
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.exec(SCHEMA); // IF NOT EXISTS — bezpieczne też dla wczytanej bazy (migracje w przód)
}

function mustDb(): Database {
  if (!db) throw new Error("Baza nie jest zainicjalizowana — wywołaj initDb().");
  return db;
}

function schedulePersist(): void {
  const snapshot = mustDb().export(); // pełny, spójny obraz bazy w tym momencie
  persistChain = persistChain.then(() => idbSave(snapshot)).catch(() => {
    /* nieudany zapis nie może wywrócić UI; kolejna mutacja spróbuje ponownie */
  });
}

/** Mutacja + automatyczny trwały zapis + powiadomienie subskrybentów. */
export function run(sql: string, params: unknown[] = []): void {
  const d = mustDb();
  d.run(sql, params as never);
  schedulePersist();
  for (const fn of Array.from(listeners)) fn();
}

/** Odczyt wielu wierszy jako obiekty. */
export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const d = mustDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params as never);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const rows = all<T>(sql, params);
  return rows.length ? rows[0] : null;
}

/** Subskrypcja zmian (ekrany renderują się na nowo po mutacji). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Czekaj, aż wszystkie zaplanowane zapisy trafią do IndexedDB (eksport/testy). */
export function flush(): Promise<void> {
  return persistChain;
}
