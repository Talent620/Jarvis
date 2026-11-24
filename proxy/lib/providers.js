// === proxy/lib/providers.js — proxy dostawców AI (Anthropic, Gemini, OpenAI, Modal Brain, Passthrough) ===
import { CORS, json, bearer, appTokenBad, rateLimited, blocksCloudMetadata, passthroughAllowed, fetchT } from "./auth.js";
import { applyVoiceModeToOpenAiBody } from "./voiceProtocol.js";

export const ALLOWED_OPENAI_HOSTS = [
  "api.groq.com",
  "openrouter.ai",
  "integrate.api.nvidia.com",
  "models.github.ai",
  "api.cohere.ai",
  "api.cerebras.ai",
  "api.mistral.ai",
  "modal.run",
];

// Normalizacja adresu Modal Brain do pełnego endpointu /v1/chat/completions.
export const normalizeModalUrl = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const clean = withScheme.replace(/\/+$/, "");
  if (/\/v1\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
};

// Ścisłe dopasowanie hosta do białej listy: dokładny host LUB jego subdomena.
export const openaiHostAllowed = (hostname) =>
  ALLOWED_OPENAI_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));

export function envKeyForHost(host, env) {
  const h = String(host || "").toLowerCase();
  if (h.includes("groq.com")) return env.GROQ_API_KEY;
  if (h.includes("openrouter.ai")) return env.OPENROUTER_API_KEY;
  if (h.includes("nvidia.com")) return env.NVIDIA_API_KEY;
  if (h.includes("github.ai")) return env.GITHUB_MODELS_TOKEN;
  if (h === "api.cerebras.ai") return env.CEREBRAS_API_KEY;
  if (h === "api.mistral.ai") return env.MISTRAL_API_KEY;
  if (h === "api.cohere.ai") return env.COHERE_API_KEY;
  if (h === "modal.run" || h.endsWith(".modal.run")) {
    // Bezpieczeństwo: gdy MODAL_BRAIN_URL jest ustawione, wstrzykuj klucz TYLKO dla tego hosta.
    if (env.MODAL_BRAIN_URL) {
      try {
        if (new URL(normalizeModalUrl(env.MODAL_BRAIN_URL)).hostname.toLowerCase() !== h) return undefined;
      } catch {
        return undefined;
      }
    }
    return env.MODAL_API_KEY || env.VLLM_API_KEY;
  }
  return undefined;
}

function safeParseUrl(raw) {
  try {
    return new URL(String(raw || ""));
  } catch {
    return null;
  }
}

