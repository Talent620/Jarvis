// KOMPAS — wspólny rdzeń danych: sql.js (SQLite w WASM) + trwałość w IndexedDB.
// Jedno źródło prawdy: baza SQL; po każdej mutacji pełny snapshot bajtów idzie do
// IndexedDB (zapis atomowy na poziomie transakcji IndexedDB → „raz albo wcale").
// Jedyne źródło czasu: now() — UI nigdy nie przyjmuje czasu od użytkownika.
//
// Po rundzie adwersarzy (FAZA 5) trwałość mówi PRAWDĘ:
// - P1: nieudany zapis nie jest połykany — persistIssue() + flush() zgłaszają porażkę,
// - P2: snapshot jest wersjonowany; starsza karta nie nadpisze nowszych danych (blokada),
// - P3/P4: błąd odczytu lub uszkodzona baza NIE tworzą cichej świeżej bazy — initDb
//   odrzuca z czytelnym komunikatem i zapis pozostaje niemożliwy (dane nietknięte),
// - P7: batch() — wieloetapowa mutacja = jedna transakcja SQL + jeden snapshot.
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

const IDB_NAME = "kompas";
const IDB_STORE = "sqlite";
const IDB_KEY = "main";
const IDB_VERSION_KEY = "version";

let db: Database | null = null;
const listeners = new Set<() => void>();
let persistChain: Promise<void> = Promise.resolve();
// Wersja snapshotu w tej karcie — musi zgadzać się z zapisaną, inaczej ktoś inny pisał.
let dbVersion = 0;
// P1: ostatni błąd trwałego zapisu (null = ostatni zapis udany).
let lastPersistError: string | null = null;
// P2: twarda blokada zapisu (konflikt kart) — chroni nowsze dane przed nadpisaniem.
let saveLocked: string | null = null;

class VersionConflictError extends Error {
  constructor() {
    super("Dane zostały zmienione w innej karcie tej aplikacji.");
    this.name = "VersionConflictError";
  }
}

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

function emit(): void {
  for (const fn of Array.from(listeners)) fn();
}

// Jedno wspólne połączenie IndexedDB (runda 2/#4): otwierane raz, zamykane przez
// przeglądarkę — bez mnożenia połączeń przy każdym zapisie.
let idbConn: IDBDatabase | null = null;

function idbOpen(): Promise<IDBDatabase> {
  if (idbConn) return Promise.resolve(idbConn);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      idbConn = req.result;
      idbConn.onclose = () => {
        idbConn = null;
      };
      resolve(idbConn);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Odczyt snapshotu + wersji w JEDNEJ transakcji. Błąd odczytu ≠ brak snapshotu (P3). */
function idbLoad(): Promise<{ bytes: Uint8Array | null; version: number }> {
  return idbOpen().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const bytesReq = store.get(IDB_KEY);
        const verReq = store.get(IDB_VERSION_KEY);
        tx.oncomplete = () => {
          const v = bytesReq.result;
          const bytes = v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null;
          const version = typeof verReq.result === "number" ? verReq.result : 0;
          resolve({ bytes, version });
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transakcja odczytu przerwana"));
      })
  );
}

/**
 * Zapis snapshotu z kontrolą wersji w JEDNEJ transakcji readwrite (P2):
 * jeżeli zapisana wersja ≠ oczekiwanej, transakcja jest przerywana i nic nie nadpisujemy.
 */
