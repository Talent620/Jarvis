// === Parowanie telefon↔EXE: podpis HMAC żądań (Project Horizon) ===
// Problem: gdy węzeł EXE wyjdzie kiedyś poza loopback (LAN), sam token w nagłówku jest
// podsłuchiwalny i podatny na replay. Rozwiązanie: KAŻDE żądanie podpisane HMAC-SHA-256
// z sekretu parowania + znacznik czasu + jednorazowy nonce. Sekret ustala się RAZ przez
// QR (EXE pokazuje, telefon skanuje) i nigdy nie leci w żądaniu.
//
// Ten moduł jest CZYSTY i współdzielony: ten sam kod liczy podpis po stronie klienta
// (TS/przeglądarka) i mógłby po stronie EXE (Node) — jedno źródło prawdy, zero rozjazdu.
// Web Crypto (crypto.subtle) jest w Chrome 79 (S9) i w Node ≥ 15, więc S9-safe.
//
// UCZCIWOŚĆ: to warstwa bezpieczeństwa transportu. Sam podpis nie zastępuje TLS przy
// realnym LAN — zabezpiecza integralność i replay, nie poufność treści.

/** Kanoniczna reprezentacja żądania do podpisu — identyczna po obu stronach. */
export interface SignableRequest {
  method: string; // "POST"
  path: string; // "/"
  body: string; // surowy JSON (dokładnie ten wysłany)
  timestamp: number; // epoch ms
  nonce: string; // losowy, jednorazowy
}

/** Nagłówki podpisu doklejane do żądania HTTP. */
export interface SignatureHeaders {
  "x-horizon-ts": string;
  "x-horizon-nonce": string;
  "x-horizon-sig": string;
}

/** Maksymalny dopuszczalny dryf zegara (5 min) — starsze żądania = odrzut (anty-replay). */
export const MAX_SKEW_MS = 5 * 60_000;

/** Kanoniczny string do podpisu — kolejność pól jest częścią kontraktu. */
export function canonicalString(req: SignableRequest): string {
  return [req.method.toUpperCase(), req.path, String(req.timestamp), req.nonce, req.body].join("\n");
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA-256(secret, canonicalString) → hex. Web Crypto (klient i Node). */
export async function signRequest(secret: string, req: SignableRequest): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(canonicalString(req)));
  return hex(sig);
}

/** Porównanie w stałym czasie (anty-timing). Czyste. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Zweryfikuj podpis żądania. Zwraca powód odrzucenia albo null (OK).
 * `seenNonce` to zależność (zbiór już użytych nonce'ów) — replay tego samego nonce
 * w oknie czasu jest odrzucany. Weryfikator NIE mutuje seenNonce; zapis nonce należy
 * do wywołującego PO sukcesie (żeby nieudana weryfikacja nie „spalała" nonce).
 */
export async function verifyRequest(
  secret: string,
  req: SignableRequest,
  provided: string,
  now: number,
  seenNonce: (nonce: string) => boolean,
): Promise<string | null> {
  if (!secret) return "brak sekretu parowania";
  if (!req.nonce) return "brak nonce";
  if (!Number.isFinite(req.timestamp)) return "brak/zły znacznik czasu";
  if (Math.abs(now - req.timestamp) > MAX_SKEW_MS) return "znacznik czasu poza oknem (replay?)";
  if (seenNonce(req.nonce)) return "nonce już użyty (replay)";
  const expected = await signRequest(secret, req);
  if (!timingSafeEqual(expected, provided)) return "zły podpis";
  return null;
}

/** Wygeneruj nagłówki podpisu dla klienta (telefon → EXE). */
export async function makeSignatureHeaders(
  secret: string,
  method: string,
  path: string,
  body: string,
  now: number,
  nonce: string,
): Promise<SignatureHeaders> {
  const req: SignableRequest = { method, path, body, timestamp: now, nonce };
  const sig = await signRequest(secret, req);
  return { "x-horizon-ts": String(now), "x-horizon-nonce": nonce, "x-horizon-sig": sig };
}

/** Losowy nonce (16 bajtów hex). Web Crypto — dostępne na S9 i w Node. */
export function freshNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Ładunek QR parowania: EXE pokazuje, telefon skanuje. Zawiera adres węzła i sekret
 * (jednorazowo, kanałem wizualnym — nie przez sieć). Wersjonowany na wypadek zmian.
 */
export interface PairingPayload {
  v: 1;
  url: string; // np. "http://192.168.1.50:4318/"
  secret: string; // sekret HMAC (hex)
  name?: string; // przyjazna nazwa komputera
}

/** Zbuduj tekst QR (kompaktowy JSON). Czysty. */
export function encodePairingPayload(p: PairingPayload): string {
  return JSON.stringify({ v: 1, url: p.url, secret: p.secret, name: p.name || "" });
}

/** Sparsuj i zwaliduj ładunek QR. Zwraca payload albo null (śmieci/zła wersja). */
export function decodePairingPayload(text: string): PairingPayload | null {
  try {
    const o = JSON.parse(text);
    if (o && o.v === 1 && typeof o.url === "string" && typeof o.secret === "string" && o.secret.length >= 16) {
      // Adres musi być http(s) z hostem — zero „javascript:" itp.
      const u = new URL(o.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return { v: 1, url: o.url, secret: o.secret, name: typeof o.name === "string" ? o.name : "" };
    }
  } catch {
    /* nie-JSON / zły URL */
  }
  return null;
}
