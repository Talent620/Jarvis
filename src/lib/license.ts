// === Aktywacja licencją (ochrona własności) ===
// Klucz licencyjny to podpisany (ECDSA P-256) token. Tylko właściciel — kluczem
// PRYWATNYM — potrafi wygenerować ważny klucz; aplikacja weryfikuje go kluczem
// PUBLICZNYM (poniżej, bezpiecznym do umieszczenia w kodzie). Dzięki temu kopia
// programu bez ważnego klucza się nie aktywuje, a kluczy nie da się podrobić.
//
// Generowanie kluczy dla kupujących: scripts/license.mjs (wymaga klucza prywatnego,
// który NIE jest w repozytorium).

import { fetchTimeout } from "./http";
import { isRevoked } from "./revoked";

// Eksportowany, bo offline-generator (licenseSign.ts) porównuje z nim wklejony klucz
// prywatny — inaczej podpisane nim licencje nie aktywują się w tej wersji aplikacji.
export const PUBLIC_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "cr_zxxKQMLPKsuGybJtd05h_z-m0H_xnhS7WiYtEmdU",
  y: "a1Xl4CHImK2EAIXg19PVIFuagNCa4PQ2zatk4gysxzg",
};

const STORE_KEY = "jarvis.license.v1";

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

let keyPromise: Promise<CryptoKey> | null = null;
function publicKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey("jwk", PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  return keyPromise;
}

export interface LicenseInfo {
  valid: boolean;
  name?: string;
  type?: string;
  exp?: number;
}

export interface LicenseStatus {
  kind: "perpetual" | "term" | "trial" | "open" | "none";
  daysLeft: number | null; // dni do wygaśnięcia (null = bezterminowa/otwarta)
  expiringSoon: boolean; // ≤ 3 dni
  expired: boolean;
}

/** Policz stan licencji (rodzaj, ile dni zostało, czy wkrótce wygasa). Czyste i testowalne. */
export function licenseStatus(info: LicenseInfo | null, now = Date.now()): LicenseStatus {
  if (!info) return { kind: "none", daysLeft: null, expiringSoon: false, expired: false };
  if (info.type === "open") return { kind: "open", daysLeft: null, expiringSoon: false, expired: false };
  if (!info.exp) return { kind: info.type === "trial" ? "trial" : "perpetual", daysLeft: null, expiringSoon: false, expired: false };
  const ms = info.exp - now;
  const daysLeft = Math.max(0, Math.ceil(ms / 86_400_000));
  const expired = ms <= 0;
  return {
    kind: info.type === "trial" ? "trial" : "term",
    daysLeft,
    expiringSoon: !expired && daysLeft <= 3,
    expired,
  };
}

/** Komunikat-zachęta dla użytkownika (trial: zawsze; licencja czasowa: tylko przy końcu). null = brak. */
export function licenseExpiryNudge(st: LicenseStatus): string | null {
  if (st.kind === "perpetual" || st.kind === "open" || st.kind === "none") return null;
  if (st.expired) return "Dostęp wygasł — przedłuż, by korzystać dalej.";
  const d = st.daysLeft ?? 0;
  const left = d <= 1 ? "został ostatni dzień" : `zostało ${d} dni`;
  if (st.kind === "trial") return `Trial — ${left}.`;
  if (st.expiringSoon) return `Licencja — ${left}. Przedłuż, by nie stracić dostępu.`;
  return null;
}

/**
 * Oczyść klucz z białych ORAZ niewidocznych znaków (zero-width, soft hyphen, BOM),
 * które kopiowanie z telefonu/maila potrafi wstawić — to one „psuły" poprawny klucz.
 */
export function normalizeKey(s: string): string {
  return (s || "").replace(/[\s\u200B-\u200D\u00AD\uFEFF\u2060]/g, "");
}

/** Zweryfikuj klucz licencyjny (podpis + ewentualny termin ważności). */
export async function verifyLicense(token: string): Promise<LicenseInfo> {
  try {
    const [data, sigB64] = normalizeKey(token).split(".");
    if (!data || !sigB64) return { valid: false };
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await publicKey(),
      bs(b64urlToBytes(sigB64)),
      bs(new TextEncoder().encode(data)),
    );
    if (!ok) return { valid: false };
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(data))) as { n?: string; t?: string; iat?: number; exp?: number };
    if (payload.exp && Date.now() > payload.exp) return { valid: false }; // licencja wygasła
    if (isRevoked(payload.n, payload.iat)) return { valid: false }; // unieważniony offline (kill-switch w aktualizacji)
    return { valid: true, name: payload.n, type: payload.t, exp: payload.exp };
  } catch {
    return { valid: false };
  }
}

