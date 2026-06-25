import { encryptText, decryptText } from "./cipher";
import { fetchTimeout } from "./http";

// === Panel administratora (wewnątrz JARVIS-a) ===
// Tu właściciel trzyma swoje sekrety (adres serwera licencji + token admina) i
// zarządza licencjami klientów. Sekrety są SZYFROWANE lokalnie (AES-256) HASŁEM
// ADMINISTRATORA (dostęp awaryjny). Bez hasła panel jest zaszyfrowany.
//
// Hasło trzymamy wyłącznie jako skrót PBKDF2-HMAC-SHA256 (nie jawnie).

// NIE goły SHA-256: hasło bywa krótkie, a goły hash łamie się szybko. Używamy
// PBKDF2-HMAC-SHA256 z solą i 210k iteracjami — brute-force ~210k× droższy.
// Skrót hasła administratora (PBKDF2 jw.). Zmiana hasła = przelicz ten skrót.
const OWNER_PHONE_HASH = "301959580928bf02209b47e3edf70dd8e8ff10d2f1a15ebf30e10945712a40c9";
const OWNER_SALT = "jarvis.owner.salt.v2";
const OWNER_ITER = 210000;
const CFG_KEY = "jarvis.admin.cfg.v1";

/** PBKDF2-HMAC-SHA256 → hex (Web Crypto; wynik identyczny z Node dla tych samych parametrów). */
async function pbkdf2hex(s: string, salt: string, iterations: number, len = 32): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(s), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" }, key, len * 8);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stałoczasowe porównanie hexów (anty-timing). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Weryfikacja właściciela numerem telefonu (dostęp awaryjny do panelu). */
export async function verifyOwnerPhone(phone: string): Promise<boolean> {
  const norm = (phone || "").replace(/\s|-/g, "").trim();
  if (!norm) return false;
  return timingSafeEqualHex(await pbkdf2hex(norm, OWNER_SALT, OWNER_ITER), OWNER_PHONE_HASH);
}

export interface AdminConfig {
  workerUrl: string;
  adminToken: string;
  notes?: string;
  signerPriv?: string; // klucz prywatny do offline-generatora (zawartość license-private.json), zaszyfrowany numerem właściciela
}

/** Zapisz sekrety panelu (zaszyfrowane numerem właściciela). */
export async function saveAdminConfig(phone: string, cfg: AdminConfig): Promise<void> {
  const blob = await encryptText(JSON.stringify(cfg), phone);
  try {
    localStorage.setItem(CFG_KEY, blob);
  } catch {
    /* ignore */
  }
}

/** Odczytaj i odszyfruj sekrety panelu (wymaga numeru właściciela). */
export async function loadAdminConfig(phone: string): Promise<AdminConfig | null> {
  try {
    const blob = localStorage.getItem(CFG_KEY);
    if (!blob) return { workerUrl: "", adminToken: "" };
    const json = await decryptText(blob, phone);
    return JSON.parse(json) as AdminConfig;
  } catch {
    return null; // zły numer lub uszkodzone dane
  }
}

export const hasAdminConfig = (): boolean => {
  try {
    return !!localStorage.getItem(CFG_KEY);
  } catch {
    return false;
  }
};

// --- Wywołania serwera licencji (panel admina) ---
function base(cfg: AdminConfig): string {
  return (cfg.workerUrl || "").replace(/\/$/, "");
}
function headers(cfg: AdminConfig): HeadersInit {
  return { "content-type": "application/json", "x-admin-token": cfg.adminToken };
}

export interface LicenseRow {
  id: string;
  name: string;
  type: string;
  exp: number;
  deviceLimit: number;
  devices: number;
  lastSeen: number;
  revoked: boolean;
}

export async function listLicenses(cfg: AdminConfig): Promise<{ licenses?: LicenseRow[]; error?: string }> {
  if (!base(cfg) || !cfg.adminToken) return { error: "Uzupełnij adres serwera i token admina." };
  try {
    const res = await fetchTimeout(`${base(cfg)}/v1/admin/list`, { headers: headers(cfg) }, 15000);
    if (!res.ok) return { error: res.status === 401 ? "Zły token administratora." : `Błąd serwera (${res.status}).` };
    return await res.json();
  } catch (e) {
    return { error: `Brak połączenia z serwerem: ${e instanceof Error ? e.message : e}` };
  }
}

export async function issueLicense(
  cfg: AdminConfig,
  data: { name: string; days?: number; deviceLimit?: number },
): Promise<{ key?: string; error?: string }> {
  try {
    const res = await fetchTimeout(`${base(cfg)}/v1/admin/issue`, { method: "POST", headers: headers(cfg), body: JSON.stringify(data) }, 15000);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d.error || `Błąd (${res.status}).` };
    return { key: d.key };
  } catch (e) {
    return { error: `Brak połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

export async function revokeLicense(cfg: AdminConfig, id: string, revoked: boolean): Promise<boolean> {
  try {
    const res = await fetchTimeout(`${base(cfg)}/v1/admin/revoke`, { method: "POST", headers: headers(cfg), body: JSON.stringify({ id, revoked }) }, 15000);
    return res.ok;
  } catch {
    return false;
  }
}

export async function resetDevices(cfg: AdminConfig, id: string): Promise<boolean> {
  try {
    const res = await fetchTimeout(`${base(cfg)}/v1/admin/reset-devices`, { method: "POST", headers: headers(cfg), body: JSON.stringify({ id }) }, 15000);
    return res.ok;
  } catch {
    return false;
  }
}
