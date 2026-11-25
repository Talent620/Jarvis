/**
 * JARVIS FORGE — Universal Free-First & Local-Aware Provider Mesh.
 *
 * Architektura bez vendor lock-in:
 * - 14 dostawców w jednym katalogu z ścisłą 4-klasową taksonomią kosztów:
 *   `local` (0 USD, offline) | `free_api` (0 USD, limity RPM/RPD/TPM) |
 *   `promo_credit` (kredyty czasowe/miesięczne — wyłączone w zero_cost) | `paid` (blokowane w zero_cost).
 * - Domyślna polityka `zero_cost` GWARANTUJE 0 USD wydatków:
 *   * dopuszcza wyłącznie `local` i `free_api`,
 *   * dla OpenRoutera TWARDO wymusza sufiks `:free` na ID modelu,
 *   * blokuje Modal ($30 kredytów GPU), Hugging Face ($0.10) oraz Anthropic.
 * - Hardware Profiler (`detectHardwareProfile`) sprawdza CPU, RAM, GPU/VRAM i lokalną Ollamę
 *   (`/api/tags`) i dobiera optymalny podział Local ↔ Free Cloud pod konkretny sprzęt.
 * - Dynamiczny Router Ról (`selectCandidatesForRole`) przydziela różne modele do ról
 *   (`architect`, `developer`, `debugger`, `reviewer`), uwzględnia zdrowie (`429 Retry-After`),
 *   realną skuteczność z `ExperienceMemory` i preferuje INNEGO dostawcę do `reviewer` (cross-model review!).
 * - Wymienialność: `registerCustomProvider()` pozwala podpiąć dowolny nowy model/serwer bez zmian silnika.
 */
import os from "node:os";
import { execFileSync } from "node:child_process";

/** @typedef {"local" | "free_api" | "promo_credit" | "paid"} CostTier */
/** @typedef {"architect" | "developer" | "debugger" | "reviewer"} ForgeRole */

