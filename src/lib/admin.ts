import { encryptText, decryptText } from "./cipher";

// === Panel administratora (wewnątrz JARVIS-a) ===
// Tu właściciel trzyma swoje sekrety (adres serwera licencji + token admina) i
// zarządza licencjami klientów. Sekrety są SZYFROWANE lokalnie (AES-256) hasłem
// = Twój numer telefonu (dostęp awaryjny). Bez numeru panel jest zaszyfrowany.
//
// Numer właściciela trzymamy wyłącznie jako skrót SHA-256 (nie jawnie).

const OWNER_PHONE_HASH = "017d1b198653988ddff2923e1ee9b383cd4a7190b1708ab50fad1fcbb3488bfb";
const CFG_KEY = "jarvis.admin.cfg.v1";

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Weryfikacja właściciela numerem telefonu (dostęp awaryjny do panelu). */
export async function verifyOwnerPhone(phone: string): Promise<boolean> {
  return (await sha256hex((phone || "").replace(/\s|-/g, "").trim())) === OWNER_PHONE_HASH;
}

export interface AdminConfig {
  workerUrl: string;
  adminToken: string;
  notes?: string;
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
    const res = await fetch(`${base(cfg)}/v1/admin/list`, { headers: headers(cfg) });
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
    const res = await fetch(`${base(cfg)}/v1/admin/issue`, { method: "POST", headers: headers(cfg), body: JSON.stringify(data) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d.error || `Błąd (${res.status}).` };
    return { key: d.key };
  } catch (e) {
    return { error: `Brak połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

export async function revokeLicense(cfg: AdminConfig, id: string, revoked: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${base(cfg)}/v1/admin/revoke`, { method: "POST", headers: headers(cfg), body: JSON.stringify({ id, revoked }) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resetDevices(cfg: AdminConfig, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(cfg)}/v1/admin/reset-devices`, { method: "POST", headers: headers(cfg), body: JSON.stringify({ id }) });
    return res.ok;
  } catch {
    return false;
  }
}
