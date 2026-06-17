// Blokada aplikacji PIN-em — chroni dostęp do JARVIS-a (sejf, dane, sterowanie),
// nawet gdy ktoś pobierze plik. PIN rozciągany przez PBKDF2-SHA256 (sól + iteracje),
// więc krótkiego PIN-u nie da się szybko zgadnąć z kopii localStorage.

const KEY = "jarvis.lock.v1";
const PBKDF2_ITER = 210_000; // koszt obliczeniowy — utrudnia brute-force offline
const MIN_PIN = 4;

interface LockData {
  salt: string;
  hash: string;
  /** Liczba iteracji PBKDF2. Brak pola = stary rekord SHA-256 (migrowany przy 1. udanym logowaniu). */
  iter?: number;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stary, jednokrotny SHA-256 — TYLKO do weryfikacji istniejących rekordów (migracja).
async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// PBKDF2-SHA256 → 256-bitowy skrót (hex). Rozciąga PIN o `iterations` rund.
async function pbkdf2(pin: string, salt: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
    km,
    256,
  );
  return hex(bits);
}

function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function lockIsSet(): boolean {
  return !!localStorage.getItem(KEY);
}

export async function setPin(pin: string): Promise<void> {
  if (!pin || pin.length < MIN_PIN) throw new Error(`PIN musi mieć co najmniej ${MIN_PIN} znaki.`);
  const salt = randHex(16);
  const hash = await pbkdf2(pin, salt, PBKDF2_ITER);
  localStorage.setItem(KEY, JSON.stringify({ salt, hash, iter: PBKDF2_ITER } as LockData));
}

export function clearPin(): void {
  localStorage.removeItem(KEY);
}

// Ochrona przed zgadywaniem PIN-u: po serii błędów krótka, rosnąca blokada.
// Łagodna (nie kasuje danych, nie blokuje na stałe) — utrudnia brute-force.
const ATT_KEY = "jarvis.lock.att.v1";
interface Att { n: number; until: number }
function loadAtt(): Att {
  try { return JSON.parse(localStorage.getItem(ATT_KEY) || "") as Att; } catch { return { n: 0, until: 0 }; }
}
function saveAtt(a: Att): void {
  try { localStorage.setItem(ATT_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

/** Ile ms pozostało chwilowej blokady po zbyt wielu błędnych PIN-ach (0 = brak). */
export function lockoutRemainingMs(): number {
  return Math.max(0, loadAtt().until - Date.now());
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return true;
    if (lockoutRemainingMs() > 0) return false; // chwilowa blokada — nie sprawdzaj
    const { salt, hash, iter } = JSON.parse(raw) as LockData;
    // Rekord PBKDF2 (iter) → PBKDF2; stary rekord SHA-256 (brak iter) → weryfikuj po staremu.
    const ok = iter
      ? (await pbkdf2(pin, salt, iter)) === hash
      : (await sha256(salt + pin)) === hash;
    if (ok) {
      localStorage.removeItem(ATT_KEY); // sukces — wyzeruj licznik
      // Migracja starego SHA-256 → PBKDF2 przy pierwszym udanym logowaniu (nie blokuj wejścia, gdy się nie uda).
      if (!iter && pin.length >= MIN_PIN) {
        try { await setPin(pin); } catch { /* migracja nieobowiązkowa */ }
      }
      return true;
    }
    const a = loadAtt();
    a.n = (a.n || 0) + 1;
    // Po 5 błędach krótka blokada, rosnąca: 15 s, 30 s, 45 s… (maks. 5 min).
    if (a.n >= 5) a.until = Date.now() + Math.min(300_000, 15_000 * (a.n - 4));
    saveAtt(a);
    return false;
  } catch {
    return false;
  }
}