export const FORGE_PROVIDERS = {
  ollama: {
    id: "ollama",
    label: "Ollama (Lokalny CPU/GPU)",
    costTier: "local",
    protocol: "ollama",
    endpoint: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
    envKeys: [],
    requiresKey: false,
    limitsNote: "Bez limitów API, 0 USD, 100% prywatne i offline.",
    privacyNote: "Dane nigdy nie opuszczają urządzenia.",
    contextChars: 24_000,
    roleModels: {
      architect: "qwen3:8b",
      developer: "qwen2.5-coder:7b",
      debugger: "qwen2.5-coder:7b",
      reviewer: "qwen3:8b",
    },
    rolePriority: { architect: 72, developer: 78, debugger: 76, reviewer: 72 },
  },
  gemini: {
    id: "gemini",
    label: "Google AI Studio (Gemini Free)",
    costTier: "free_api",
    protocol: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    requiresKey: true,
    limitsNote: "~10–15 RPM, 250–1500 RPD (Flash / Flash-Lite), reset północ PT, bez karty.",
    privacyNote: "W darmowym tierze Google może używać promptów do ulepszania usług — Forge redaguje sekrety.",
    contextChars: 120_000,
    roleModels: {
      architect: "gemini-2.5-flash",
      developer: "gemini-2.5-flash",
      debugger: "gemini-2.5-flash",
      reviewer: "gemini-2.5-flash",
    },
    rolePriority: { architect: 96, developer: 90, debugger: 92, reviewer: 94 },
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras Inference (Free ~2000 tok/s)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    envKeys: ["CEREBRAS_API_KEY"],
    requiresKey: true,
    limitsNote: "~1M tokenów/dzień, 5–30 RPM, ekstremalna szybkość, bez karty.",
    privacyNote: "API chmurowe; nie wysyłać sekretów.",
    contextChars: 48_000,
    roleModels: {
      architect: "qwen-3-32b",
      developer: "qwen-3-32b",
      debugger: "llama-3.3-70b",
      reviewer: "llama-3.3-70b",
    },
    rolePriority: { architect: 86, developer: 93, debugger: 90, reviewer: 85 },
  },
  groq: {
    id: "groq",
    label: "Groq Cloud (Free Fast LPU)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    envKeys: ["GROQ_API_KEY"],
    requiresKey: true,
    limitsNote: "30 RPM, ~1000 RPD, ciasne ~8K TPM / 200K TPD — idealne z kompaktowaną Repo Map.",
    privacyNote: "API chmurowe; bez karty.",
    contextChars: 18_000, // celowo mniejsze okno pod 8K TPM!
    roleModels: {
      architect: "moonshotai/kimi-k2-instruct",
      developer: "moonshotai/kimi-k2-instruct",
      debugger: "llama-3.3-70b-versatile",
      reviewer: "llama-3.3-70b-versatile",
    },
    rolePriority: { architect: 82, developer: 88, debugger: 86, reviewer: 82 },
  },
  mistral: {
    id: "mistral",
    label: "Mistral La Plateforme (Experiment Free)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    envKeys: ["MISTRAL_API_KEY"],
    requiresKey: true,
    limitsNote: "Plan Experiment: ~1 req/s, wysoki limit miesięczny, bez karty (wymaga weryfikacji tel.).",
    privacyNote: "Przetwarzanie w UE dostępne; plan Experiment może używać danych do ulepszania.",
    contextChars: 64_000,
    roleModels: {
      architect: "mistral-large-latest",
      developer: "codestral-latest",
      debugger: "mistral-large-latest",
      reviewer: "mistral-small-latest",
    },
    rolePriority: { architect: 88, developer: 91, debugger: 88, reviewer: 87 },
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM (Developer Free)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    envKeys: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
    requiresKey: true,
    limitsNote: "Darmowy katalog Developer Program (~40 RPM), wymaga weryfikacji tel.",
    privacyNote: "Do prototypowania i rozwoju.",
    contextChars: 48_000,
    roleModels: {
      architect: "deepseek-ai/deepseek-r1",
      developer: "qwen/qwen2.5-coder-32b-instruct",
      debugger: "qwen/qwen2.5-coder-32b-instruct",
      reviewer: "meta/llama-3.3-70b-instruct",
    },
    rolePriority: { architect: 85, developer: 92, debugger: 91, reviewer: 84 },
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (:free only)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: { "HTTP-Referer": "https://jarvis.app", "X-Title": "JARVIS Forge" },
    envKeys: ["OPENROUTER_API_KEY"],
    requiresKey: true,
    requireFreeSuffixInZeroCost: true,
    limitsNote: "20 RPM, 50 RPD (1000 RPD po doładowaniu $10). W zero_cost TYLKO modele `:free`!",
    privacyNote: "Zależy od upstream dostawcy modelu `:free`.",
    contextChars: 48_000,
    roleModels: {
      architect: "deepseek/deepseek-chat-v3-0324:free",
      developer: "qwen/qwen-2.5-coder-32b-instruct:free",
      debugger: "deepseek/deepseek-chat-v3-0324:free",
      reviewer: "meta-llama/llama-3.3-70b-instruct:free",
    },
    rolePriority: { architect: 84, developer: 86, debugger: 85, reviewer: 86 },
  },
  github: {
    id: "github",
    label: "GitHub Models (Free Dev Tier)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://models.github.ai/inference/chat/completions",
    envKeys: ["GITHUB_MODELS_TOKEN", "GITHUB_TOKEN"],
    requiresKey: true,
    limitsNote: "10–15 RPM, 50–150 RPD (zależnie od klasy modelu), konto GitHub, bez karty.",
    privacyNote: "Limit dzienny jest mały — używać priorytetowo do Architect/Reviewer.",
    contextChars: 48_000,
    roleModels: {
      architect: "openai/gpt-4.1-mini",
      developer: "openai/gpt-4.1-mini",
      debugger: "openai/gpt-4.1-mini",
      reviewer: "openai/gpt-4.1-mini",
    },
    rolePriority: { architect: 87, developer: 80, debugger: 82, reviewer: 90 },
  },
  sambanova: {
    id: "sambanova",
    label: "SambaNova Cloud (Free Tier)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://api.sambanova.ai/v1/chat/completions",
    envKeys: ["SAMBANOVA_API_KEY"],
    requiresKey: true,
    limitsNote: "Darmowy tier OpenAI-compat z limitami RPM/RPD, szybkie Qwen/Llama, bez karty.",
    privacyNote: "API chmurowe.",
    contextChars: 32_000,
    roleModels: {
      architect: "Meta-Llama-3.3-70B-Instruct",
      developer: "Qwen2.5-Coder-32B-Instruct",
      debugger: "Meta-Llama-3.3-70B-Instruct",
      reviewer: "Meta-Llama-3.3-70B-Instruct",
    },
    rolePriority: { architect: 80, developer: 87, debugger: 84, reviewer: 80 },
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI (10K Neurons/dzień)",
    costTier: "free_api",
    protocol: "cloudflare",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions",
    envKeys: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
    accountEnvKeys: ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"],
    requiresKey: true,
    limitsNote: "10 000 Neurons/dzień (reset 00:00 UTC). Wymaga Workers Free (na Paid nalicza powyżej 10K!).",
    privacyNote: "Wymaga CF_ACCOUNT_ID + CF_API_TOKEN.",
    contextChars: 24_000,
    roleModels: {
      architect: "@cf/qwen/qwen2.5-coder-32b-instruct",
      developer: "@cf/qwen/qwen2.5-coder-32b-instruct",
      debugger: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      reviewer: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    },
    rolePriority: { architect: 74, developer: 77, debugger: 76, reviewer: 75 },
  },
  cohere: {
    id: "cohere",
    label: "Cohere (Trial 1000/mies.)",
    costTier: "free_api",
    protocol: "openai",
    endpoint: "https://api.cohere.ai/compatibility/v1/chat/completions",
    envKeys: ["COHERE_API_KEY"],
    requiresKey: true,
    limitsNote: "20 RPM, 1000 wywołań/mies., bez karty.",
    privacyNote: "Klucz Trial — używać jako rezerwa.",
    contextChars: 48_000,
    roleModels: {
      architect: "command-a-03-2025",
      developer: "command-a-03-2025",
      debugger: "command-r-plus-08-2024",
      reviewer: "command-a-03-2025",
    },
    rolePriority: { architect: 75, developer: 70, debugger: 72, reviewer: 78 },
  },
  huggingface: {
    id: "huggingface",
    label: "Hugging Face Inference ($0.10/mies.)",
    costTier: "promo_credit",
    protocol: "openai",
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    envKeys: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
    requiresKey: true,
    limitsNote: "Tylko $0.10/mies. kredytów dla darmowych kont — wyłączone w domyślnym zero_cost.",
    privacyNote: "Kredyt miesięczny — wymaga jawnej polityki allow_credits.",
    contextChars: 32_000,
    roleModels: {
      architect: "Qwen/Qwen2.5-Coder-32B-Instruct",
      developer: "Qwen/Qwen2.5-Coder-32B-Instruct",
      debugger: "Qwen/Qwen2.5-Coder-32B-Instruct",
      reviewer: "Qwen/Qwen2.5-Coder-32B-Instruct",
    },
    rolePriority: { architect: 60, developer: 65, debugger: 62, reviewer: 60 },
  },
  modal: {
    id: "modal",
    label: "Modal Serverless GPU ($30/mies. kredyty)",
    costTier: "promo_credit",
    protocol: "openai",
    endpoint: process.env.MODAL_BRAIN_URL || "",
    envKeys: ["MODAL_BRAIN_KEY"],
    requiresKey: true,
    limitsNote: "Kredyty $30/mies. (ryzyko naliczenia po limicie + cold start >20 s) — wyłączone w zero_cost.",
    privacyNote: "Własny serverless vLLM; nigdy nie wybudzany automatycznie bez zgody.",
    contextChars: 32_000,
    roleModels: {
      architect: "Qwen/Qwen3-32B-AWQ",
      developer: "Qwen/Qwen3-32B-AWQ",
      debugger: "Qwen/Qwen3-32B-AWQ",
      reviewer: "Qwen/Qwen3-32B-AWQ",
    },
    rolePriority: { architect: 89, developer: 89, debugger: 89, reviewer: 89 },
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude (Płatne)",
    costTier: "paid",
    protocol: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    envKeys: ["ANTHROPIC_API_KEY"],
    requiresKey: true,
    limitsNote: "Płatne za token — twardo ZABLOKOWANE w trybie zero_cost.",
    privacyNote: "Wymaga jawnej zgody costPolicy=allow_paid.",
    contextChars: 140_000,
    roleModels: {
      architect: "claude-sonnet-4-6",
      developer: "claude-sonnet-4-6",
      debugger: "claude-sonnet-4-6",
      reviewer: "claude-sonnet-4-6",
    },
    rolePriority: { architect: 100, developer: 100, debugger: 100, reviewer: 100 },
  },
};

