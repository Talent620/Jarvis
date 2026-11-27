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
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  COST_CATEGORIES,
  costCategoryOf,
  createPromoBudgetGovernor,
  validatePromoBudgetSpec,
  verifyModalPromoStatus,
} from "./budget.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODAL_BRIDGE_SCRIPT = path.join(__dirname, "modal-bridge.py");

/** Usuń bloki rozumowania `<think>...</think>` emitowane przez modele Qwen3 / DeepSeek-R1 przed parsowaniem JSON/narzędzi. */
export function stripThinkingTags(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

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

/** Wybierz najlepszy zainstalowany lokalnie model Ollama dla danej roli (z obsługą eskalacji i cross-model review). */
export function pickBestLocalOllamaModel(installedModels, role, hardware, { excludeModels = [], preferDifferentModelFrom = null, preferredModel = null } = {}) {
  const list = (installedModels || []).map((m) => String(m || "")).filter(Boolean);
  if (!list.length) return null;
  if (preferredModel) {
    const exact = list.find((m) => m === preferredModel || m.startsWith(`${preferredModel}:`));
    if (exact) return exact;
  }

  const excluded = new Set((excludeModels || []).map((m) => String(m || "").replace(/^ollama\//, "")));
  const prefs = role === "developer" || role === "debugger"
    ? [/qwen3[-.]?coder/i, /qwen2\.5-coder/i, /codestral/i, /deepseek-coder/i, /devstral/i, /qwen3/i, /llama3/i]
    : [/qwen3/i, /deepseek-r1/i, /phi4/i, /qwen2\.5-coder/i, /gemma3/i, /llama3/i];

  // Na słabszym sprzęcie (<=10GB RAM bez GPU) unikaj wielkich modeli 27B+, jeśli dostępny jest mniejszy
  const avoidHuge = !hardware?.gpu && (hardware?.totalRamGb || 8) <= 10;
  const sizeFiltered = avoidHuge ? list.filter((m) => !/:(?:27b|30b|32b|70b|72b)\b/i.test(m)) : list;
  const basePool = sizeFiltered.length ? sizeFiltered : list;
  const notExcluded = basePool.filter((m) => !excluded.has(m));
  let pool = notExcluded.length ? notExcluded : basePool;

  // Przy recenzji lub eskalacji preferuj INNY zainstalowany model lokalny (np. qwen3:4b vs qwen2.5-coder:3b)
  if (preferDifferentModelFrom) {
    const diffName = String(preferDifferentModelFrom).replace(/^ollama\//, "");
    const others = pool.filter((m) => m !== diffName);
    if (others.length) pool = others;
  }

  const paramSizeB = (name) => {
    const m = String(name).match(/:(\d+(?:\.\d+)?)b\b/i);
    return m ? Number(m[1]) : 0;
  };
  for (const re of prefs) {
    const hits = pool.filter((m) => re.test(m));
    if (hits.length) {
      hits.sort((a, b) => paramSizeB(b) - paramSizeB(a));
      return hits[0];
    }
  }
  return pool[0];
}

/**
 * Czy dany dostawca + model są dozwolone w wybranej polityce kosztowej?
 * 3 kategorie bez wydatków z kieszeni:
 *  - A. `local_free` (`local`)
 *  - B. `api_free` (`free_api`)
 *  - C. `promo_credits` (`promo_credit`) — WYŁĄCZNIE z jawną kopertą budżetową + limitem czasu, ZERO przejścia na `paid`!
 */
export function isAllowedByCostPolicy(providerSpec, modelId, costPolicy = "zero_cost", opts = {}) {
  if (!providerSpec) return { ok: false, reason: "Nieznany dostawca." };
  const tier = providerSpec.costTier;
  const category = costCategoryOf(tier);
  if (costPolicy === "local_only") {
    return category === COST_CATEGORIES.LOCAL_FREE
      ? { ok: true, category }
      : { ok: false, category, reason: "Polityka local_only dopuszcza wyłącznie modele lokalne (kategoria A: Local Free)." };
  }
  if (costPolicy === "zero_cost") {
    if (category !== COST_CATEGORIES.LOCAL_FREE && category !== COST_CATEGORIES.API_FREE) {
      return { ok: false, category, reason: `Dostawca ${providerSpec.id} ma kategorię "${category}" — zablokowany w trybie zero_cost (tylko Local Free + API Free).` };
    }
    if (providerSpec.requireFreeSuffixInZeroCost && !/:free$/i.test(String(modelId || ""))) {
      return { ok: false, category, reason: `OpenRouter w trybie zero_cost dopuszcza wyłącznie modele z sufiksem ":free" (otrzymano "${modelId}").` };
    }
    return { ok: true, category };
  }
  if (costPolicy === "allow_promo_credits" || costPolicy === "allow_credits") {
    if (category === COST_CATEGORIES.PAID) {
      return { ok: false, category, reason: `Dostawca ${providerSpec.id} należy do rozliczenia płatnego — twardo zablokowany w polityce kredytów promocyjnych.` };
    }
    if (providerSpec.requireFreeSuffixInZeroCost && !/:free$/i.test(String(modelId || ""))) {
      return { ok: false, category, reason: `OpenRouter bez sufiksu ":free" wymaga płatnych środków — zablokowany w polityce kredytów promocyjnych.` };
    }
    if (category === COST_CATEGORIES.PROMO_CREDITS) {
      if (!opts.promoGovernor) {
        const check = validatePromoBudgetSpec(opts.promoBudget);
        if (!check.ok) {
          return { ok: false, category, reason: `Kredyty promocyjne (${providerSpec.id}) zablokowane bez jawnego budżetu i limitu czasu: ${check.reason}` };
        }
      }
    }
    return { ok: true, category };
  }
  return { ok: true, category };
}

function parseRetryAfterMs(headerVal) {
  if (!headerVal) return 60_000;
  const sec = Number(headerVal);
  if (Number.isFinite(sec) && sec > 0) return Math.min(15 * 60_000, Math.round(sec * 1000));
  const at = Date.parse(headerVal);
  if (Number.isFinite(at) && at > Date.now()) return Math.min(15 * 60_000, at - Date.now());
  return 60_000;
}

/**
 * Wyłuskaj wywołania narzędzi osadzone w treści tekstu (np. Ollama `qwen2.5-coder:3b` zwraca JSON w `content`,
 * a modele Qwen3/Hermes potrafią emitować `<tool_call>{...}</tool_call>`).
 */
export function extractInlineToolCallsFromText(text, tools = []) {
  const cleaned = stripThinkingTags(text);
  if (!cleaned) return [];
  const allowed = new Set((tools || []).map((t) => t.name).filter(Boolean));
  const out = [];

  const pushCandidate = (obj) => {
    if (!obj || typeof obj !== "object") return;
    const name = obj.name || obj.tool || obj.function?.name || (typeof obj.function === "string" ? obj.function : "");
    if (!name || (allowed.size > 0 && !allowed.has(name))) return;
    let args = obj.arguments ?? obj.args ?? obj.input ?? obj.parameters ?? obj.function?.arguments ?? {};
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }
    if (!args || typeof args !== "object") args = {};
    out.push({ id: `inline_${out.length + 1}_${Date.now()}`, name, arguments: args });
  };

  // 1. Bloki <tool_call>...</tool_call> (również bez zamykającego tagu </tool_call>)
  const hermesMatches = [...cleaned.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)];
  for (const m of hermesMatches) {
    try { pushCandidate(JSON.parse(m[1].trim())); } catch { /* ignore */ }
  }
  if (out.length) return out;

  // 2. Bloki ```json ... ``` lub czysty obiekt JSON (po usunięciu ew. niedomkniętego <tool_call>)
  const stripped = cleaned.replace(/<\/?tool_call>/gi, "").trim();
  const fenced = [...stripped.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
  const candidates = fenced.length ? fenced : [stripped];
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (Array.isArray(parsed)) parsed.forEach(pushCandidate);
      else pushCandidate(parsed);
      if (out.length) return out;
    } catch {
      // 2b. NDJSON / wiele obiektów JSON linia po linii (częste w Ollama qwen2.5-coder:3b!)
      const lines = cand.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{") && l.endsWith("}"));
      for (const ln of lines) {
        try { pushCandidate(JSON.parse(ln)); } catch { /* ignore */ }
      }
      if (out.length) return out;

      const start = cand.indexOf("{");
      const end = cand.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          pushCandidate(JSON.parse(cand.slice(start, end + 1)));
          if (out.length) return out;
        } catch { /* ignore */ }
      }
    }
  }
  return out;
}

