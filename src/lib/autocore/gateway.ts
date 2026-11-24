// === AUTOCORE · AI Gateway (wspólny kontrakt dla całej aplikacji) ===
// Każdy moduł (czat, agenci, głos, Live Vision, narzędzia, pamięć, automatyzacje, diagnostyka)
// komunikuje się przez ten kontrakt zamiast utrzymywać własne listy dostawców i kluczy.
// Wykonawca czatu/modelu jest wstrzykiwany z `brain.ts` (registerGatewayExecutor), dzięki
// czemu unikamy cykli importów w rdzeniu.
import { store } from "../store";
import type { Settings } from "../../types";
import type { JarvisReply, Msg, ProviderId, TokenUsage } from "../providers/types";
import { orderedKeys } from "../keys";
import { budgetGate, budgetGateExternal, estimateSideServiceCost, recordCall, recordExternalCall } from "./budget";
import { keyUsable, modelUsable, providerUsable, reportFailure, reportSuccess } from "./health";
import { classifyTaskClass, type TaskClass } from "./router";

export type ServiceKind = "stt" | "tts" | "embed" | "image" | "live" | "search";
export type ResolvedVoiceEngine = "system" | "gemini" | "eleven" | "openai" | "modal" | "fish" | "local";

export interface GatewayRequest {
  task?: TaskClass;
  system: string;
  history: Msg[];
  webSearch?: boolean;
  heavy?: boolean;
  /** Preferowany dostawca/model (np. z eksperymentu lub trybu). */
  prefer?: { provider: ProviderId; model: string };
}

export type GatewayExecutor = (req: GatewayRequest) => Promise<JarvisReply>;

let executor: GatewayExecutor | null = null;
let lastGatewayTask: TaskClass | null = null;
export function registerGatewayExecutor(fn: GatewayExecutor): void {
  executor = fn;
}

/** Ostatnia klasa zadania obsłużona przez AI Gateway (telemetria / diagnostyka). */
export function getLastGatewayTask(): TaskClass | null {
  return lastGatewayTask;
}

/** Wspólne wywołanie modelu AI przez AutoCore (routing + zdrowie + budżet + failover + telemetria). */
export async function aiRequest(req: GatewayRequest): Promise<JarvisReply> {
  if (!executor) throw new Error("AutoCore AI Gateway nie jest jeszcze zainicjalizowany.");
  const last = req.history[req.history.length - 1];
  const task = req.task ?? classifyTaskClass(last?.content || "", { hasImage: !!last?.image });
  lastGatewayTask = task;
  return executor({ ...req, task });
}

/**
 * JEDNO źródło prawdy o wyborze silnika TTS w całym JARVIS-ie (używane przez voice.ts,
 * AutoCorePanel.tsx, selfManifest.ts i resolveService("tts")). Koniec sprzecznych resolverów.
 */
export function resolveVoiceEngine(s: Settings = store.settings): ResolvedVoiceEngine {
  const vm = s.voiceMode as string | undefined;
  if (vm && vm !== "auto") return vm as ResolvedVoiceEngine;
  if (s.localTts) return "local";
  if (s.fishAudioApiKey?.trim() && s.fishAudioVoiceId?.trim()) return "fish";
  const basicPl = s.voicePinned || s.voiceSystemPl !== false;
  if (!basicPl && s.elevenLabsApiKey?.trim() && s.elevenLabsVoiceId?.trim()) return "eleven";
  if (!basicPl && s.openaiTtsApiKey?.trim()) return "openai";
  if (!basicPl && s.modalVoiceUrl?.trim()) return "modal";
  if (!basicPl && s.geminiTts && (orderedKeys("gemini")[0] || s.keys?.gemini?.trim())) return "gemini";
  return "system";
}

export interface ServiceResolution {
  kind: ServiceKind;
  provider: string;
  apiKey: string;
  endpoint?: string;
  allowed: boolean;
  reason?: string;
}

/**
 * Rozwiąż zewnętrzną usługę AI (STT/TTS/embed/image/live/search) przez jeden rejestr ustawień,
 * z pełną kontrolą budżetu (`budgetGate` / `budgetGateExternal`) i zdrowia.
 */
