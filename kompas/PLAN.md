# KOMPAS — PLAN (FAZA 2)

## Architektura w jednym zdaniu
Jedna baza sql.js (SQLite w WASM) trwale zapisywana do IndexedDB po każdej mutacji;
cztery ekrany (Dziś / Tydzień / Zakład / Eksport) nad czterema cienkimi modułami
domenowymi; stan „done" działania konstruowalny WYŁĄCZNIE przez funkcję wymagającą
dowodu (zasada zerowa na poziomie typu i schematu SQL).

## Model danych (schemat SQL, wersja 1)
```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);           -- schema_version='1'
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL CHECK(length(trim(text)) > 0),
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL                                    -- epoch ms, nadaje SYSTEM
);
CREATE TABLE bets (
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
CREATE TABLE proofs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('file','note','link')),
  note TEXT, url TEXT, file_name TEXT, file_mime TEXT, file_blob BLOB,
  created_at INTEGER NOT NULL                                    -- nadaje SYSTEM
);
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  bet_id TEXT NOT NULL REFERENCES bets(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER,
  proof_id TEXT REFERENCES proofs(id),
  CHECK ((done_at IS NULL) = (proof_id IS NULL))                 -- zasada zerowa w schemacie
);
```
Inwarianty (egzekwowane w module + schemacie):
- `done_at` i `proof_id` ustawiane RAZEM albo wcale — jedyna droga: `closeAction(...)` z ważnym dowodem.
- Dokładnie 0 lub 1 zakład `status='active'` (egzekwowane w `createBet`).
- Wszystkie `created_at` nadaje `now()` z db.ts — UI nigdy nie przyjmuje czasu od użytkownika.

## Wspólny rdzeń (pisze INTEGRATOR przed startem wykonawców)
`src/lib/db.ts` — sql.js + trwałość + czas + id:
```ts
export function now(): number;                 // jedyne źródło czasu (Date.now)
export function uuid(): string;
export async function initDb(): Promise<void>; // idempotentne: wczytaj z IndexedDB albo utwórz schemat
export function run(sql: string, params?: unknown[]): void;         // mutacja + auto-persist (async)
export function all<T>(sql: string, params?: unknown[]): T[];       // odczyt
export function one<T>(sql: string, params?: unknown[]): T | null;
export function subscribe(fn: () => void): () => void;              // powiadomienie po mutacji (re-render)
export async function flush(): Promise<void>;  // czekaj aż persist się zakończy (dla testów/eksportu)
```
`src/App.tsx` — nawigacja 4 zakładek + montaż ekranów (integrator; wykonawcy NIE dotykają).
`src/styles.css` — style bazowe + klasy narzędziowe (integrator). Ekrany mają WŁASNE pliki css.

## Wycinki i własność plików (rozdzielne — zero wspólnych plików)
### Wykonawca A — W1 Daily Capture + W2 Typed Memory
Pliki (tylko te!): `src/lib/entries.ts`, `src/lib/week.ts`, `src/lib/ai.ts`,
`src/screens/Today.tsx`, `src/screens/Today.css`, `src/screens/Week.tsx`, `src/screens/Week.css`
- `entries.ts`: `addEntry(text, score)` (trim, walidacja, timestamp systemowy),
  `listEntries()` (malejąco po czasie), `countEntries()`.
- `week.ts`: `weekStats(nowMs)`: `{ enough: boolean, count, days: {label, count, avgScore}[] }`
  — `enough` = ≥5 wpisów ORAZ ≥3 różne dni kalendarzowe (ostatnie 7 dni).
- `ai.ts`: klucz w `localStorage['kompas.apiKey']`; `analyzeWeek()` → 1 call
  `POST https://api.anthropic.com/v1/messages` (nagłówek
  `anthropic-dangerous-direct-browser-access: true`, model `claude-haiku-4-5-20251001`),
  prompt zawiera statystyki tygodnia, odpowiedź parsowana jako JSON `{bet, prediction}`
  (tolerancyjnie: pierwszy blok `{...}` z tekstu). Zwraca propozycję — NICZEGO nie zapisuje.
- `Today.tsx`: ekran startowy — textarea, 5 przycisków oceny, Zapisz (blokada podczas
  zapisu — obrona S12), lista wpisów z czasem (tekst, nie pole).