/** Wykryj rzeczywiste zasoby sprzętowe (CPU, RAM, GPU/VRAM) i zarekomenduj profil lokalnych modeli. */
export function detectHardwareProfile() {
  const cpuCores = os.cpus()?.length || 1;
  const totalRamGb = Number((os.totalmem() / (1024 ** 3)).toFixed(1));
  const freeRamGb = Number((os.freemem() / (1024 ** 3)).toFixed(1));

  let gpu = null;
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500,
    }).trim();
    if (out) {
      const [name, vramMb] = out.split(/\r?\n/)[0].split(",").map((s) => s.trim());
      gpu = { name, vramGb: Number((Number(vramMb || 0) / 1024).toFixed(1)) };
    }
  } catch { /* brak nvidia-smi / GPU */ }

  let tier = "cpu_light";
  let recommendedOllamaModels = ["qwen2.5-coder:3b", "qwen3:1.7b"];
  let localStrategy = "CPU bez GPU: używaj lokalnej Ollamy do lekkiej kompakcji/prostych poprawek, a cięższe kodowanie kieruj do puli free_api.";

  if (gpu && gpu.vramGb >= 20) {
    tier = "gpu_pro";
    recommendedOllamaModels = ["qwen3-coder:30b", "qwen2.5-coder:32b", "qwen3:14b"];
    localStrategy = `GPU ${gpu.vramGb} GB VRAM: pełne lokalne kodowanie i debugowanie bez limitów API, darmowa chmura jako niezależny Reviewer.`;
  } else if (gpu && gpu.vramGb >= 10) {
    tier = "gpu_mid";
    recommendedOllamaModels = ["qwen2.5-coder:14b", "qwen2.5-coder:7b", "qwen3:8b"];
    localStrategy = `GPU ${gpu.vramGb} GB VRAM: lokalny Developer (7B–14B Q4) + darmowa chmura dla trudnego planowania i recenzji.`;
  } else if (gpu && gpu.vramGb >= 4) {
    tier = "gpu_entry";
    recommendedOllamaModels = ["qwen2.5-coder:3b", "qwen3:4b"];
    localStrategy = `GPU ${gpu.vramGb} GB VRAM: szybki lokalny Refleks (3B–4B Q4) + darmowa chmura (Gemini/Cerebras/Groq/Mistral) dla głównych zadań.`;
  } else if (totalRamGb >= 24) {
    tier = "cpu_heavy";
    recommendedOllamaModels = ["qwen2.5-coder:7b", "qwen3:4b"];
    localStrategy = `CPU + ${totalRamGb} GB RAM: modele 4B–7B Q4 użyteczne lokalnie do prostych zmian; do dużych refaktorów preferuj darmowe API.`;
  }

  return {
    platform: process.platform,
    arch: process.arch,
    cpuCores,
    totalRamGb,
    freeRamGb,
    gpu,
    tier,
    recommendedOllamaModels,
    localStrategy,
  };
}

