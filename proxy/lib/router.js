// === proxy/lib/router.js — główny router żądań HTTP Workera JARVIS BFF ===
import { CORS, json } from "./auth.js";
import { handleIntegrationRoute } from "./integrations.js";
import { handleLicenseAdminRoute } from "./licenseAdmin.js";
import { handleProviderRoute } from "./providers.js";

export async function routeRequest(req, env) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  try {
    if (path === "" || path === "/v1/health") {
      return json(200, {
        ok: true,
        service: "jarvis-bff",
        kv: !!env.JARVIS_KV,
        features: {
          modal: !!env.MODAL_BRAIN_URL,
          modalVoice: !!env.MODAL_VOICE_URL,
          search: !!env.TAVILY_API_KEY,
          embed: !!env.GEMINI_API_KEY,
          google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        },
      });
    }

    const integrationRes = await handleIntegrationRoute(path, url, req, env);
    if (integrationRes) return integrationRes;

    const licenseRes = await handleLicenseAdminRoute(path, req, env);
    if (licenseRes) return licenseRes;

    const providerRes = await handleProviderRoute(path, url, req, env);
    if (providerRes) return providerRes;

    return json(404, { error: "Nieznana trasa." });
  } catch (e) {
    console.error("[worker]", e);
    return json(500, { error: "Wewnętrzny błąd serwera." });
  }
}
