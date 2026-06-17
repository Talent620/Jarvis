import { encryptText, decryptText } from "./cipher";

// Osobisty sejf haseł — Twoje dane logowania, zaszyfrowane hasłem głównym
// (AES-256-GCM). Odblokowany tylko w pamięci; nic w jawnej formie na dysku.

const KEY = "jarvis.vault.v1";

export interface Cred {
  id: string;
  name: string; // serwis / strona
  login: string; // login lub e-mail
  password: string;
  url?: string;
  notes?: string;
  updatedAt: number;
}

let cache: Cred[] | null = null; // odblokowane wpisy (RAM)
let master = "";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const vaultExists = (): boolean => !!localStorage.getItem(KEY);
export const vaultUnlocked = (): boolean => cache !== null;

/** Odblokuj istniejący sejf (lub utwórz nowy) hasłem głównym. */
export async function unlockVault(pass: string): Promise<boolean> {
  if (!pass) return false;
  // Wyzeruj sesję ZANIM spróbujemy odszyfrować — błędne hasło przy otwartym sejfie
  // musi go zaryglować, a nie zostawić stare wpisy widoczne przez listCreds().
  cache = null;
  master = "";
  const blob = localStorage.getItem(KEY);
  if (!blob) {
    cache = [];
    master = pass;
    await persist();
    return true;
  }
  try {
    cache = JSON.parse(await decryptText(blob, pass)) as Cred[];
    master = pass;
    return true;
  } catch {
    cache = null;
    master = "";
    return false;
  }
}

export function lockVault(): void {
  cache = null;
  master = "";
}

export function listCreds(): Cred[] {
  return cache ? [...cache].sort((a, b) => a.name.localeCompare(b.name)) : [];
}

async function persist(): Promise<void> {
  if (cache === null) return;
  localStorage.setItem(KEY, await encryptText(JSON.stringify(cache), master));
}

export async function saveCred(c: Omit<Cred, "id" | "updatedAt"> & { id?: string }): Promise<void> {
  if (cache === null) throw new Error("Sejf zablokowany.");
  const now = Date.now();
  if (c.id) {
    const e = cache.find((x) => x.id === c.id);
    if (e) Object.assign(e, { ...c, updatedAt: now });
  } else {
    cache.unshift({ id: uid(), name: c.name, login: c.login, password: c.password, url: c.url, notes: c.notes, updatedAt: now });
  }
  await persist();
}

export async function removeCred(id: string): Promise<void> {
  if (cache === null) return;
  cache = cache.filter((x) => x.id !== id);
  await persist();
}

/** Zmiana hasła głównego (re-szyfruje cały sejf). */
export async function changeMaster(next: string): Promise<void> {
  if (cache === null || !next) return;
  master = next;
  await persist();
}

// Silny generator haseł (Web Crypto, bez znaków mylących domyślnie).
export function genPassword(len = 20, opts: { symbols?: boolean } = { symbols: true }): string {
  let charset = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (opts.symbols !== false) charset += "!@#$%^&*-_=+?";
  const out: string[] = [];
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < len; i++) out.push(charset[rnd[i] % charset.length]);
  return out.join("");
}