/** Znormalizuj odpowiedź OpenAI-compatible do kontraktu Forge { content, toolCalls, usage }. */
function parseOpenAiResponse(data, tools = []) {
  const msg = data?.choices?.[0]?.message || {};
  let toolCalls = Array.isArray(msg.tool_calls)
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
  const cleanContent = typeof msg.content === "string" ? stripThinkingTags(msg.content) : "";
  if (!toolCalls.length && cleanContent && tools.length) {
    toolCalls = extractInlineToolCallsFromText(cleanContent, tools);
  }
  return {
    content: cleanContent,
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
    return parseOpenAiResponse(data, tools);
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

/** Wywołanie natywnego API Ollama (`/api/chat`) z natywnymi narzędziami i adaptacją pod CPU/GPU. */
async function callOllamaProtocol({ endpoint, model, system, messages, tools, hardware = null, temperature = 0.15, timeoutMs, signal }) {
  const isCpuLight = hardware ? (!hardware.gpu && hardware.cpuCores <= 4) : false;
  const effectiveTimeout = timeoutMs ?? (isCpuLight ? 180_000 : 120_000);
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
    keep_alive: "5m",
    ...(/^qwen3/i.test(String(model || "")) ? { think: false } : {}),
    messages: ollMessages,
    options: {
      temperature: Number.isFinite(temperature) ? temperature : 0.15,
      num_ctx: isCpuLight ? 4096 : 8192,
      ...(isCpuLight ? { num_predict: 1024 } : {}),
    },
  };
  if (tools && tools.length) {
    const coreNames = new Set(["read_file", "edit_file", "write_file", "run_command", "finish_task"]);
    const activeTools = isCpuLight ? tools.filter((t) => coreNames.has(t.name)) : tools;
    body.tools = (activeTools.length ? activeTools : tools).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: isCpuLight ? String(t.description || "").slice(0, 72) : t.description,
        parameters: t.parameters,
      },
    }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
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
    let toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc, i) => {
          let parsedArgs = {};
          const rawArgs = tc?.function?.arguments;
          if (typeof rawArgs === "string") {
            try { parsedArgs = JSON.parse(rawArgs); } catch { parsedArgs = { _raw: rawArgs }; }
          } else if (rawArgs && typeof rawArgs === "object") {
            parsedArgs = rawArgs;
          }
          return {
            id: `oll_${i + 1}`,
            name: tc?.function?.name || "",
            arguments: parsedArgs,
          };
        }).filter((t) => t.name)
      : [];
    const cleanContent = typeof msg.content === "string" ? stripThinkingTags(msg.content) : "";
    if (!toolCalls.length && cleanContent && tools && tools.length) {
      toolCalls = extractInlineToolCallsFromText(cleanContent, tools);
    }
    return {
      content: cleanContent,
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

/** Zbuduj standardowy payload OpenAI chat/completions (używany przez OpenAI-compat i Modal Bridge). */
function buildOpenAiPayload({ model, system, messages, tools, maxTokens = 2560, temperature = 0.15 }) {
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
    temperature: Number.isFinite(temperature) ? temperature : 0.15,
    max_tokens: maxTokens,
  };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }
  return body;
}