/** Wybierz najlepszy zainstalowany lokalnie model Ollama dla danej roli (lub fallback). */
export function pickBestLocalOllamaModel(installedModels, role, hardware) {
  const list = (installedModels || []).map((m) => String(m || "")).filter(Boolean);
  if (!list.length) return null;
  const prefs = role === "developer" || role === "debugger"
    ? [/qwen3[-.]?coder/i, /qwen2\.5-coder/i, /codestral/i, /deepseek-coder/i, /devstral/i, /qwen3/i, /llama3/i]
    : [/qwen3/i, /deepseek-r1/i, /phi4/i, /qwen2\.5-coder/i, /gemma3/i, /llama3/i];

  // Na słabszym sprzęcie (<=8GB RAM bez GPU) unikaj wielkich modeli 30B+, jeśli dostępny jest mniejszy
  const avoidHuge = !hardware?.gpu && (hardware?.totalRamGb || 8) <= 10;
  const filtered = avoidHuge ? list.filter((m) => !/:(?:27b|30b|32b|70b|72b)\b/i.test(m)) : list;
  const pool = filtered.length ? filtered : list;

  for (const re of prefs) {
    const hit = pool.find((m) => re.test(m));
    if (hit) return hit;
  }
  return pool[0];
}

/** Czy dany dostawca + model są dozwolone w wybranej polityce kosztowej? */
export function isAllowedByCostPolicy(providerSpec, modelId, costPolicy = "zero_cost") {
  if (!providerSpec) return { ok: false, reason: "Nieznany dostawca." };
  const tier = providerSpec.costTier;
  if (costPolicy === "local_only") {
    return tier === "local" ? { ok: true } : { ok: false, reason: "Polityka local_only dopuszcza wyłącznie modele lokalne." };
  }
  if (costPolicy === "zero_cost") {
    if (tier !== "local" && tier !== "free_api") {
      return { ok: false, reason: `Dostawca ${providerSpec.id} ma klasę kosztu "${tier}" — zablokowany w trybie zero_cost (0 USD).` };
    }
    if (providerSpec.requireFreeSuffixInZeroCost && !/:free$/i.test(String(modelId || ""))) {
      return { ok: false, reason: `OpenRouter w trybie zero_cost dopuszcza wyłącznie modele z sufiksem ":free" (otrzymano "${modelId}").` };
    }
    return { ok: true };
  }
  if (costPolicy === "allow_credits") {
    if (tier === "paid") return { ok: false, reason: `Dostawca ${providerSpec.id} jest płatny (wymaga allow_paid).` };
    return { ok: true };
  }
  return { ok: true };
}

function parseRetryAfterMs(headerVal) {
  if (!headerVal) return 60_000;
  const sec = Number(headerVal);
  if (Number.isFinite(sec) && sec > 0) return Math.min(15 * 60_000, Math.round(sec * 1000));
  const at = Date.parse(headerVal);
  if (Number.isFinite(at) && at > Date.now()) return Math.min(15 * 60_000, at - Date.now());
  return 60_000;
}

