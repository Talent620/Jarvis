// === proxy/lib/auth.js — bezpieczeństwo, CORS, autoryzacja, SSRF i kryptografia licencji ===

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, x-api-key, x-app-token, x-admin-token, anthropic-version, anthropic-dangerous-direct-browser-access",
  "Access-Control-Max-Age": "86400",
};

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

// Base64 dla UTF-8 (MIME-word) oraz base64url.
export const b64 = (s) => btoa(unescape(encodeURIComponent(String(s))));
export const b64url = (str) =>
  btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Usuń CR/LF z wartości trafiających do linii protokołu/nagłówków (anty-injection SMTP/MIME).
export const noCRLF = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

// fetch z twardym limitem czasu — wiszący upstream nie blokuje invocation workera.
export const fetchT = (url, opts = {}, ms = 20000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });

export function bearer(req) {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

// Token aplikacji niepoprawny?
// Domyślny (zgodny wstecz): egzekwuje gdy APP_TOKEN ustawiony.
// Fail-closed (REQUIRE_APP_TOKEN=1): wymaga poprawnego tokenu ZAWSZE.
const truthy = (v) => v === "1" || v === "true" || v === true;
export const appTokenBad = (req, env) => {
  const failClosed = truthy(env.REQUIRE_APP_TOKEN);
  if (failClosed && !env.APP_TOKEN) return true;
  if (!env.APP_TOKEN) return false;
  return req.headers.get("x-app-token") !== env.APP_TOKEN;
};

export const adminOk = (req, env) => !!env.ADMIN_TOKEN && req.headers.get("x-admin-token") === env.ADMIN_TOKEN;

// Opt-in allowlista /passthrough (CSV). Puste = zgodność wstecz (wciąż blokada metadanych chmury).
export const passthroughAllowed = (hostname, allowEnv) => {
  const list = String(allowEnv || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const h = String(hostname || "").toLowerCase();
  return list.some((a) => h === a || h.endsWith(`.${a}`));
};

// Blokada SSRF do metadanych chmury (AWS/GCP/Azure/Alibaba IMDS).
export function blocksCloudMetadata(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === "metadata.google.internal" ||
      host === "100.100.100.200" ||
      /^169\.254\./.test(host) ||
      host === "[fd00:ec2::254]" ||
      host === "fd00:ec2::254"
    );
  } catch {
    return true;
  }
}

// Ściślejsza blokada SSRF dla endpointów pobierających publiczny URL (audyt/PageSpeed).
export function isPrivateHost(rawUrl) {
  try {
    const h = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0") return true;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^169\.254\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(h)) return true;
    if (/^(fe80:|fc|fd)/.test(h) || h === "::1") return true;
    return false;
  } catch {
    return true;
  }
}

// Zgrubny rate-limit per IP (gdy ustawiono RATE_LIMIT_PER_MIN i jest KV).
export async function rateLimited(req, env) {
  const lim = parseInt(env.RATE_LIMIT_PER_MIN || "0", 10);
  if (!lim || !env.JARVIS_KV) return false;
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.JARVIS_KV.get(key)) || "0", 10) + 1;
  await env.JARVIS_KV.put(key, String(n), { expirationTtl: 70 });
  return n > lim;
}

// ===== Kryptografia licencji (ECDSA P-256) =====
// Klucz publiczny MUSI być zgodny z src/lib/license.ts (PUBLIC_JWK).
export const LICENSE_PUBLIC_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "cr_zxxKQMLPKsuGybJtd05h_z-m0H_xnhS7WiYtEmdU",
  y: "a1Xl4CHImK2EAIXg19PVIFuagNCa4PQ2zatk4gysxzg",
};

export function b64urlToBytesW(s) {
  const b64Str = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64Str);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function bytesToB64urlW(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const licPubKey = () =>
  crypto.subtle.importKey("jwk", LICENSE_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

export const licPrivKey = (env) =>
  env.LICENSE_PRIVATE_JWK
    ? crypto.subtle.importKey("jwk", JSON.parse(env.LICENSE_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
    : null;

export async function verifyToken(token) {
  try {
    const [data, sig] = String(token || "").trim().split(".");
    if (!data || !sig) return null;
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await licPubKey(),
      b64urlToBytesW(sig),
      new TextEncoder().encode(data),
    );
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlToBytesW(data)));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

export async function signToken(payload, priv) {
  const data = bytesToB64urlW(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, new TextEncoder().encode(data));
  return data + "." + bytesToB64urlW(sig);
}