export function resolveService(kind: ServiceKind): ServiceResolution {
  const s = store.settings;
  const pick = (provider: ProviderId | string, apiKey: string, endpoint?: string, model: string = kind): ServiceResolution => {
    const k = (apiKey || "").trim();
    if (!k) return { kind, provider, apiKey: "", endpoint, allowed: false, reason: `Brak klucza dla usługi ${kind} (${provider}).` };
    if (provider === "groq" || provider === "gemini" || provider === "modal" || provider === "openrouter") {
      if (!providerUsable(provider)) return { kind, provider, apiKey: k, endpoint, allowed: false, reason: `${provider} w stanie backoff.` };
      if (!keyUsable(provider, k)) return { kind, provider, apiKey: k, endpoint, allowed: false, reason: `Klucz ${provider} chwilowo zablokowany.` };
      if (!modelUsable(provider, model)) return { kind, provider, apiKey: k, endpoint, allowed: false, reason: `Model ${model} niedostępny.` };
      const g = budgetGate(provider, model);
      if (!g.allowed) return { kind, provider, apiKey: k, endpoint, allowed: false, reason: g.reason };
    } else {
      const g = budgetGateExternal(provider);
      if (!g.allowed) return { kind, provider, apiKey: k, endpoint, allowed: false, reason: g.reason };
    }
    return { kind, provider, apiKey: k, endpoint, allowed: true };
  };

  if (kind === "stt") {
    if (s.modalVoiceUrl?.trim()) {
      const g = budgetGate("modal", "modal-stt");
      return {
        kind,
        provider: "modal",
        apiKey: s.keys.modal || "",
        endpoint: s.modalVoiceUrl.trim(),
        allowed: g.allowed,
        ...(g.allowed ? {} : { reason: g.reason }),
      };
    }
    const groqKey = orderedKeys("groq")[0] || s.keys.groq || "";
    return pick("groq", groqKey, "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo");
  }
  if (kind === "tts") {
    const engine = resolveVoiceEngine(s);
    if (engine === "eleven") {
      if (!s.elevenLabsVoiceId?.trim()) {
        return { kind, provider: "elevenlabs", apiKey: "", allowed: false, reason: "Brak wybranego głosu (elevenLabsVoiceId)." };
      }
      return pick("elevenlabs", s.elevenLabsApiKey || "", undefined, s.elevenLabsModel || "eleven_flash_v2_5");
    }
    if (engine === "openai") {
      return pick("openai-tts", s.openaiTtsApiKey || "", undefined, s.openaiTtsModel || "gpt-4o-mini-tts");
    }
    if (engine === "fish") {
      if (!s.fishAudioVoiceId?.trim()) {
        return { kind, provider: "fish", apiKey: "", allowed: false, reason: "Brak wybranego głosu (fishAudioVoiceId)." };
      }
      return pick("fish", s.fishAudioApiKey || "", undefined, "fish-s1");
    }
    if (engine === "modal") {
      if (!s.modalVoiceUrl?.trim()) {
        return { kind, provider: "modal", apiKey: "", allowed: false, reason: "Brak adresu Modal Voice." };
      }
      const g = budgetGate("modal", "modal-voice");
      return {
        kind,
        provider: "modal",
        apiKey: s.keys.modal || "",
        endpoint: s.modalVoiceUrl.trim(),
        allowed: g.allowed,
        ...(g.allowed ? {} : { reason: g.reason }),
      };
    }
    if (engine === "gemini") {
      const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
      return pick("gemini", gemKey, undefined, "gemini-2.5-flash-preview-tts");
    }
    if (engine === "local") {
      return { kind, provider: "local", apiKey: "local", allowed: true };
    }
    return { kind, provider: "native", apiKey: "local", allowed: true };
  }
  if (kind === "live") {
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    return pick("gemini", gemKey, undefined, "gemini-live");
  }
  if (kind === "embed") {
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    if (gemKey && !s.onDeviceOnly) return pick("gemini", gemKey, undefined, "text-embedding-004");
    if (s.ollamaUrl?.trim()) return { kind, provider: "ollama", apiKey: "local", endpoint: s.ollamaUrl.trim(), allowed: true };
    return { kind, provider: "local", apiKey: "local", allowed: true };
  }
  if (kind === "image") {
    if (s.falApiKey?.trim()) return pick("fal", s.falApiKey.trim(), undefined, "fal-flux-kontext");
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    if (gemKey) return pick("gemini", gemKey, undefined, "imagen-3");
    return { kind, provider: "none", apiKey: "", allowed: false, reason: "Brak klucza generowania obrazów (fal.ai lub Gemini)." };
  }
  // search
  return pick("tavily", s.tavilyApiKey || "", "https://api.tavily.com/search", "advanced");
}

const EXTERNAL_PAID = new Set(["elevenlabs", "openai-tts", "fish", "fal", "tavily"]);

/** Zgłoś wynik usługi spoza głównego czatu (STT/TTS/embed/image/live/search) do zdrowia i budżetu AutoCore. */
export function reportOutcome(
  provider: string,
  model: string,
  apiKey: string,
  ok: boolean,
  opts: { latencyMs?: number; error?: unknown; usage?: TokenUsage; costUsd?: number; units?: number } = {},
): void {
  if (EXTERNAL_PAID.has(provider)) {
    if (ok) {
      const usd =
        typeof opts.costUsd === "number" && opts.costUsd > 0
          ? opts.costUsd
          : estimateSideServiceCost(provider, model, opts.units ?? 1);
      recordExternalCall(provider, model, usd);
    }
    return;
  }
  const known: ProviderId[] = ["modal", "anthropic", "gemini", "groq", "cerebras", "mistral", "cohere", "openrouter", "nvidia", "github", "ollama", "webllm"];
  if (!known.includes(provider as ProviderId)) return;
  const pid = provider as ProviderId;
  if (ok) {
    reportSuccess(pid, model, apiKey, opts.latencyMs);
    const fallbackUsd =
      typeof opts.costUsd === "number" && opts.costUsd > 0
        ? opts.costUsd
        : estimateSideServiceCost(pid, model, opts.units ?? 1);
    if (opts.usage || pid === "modal" || fallbackUsd > 0) {
      recordCall(pid, model, opts.usage, opts.latencyMs, Date.now(), { fallbackUsd });
    }
  } else if (opts.error !== undefined) {
    reportFailure(pid, model, apiKey, opts.error);
  }
}
