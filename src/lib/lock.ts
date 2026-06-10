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

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return true;
    const { salt, hash } = JSON.parse(raw) as LockData;
    return (await sha256(salt + pin)) === hash;
  } catch {
    return false;
  }
}