function idbSaveVersioned(bytes: Uint8Array, expected: number): Promise<void> {
  return idbOpen().then(
    (idb) =>
      new Promise((resolve, reject) => {
        let conflict = false;
        const tx = idb.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        const verReq = store.get(IDB_VERSION_KEY);
        verReq.onsuccess = () => {
          const stored = typeof verReq.result === "number" ? verReq.result : 0;
          if (stored !== expected) {
            conflict = true;
            try {
              tx.abort();
            } catch {
              /* już przerwana */
            }
            return;
          }
          store.put(bytes, IDB_KEY);
          store.put(expected + 1, IDB_VERSION_KEY);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(conflict ? new VersionConflictError() : tx.error ?? new Error("Zapis przerwany"));
        tx.onerror = () => {
          /* po onerror IndexedDB i tak wywoła onabort */
        };
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

/**
 * Idempotentna inicjalizacja. Odrzuca z CZYTELNYM błędem (po polsku), gdy:
 * - odczyt z IndexedDB się nie powiódł (P3 — nie tworzymy cicho świeżej bazy),
 * - snapshot jest uszkodzony (P4 — nie nadpisujemy go; dane zostają nietknięte).
 * W obu przypadkach db pozostaje null → każda próba zapisu rzuci, snapshot przetrwa.
 */
let initPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  // Memoizowana obietnica (runda 2/#3): równoległe wywołania (StrictMode w dev)
  // dzielą jedną inicjalizację; porażka zeruje memo, żeby przeładowanie mogło spróbować znów.
  if (!initPromise) {
    initPromise = doInitDb().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

async function doInitDb(): Promise<void> {
  if (db) return;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let loaded: { bytes: Uint8Array | null; version: number };
  try {
    loaded = await idbLoad();
  } catch {
    throw new Error(
      "Nie udało się odczytać zapisanej bazy z tej przeglądarki. Twoje dane NIE zostały skasowane — odśwież stronę i spróbuj ponownie."
    );
  }
  try {
    db = loaded.bytes ? new SQL.Database(loaded.bytes) : new SQL.Database();
    db.exec(SCHEMA); // IF NOT EXISTS — bezpieczne też dla wczytanej bazy (migracje w przód)
  } catch {
    db = null;
    throw new Error(
      "Zapisana baza wygląda na uszkodzoną. Nie nadpisuję jej automatycznie — dane pozostają w przeglądarce. Odśwież stronę; jeśli błąd wraca, zgłoś go zanim cokolwiek usuniesz."
    );
  }
  dbVersion = loaded.version;
}

function mustDb(): Database {
  if (!db) throw new Error("Baza nie jest zainicjalizowana — wywołaj initDb().");
  return db;
}

function schedulePersist(): void {
  if (saveLocked) return; // konflikt kart: nie wolno nadpisać nowszych danych (P2)
  const snapshot = mustDb().export(); // pełny, spójny obraz bazy w tym momencie
  persistChain = persistChain.then(() => {
    if (saveLocked) return; // blokada mogła zapaść, gdy ten zapis czekał w kolejce
    // `expected` wyznaczane w MOMENCIE WYKONANIA (kolejka FIFO), a wersja rośnie
    // wyłącznie po UDANYM zapisie — porażka quota nie rozjeżdża licznika i nie
    // udaje później konfliktu kart (kolejny zapis po prostu próbuje ponownie).
    const expected = dbVersion;
    return idbSaveVersioned(snapshot, expected).then(
      () => {
        dbVersion = expected + 1;
        // Udany zapis kasuje ewentualny wcześniejszy błąd (np. zwolniło się miejsce).
        if (lastPersistError) {
          lastPersistError = null;
          emit();
        }
      },
      (e) => {
        if (e instanceof VersionConflictError) {
          saveLocked =
            "Dane zostały zmienione w innej karcie tej aplikacji. Ta karta ma nieaktualny stan — odśwież stronę, żeby nie nadpisać nowszych danych. Zapis z tej karty jest zablokowany.";
        } else {
          lastPersistError =
            "Trwały zapis nie powiódł się (np. brak miejsca w przeglądarce). Dane z tej sesji mogą zniknąć po zamknięciu karty — zwolnij miejsce i spróbuj ponownie.";
        }
        emit();
      }
    );
    // celowo bez rethrow: łańcuch nigdy nie jest odrzucony (brak unhandled rejection),
    // a prawda o porażce żyje w lastPersistError/saveLocked i w flush().
  });
}

/** Mutacja + automatyczny trwały zapis + powiadomienie subskrybentów. */
export function run(sql: string, params: unknown[] = []): void {
  const d = mustDb();
  d.run(sql, params as never);
  if (!batching) {
    schedulePersist();
    emit();
  }
}

let batching = false;

/**
 * Partia (P7): wieloetapowa mutacja jako JEDNA transakcja SQL i JEDEN snapshot.
 * Wyjątek w środku wycofuje całość (ROLLBACK) — bez połowicznych stanów.
 */
export function batch(fn: () => void): void {
  if (batching) {
    fn(); // zagnieżdżenie dołącza do zewnętrznej partii
    return;
  }
  const d = mustDb();
  batching = true;
  d.exec("BEGIN");
  try {
    fn();
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* transakcja mogła już upaść */
    }
    batching = false;
    throw e;
  }
  batching = false;
  schedulePersist();
  emit();
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

/** Liczba wierszy zmienionych ostatnią mutacją — do wykrywania cichych no-opów. */
export function rowsModified(): number {
  return mustDb().getRowsModified();
}

/** Subskrypcja zmian (ekrany renderują się na nowo po mutacji). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Bieżący problem trwałości do pokazania użytkownikowi (null = wszystko trwałe). */
export function persistIssue(): string | null {
  return saveLocked ?? lastPersistError;
}

/**
 * Czekaj na zakończenie zaplanowanych zapisów. RZUCA, gdy trwały zapis się nie
 * powiódł albo jest zablokowany — „zapisane” wolno powiedzieć tylko po prawdzie (P1).
 */
export async function flush(): Promise<void> {
  await persistChain;
  const issue = persistIssue();
  if (issue) throw new Error(issue);
}