export async function relay(target, req, headers, opts = {}) {
  const rawBody = await req.text();
  const body = opts.openaiVoiceMode
    ? applyVoiceModeToOpenAiBody(rawBody, req.headers.get("x-voice-mode") === "1")
    : rawBody;
  let upstream;
  try {
    upstream = await fetchT(target, { method: "POST", headers, body }, opts.timeoutMs || 90000);
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || /abort|timeout/i.test(String(e.message || e)));
    return json(isAbort ? 504 : 502, {
      error: isAbort
        ? "Przekroczono czas odpowiedzi serwera AI (możliwy cold-start Modal — spróbuj za chwilę)."
        : "Nie udało się połączyć z dostawcą AI (błąd sieci upstream).",
    });
  }
  const out = new Headers(upstream.headers);
  Object.entries(CORS).forEach(([k, v]) => out.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function handleProviderRoute(path, url, req, env) {
  const isProxyRoute =
    path.endsWith("/anthropic") ||
    path.endsWith("/gemini") ||
    path.endsWith("/openai") ||
    path.endsWith("/modal") ||
    path.endsWith("/modal-voice/stt") ||
    path.endsWith("/modal-voice/tts") ||
    path.endsWith("/passthrough");

  if (!isProxyRoute) return null;

  if (appTokenBad(req, env)) {
    return json(401, { error: "Brak lub zły token aplikacji (x-app-token)." });
  }
  if (await rateLimited(req, env)) {
    return json(429, { error: "Za dużo żądań w tej chwili — spróbuj ponownie za moment." });
  }

  if (path.endsWith("/modal-voice/stt") || path.endsWith("/modal-voice/tts")) {
    const base = String(env.MODAL_VOICE_URL || "").trim().replace(/\/+$/, "");
    if (!base) return json(500, { error: "Brak MODAL_VOICE_URL w konfiguracji Workera." });
    const parsed = safeParseUrl(/^https?:\/\//i.test(base) ? base : `https://${base}`);
    if (!parsed) return json(500, { error: "Niepoprawny MODAL_VOICE_URL w konfiguracji Workera." });
    if (!openaiHostAllowed(parsed.hostname.toLowerCase())) {
      return json(403, { error: `Host niedozwolony: ${parsed.hostname}` });
    }
    const key = env.MODAL_API_KEY || env.VLLM_API_KEY || bearer(req);
    const suffix = path.endsWith("/stt") ? `/v1/stt${url.search}` : "/v1/tts";
    let upstream;
    try {
      upstream = await fetchT(
        `${parsed.origin}${suffix}`,
        {
          method: "POST",
          headers: {
            "content-type": req.headers.get("content-type") || "application/json",
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: req.body,
        },
        90000,
      );
    } catch (e) {
      const isAbort = e && (e.name === "AbortError" || /abort|timeout/i.test(String(e.message || e)));
      return json(isAbort ? 504 : 502, { error: isAbort ? "Timeout serwera Modal Voice." : "Błąd połączenia z Modal Voice." });
    }
    const out = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([k, v]) => out.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  if (path.endsWith("/modal")) {
    const target = normalizeModalUrl(env.MODAL_BRAIN_URL);
    if (!target) return json(500, { error: "Brak MODAL_BRAIN_URL w konfiguracji Workera." });
    const parsed = safeParseUrl(target);
    if (!parsed) return json(500, { error: "Niepoprawny MODAL_BRAIN_URL w konfiguracji Workera." });
    const hostname = parsed.hostname.toLowerCase();
    if (!openaiHostAllowed(hostname)) return json(403, { error: `Host niedozwolony: ${hostname}` });
    const key = env.MODAL_API_KEY || env.VLLM_API_KEY || bearer(req);
    if (!key) return json(401, { error: "Brak klucza API dla Modal Brain (MODAL_API_KEY / VLLM_API_KEY)." });
    return relay(target, req, { "content-type": "application/json", authorization: `Bearer ${key}` }, { openaiVoiceMode: true });
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
    const parsed = safeParseUrl(u);
    if (!parsed) return json(400, { error: "Niepoprawny URL w parametrze u." });
    const host = parsed.host;
    const hostname = parsed.hostname.toLowerCase();
    if (!openaiHostAllowed(hostname)) return json(403, { error: `Host niedozwolony: ${host}` });
    const key = envKeyForHost(host, env) || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    return relay(u, req, { "content-type": "application/json", authorization: `Bearer ${key}` }, { openaiVoiceMode: true });
  }

  if (path.endsWith("/passthrough")) {
    const u = url.searchParams.get("u");
    if (!u) return json(400, { error: "Brak parametru u." });
    const parsed = safeParseUrl(u);
    if (!parsed) return json(400, { error: "Niepoprawny URL w parametrze u." });
    if (blocksCloudMetadata(u)) return json(403, { error: "Adres niedozwolony." });
    if (!passthroughAllowed(parsed.hostname, env.PASSTHROUGH_HOSTS)) {
      return json(403, { error: `Host niedozwolony: ${parsed.host}` });
    }
    const h = { "content-type": "application/json" };
    const auth = req.headers.get("authorization");
    if (auth) h.authorization = auth;
    return relay(u, req, h);
  }

  return null;
}
