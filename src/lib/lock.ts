// Blokada aplikacji PIN-em — chroni dostęp do JARVIS-a (sejf, dane, sterowanie),
// nawet gdy ktoś pobierze plik. PIN przechowywany wyłącznie jako skrót SHA-256+sól.

const KEY = "jarvis.lock.v1";

interface LockData {
  salt: string;
  hash: string;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const salt = randHex(8);
  const hash = await sha256(salt + pin);
  localStorage.setItem(KEY, JSON.stringify({ salt, hash } as LockData));
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
    const { salt, hash } = JSON.parse(raw) as LockData;
    const ok = (await sha256(salt + pin)) === hash;
    if (ok) {
      localStorage.removeItem(ATT_KEY); // sukces — wyzeruj licznik
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
