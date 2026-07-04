// === Offline-generator licencji (po stronie właściciela, w aplikacji) ===
// Podpisuje klucze licencyjne LOKALNIE kluczem prywatnym wklejonym przez właściciela
// (zawartość license-private.json) — bez serwera/Workera. To odpowiednik scripts/license.mjs,
// ale w apce: jeden klik = podpisany klucz. Token jest zgodny z verifyLicense() w license.ts.
//
// UWAGA bezpieczeństwa: klucz prywatny przechowuje AdminPanel zaszyfrowany (numerem właściciela),
// nigdzie go nie wysyłamy. Wydane tokeny (NIE są sekretem) trzymamy w lokalnym rejestrze, by
// pokazać kto · na ile · status i umożliwić przedłużenie jednym kliknięciem.

import { PUBLIC_JWK } from "./license";
import { loadJson, saveJson } from "./lsJson";

const REG_KEY = "jarvis.licenses.local.v1";
const DAY_MS = 86_400_000;

export interface LicensePayload {
  n?: string; // owner / nazwa
  t?: string; // "term" | "perpetual"
  iat?: number;
  exp?: number;
}

export interface LicenseRecord {
  id: string;
  owner: string;
  type: string; // "term" | "perpetual"
  iat: number;
  exp: number | null; // null = bezterminowy
  token: string;
}

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Sparsuj wklejony klucz prywatny (zawartość license-private.json). null = niepoprawny. */
export function parsePrivateJwk(text: string): JsonWebKey | null {
  try {
    const j = JSON.parse(text) as JsonWebKey;
    if (j.kty === "EC" && j.crv === "P-256" && j.d && j.x && j.y) return j;
    return null;
  } catch {
    return null;
  }
}

/** Czy ten klucz prywatny pasuje do KLUCZA PUBLICZNEGO tej aplikacji.
 *  Jeśli nie — licencje nim podpisane NIE aktywują się w tej wersji (inny klucz publiczny). */
export function privateMatchesApp(jwk: JsonWebKey): boolean {
  return !!jwk.x && !!jwk.y && jwk.x === PUBLIC_JWK.x && jwk.y === PUBLIC_JWK.y;
}

/** Podpisz licencję lokalnie (ECDSA P-256). Zwraca token „data.sig" — zgodny z verifyLicense(). */
export async function signLicense(jwk: JsonWebKey, name: string, days: number): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Date.now();
  const payload: LicensePayload = { n: name, t: days ? "term" : "perpetual", iat };
  if (days) payload.exp = iat + days * DAY_MS;
  const data = b64urlBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  return data + "." + b64urlBytes(new Uint8Array(sig));
}

/** Odczytaj zawartość tokenu (bez weryfikacji podpisu) — do listy/przedłużania. */
export function decodeLicense(token: string): LicensePayload | null {
  try {
    const data = (token || "").split(".")[0];
    if (!data) return null;
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(data))) as LicensePayload;
  } catch {
    return null;
  }
}

/** Status klucza wg daty (offline nie raportuje użycia, więc liczymy z exp). */
export function licenseStatus(exp: number | null, now = Date.now()): { label: string; tone: "ok" | "warn" | "err" } {
  if (!exp) return { label: "bezterminowy", tone: "ok" };
  const days = Math.ceil((exp - now) / DAY_MS);
  if (days < 0) return { label: `wygasł ${Math.abs(days)} dni temu`, tone: "err" };
  if (days <= 7) return { label: `wygasa za ${days} dni`, tone: "warn" };
  return { label: `aktywny · ${days} dni`, tone: "ok" };
}

// --- Lokalny rejestr wydanych kluczy (kto · na ile · status) ---
export function listLocalLicenses(): LicenseRecord[] {
  return loadJson<LicenseRecord[]>(REG_KEY, []);
}
export function saveLocalLicense(rec: LicenseRecord): void {
  const all = listLocalLicenses().filter((r) => r.id !== rec.id); // upsert po id
  all.unshift(rec);
  saveJson(REG_KEY, all.slice(0, 500));
}
export function removeLocalLicense(id: string): void {
  saveJson(REG_KEY, listLocalLicenses().filter((r) => r.id !== id));
}

/** Podpisz NOWY klucz dla właściciela i dopisz do rejestru. */
export async function issueLocalLicense(jwk: JsonWebKey, owner: string, days: number): Promise<LicenseRecord> {
  const token = await signLicense(jwk, owner, days);
  const p = decodeLicense(token);
  const iat = p?.iat ?? Date.now();
  const rec: LicenseRecord = {
    id: `${iat}-${Math.random().toString(36).slice(2, 8)}`,
    owner,
    type: p?.t || "term",
    iat,
    exp: p?.exp ?? null,
    token,
  };
  saveLocalLicense(rec);
  return rec;
}

/** Przedłuż klucz danego właściciela — ten sam wpis, nowy termin (days=0 → bezterminowy). */
export async function extendLocalLicense(jwk: JsonWebKey, rec: LicenseRecord, days: number): Promise<LicenseRecord> {
  const token = await signLicense(jwk, rec.owner, days);
  const p = decodeLicense(token);
  const updated: LicenseRecord = { ...rec, type: p?.t || "term", iat: p?.iat ?? Date.now(), exp: p?.exp ?? null, token };
  saveLocalLicense(updated);
  return updated;
}
