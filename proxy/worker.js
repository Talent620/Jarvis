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
