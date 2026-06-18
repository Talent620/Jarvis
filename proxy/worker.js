// JARVIS BFF — Cloudflare Worker.
//
// Pełni trzy role:
//  1) PROXY KLUCZY/CORS dla dostawców AI (NVIDIA/GitHub blokują CORS; ukrycie kluczy).
//  2) RESEARCH + EMBEDDINGS (Tavily/Gemini) za serwerem — klient nie zna kluczy.
//  3) SYNCHRONIZACJA danych użytkownika (Cloudflare KV) między urządzeniami.
//
// Trasy:
//   POST /anthropic                  → api.anthropic.com/v1/messages
//   POST /openai?u=<url>             → endpoint zgodny z OpenAI (biała lista)
//   POST /gemini?model=<model>       → generativelanguage (klucz z env)
//   POST /passthrough?u=<url>        → dowolny URL (np. Home Assistant)
//   POST /v1/search   {query}        → Tavily (klucz z env) → {results, citations}
//   POST /v1/embed    {texts[]}      → Gemini embeddings → {vectors}
//   GET/POST /v1/sync (Bearer token) → odczyt/zapis blobu danych (KV)
//
// Sekrety (Workers → Settings → Variables): ANTHROPIC_API_KEY, GEMINI_API_KEY,
//   GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, GITHUB_MODELS_TOKEN, TAVILY_API_KEY
// Binding KV: JARVIS_KV (patrz wrangler.toml).

const ALLOWED_OPENAI_HOSTS = ["api.groq.com", "openrouter.ai", "integrate.api.nvidia.com", "models.github.ai"];

// Base64 dla UTF-8 (MIME-word). Moduł-globalne, bo używane też poza smtpRelay (np. /v1/gmail/send).
const b64 = (s) => btoa(unescape(encodeURIComponent(String(s))));

// Usuń CR/LF z wartości trafiających do linii protokołu/nagłówków (anty-injection SMTP/MIME).
const noCRLF = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

// fetch z twardym limitem czasu — wiszący upstream nie blokuje invocation workera.
const fetchT = (url, opts = {}, ms = 20000) => fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });


// Przekaźnik SMTP (telefon wysyła „w tle" hasłem aplikacji, bez Google OAuth).
// Logika lustrzana do electron/smtp.cjs, ale na gniazdach Cloudflare Workers.
import { connect } from "cloudflare:sockets";

