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


export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "");

    try {
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
        const vectors = [];
        for (const t of texts || []) {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${env.GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
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
          messages.push({ from: h("From"), subject: h("Subject"), date: h("Date"), snippet: msg.snippet || "" });
        }
        return json(200, { messages });
      }
      if (path === "/v1/gmail/send" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { to, subject, body } = await req.json();
        const raw = b64url(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`);
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        return json(r.ok ? 200 : 502, r.ok ? { ok: true } : { error: "Nie udało się wysłać." });
      }

      // --- GOOGLE CALENDAR ---
      if (path === "/v1/gcal/list" && req.method === "POST") {
        const at = await googleAccessToken(env, bearer(req));
        if (!at) return json(401, { error: "Google niepołączone." });
        const { max = 10 } = await req.json();
        const d = await (
          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${max}&singleEvents=true&orderBy=startTime&timeMin=${new Date().toISOString()}`,
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

      // --- PROXY KLUCZY ---
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
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
          req,
          { "content-type": "application/json" },
        );
      }
      if (path.endsWith("/openai")) {
        const u = url.searchParams.get("u");
        if (!u) return json(400, { error: "Brak parametru u." });
        const host = new URL(u).host;
        if (!ALLOWED_OPENAI_HOSTS.some((h) => host.includes(h))) return json(403, { error: `Host niedozwolony: ${host}` });
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
      return json(500, { error: String(e) });
    }
  },
};
