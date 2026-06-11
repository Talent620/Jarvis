// === Aktywacja licencją (ochrona własności) ===
// Klucz licencyjny to podpisany (ECDSA P-256) token. Tylko właściciel — kluczem
// PRYWATNYM — potrafi wygenerować ważny klucz; aplikacja weryfikuje go kluczem
// PUBLICZNYM (poniżej, bezpiecznym do umieszczenia w kodzie). Dzięki temu kopia
// programu bez ważnego klucza się nie aktywuje, a kluczy nie da się podrobić.
//
// Generowanie kluczy dla kupujących: scripts/license.mjs (wymaga klucza prywatnego,
// który NIE jest w repozytorium).

const PUBLIC_JWK: JsonWebKey = {
  kty: "EC",
  crv: "P-256",
  x: "t9urffSCbUds8y0eFhP3pnPcQUfCdV3InW9XBh6brj4",
  y: "sztIfFUb_CvnVDivA0LLWFmnKqGlrkZVtEDVdOaUlK0",
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

/** Zweryfikuj klucz licencyjny (podpis + ewentualny termin ważności). */
export async function verifyLicense(token: string): Promise<LicenseInfo> {
  try {
    const [data, sigB64] = (token || "").trim().split(".");
    if (!data || !sigB64) return { valid: false };
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await publicKey(),
      bs(b64urlToBytes(sigB64)),
      bs(new TextEncoder().encode(data)),
    );
    if (!ok) return { valid: false };
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(data))) as { n?: string; t?: string; exp?: number };
    if (payload.exp && Date.now() > payload.exp) return { valid: false }; // licencja wygasła
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

/** Czy aplikacja jest aktywowana (lub aktywacja niewymagana). Zwraca też dane licencji. */
export async function checkActivation(): Promise<LicenseInfo> {
  if (!licenseRequired()) return { valid: true, type: "open" };
  const token = storedLicense();
  if (!token) return { valid: false };
  return verifyLicense(token);
}