- `Week.tsx`: przy `!enough` → `week-too-few`; inaczej `week-pattern` (count + 7 wierszy dni);
  pole klucza API; z kluczem: przycisk `ai-analyze` → propozycja `ai-proposal` z
  `ai-accept`/`ai-reject`; bez klucza: `local-stats-badge` („statystyka lokalna — bez AI");
  formularz ręcznego zakładu (`bet-manual-*`). Akceptacja/zapis zakładu woła
  `createBet(...)` z modułu B i pokazuje `bet-conflict` przy `BetConflictError`.

### Wykonawca B — W3 One Active Bet + W4 Action Verification
Pliki (tylko te!): `src/lib/bets.ts`, `src/lib/exportMd.ts`,
`src/screens/Bet.tsx`, `src/screens/Bet.css`, `src/screens/Export.tsx`, `src/screens/Export.css`
- `bets.ts`: `activeBet()`, `createBet(text, prediction, source)` → rzuca `BetConflictError`
  gdy istnieje aktywny; `listActions(betId)`, `addAction(betId, text)`;
  `closeAction(actionId, proof: ProofInput)` — JEDYNA droga do done; walidacja dowodu
  (note: niepusty tekst; link: URL http/https; file: niepuste bajty) → inaczej rzuca
  `ProofRequiredError`; `getProof(proofId)`; `resolveBet(betId, outcome, learned)`;
  `betHistory()`.
  `type ProofInput = { kind:'note', note:string } | { kind:'link', url:string }
                   | { kind:'file', name:string, mime:string, bytes:Uint8Array }`
- `exportMd.ts`: `buildMarkdown()` — nagłówek, `Wpisy: N`, lista wpisów, zakłady
  (aktywny + historia z outcome/learned), działania: `- [x] tekst — dowód: rodzaj (data)`
  albo `- [ ] tekst`. Działanie bez dowodu NIGDY z `[x]`.
- `Bet.tsx`: `bet-empty` | `bet-active` (tekst, przewidywanie, status), dodawanie działań,
  przycisk `action-done` → modal `proof-form` (3 typy, walidacja, `proof-required` przy
  odmowie), `proof-view` → `proof-artifact` (podgląd + timestamp systemowy; Escape zamyka),
  `bet-resolve` → werdykt hit/miss/unclear + `bet-learned` → `bet-resolve-save`;
  `bet-history` z wpisami zawierającymi ORYGINALNE przewidywanie i werdykt
  („sprawdziło się" / „nie sprawdziło się" / „nierozstrzygnięte").
- `Export.tsx`: przycisk `export-md` → pobranie pliku `kompas-eksport.md`
  (blob + `<a download>`), po `await flush()`.

## Kontrakt UI (data-testid)
Pełna lista w `e2e/helpers.ts` (sekcja KONTRAKT UI) — to jest źródło prawdy.
Teksty wymagane przez testy: „za mało" (week-too-few), „bez AI" (local-stats-badge),
„rozstrzygnij" (bet-conflict), „dowod/dowód" (proof-required), „do zrobienia"/„zrobione"
(action-status), „sprawdziło się" (historia).

## Mapowanie wycinek → scenariusze eval.md
| Wycinek | Scenariusze |
|---|---|
| W1 Daily Capture (A) | S01, S02, S03, S12 |
| W2 Typed Memory (A) | S04, S05*, S06 |
| W3 One Active Bet (B) | S05*, S07, S10 |
| W4 Action Verification + eksport (B) | S08, S09, S11 |

*S05 przechodzi przez oba wycinki: propozycja (A) → akceptacja woła `createBet` (B).
Integrator odpowiada za spięcie i zieloność S05/S07.

## Zasady integracji
1. Wykonawcy edytują WYŁĄCZNIE swoje pliki z listy; rdzeń (db.ts, App.tsx, styles.css,
   e2e/, configi) jest zamrożony — zmiany tam tylko przez integratora.
2. Po scaleniu każdego wycinka: `bash verify.sh` (pełny zrzut w EVIDENCE/); commit po
   każdym zielonym wycinku, jeden cel na commit.
3. Max 2 iteracje naprawcze na wycinek; trzecia porażka = STOP i raport.
4. Definicje „zrobione": scenariusze wycinka ZIELONE w tabeli verify.sh — nic innego
   się nie liczy.
