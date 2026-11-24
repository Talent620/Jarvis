// JARVIS BFF — Cloudflare Worker (modularny punkt wejścia).
//
// Moduły w proxy/lib/:
//  • auth.js         — CORS, tokeny, rate-limit, SSRF guards, kryptografia licencji ECDSA
//  • providers.js    — proxy kluczy/CORS AI (Anthropic, Gemini, OpenAI-compatible, Modal Brain)
//  • integrations.js — Sync KV, Tavily, Site Audit, PageSpeed, Embeddings, Google/Gmail/SMTP/GCal
//  • licenseAdmin.js — aktywacja/heartbeat licencji + panel /admin
//  • cron.js         — proaktywne wyzwalacze Cron (poranny briefing sterowany zdarzeniami)
//  • router.js       — główny dispatcher tras HTTP
//
// Pełna kompatybilność wstecz: wszystkie dotychczasowe eksporty nazwane są re-eksportowane poniżej.

export {
  appTokenBad,
  blocksCloudMetadata,
  isPrivateHost,
  noCRLF,
  passthroughAllowed,
} from "./lib/auth.js";

export {
  ALLOWED_OPENAI_HOSTS,
  envKeyForHost,
  normalizeModalUrl,
  openaiHostAllowed,
} from "./lib/providers.js";

import { routeRequest } from "./lib/router.js";
import { handleScheduled } from "./lib/cron.js";

export default {
  async fetch(req, env) {
    return routeRequest(req, env);
  },
  async scheduled(event, env, ctx) {
    const job = handleScheduled(event, env);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
    return job;
  },
};