export function storedLicense(): string {
  try {
    return localStorage.getItem(STORE_KEY) || "";
  } catch {
    return "";
  }
}
export function saveLicense(token: string): void {
  try {
    localStorage.setItem(STORE_KEY, token.trim());
  } catch {
    /* ignore */
  }
}
export function clearLicense(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** Czy build wymaga aktywacji (domyślnie true). */
export const licenseRequired = (): boolean =>
  typeof __LICENSE_REQUIRED__ === "undefined" ? true : __LICENSE_REQUIRED__;

/** Adres serwera licencji (Cloudflare Worker) lub "" w trybie offline. */
const licenseUrl = (): string => (typeof __LICENSE_URL__ === "undefined" ? "" : __LICENSE_URL__).replace(/\/$/, "");
/** Tryb rygorystyczny: bez udanej aktywacji online aplikacja się nie uruchamia. */
const licenseStrict = (): boolean => typeof __LICENSE_STRICT__ !== "undefined" && __LICENSE_STRICT__;

const DEVICE_KEY = "jarvis.device.v1";
/** Stabilny, anonimowy identyfikator urządzenia (do limitu urządzeń i podglądu „kto korzysta"). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 24);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "nodevice";
  }
}

function platformName(): string {
  const w = window as any;
  if (w.jarvisDesktop) return "windows";
  if (w.Capacitor?.isNativePlatform?.()) return "android";
  return "web";
}

/** Wywołanie serwera licencji (aktywacja/heartbeat). Zwraca null przy braku sieci. */
async function callServer(path: string, token: string): Promise<{ valid: boolean; error?: string; devices?: number } | null> {
  const base = licenseUrl();
  if (!base) return null;
  try {
    // Twardy limit czasu — bez tego wiszący serwer licencji zamroziłby aktywację/start.
    const res = await fetchTimeout(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: token, device: deviceId(), platform: platformName() }),
    }, 7000);
    return await res.json().catch(() => null);
  } catch {
    return null; // serwer nieosiągalny/timeout — obsługa zależna od trybu (offline grace / strict)
  }
}

/**
 * Aktywacja kluczem (z ekranu LicenseGate). Najpierw lokalny podpis (anty-podróbka),
 * potem rejestracja na serwerze (limit urządzeń, unieważnienie). W trybie strict
 * wymaga odpowiedzi serwera; inaczej dopuszcza offline przy ważnym podpisie.
 */
export async function activateLicense(token: string): Promise<LicenseInfo> {
  const local = await verifyLicense(token);
  if (!local.valid) return local;
  if (!licenseUrl()) return local; // tryb offline — sam podpis
  const server = await callServer("/v1/license/activate", token);
  if (server === null) {
    // brak sieci: strict blokuje, zwykły tryb dopuszcza (podpis jest ważny)
    return licenseStrict() ? { valid: false, name: local.name } : local;
  }
  return server.valid ? { ...local, valid: true } : { valid: false, name: local.name };
}

/**
 * Sprawdzenie aktywacji przy starcie. Weryfikuje podpis lokalnie; jeśli serwer jest
 * skonfigurowany, robi heartbeat (aktualizuje „kto korzysta") i respektuje zdalne
 * unieważnienie. Strict wymaga potwierdzenia serwera; inaczej działa offline.
 */
export async function checkActivation(): Promise<LicenseInfo> {
  if (!licenseRequired()) return { valid: true, type: "open" };
  const token = storedLicense();
  if (!token) return { valid: false };
  const local = await verifyLicense(token);
  if (!local.valid) return local;
  if (!licenseUrl()) return local;
  const server = await callServer("/v1/license/check", token);
  if (server === null) return licenseStrict() ? { valid: false } : local; // offline grace
  if (!server.valid) {
    clearLicense(); // unieważniona zdalnie — wymuś ponowną aktywację
    return { valid: false, name: local.name };
  }
  return local;
}