/**
 * Długowieczna sesja przekaźnika Modal (`forge/modal-bridge.py --daemon`),
 * wywołująca wdrożony `jarvis-brain` bez ujawniania `VLLM_API_KEY` lokalnej VM.
 */
function createModalBridgeSession() {
  let proc = null;
  let readyPromise = null;
  let buf = "";
  const waiters = [];

  const rejectAll = (err) => {
    while (waiters.length) {
      const w = waiters.shift();
      clearTimeout(w.timer);
      w.reject(err);
    }
  };

  const handleLine = (line) => {
    let parsed;
    try { parsed = JSON.parse(line); } catch { return; }
    const w = waiters.shift();
    if (!w) return;
    clearTimeout(w.timer);
    w.resolve(parsed);
  };

  const ensureStarted = (timeoutMs = 90_000) => {
    if (readyPromise && proc && !proc.killed) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      proc = spawn("python3", [MODAL_BRIDGE_SCRIPT, "--daemon"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stderrBuf = "";
      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
        reject(new Error(`Timeout uruchomienia Modal Bridge (${Math.round(timeoutMs / 1000)}s).`));
      }, timeoutMs);

      waiters.push({
        timer,
        resolve: (msg) => {
          if (msg && msg.ready) resolve(msg);
          else reject(new Error(msg?.error || "Modal Bridge nie zgłosił gotowości."));
        },
        reject,
      });

      proc.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx = buf.indexOf("\n");
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) handleLine(line);
          idx = buf.indexOf("\n");
        }
      });
      proc.stderr.on("data", (c) => { stderrBuf = (stderrBuf + c.toString("utf8")).slice(-2000); });
      proc.on("error", (err) => {
        readyPromise = null;
        rejectAll(err);
      });
      proc.on("close", (code) => {
        readyPromise = null;
        proc = null;
        rejectAll(new Error(`Modal Bridge zakończony (exit ${code}): ${stderrBuf.trim().slice(0, 260)}`));
      });
    });
    return readyPromise;
  };

  async function invoke({ model, system, messages, tools, temperature = 0.15, timeoutMs = 240_000, signal }) {
    if (signal?.aborted) throw new Error("Anulowano przez użytkownika.");
    await ensureStarted(Math.min(90_000, timeoutMs));
    const payload = buildOpenAiPayload({ model, system, messages, tools, maxTokens: 3072, temperature });

    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Przekroczono limit czasu wywołania Modal Bridge (${Math.round(timeoutMs / 1000)}s).`));
      }, timeoutMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Anulowano wywołanie Modal (AbortSignal)."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push({
        timer,
        resolve: (msg) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(msg);
        },
        reject: (err) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      });
      proc.stdin.write(JSON.stringify({ payload, timeoutSeconds: Math.round(timeoutMs / 1000) }) + "\n");
    });

    if (!response || !response.ok || !response.data) {
      const err = new Error(`Modal Brain (${response?.status || 500}): ${response?.error || "Brak danych"}`);
      err.status = Number(response?.status || 502);
      throw err;
    }
    const parsed = parseOpenAiResponse(response.data, tools);
    return {
      ...parsed,
      content: stripThinkingTags(parsed.content),
    };
  }

  function close() {
    if (proc && !proc.killed) {
      try { proc.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n"); } catch { /* ignore */ }
      setTimeout(() => {
        try { proc?.kill("SIGTERM"); } catch { /* ignore */ }
      }, 300).unref();
    }
    proc = null;
    readyPromise = null;
  }

  return { invoke, close };
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
 * - kontrolowanego wykorzystania kredytów promocyjnych (kategoria C: Modal Bridge pod PromoBudgetGovernor),
 * - podpinania własnych/testowych adapterów (`registerCustomProvider`),
 * - uczenia się routingu z `ExperienceMemory` oraz cooldownów `429 Retry-After`.
 */
export function createProviderPool({
  env = process.env,
  runtimeKeys = {},
  ollamaUrl,
  memory = null,
  customProviders = {},
  enableModalBridge = false,
  modalBillingVerifier = verifyModalPromoStatus,
} = {}) {
  const hardware = detectHardwareProfile();
  const registry = { ...FORGE_PROVIDERS, ...customProviders };
  const cooldownUntil = new Map(); // providerId -> timestamp
  const authBlocked = new Set();
  const modalBridge = createModalBridgeSession();
  let ollamaProbeCache = { checkedAt: 0, online: false, models: [], url: ollamaUrl || env.OLLAMA_URL || "http://127.0.0.1:11434" };
  let modalStatusCache = { checkedAt: 0, result: null };

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

  function probeModal(force = false) {
    if (!enableModalBridge && !env?.FORGE_MODAL_BRIDGE) {
      return { verified: false, available: false, reason: "Modal Bridge wyłączony domyślnie (wymaga jawnego budżetu kredytów promocyjnych)." };
    }
    if (!force && modalStatusCache.result && Date.now() - modalStatusCache.checkedAt < 60_000) {
      return modalStatusCache.result;
    }
    const res = modalBillingVerifier();
    modalStatusCache = { checkedAt: Date.now(), result: res };
    return res;
  }

  const explicitOllamaUrl = Boolean(ollamaUrl || env?.OLLAMA_URL);

  async function probeOllama(force = false, customUrl) {
    const hasCustom = Object.values(registry).some((s) => s.protocol === "custom");
    if (hasCustom && !explicitOllamaUrl && !customUrl) {
      ollamaProbeCache = { checkedAt: Date.now(), online: false, models: [], url: ollamaProbeCache.url };
      return ollamaProbeCache;
    }
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

  /** Zwróć pełny, uczciwy status wszystkich dostawców (3 kategorie kosztów, bez ujawniania kluczy!). */
  async function getProviderMatrix({ costPolicy = "zero_cost", overrideKeys = {}, probeLocal = true, promoBudget = null, promoGovernor = null, memoryOverride = null } = {}) {
    const activeMemory = memoryOverride || memory;
    const ollamaState = probeLocal ? await probeOllama(false, overrideKeys?.ollamaUrl) : ollamaProbeCache;
    const modalBridgeState = (enableModalBridge || env?.FORGE_MODAL_BRIDGE) ? probeModal(false) : null;

    return Object.values(registry).map((spec) => {
      const key = resolveKey(spec, overrideKeys);
      const endpoint = resolveEndpoint(spec, overrideKeys);
      const defaultModel = spec.id === "ollama"
        ? (pickBestLocalOllamaModel(ollamaState.models, "developer", hardware) || spec.roleModels.developer)
        : spec.roleModels.developer;
      const policyCheck = isAllowedByCostPolicy(spec, defaultModel, costPolicy, { promoBudget, promoGovernor });
      const cooledMs = Math.max(0, (cooldownUntil.get(spec.id) || 0) - Date.now());
      const usingModalBridge = spec.id === "modal" && (!key || !endpoint) && Boolean(modalBridgeState?.available);

      let status = "ready";
      let statusReason = "Gotowy do pracy";
      if (spec.protocol === "custom") {
        status = policyCheck.ok ? "ready" : "blocked_by_policy";
        statusReason = policyCheck.ok ? "Adapter niestandardowy (aktywny)" : policyCheck.reason;
      } else if (spec.id === "ollama") {
        if (!ollamaState.online) { status = "offline"; statusReason = `Ollama nieosiągalna pod ${ollamaState.url}`; }
        else if (!ollamaState.models.length) { status = "untested"; statusReason = "Ollama działa, ale brak zainstalowanych modeli (ollama pull qwen2.5-coder:3b)"; }
        else { status = "ready"; statusReason = `Lokalnie dostępnych modeli: ${ollamaState.models.length}`; }
      } else if (usingModalBridge) {
        if (!policyCheck.ok) { status = "blocked_by_policy"; statusReason = policyCheck.reason; }
        else { status = "ready"; statusReason = `Modal Bridge (${modalBridgeState.profile}, Billed $0.00, kredyty promocyjne pod budżetem)`; }
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

      const devScore = activeMemory ? activeMemory.getModelScore(spec.id, defaultModel, "developer") : null;
      return {
        id: spec.id,
        label: spec.label,
        costTier: spec.costTier,
        costCategory: costCategoryOf(spec.costTier),
        protocol: usingModalBridge ? "modal-bridge" : spec.protocol,
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

  /** Posortuj dostępnych, dozwolonych i zdrowych kandydatów dla konkretnej roli (z obsługą Adaptive Intelligence). */
  async function selectCandidatesForRole(role, {
    costPolicy = "zero_cost",
    overrideKeys = {},
    excludeProviders = [],
    excludeModels = [],
    preferDifferentFrom = null,
    preferDifferentModelFrom = null,
    preferredCategories = null,
    allowedCategories = null,
    preferredProvider = null,
    preferredModel = null,
    promoBudget = null,
    promoGovernor = null,
    memoryOverride = null,
  } = {}) {
    const activeMemory = memoryOverride || memory;
    const ollamaState = await probeOllama(false, overrideKeys?.ollamaUrl);
    const exclude = new Set(excludeProviders);
    const allowedCatSet = Array.isArray(allowedCategories) && allowedCategories.length ? new Set(allowedCategories) : null;
    const prefCatList = Array.isArray(preferredCategories) ? preferredCategories : [];
    const now = Date.now();
    const candidates = [];

    for (const spec of Object.values(registry)) {
      if (exclude.has(spec.id)) continue;
      if (authBlocked.has(spec.id)) continue;
      if ((cooldownUntil.get(spec.id) || 0) > now) continue;

      const category = costCategoryOf(spec.costTier);
      if (allowedCatSet && !allowedCatSet.has(category)) continue;

      let model = spec.roleModels?.[role] || spec.roleModels?.developer || "default";
      if (spec.id === "ollama") {
        if (!ollamaState.online || !ollamaState.models.length) continue;
        model = pickBestLocalOllamaModel(ollamaState.models, role, hardware, {
          excludeModels,
          preferDifferentModelFrom: preferDifferentModelFrom && (!preferDifferentFrom || preferDifferentFrom === "ollama")
            ? preferDifferentModelFrom
            : null,
          preferredModel: (!preferredProvider || preferredProvider === "ollama") ? preferredModel : null,
        }) || model;
      } else if (preferredProvider === spec.id && preferredModel) {
        model = preferredModel;
      }

      if (excludeModels.includes(`${spec.id}/${model}`)) continue;

      const policy = isAllowedByCostPolicy(spec, model, costPolicy, { promoBudget, promoGovernor });
      if (!policy.ok) continue;

      const key = resolveKey(spec, overrideKeys);
      const endpoint = resolveEndpoint(spec, overrideKeys);
      let useModalBridge = false;
      if (spec.id === "modal" && (!key || !endpoint) && (enableModalBridge || env?.FORGE_MODAL_BRIDGE)) {
        const mb = probeModal(false);
        if (mb?.verified && mb?.available) useModalBridge = true;
      }

      if (spec.protocol !== "custom" && !useModalBridge && (!key || !endpoint)) continue;

      let score = spec.rolePriority?.[role] ?? 70;
      if (spec.id === "ollama" && (hardware.tier === "gpu_pro" || hardware.tier === "gpu_mid")) score += 20;
      if (role === "reviewer" && preferDifferentFrom && spec.id !== preferDifferentFrom) score += 22;
      if (role === "reviewer" && preferDifferentModelFrom && model !== String(preferDifferentModelFrom).replace(/^[^/]+\//, "")) score += 10;

      // Adaptive Intelligence: priorytetyzacja kategorii kosztowej (np. simple -> local_free, medium -> api_free, hard -> promo/strongest)
      if (prefCatList.length) {
        const catIdx = prefCatList.indexOf(category);
        if (catIdx === 0) score += 60;
        else if (catIdx === 1) score += 28;
        else if (catIdx === 2) score += 8;
        else score -= 40;
      }

      if (preferredProvider && spec.id === preferredProvider) score += 120;
      if (preferredModel && model === preferredModel) score += 40;

      const learned = activeMemory ? activeMemory.getModelScore(spec.id, model, role) : null;
      if (learned !== null) score += Math.round((learned - 0.5) * 30);

      candidates.push({
        spec,
        provider: spec.id,
        model,
        costCategory: category,
        apiKey: key,
        endpoint,
        useModalBridge,
        score,
        contextChars: spec.contextChars || 32_000,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  /** Wywołaj najlepszego dostępnego dostawcę dla roli z failoverem, 429 Retry-After, Adaptive Intelligence i twardą kontrolą budżetu. */
  async function invokeForRole(role, {
    system,
    messages,
    tools = [],
    costPolicy = "zero_cost",
    overrideKeys = {},
    excludeProviders = [],
    excludeModels = [],
    preferDifferentFrom = null,
    preferDifferentModelFrom = null,
    preferredCategories = null,
    allowedCategories = null,
    preferredProvider = null,
    preferredModel = null,
    temperature = 0.15,
    promoBudget = null,
    promoGovernor = null,
    memoryOverride = null,
    signal,
  }) {
    const activeMemory = memoryOverride || memory;
    const activeGovernor = promoGovernor
      || (promoBudget && (costPolicy === "allow_promo_credits" || costPolicy === "allow_credits")
        ? createPromoBudgetGovernor({ budgetSpec: promoBudget, billingVerifier: modalBillingVerifier })
        : null);

    let candidates = await selectCandidatesForRole(role, {
      costPolicy,
      overrideKeys,
      excludeProviders,
      excludeModels,
      preferDifferentFrom,
      preferDifferentModelFrom,
      preferredCategories,
      allowedCategories,
      preferredProvider,
      preferredModel,
      promoBudget,
      promoGovernor: activeGovernor,
      memoryOverride: activeMemory,
    });
    // Jeśli filtr kategorii (np. local_free dla prostego zadania) nie znalazł gotowego dostawcy (np. Ollama offline),
    // rozszerz fallback WYŁĄCZNIE do darmowych kategorii (local_free + api_free) — NIGDY nie przeskakuj cicho na promo_credits!
    if (!candidates.length && Array.isArray(allowedCategories) && allowedCategories.length && !preferredProvider) {
      const safeFallbackCats = allowedCategories.includes(COST_CATEGORIES.PROMO_CREDITS)
        ? null
        : [COST_CATEGORIES.LOCAL_FREE, COST_CATEGORIES.API_FREE];
      candidates = await selectCandidatesForRole(role, {
        costPolicy,
        overrideKeys,
        excludeProviders,
        excludeModels,
        preferDifferentFrom,
        preferDifferentModelFrom,
        preferredCategories: preferredCategories || [COST_CATEGORIES.LOCAL_FREE, COST_CATEGORIES.API_FREE],
        allowedCategories: safeFallbackCats,
        promoBudget,
        promoGovernor: activeGovernor,
        memoryOverride: activeMemory,
      });
    }
    if (!candidates.length) {
      const err = new Error(`Brak dostępnego dostawcy AI dla roli "${role}" w polityce "${costPolicy}". Skonfiguruj darmowy klucz API (np. Gemini/Cerebras/Groq/Mistral/OpenRouter :free), uruchom lokalną Ollamę albo przekaż jawny budżet kredytów promocyjnych.`);
      err.code = "NO_PROVIDER_AVAILABLE";
      throw err;
    }

    const errors = [];
    for (const cand of candidates) {
      const isPromo = costCategoryOf(cand.spec.costTier) === COST_CATEGORIES.PROMO_CREDITS;
      let reservedUsd = 0;
      if (isPromo) {
        if (!activeGovernor) {
          errors.push(`${cand.provider}/${cand.model}: brak kontrolera budżetu kredytów promocyjnych.`);
          continue;
        }
        try {
          const check = activeGovernor.assertCanSpend(15, { reserve: true });
          reservedUsd = check?.reservedUsd || 0;
        } catch (budgetErr) {
          errors.push(`${cand.provider}/${cand.model}: ${budgetErr instanceof Error ? budgetErr.message : String(budgetErr)}`);
          // Jeśli w puli są jeszcze darmowi kandydaci (np. lokalna Ollama), pozwól im przejąć zadanie!
          continue;
        }
      }

      const t0 = Date.now();
      try {
        let reply;
        if (cand.spec.protocol === "custom" && typeof cand.spec.invoke === "function") {
          reply = await cand.spec.invoke({ role, model: cand.model, system, messages, tools, temperature, signal });
        } else if (cand.useModalBridge) {
          reply = await modalBridge.invoke({ model: cand.model, system, messages, tools, temperature, signal });
        } else if (cand.spec.protocol === "gemini") {
          reply = await callGeminiProtocol({ endpoint: cand.endpoint, apiKey: cand.apiKey, model: cand.model, system, messages, tools, signal });
        } else if (cand.spec.protocol === "ollama") {
          reply = await callOllamaProtocol({ endpoint: cand.endpoint, model: cand.model, system, messages, tools, hardware, temperature, signal });
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
          reply = { ...reply, content: stripThinkingTags(reply.content) };
        }
        const latencyMs = Date.now() - t0;
        let promoUsage = null;
        if (isPromo && activeGovernor) {
          promoUsage = activeGovernor.recordUsage({
            durationMs: latencyMs,
            tokensIn: reply?.usage?.inputTokens || 0,
            tokensOut: reply?.usage?.outputTokens || 0,
            reservedUsd,
          });
          reservedUsd = 0;
        }
        activeMemory?.recordModelOutcome({
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
          costCategory: costCategoryOf(cand.spec.costTier),
          contextChars: cand.contextChars,
          latencyMs,
          estimatedCostUsd: (cand.spec.costTier === "local" || cand.spec.costTier === "free_api")
            ? 0
            : (promoUsage ? promoUsage.costUsd : null),
          ...(promoUsage ? { promoBudgetSnapshot: promoUsage.snapshot } : {}),
        };
      } catch (e) {
        const latencyMs = Date.now() - t0;
        if (isPromo && activeGovernor) {
          if (latencyMs > 1000) {
            activeGovernor.recordUsage({ durationMs: latencyMs, overheadSec: 1, reservedUsd });
          } else {
            activeGovernor.releaseReservation?.(reservedUsd);
          }
          reservedUsd = 0;
        }
        const status = Number(e?.status || 0);
        const rateLimited = status === 429;
        if (rateLimited) {
          cooldownUntil.set(cand.provider, Date.now() + parseRetryAfterMs(e?.retryAfter));
        } else if (status === 401 || status === 403) {
          authBlocked.add(cand.provider);
        } else if (status === 402) {
          cooldownUntil.set(cand.provider, Date.now() + 24 * 3600_000);
        }
        activeMemory?.recordModelOutcome({ provider: cand.provider, model: cand.model, role, ok: false, latencyMs, rateLimited });
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
    probeModal,
    getProviderMatrix,
    selectCandidatesForRole,
    invokeForRole,
    registerCustomProvider,
    close: () => modalBridge.close(),
  };
}