/** Znormalizuj odpowiedź OpenAI-compatible do kontraktu Forge { content, toolCalls, usage }. */
function parseOpenAiResponse(data) {
  const msg = data?.choices?.[0]?.message || {};
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc, i) => {
        let parsedArgs = {};
        const rawArgs = tc?.function?.arguments;
        if (typeof rawArgs === "string") {
          try { parsedArgs = JSON.parse(rawArgs); } catch { parsedArgs = { _raw: rawArgs }; }
        } else if (rawArgs && typeof rawArgs === "object") {
          parsedArgs = rawArgs;
        }
        return {
          id: tc.id || `tc_${i + 1}`,
          name: tc?.function?.name || "",
          arguments: parsedArgs,
        };
      }).filter((t) => t.name)
    : [];
  return {
    content: typeof msg.content === "string" ? msg.content : "",
    toolCalls,
    usage: {
      inputTokens: Number(data?.usage?.prompt_tokens || 0),
      outputTokens: Number(data?.usage?.completion_tokens || 0),
    },
  };
}

/** Wywołanie protokołu OpenAI-compatible (Cerebras, Groq, Mistral, OpenRouter, NVIDIA, GitHub, SambaNova, Cohere, Cloudflare, Modal, HF). */
async function callOpenAiProtocol({ endpoint, apiKey, model, system, messages, tools, extraHeaders = {}, timeoutMs = 90_000, signal }) {
  const oaiMessages = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      oaiMessages.push({ role: "tool", tool_call_id: m.toolCallId || "call_1", content: String(m.content ?? "") });
    } else if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      oaiMessages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });
    } else {
      oaiMessages.push({ role: m.role, content: String(m.content ?? "") });
    }
  }

  const body = {
    model,
    messages: oaiMessages,
    temperature: 0.15,
    max_tokens: 4096,
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  signal?.addEventListener("abort", onExtAbort, { once: true });

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error(`${data?.error?.message || data?.message || "Błąd API"} (${res.status})`);
      err.status = res.status;
      err.retryAfter = res.headers.get("retry-after") || undefined;
      throw err;
    }
    return parseOpenAiResponse(data);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExtAbort);
  }
}

/** Wywołanie natywnego API Google Gemini (AI Studio) z obsługą functionDeclarations. */
async function callGeminiProtocol({ endpoint, apiKey, model, system, messages, tools, timeoutMs = 90_000, signal }) {
  const contents = [];
  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: String(m.content ?? "") }] });
    } else if (m.role === "assistant") {
      const parts = [];
      if (m.content) parts.push({ text: String(m.content) });
      for (const tc of m.toolCalls || []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments || {} } });
      }
      if (parts.length) contents.push({ role: "model", parts });
    } else if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: m.toolName || "tool",
            response: { output: String(m.content ?? "") },
          },
        }],
      });
    }
  }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.15, maxOutputTokens: 4096 },
  };
  if (tools && tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];
  }

  const url = `${endpoint.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  signal?.addEventListener("abort", onExtAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error(`${data?.error?.message || "Błąd Gemini API"} (${res.status})`);
      err.status = res.status;
      err.retryAfter = res.headers.get("retry-after") || undefined;
      throw err;
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    let content = "";
    const toolCalls = [];
    for (const part of parts) {
      if (typeof part.text === "string") content += part.text;
      if (part.functionCall?.name) {
        toolCalls.push({
          id: `gem_${toolCalls.length + 1}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }
    return {
      content,
      toolCalls,
      usage: {
        inputTokens: Number(data?.usageMetadata?.promptTokenCount || 0),
        outputTokens: Number(data?.usageMetadata?.candidatesTokenCount || 0),
      },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExtAbort);
  }
}

