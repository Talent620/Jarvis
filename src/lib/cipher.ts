// Szyfrowanie tekstu klasy wojskowej — AES-256-GCM + PBKDF2.
// W pełni offline, w przeglądarce (Web Crypto). Bez backendu, bez wycieku.
//
// Format „JV2:": salt(16) + iter(uint32 BE) + iv(12) + ciphertext. Liczba iteracji
// jest ZAPISANA w blobie, więc można ją w przyszłości podnosić bez brickowania
// istniejących sejfów/kopii. Stare „JV1:" (i bez prefiksu) czytamy przy 150k iter.
const enc = new TextEncoder();
const dec = new TextDecoder();

const ITERATIONS = 210000; // dla NOWYCH szyfrowań (zgodne z lock.ts); stare bloby: 150000
const LEGACY_ITERATIONS = 150000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveKey(pass: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bs(enc.encode(pass)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(plain: string, pass: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(enc.encode(plain))));
  const out = new Uint8Array(16 + 4 + 12 + ct.length);
  out.set(salt, 0);
  new DataView(out.buffer).setUint32(16, ITERATIONS, false); // iter (BE) w nagłówku
  out.set(iv, 20);
  out.set(ct, 32);
  return "JV2:" + toB64(out);
}

export async function decryptText(payload: string, pass: string): Promise<string> {
  if (payload.startsWith("JV2:")) {
    const data = fromB64(payload.slice(4));
    if (data.length < 33) throw new Error("Nieprawidłowe dane.");
    const salt = data.slice(0, 16);
    const iter = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16, false);
    const iv = data.slice(20, 32);
    const ct = data.slice(32);
    const key = await deriveKey(pass, salt, iter);
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ct)));
  }
  // Legacy „JV1:" / bez prefiksu — 150k iteracji, układ salt(16)+iv(12)+ct.
  const b64 = payload.startsWith("JV1:") ? payload.slice(4) : payload;
  const data = fromB64(b64);
  if (data.length < 29) throw new Error("Nieprawidłowe dane.");
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ct = data.slice(28);
  const key = await deriveKey(pass, salt, LEGACY_ITERATIONS);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ct));
  return dec.decode(pt);
}