async function smtpRelay({ host, port, user, pass, to, subject, body, verifyOnly }) {
  const HOST = String(host || "smtp.gmail.com");
  const PORT = Number(port) || 465;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (s) => btoa(unescape(encodeURIComponent(String(s))));
  const fail = (error) => ({ ok: false, error });

  let socket, writer, reader, buf = "";
  try {
    socket = connect({ hostname: HOST, port: PORT }, { secureTransport: "on", allowHalfOpen: false });
    writer = socket.writable.getWriter();
    reader = socket.readable.getReader();
  } catch (e) {
    return fail(`Nie udało się połączyć z serwerem poczty: ${e?.message || e}`);
  }
  const close = async () => { try { await writer.close(); } catch { /* ignore */ } try { await reader.cancel(); } catch { /* ignore */ } };
  const readResp = async () => {
    for (let i = 0; i < 60; i++) {
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) { buf = ""; return last; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    const lines = buf.split(/\r?\n/).filter(Boolean);
    buf = "";
    return lines[lines.length - 1] || "";
  };
  const send = (s) => writer.write(enc.encode(s + "\r\n"));
  const authErr = "Logowanie odrzucone — sprawdź adres i HASŁO APLIKACJI (nie zwykłe hasło Gmaila).";

  try {
    let r = await readResp(); if (!/^220/.test(r)) return fail(`Serwer: ${r.slice(0, 120)}`);
    await send("EHLO jarvis.worker"); r = await readResp(); if (!/^250/.test(r)) return fail(`EHLO: ${r.slice(0, 120)}`);
    await send("AUTH LOGIN"); r = await readResp(); if (!/^334/.test(r)) return fail(`AUTH: ${r.slice(0, 120)}`);
    await send(b64(user)); r = await readResp(); if (!/^334/.test(r)) return fail(`Login: ${r.slice(0, 120)}`);
    await send(b64(pass)); r = await readResp(); if (!/^235/.test(r)) return fail(authErr);
    if (verifyOnly) { await send("QUIT"); await close(); return { ok: true }; }
    const sUser = noCRLF(user), sTo = noCRLF(to); // anty-injection: bez CR/LF w liniach protokołu
    await send(`MAIL FROM:<${sUser}>`); r = await readResp(); if (!/^250/.test(r)) return fail(`MAIL FROM: ${r.slice(0, 120)}`);
    await send(`RCPT TO:<${sTo}>`); r = await readResp(); if (!/^250/.test(r)) return fail(`RCPT TO: ${r.slice(0, 120)}`);
    await send("DATA"); r = await readResp(); if (!/^354/.test(r)) return fail(`DATA: ${r.slice(0, 120)}`);
    const bodyB64 = b64(body).replace(/(.{76})/g, "$1\r\n");
    const data = [
      `From: <${sUser}>`, `To: <${sTo}>`,
      `Subject: =?UTF-8?B?${b64(noCRLF(subject))}?=`,
      "MIME-Version: 1.0", 'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64", "", bodyB64, ".",
    ].join("\r\n");
    await send(data); r = await readResp(); if (!/^250/.test(r)) return fail(`Wysyłka: ${r.slice(0, 120)}`);
    await send("QUIT"); await close();
    return { ok: true };
  } catch (e) {
    await close();
    return fail(`Błąd SMTP: ${e?.message || e}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
  "Access-Control-Max-Age": "86400",
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

function envKeyForHost(host, env) {
  if (host.includes("groq.com")) return env.GROQ_API_KEY;
  if (host.includes("openrouter.ai")) return env.OPENROUTER_API_KEY;
  if (host.includes("nvidia.com")) return env.NVIDIA_API_KEY;
  if (host.includes("github.ai")) return env.GITHUB_MODELS_TOKEN;
  return undefined;
}

async function relay(target, req, headers) {
  const upstream = await fetch(target, { method: "POST", headers, body: await req.text() });
  const out = new Headers(upstream.headers);
  Object.entries(CORS).forEach(([k, v]) => out.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

// Zgrubny rate-limit per IP (gdy ustawiono RATE_LIMIT_PER_MIN i jest KV). Workers KV nie
// jest atomowe — to ochrona anty-abuse/kosztowa, nie twarda granica. Puste = wyłączone.
async function rateLimited(req, env) {
  const lim = parseInt(env.RATE_LIMIT_PER_MIN || "0", 10);
  if (!lim || !env.JARVIS_KV) return false;
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = parseInt((await env.JARVIS_KV.get(key)) || "0", 10) + 1;
  await env.JARVIS_KV.put(key, String(n), { expirationTtl: 70 });
  return n > lim;
}

// --- Google OAuth (Gmail + Calendar) ---
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

function bearer(req) {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

async function googleAccessToken(env, token) {
  if (!env.JARVIS_KV) return null;
  const rec = await env.JARVIS_KV.get(`google:${token}`);
  if (!rec) return null;
  const { refresh_token } = JSON.parse(rec);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  return d.access_token || null;
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ===== LICENCJE (ECDSA P-256) + PANEL ADMINA + „kto korzysta" =====
// Klucz publiczny MUSI być zgodny z src/lib/license.ts (PUBLIC_JWK). Klucz
// prywatny do WYDAWANIA licencji to sekret Workera (LICENSE_PRIVATE_JWK).
const LICENSE_PUBLIC_JWK = {
  kty: "EC", crv: "P-256",
  x: "yVt6bj1aOh50oDQOH8oKKEVJ2ETteQF9-N0UbSsiUFo",
  y: "YzRn5l1wri_mFT2SHV_jsbOegqbR9b3TtjJ-5vSHzfk",
};
function b64urlToBytesW(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64urlW(buf) {
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const licPubKey = () => crypto.subtle.importKey("jwk", LICENSE_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const licPrivKey = (env) => env.LICENSE_PRIVATE_JWK
  ? crypto.subtle.importKey("jwk", JSON.parse(env.LICENSE_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  : null;
async function verifyToken(token) {
  try {
    const [data, sig] = String(token || "").trim().split(".");
    if (!data || !sig) return null;
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await licPubKey(), b64urlToBytesW(sig), new TextEncoder().encode(data));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlToBytesW(data)));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
async function signToken(payload, priv) {
  const data = bytesToB64urlW(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, new TextEncoder().encode(data));
  return data + "." + bytesToB64urlW(sig);
}
const adminOk = (req, env) => !!env.ADMIN_TOKEN && req.headers.get("x-admin-token") === env.ADMIN_TOKEN;

// Panel administracyjny (jedno konto = ADMIN_TOKEN). Wydaje/unieważnia klucze,
// pokazuje kto korzysta (urządzenia + ostatnia aktywność).
const ADMIN_HTML = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>JARVIS — Panel licencji</title>
<style>
:root{--bg:#04070f;--p:#0b1426;--cy:#6ce7ff;--tx:#cfeefb;--dim:#7fa6bd;--line:rgba(108,231,255,.2);--ok:#58e08a;--bad:#ff8585}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,sans-serif;padding:18px}
h1{color:var(--cy);font-size:20px}h2{font-size:15px;margin:18px 0 8px}input,select,button{font:inherit;border-radius:10px;border:1px solid var(--line);background:#081020;color:var(--tx);padding:9px 12px}
button{cursor:pointer;background:var(--cy);color:#012;border:none;font-weight:600}button.gh{background:transparent;color:var(--cy);border:1px solid var(--line)}
.card{background:var(--p);border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line)}.k{font-family:monospace;font-size:11px;word-break:break-all}
.pill{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}.on{color:var(--ok)}.off{color:var(--bad)}.muted{color:var(--dim);font-size:12px}
</style></head><body>
<h1>🔐 JARVIS — Panel licencji</h1>
<div class="card" id="login">
  <div class="row"><input id="tok" type="password" placeholder="Token administratora" style="flex:1"><button onclick="login()">Zaloguj</button></div>
  <div class="muted" id="lerr"></div>
</div>
<div id="app" style="display:none">
  <div class="card"><h2>➕ Wydaj nowy klucz</h2>
    <div class="row">
      <input id="name" placeholder="Imię / firma klienta" style="flex:1">
      <input id="days" type="number" placeholder="Dni (puste = bezterminowy)" style="width:170px">
      <input id="lim" type="number" value="1" min="1" placeholder="Limit urządzeń" style="width:140px">
      <button onclick="issue()">Wygeneruj</button>
    </div>
    <div id="newkey" class="muted" style="margin-top:8px"></div>
  </div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📋 Licencje i kto korzysta</h2><button class="gh" onclick="load()">Odśwież</button></div>
    <table id="tbl"><thead><tr><th>Klient</th><th>Typ</th><th>Urządzenia</th><th>Ost. aktywność</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
  </div>
</div>
<script>
let T=sessionStorage.getItem("jat")||"";
const H=()=>({"x-admin-token":T,"content-type":"application/json"});
function login(){T=document.getElementById("tok").value.trim();sessionStorage.setItem("jat",T);load(true);}
async function load(first){
  const r=await fetch("v1/admin/list",{headers:H()});
  if(!r.ok){document.getElementById("lerr").textContent="❌ Zły token.";return;}
  document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";
  const {licenses}=await r.json();const tb=document.querySelector("#tbl tbody");tb.innerHTML="";
  for(const l of licenses){const tr=document.createElement("tr");
    const last=l.lastSeen?new Date(l.lastSeen).toLocaleString("pl-PL"):"—";
    tr.innerHTML=\`<td>\${l.name}</td><td>\${l.type}\${l.exp?" do "+new Date(l.exp).toLocaleDateString("pl-PL"):""}</td>
    <td>\${l.devices}/\${l.deviceLimit}</td><td class="muted">\${last}</td>
    <td><span class="pill \${l.revoked?'off':'on'}">\${l.revoked?'unieważniona':'aktywna'}</span></td>
    <td class="row"><button class="gh" onclick="rev('\${l.id}',\${!l.revoked})">\${l.revoked?'Przywróć':'Unieważnij'}</button>
    <button class="gh" onclick="resetDev('\${l.id}')">Reset urządzeń</button></td>\`;tb.appendChild(tr);}
}
async function issue(){
  const name=document.getElementById("name").value||"Klient";
  const days=document.getElementById("days").value;const lim=document.getElementById("lim").value||1;
  const r=await fetch("v1/admin/issue",{method:"POST",headers:H(),body:JSON.stringify({name,days:days?+days:0,deviceLimit:+lim})});
  const d=await r.json();
  document.getElementById("newkey").innerHTML=d.key?("✅ Klucz dla <b>"+name+"</b> (skopiuj i wyślij klientowi):<br><span class='k'>"+d.key+"</span>"):("❌ "+(d.error||"błąd"));
  load();
}
async function rev(id,v){await fetch("v1/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({id,revoked:v})});load();}
async function resetDev(id){if(confirm("Wyzerować urządzenia tej licencji?")){await fetch("v1/admin/reset-devices",{method:"POST",headers:H(),body:JSON.stringify({id})});load();}}
if(T)load(true);
</script></body></html>`;


export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "");

    try {
      // --- HEALTH (test połączenia z aplikacji) ---
      if (path === "" || path === "/v1/health") {
        return json(200, {
          ok: true,
          service: "jarvis-bff",
          kv: !!env.JARVIS_KV,
          features: {
            search: !!env.TAVILY_API_KEY,
            embed: !!env.GEMINI_API_KEY,
            google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          },
        });
      }

      // --- SYNC (KV) ---
      if (path === "/v1/sync") {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (!token) return json(401, { error: "Brak tokenu sync." });
        if (!env.JARVIS_KV) return json(500, { error: "Brak bindingu KV (JARVIS_KV)." });
        const key = `sync:${token}`;
        if (req.method === "GET") {
          const blob = await env.JARVIS_KV.get(key);
          return json(200, blob ? JSON.parse(blob) : { data: null, updatedAt: 0 });
        }
        if (req.method === "POST") {
          const body = await req.json();
          const existing = await env.JARVIS_KV.get(key);
          const prev = existing ? JSON.parse(existing) : { updatedAt: 0 };
          if ((body.updatedAt || 0) < (prev.updatedAt || 0)) {
            return json(409, { error: "Nowsza wersja na serwerze.", server: prev });
          }
          await env.JARVIS_KV.put(key, JSON.stringify({ data: body.data, updatedAt: body.updatedAt || Date.now() }));
          return json(200, { ok: true });
        }
      }

      // --- RESEARCH (Tavily) ---
      if (path === "/v1/search" && req.method === "POST") {
        if (!env.TAVILY_API_KEY) return json(500, { error: "Brak TAVILY_API_KEY." });
        const { query, max_results = 5 } = await req.json();
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results, include_answer: true, search_depth: "advanced" }),
        });
        const data = await r.json();
        const citations = (data.results || []).map((x) => ({ title: x.title || x.url, url: x.url }));
        return json(r.ok ? 200 : 502, { answer: data.answer, results: data.results, citations });
      }

      // --- EMBEDDINGS (Gemini) ---
      if (path === "/v1/embed" && req.method === "POST") {
        if (!env.GEMINI_API_KEY) return json(500, { error: "Brak GEMINI_API_KEY." });
        const { texts } = await req.json();
        const list = Array.isArray(texts) ? texts.slice(0, 64) : []; // cap fan-out (koszt/CPU)
        const vectors = [];
        for (const t of list) {
          const r = await fetchT(
            "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent",
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
              body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: t }] } }),
            },
          );
          const d = await r.json();
          vectors.push(d?.embedding?.values || []);
        }
        return json(200, { vectors });
      }

      // --- GOOGLE OAUTH ---
      if (path === "/v1/google/start") {
        const token = url.searchParams.get("token");
        if (!token) return json(400, { error: "Brak token." });
        const redirect = `${url.origin}/v1/google/callback`;
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID || "");
        auth.searchParams.set("redirect_uri", redirect);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("scope", GOOGLE_SCOPES);
        auth.searchParams.set("access_type", "offline");
        auth.searchParams.set("prompt", "consent");
        auth.searchParams.set("state", token);
        return Response.redirect(auth.toString(), 302);
      }
      if (path === "/v1/google/callback") {
        const code = url.searchParams.get("code");
        const token = url.searchParams.get("state");
        if (!code || !token) return new Response("Brak code/state.", { status: 400 });
        const redirect = `${url.origin}/v1/google/callback`;
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            redirect_uri: redirect,
            grant_type: "authorization_code",
          }),
        });
        const d = await r.json();
        if (!d.refresh_token) {
          return new Response("Brak refresh_token (odłącz aplikację w koncie Google i spróbuj ponownie).", { status: 400 });
        }
        await env.JARVIS_KV.put(`google:${token}`, JSON.stringify({ refresh_token: d.refresh_token }));
        return new Response(
          "<html><body style='background:#04070f;color:#6ce7ff;font-family:sans-serif;text-align:center;padding-top:60px'><h2>✅ Połączono z Google</h2><p>Możesz wrócić do JARVIS-a.</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      if (path === "/v1/google/status") {
        const token = bearer(req) || url.searchParams.get("token");
        const rec = env.JARVIS_KV && token ? await env.JARVIS_KV.get(`google:${token}`) : null;
        return json(200, { connected: !!rec });
      }

      // --- GMAIL ---
      if (path === "/v1/gmail/list" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { query = "", max = 10 } = await req.json();
        const list = await (
          await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
            { headers: { authorization: `Bearer ${at}` } },
          )
        ).json();
        const messages = [];
        for (const m of list.messages || []) {
          const msg = await (
            await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { authorization: `Bearer ${at}` } },
            )
          ).json();
          const h = (n) => (msg.payload?.headers || []).find((x) => x.name === n)?.value || "";
          messages.push({ id: m.id, threadId: msg.threadId || m.threadId, from: h("From"), subject: h("Subject"), date: h("Date"), snippet: msg.snippet || "" });
        }
        return json(200, { messages });
      }
      if (path === "/v1/gmail/get" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { id } = await req.json();
        if (!id) return json(400, { error: "Brak id wiadomości." });
        const msg = await (
          await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
            headers: { authorization: `Bearer ${at}` },
          })
        ).json();
        const h = (n) => (msg.payload?.headers || []).find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value || "";
        // Wyłuskaj treść text/plain (rekurencyjnie po częściach), z dekodowaniem base64url.
        const decode = (data) => { try { return decodeURIComponent(escape(atob(String(data).replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };
        const findPlain = (p) => {
          if (!p) return "";
          if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
          for (const part of p.parts || []) { const t = findPlain(part); if (t) return t; }
          return "";
        };
        // Wiele maili przychodzi WYŁĄCZNIE jako text/html — bez tego użytkownik widział
        // tylko 1-zdaniowy podgląd. Fallback: weź HTML i zdejmij tagi do czytelnego tekstu.
        const findHtml = (p) => {
          if (!p) return "";
          if (p.mimeType === "text/html" && p.body?.data) return decode(p.body.data);
          for (const part of p.parts || []) { const t = findHtml(part); if (t) return t; }
          return "";
        };
        let bodyText = findPlain(msg.payload);
        if (!bodyText && msg.payload?.body?.data) bodyText = decode(msg.payload.body.data);
        if (!bodyText) {
          const html = findHtml(msg.payload);
          if (html) {
            bodyText = html
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
              .replace(/<br\s*\/?>(?=)/gi, "\n")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
              .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          }
        }
        return json(200, {
          id: msg.id, threadId: msg.threadId,
          from: h("From"), to: h("To"), subject: h("Subject"), date: h("Date"),
          messageId: h("Message-ID"),
          body: (bodyText || msg.snippet || "").slice(0, 16000),
        });
      }
      if (path === "/v1/gmail/send" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { to, subject, body, threadId, inReplyTo } = await req.json();
        const sTo = noCRLF(to), sSubject = noCRLF(subject); // anty-injection nagłówków MIME
        // Temat z polskimi znakami musi być zakodowany jako MIME-word (=?UTF-8?B?…?=),
        // inaczej w skrzynce odbiorcy bywa krzaczasty.
        const subjHeader = /[^\x00-\x7F]/.test(sSubject)
          ? `=?UTF-8?B?${b64(sSubject)}?=`
          : sSubject;
        // Odpowiedź w wątku: dołącz nagłówki In-Reply-To/References + threadId.
        const headers = [`To: ${sTo}`, `Subject: ${subjHeader}`];
        if (inReplyTo) {
          // Message-ID musi być w nawiasach <…>, inaczej Gmail nie zawsze wpina w wątek.
          const mid = noCRLF(inReplyTo);
          const norm = /^<.*>$/.test(mid) ? mid : `<${mid}>`;
          headers.push(`In-Reply-To: ${norm}`, `References: ${norm}`);
        }
        headers.push('Content-Type: text/plain; charset=UTF-8', "", body);
        const raw = b64url(headers.join("\r\n"));
        const payload = threadId ? { raw, threadId } : { raw };
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: "Nie udało się wysłać." });
      }

      // --- SMTP RELAY (telefon: wysyłka hasłem aplikacji, bez Google OAuth) ---
      if (path === "/v1/smtp/send" && req.method === "POST") {
        if (!bearer(req)) return json(401, { error: "Brak tokenu synchronizacji." });
        const { host, port, user, pass, to, subject, body } = await req.json();
        if (!user || !pass) return json(400, { error: "Brak danych poczty (adres + hasło aplikacji)." });
        if (!to || !String(to).includes("@")) return json(400, { error: "Brak poprawnego adresu odbiorcy." });
        const r = await smtpRelay({ host, port, user, pass, to, subject: String(subject || ""), body: String(body || "") });
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error });
      }
      if (path === "/v1/smtp/verify" && req.method === "POST") {
        if (!bearer(req)) return json(401, { error: "Brak tokenu synchronizacji." });
        const { host, port, user, pass } = await req.json();
        if (!user || !pass) return json(400, { error: "Brak danych poczty (adres + hasło aplikacji)." });
        const r = await smtpRelay({ host, port, user, pass, verifyOnly: true });
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: r.error });
      }

      // --- GOOGLE CALENDAR ---
      if (path === "/v1/gcal/list" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { max = 10, timeMin, timeMax } = await req.json();
        const params = new URLSearchParams({
          maxResults: String(max), singleEvents: "true", orderBy: "startTime",
          timeMin: timeMin || new Date().toISOString(),
        });
        if (timeMax) params.set("timeMax", timeMax);
        const d = await (
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { authorization: `Bearer ${at}` } },
          )
        ).json();
        const events = (d.items || []).map((e) => ({
          summary: e.summary || "(bez tytułu)",
          start: e.start?.dateTime || e.start?.date,
          location: e.location || "",
        }));
        return json(200, { events });
      }
      if (path === "/v1/gcal/add" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { summary, start, end, location } = await req.json();
        const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify({
            summary,
            location,
            start: { dateTime: new Date(start).toISOString() },
            end: { dateTime: new Date(end || new Date(new Date(start).getTime() + 3600000)).toISOString() },
          }),
        });
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: "Nie udało się dodać wydarzenia." });
      }

      // ===== LICENCJE =====
      // Aktywacja: weryfikacja podpisu + rejestracja urządzenia + limit + unieważnienie.
      if (path === "/v1/license/activate" && req.method === "POST") {
        const { key, device, platform } = await req.json();
        const p = await verifyToken(key);
        if (!p) return json(403, { valid: false, error: "Nieprawidłowy lub wygasły klucz licencyjny." });
        if (!p.id || !env.JARVIS_KV) return json(200, { valid: true, name: p.n, type: p.t }); // master/legacy
        const raw = await env.JARVIS_KV.get(`lic:${p.id}`);
        const rec = raw ? JSON.parse(raw) : { id: p.id, name: p.n, type: p.t, exp: p.exp || 0, deviceLimit: 1, revoked: false, devices: [], createdAt: Date.now() };
        if (rec.revoked) return json(403, { valid: false, error: "Licencja została unieważniona przez autora." });
        const dev = String(device || "").slice(0, 64) || "unknown";
        const now = Date.now();
        const ex = rec.devices.find((d) => d.id === dev);
        if (ex) { ex.lastSeen = now; ex.platform = platform || ex.platform; }
        else {
          if (rec.devices.length >= (rec.deviceLimit || 1)) return json(403, { valid: false, error: `Przekroczono limit urządzeń (${rec.deviceLimit}). Skontaktuj się z autorem.` });
          rec.devices.push({ id: dev, platform: platform || "?", firstSeen: now, lastSeen: now });
        }
        rec.lastSeen = now;
        await env.JARVIS_KV.put(`lic:${p.id}`, JSON.stringify(rec));
        return json(200, { valid: true, name: rec.name, type: rec.type, deviceLimit: rec.deviceLimit, devices: rec.devices.length });
      }
      // Heartbeat / sprawdzenie (kto korzysta + zdalne unieważnienie). Aktualizuje lastSeen.
      if (path === "/v1/license/check" && req.method === "POST") {
        const { key, device, platform } = await req.json();
        const p = await verifyToken(key);
        if (!p) return json(200, { valid: false });
        if (!p.id || !env.JARVIS_KV) return json(200, { valid: true });
        const raw = await env.JARVIS_KV.get(`lic:${p.id}`);
        if (!raw) return json(200, { valid: true });
        const rec = JSON.parse(raw);
        if (rec.revoked) return json(200, { valid: false, error: "unieważniona" });
        const dev = String(device || "").slice(0, 64);
        const d = rec.devices.find((x) => x.id === dev);
        if (d) { d.lastSeen = Date.now(); d.platform = platform || d.platform; rec.lastSeen = Date.now(); await env.JARVIS_KV.put(`lic:${p.id}`, JSON.stringify(rec)); }
        return json(200, { valid: true });
      }

      // ===== ADMIN (jedno konto = ADMIN_TOKEN) =====
      if (path === "/admin") {
        return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
      }
      if (path === "/v1/admin/issue" && req.method === "POST") {
        if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień administratora." });
        const priv = await licPrivKey(env);
        if (!priv) return json(500, { error: "Brak sekretu LICENSE_PRIVATE_JWK w Workerze." });
        const { name, days, deviceLimit } = await req.json();
        const id = bytesToB64urlW(crypto.getRandomValues(new Uint8Array(6)));
        const payload = { n: String(name || "Klient"), t: days ? "term" : "perpetual", id, iat: Date.now() };
        if (days) payload.exp = Date.now() + Number(days) * 86400000;
        const key = await signToken(payload, priv);
        const rec = { id, name: payload.n, type: payload.t, exp: payload.exp || 0, deviceLimit: Number(deviceLimit) || 1, revoked: false, devices: [], createdAt: Date.now() };
        if (env.JARVIS_KV) await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
        return json(200, { ok: true, key, ...rec });
      }
      if (path === "/v1/admin/list" && req.method === "GET") {
        if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
        if (!env.JARVIS_KV) return json(200, { licenses: [] });
        const list = await env.JARVIS_KV.list({ prefix: "lic:" });
        const out = [];
        for (const k of list.keys) { const v = await env.JARVIS_KV.get(k.name); if (v) out.push(JSON.parse(v)); }
        out.sort((a, b) => (b.lastSeen || b.createdAt || 0) - (a.lastSeen || a.createdAt || 0));
        return json(200, { licenses: out.map((r) => ({ id: r.id, name: r.name, type: r.type, exp: r.exp, deviceLimit: r.deviceLimit, devices: (r.devices || []).length, lastSeen: r.lastSeen || 0, revoked: r.revoked })) });
      }
      if (path === "/v1/admin/revoke" && req.method === "POST") {
        if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
        const { id, revoked = true } = await req.json();
        const raw = env.JARVIS_KV ? await env.JARVIS_KV.get(`lic:${id}`) : null;
        if (!raw) return json(404, { error: "Nie ma takiej licencji." });
        const rec = JSON.parse(raw); rec.revoked = !!revoked;
        await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
        return json(200, { ok: true, revoked: rec.revoked });
      }
      if (path === "/v1/admin/reset-devices" && req.method === "POST") {
        if (!adminOk(req, env)) return json(401, { error: "Brak uprawnień." });
        const { id } = await req.json();
        const raw = env.JARVIS_KV ? await env.JARVIS_KV.get(`lic:${id}`) : null;
        if (!raw) return json(404, { error: "Nie ma takiej licencji." });
        const rec = JSON.parse(raw); rec.devices = [];
        await env.JARVIS_KV.put(`lic:${id}`, JSON.stringify(rec));
        return json(200, { ok: true });
      }

      // --- PROXY KLUCZY ---
      // Bramka tras proxy: (1) opcjonalny token aplikacji (origin bywa podrabialny, token nie),
      // (2) opcjonalny rate-limit anty-abuse/kosztowy. Obie env-gated (puste = bez zmian).
      const isProxyRoute =
        path.endsWith("/anthropic") || path.endsWith("/gemini") || path.endsWith("/openai") || path.endsWith("/passthrough");
      if (isProxyRoute) {
        if (env.APP_TOKEN && req.headers.get("x-app-token") !== env.APP_TOKEN) {
          return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
        }
        if (await rateLimited(req, env)) {
          return json(429, { error: "Za dużo żądań w tej chwili — spróbuj ponownie za moment." });
        }
      }
      if (path.endsWith("/anthropic")) {
        return relay("https://api.anthropic.com/v1/messages", req, {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": env.ANTHROPIC_API_KEY || req.headers.get("x-api-key") || "",
        });
      }
      if (path.endsWith("/gemini")) {
        const model = url.searchParams.get("model");
        if (!model || !env.GEMINI_API_KEY) return json(400, { error: "Brak modelu lub GEMINI_API_KEY." });
        return relay(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          req,
          { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        );
      }
      if (path.endsWith("/openai")) {
        const u = url.searchParams.get("u");
        if (!u) return json(400, { error: "Brak parametru u." });
        const host = new URL(u).host;
        const hostname = new URL(u).hostname.toLowerCase();
        // Ścisłe dopasowanie: dokładny host lub jego subdomena. `includes` przepuszczał
        // np. api.groq.com.attacker.tld i wyciekłby klucz Bearer dostawcy.
        if (!ALLOWED_OPENAI_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) return json(403, { error: `Host niedozwolony: ${host}` });
        const key = envKeyForHost(host, env) || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        return relay(u, req, { "content-type": "application/json", authorization: `Bearer ${key}` });
      }
      if (path.endsWith("/passthrough")) {
        const u = url.searchParams.get("u");
        if (!u) return json(400, { error: "Brak parametru u." });
        const h = { "content-type": "application/json" };
        const auth = req.headers.get("authorization");
        if (auth) h.authorization = auth;
        return relay(u, req, h);
      }

      return json(404, { error: "Nieznana trasa." });
    } catch (e) {
      console.error("[worker]", e); // szczegóły do logów serwera, nie do klienta
      return json(500, { error: "Wewnętrzny błąd serwera." });
    }
  },
};
