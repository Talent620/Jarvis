// JARVIS backend-proxy (Cloudflare Worker).
//
// Po co: niektórzy dostawcy (NVIDIA NIM, GitHub Models, część Home Assistant)
// blokują zapytania z przeglądarki przez CORS. Ten proxy je przekazuje z
// poprawnymi nagłówkami CORS, a jeśli ustawisz sekrety środowiskowe — chowa
// klucze API po stronie serwera (klient nie musi ich znać).
//
// W ustawieniach aplikacji wpisz adres proxy, np.: https://twoj-worker.workers.dev
//
// Obsługiwane trasy (zgodne z klientem JARVIS):
//   POST /anthropic              -> api.anthropic.com/v1/messages
//   POST /openai?u=<url>         -> dowolny endpoint zgodny z OpenAI (z białej listy)
//   POST /gemini?model=<model>   -> generativelanguage.googleapis.com
//   POST /passthrough?u=<url>    -> dowolny URL (np. Twój Home Assistant)
//
// Opcjonalne sekrety (Workers → Settings → Variables):
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY,
//   OPENROUTER_API_KEY, NVIDIA_API_KEY, GITHUB_MODELS_TOKEN

const ALLOWED_OPENAI_HOSTS = [
  "api.groq.com",
  "openrouter.ai",
  "integrate.api.nvidia.com",
  "models.github.ai",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
  "Access-Control-Max-Age": "86400",
};

function envKeyForHost(host, env) {
  if (host.includes("groq.com")) return env.GROQ_API_KEY;
  if (host.includes("openrouter.ai")) return env.OPENROUTER_API_KEY;
  if (host.includes("nvidia.com")) return env.NVIDIA_API_KEY;
  if (host.includes("github.ai")) return env.GITHUB_MODELS_TOKEN;
  return undefined;
}

async function relay(target, req, headers) {
  const upstream = await fetch(target, {
    method: "POST",
    headers,
    body: await req.text(),
  });
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
      if (path.endsWith("/anthropic")) {
        const h = {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": env.ANTHROPIC_API_KEY || req.headers.get("x-api-key") || "",
        };
        return relay("https://api.anthropic.com/v1/messages", req, h);
      }

      if (path.endsWith("/gemini")) {
        const model = url.searchParams.get("model");
        const key = env.GEMINI_API_KEY;
        if (!model || !key) return json(400, { error: "Brak modelu lub GEMINI_API_KEY w proxy." });
        const target = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        return relay(target, req, { "content-type": "application/json" });
      }

      if (path.endsWith("/openai")) {
        const u = url.searchParams.get("u");
        if (!u) return json(400, { error: "Brak parametru u." });
        const host = new URL(u).host;
        if (!ALLOWED_OPENAI_HOSTS.some((h) => host.includes(h)))
          return json(403, { error: `Host niedozwolony: ${host}` });
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

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