/** Wywołanie natywnego API Ollama (`/api/chat`) z natywnymi narzędziami. */
async function callOllamaProtocol({ endpoint, model, system, messages, tools, timeoutMs = 120_000, signal }) {
  const base = String(endpoint || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ollMessages = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      ollMessages.push({ role: "tool", content: String(m.content ?? "") });
    } else if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      ollMessages.push({
        role: "assistant",
        content: m.content || "",
        tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments || {} } })),
      });
    } else {
      ollMessages.push({ role: m.role, content: String(m.content ?? "") });
    }
  }

  const body = {
    model,
    stream: false,
    messages: ollMessages,
    options: { temperature: 0.15, num_ctx: 8192 },
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  signal?.addEventListener("abort", onExtAbort, { once: true });

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error(`${data?.error || "Błąd Ollama"} (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const msg = data.message || {};
    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc, i) => ({
          id: `oll_${i + 1}`,
          name: tc?.function?.name || "",
          arguments: tc?.function?.arguments || {},
        })).filter((t) => t.name)
      : [];
    return {
      content: typeof msg.content === "string" ? msg.content : "",
      toolCalls,
      usage: {
        inputTokens: Number(data.prompt_eval_count || 0),
        outputTokens: Number(data.eval_count || 0),
      },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExtAbort);
  }
}

/** Wywołanie natywnego API Anthropic (wyłącznie gdy jawnie włączono `allow_paid`). */
async function callAnthropicProtocol({ endpoint, apiKey, model, system, messages, tools, timeoutMs = 90_000, signal }) {
  const anthMessages = [];
  for (const m of messages) {
    if (m.role === "user") {
      anthMessages.push({ role: "user", content: String(m.content ?? "") });
    } else if (m.role === "assistant") {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: String(m.content) });
      for (const tc of m.toolCalls || []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments || {} });
      }
      if (blocks.length) anthMessages.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      anthMessages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId || "tc_1", content: String(m.content ?? "") }],
      });
    }
  }

  const body = {
    model,
    system,
    max_tokens: 4096,
    temperature: 0.15,
    messages: anthMessages,
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  signal?.addEventListener("abort", onExtAbort, { once: true });

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const err = new Error(`${data?.error?.message || "Błąd Anthropic API"} (${res.status})`);
      err.status = res.status;
      err.retryAfter = res.headers.get("retry-after") || undefined;
      throw err;
    }
    let content = "";
    const toolCalls = [];
    for (const b of data.content || []) {
      if (b.type === "text") content += b.text || "";
      if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, arguments: b.input || {} });
    }
    return {
      content,
      toolCalls,
      usage: {
        inputTokens: Number(data?.usage?.input_tokens || 0),
        outputTokens: Number(data?.usage?.output_tokens || 0),
      },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExtAbort);
  }
}

/**
 * Utwórz zarządzaną pulę dostawców (Provider Pool) z możliwością:
 * - wstrzykiwania kluczy per uruchomienie (z UI Jarvisa lub env) bez zapisu na dysku,
 * - wykrywania żywej lokalnej Ollamy (`/api/tags`),
 * - podpinania własnych/testowych adapterów (`registerCustomProvider`),
 * - uczenia się routingu z `ExperienceMemory` oraz cooldownów `429 Retry-After`.
 */
export function createProviderPool({ env = process.env, runtimeKeys = {}, ollamaUrl, memory = null, customProviders = {} } = {}) {
  const hardware = detectHardwareProfile();
  const registry = { ...FORGE_PROVIDERS, ...customProviders };
  const cooldownUntil = new Map(); // providerId -> timestamp
  const authBlocked = new Set();
  let ollamaProbeCache = { checkedAt: 0, online: false, models: [], url: ollamaUrl || env.OLLAMA_URL || "http://127.0.0.1:11434" };

  function resolveKey(spec, overrideKeys = {}) {
    if (!spec.requiresKey) return "local";
    const direct = overrideKeys?.[spec.id];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const init = runtimeKeys?.[spec.id];
    if (typeof init === "string" && init.trim()) return init.trim();
    for (const envName of spec.envKeys || []) {
      const v = env?.[envName];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function resolveEndpoint(spec, overrideKeys = {}) {
    if (spec.id === "ollama") {
      return (overrideKeys?.ollamaUrl || ollamaProbeCache.url || spec.endpoint).replace(/\/+$/, "");
    }
    if (spec.id === "cloudflare") {
      const acc = overrideKeys?.cloudflareAccountId
        || runtimeKeys?.cloudflareAccountId
        || (spec.accountEnvKeys || []).map((k) => env?.[k]).find((v) => typeof v === "string" && v.trim());
      if (!acc) return "";
      return spec.endpoint.replace("{accountId}", encodeURIComponent(acc.trim()));
    }
    if (spec.id === "modal") {
      return (overrideKeys?.modalUrl || runtimeKeys?.modalUrl || env?.MODAL_BRAIN_URL || spec.endpoint || "").trim();
    }
    return spec.endpoint;
  }

  async function probeOllama(force = false, customUrl) {
    const url = (customUrl || ollamaProbeCache.url || "http://127.0.0.1:11434").replace(/\/+$/, "");
    if (!force && Date.now() - ollamaProbeCache.checkedAt < 20_000 && ollamaProbeCache.url === url) {
      return ollamaProbeCache;
    }
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const models = Array.isArray(data?.models) ? data.models.map((m) => String(m.name || "")).filter(Boolean) : [];
      ollamaProbeCache = { checkedAt: Date.now(), online: true, models, url };
    } catch {
      ollamaProbeCache = { checkedAt: Date.now(), online: false, models: [], url };
    }
    return ollamaProbeCache;
  }

  /** Zwróć pełny, uczciwy status wszystkich dostawców (bez ujawniania kluczy!). */
  async function getProviderMatrix({ costPolicy = "zero_cost", overrideKeys = {}, probeLocal = true } = {}) {
    const ollamaState = probeLocal ? await probeOllama(false, overrideKeys?.ollamaUrl) : ollamaProbeCache;
    return Object.values(registry).map((spec) => {
      const key = resolveKey(spec, overrideKeys);
      const endpoint = resolveEndpoint(spec, overrideKeys);
      const defaultModel = spec.id === "ollama"
        ? (pickBestLocalOllamaModel(ollamaState.models, "developer", hardware) || spec.roleModels.developer)
        : spec.roleModels.developer;
      const policyCheck = isAllowedByCostPolicy(spec, defaultModel, costPolicy);
      const cooledMs = Math.max(0, (cooldownUntil.get(spec.id) || 0) - Date.now());

      let status = "ready";
      let statusReason = "Gotowy do pracy";
      if (spec.protocol === "custom") {
        status = "ready";
        statusReason = "Adapter niestandardowy (aktywny)";
      } else if (spec.id === "ollama") {
        if (!ollamaState.online) { status = "offline"; statusReason = `Ollama nieosiągalna pod ${ollamaState.url}`; }
        else if (!ollamaState.models.length) { status = "untested"; statusReason = "Ollama działa, ale brak zainstalowanych modeli (ollama pull qwen2.5-coder:3b)"; }
        else { status = "ready"; statusReason = `Lokalnie dostępnych modeli: ${ollamaState.models.length}`; }
      } else if (!key || !endpoint) {
        status = "not_configured";
        statusReason = !key ? `Brak klucza API (${(spec.envKeys || []).join(" / ") || "ustawienia"})` : "Brak adresu/Account ID";
      } else if (authBlocked.has(spec.id)) {
        status = "auth_error";
        statusReason = "Klucz odrzucony (401/403)";
      } else if (!policyCheck.ok) {
        status = "blocked_by_policy";
        statusReason = policyCheck.reason;
      } else if (cooledMs > 0) {
        status = "cooldown";
        statusReason = `Limit 429 — ponowna próba za ${Math.ceil(cooledMs / 1000)} s`;
      }

      const devScore = memory ? memory.getModelScore(spec.id, defaultModel, "developer") : null;
      return {
        id: spec.id,
        label: spec.label,
        costTier: spec.costTier,
        protocol: spec.protocol,
        status,
        statusReason,
        allowedInPolicy: policyCheck.ok,
        defaultModel,
        roleModels: spec.roleModels,
        contextChars: spec.contextChars,
        limitsNote: spec.limitsNote,
        privacyNote: spec.privacyNote,
        learnedScore: devScore,
        ...(spec.id === "ollama" ? { installedModels: ollamaState.models } : {}),
      };
    });
  }

  /** Posortuj dostępnych, dozwolonych i zdrowych kandydatów dla konkretnej roli. */
  async function selectCandidatesForRole(role, { costPolicy = "zero_cost", overrideKeys = {}, excludeProviders = [], preferDifferentFrom = null } = {}) {
    const ollamaState = await probeOllama(false, overrideKeys?.ollamaUrl);
    const exclude = new Set(excludeProviders);
    const now = Date.now();
    const candidates = [];

    for (const spec of Object.values(registry)) {
      if (exclude.has(spec.id)) continue;
      if (authBlocked.has(spec.id)) continue;
      if ((cooldownUntil.get(spec.id) || 0) > now) continue;

      let model = spec.roleModels?.[role] || spec.roleModels?.developer || "default";
      if (spec.id === "ollama") {
        if (!ollamaState.online || !ollamaState.models.length) continue;
        model = pickBestLocalOllamaModel(ollamaState.models, role, hardware) || model;
      }

      const policy = isAllowedByCostPolicy(spec, model, costPolicy);
      if (!policy.ok) continue;

      const key = resolveKey(spec, overrideKeys);
      const endpoint = resolveEndpoint(spec, overrideKeys);
      if (spec.protocol !== "custom" && (!key || !endpoint)) continue;

      let score = spec.rolePriority?.[role] ?? 70;
      // Inteligentny bonus: na sprzęcie z mocnym GPU preferuj lokalną Ollamę dla Developer/Debugger
      if (spec.id === "ollama" && (hardware.tier === "gpu_pro" || hardware.tier === "gpu_mid")) score += 20;
      // Niezależna recenzja (cross-model review): bonus dla innego dostawcy niż Developer!
      if (role === "reviewer" && preferDifferentFrom && spec.id !== preferDifferentFrom) score += 18;
      // Uczenie z pamięci doświadczeń!
      const learned = memory ? memory.getModelScore(spec.id, model, role) : null;
      if (learned !== null) score += Math.round((learned - 0.5) * 30);

      candidates.push({ spec, provider: spec.id, model, apiKey: key, endpoint, score, contextChars: spec.contextChars || 32_000 });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /** Wywołaj najlepszego dostępnego dostawcę dla roli z automatycznym failoverem i respektowaniem 429 Retry-After. */
  async function invokeForRole(role, { system, messages, tools = [], costPolicy = "zero_cost", overrideKeys = {}, excludeProviders = [], preferDifferentFrom = null, signal }) {
    const candidates = await selectCandidatesForRole(role, { costPolicy, overrideKeys, excludeProviders, preferDifferentFrom });
    if (!candidates.length) {
      const err = new Error(`Brak dostępnego dostawcy AI dla roli "${role}" w polityce "${costPolicy}". Skonfiguruj darmowy klucz API (np. Gemini/Cerebras/Groq/Mistral/OpenRouter :free) lub uruchom lokalną Ollamę.`);
      err.code = "NO_PROVIDER_AVAILABLE";
      throw err;
    }

    const errors = [];
    for (const cand of candidates) {
      const t0 = Date.now();
      try {
        let reply;
        if (cand.spec.protocol === "custom" && typeof cand.spec.invoke === "function") {
          reply = await cand.spec.invoke({ role, model: cand.model, system, messages, tools, signal });
        } else if (cand.spec.protocol === "gemini") {
          reply = await callGeminiProtocol({ endpoint: cand.endpoint, apiKey: cand.apiKey, model: cand.model, system, messages, tools, signal });
        } else if (cand.spec.protocol === "ollama") {
          reply = await callOllamaProtocol({ endpoint: cand.endpoint, model: cand.model, system, messages, tools, signal });
        } else if (cand.spec.protocol === "anthropic") {
          reply = await callAnthropicProtocol({ endpoint: cand.endpoint, apiKey: cand.apiKey, model: cand.model, system, messages, tools, signal });
        } else {
          reply = await callOpenAiProtocol({
            endpoint: cand.endpoint,
            apiKey: cand.apiKey,
            model: cand.model,
            system,
            messages,
            tools,
            extraHeaders: cand.spec.extraHeaders || {},
            signal,
          });
        }
        const latencyMs = Date.now() - t0;
        memory?.recordModelOutcome({
          provider: cand.provider,
          model: cand.model,
          role,
          ok: true,
          latencyMs,
          tokensIn: reply?.usage?.inputTokens || 0,
          tokensOut: reply?.usage?.outputTokens || 0,
        });
        return {
          ...reply,
          provider: cand.provider,
          model: cand.model,
          costTier: cand.spec.costTier,
          contextChars: cand.contextChars,
          latencyMs,
          estimatedCostUsd: cand.spec.costTier === "local" || cand.spec.costTier === "free_api" ? 0 : null,
        };
      } catch (e) {
        const latencyMs = Date.now() - t0;
        const status = Number(e?.status || 0);
        const rateLimited = status === 429;
        if (rateLimited) {
          cooldownUntil.set(cand.provider, Date.now() + parseRetryAfterMs(e?.retryAfter));
        } else if (status === 401 || status === 403) {
          authBlocked.add(cand.provider);
        } else if (status === 402) {
          cooldownUntil.set(cand.provider, Date.now() + 24 * 3600_000);
        }
        memory?.recordModelOutcome({ provider: cand.provider, model: cand.model, role, ok: false, latencyMs, rateLimited });
        errors.push(`${cand.provider}/${cand.model}: ${e instanceof Error ? e.message : String(e)}`);
        if (signal?.aborted) throw e;
      }
    }

    const combined = new Error(`Wszyscy kandydaci dla roli "${role}" zawiedli: ${errors.join(" | ")}`);
    combined.code = "ALL_PROVIDERS_FAILED";
    throw combined;
  }

  function registerCustomProvider(id, spec) {
    registry[id] = {
      id,
      label: spec.label || id,
      costTier: spec.costTier || "local",
      protocol: "custom",
      requiresKey: false,
      contextChars: spec.contextChars || 48_000,
      roleModels: spec.roleModels || { architect: id, developer: id, debugger: id, reviewer: id },
      rolePriority: spec.rolePriority || { architect: 90, developer: 90, debugger: 90, reviewer: 90 },
      limitsNote: spec.limitsNote || "Adapter niestandardowy",
      privacyNote: spec.privacyNote || "Lokalny",
      invoke: spec.invoke,
    };
  }

  return {
    hardware,
    probeOllama,
    getProviderMatrix,
    selectCandidatesForRole,
    invokeForRole,
    registerCustomProvider,
  };
}
