// === AUTOCORE · AI Gateway (wspólny kontrakt dla całej aplikacji) ===
// Każdy moduł (czat, agenci, głos, Live Vision, narzędzia, pamięć, automatyzacje, diagnostyka)
// komunikuje się przez ten kontrakt zamiast utrzymywać własne listy dostawców i kluczy.
// Wykonawca czatu/modelu jest wstrzykiwany z `brain.ts` (registerGatewayExecutor), dzięki
// czemu unikamy cykli importów w rdzeniu.
import { store } from "../store";
import type { JarvisReply, Msg, ProviderId, TokenUsage } from "../providers/types";
import { orderedKeys } from "../keys";
import { budgetGate, recordCall } from "./budget";
import { keyUsable, modelUsable, providerUsable, reportFailure, reportSuccess } from "./health";
import { classifyTaskClass, type TaskClass } from "./router";

export type ServiceKind = "stt" | "tts" | "embed" | "image" | "live" | "search";

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
export function registerGatewayExecutor(fn: GatewayExecutor): void {
  executor = fn;
}

/** Wspólne wywołanie modelu AI przez AutoCore (routing + zdrowie + budżet + failover + telemetria). */
export async function aiRequest(req: GatewayRequest): Promise<JarvisReply> {
  if (!executor) throw new Error("AutoCore AI Gateway nie jest jeszcze zainicjalizowany.");
  const last = req.history[req.history.length - 1];
  const task = req.task ?? classifyTaskClass(last?.content || "", { hasImage: !!last?.image });
  return executor({ ...req, task });
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
 * z kontrolą budżetu i zdrowia. Zamiast rozrzuconych odczytów `store.settings.*ApiKey`.
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
    }
    return { kind, provider, apiKey: k, endpoint, allowed: true };
  };

  if (kind === "stt") {
    if (s.modalVoiceUrl?.trim()) {
      return { kind, provider: "modal", apiKey: s.keys.modal || "", endpoint: s.modalVoiceUrl.trim(), allowed: true };
    }
    const groqKey = orderedKeys("groq")[0] || s.keys.groq || "";
    return pick("groq", groqKey, "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3-turbo");
  }
  if (kind === "tts") {
    const mode = s.voiceMode || "auto";
    if (mode === "eleven" || (mode === "auto" && s.elevenLabsApiKey?.trim())) {
      return { kind, provider: "elevenlabs", apiKey: s.elevenLabsApiKey || "", allowed: !!s.elevenLabsApiKey?.trim() };
    }
    if (mode === "openai" || (mode === "auto" && s.openaiTtsApiKey?.trim())) {
      return { kind, provider: "openai-tts", apiKey: s.openaiTtsApiKey || "", allowed: !!s.openaiTtsApiKey?.trim() };
    }
    if (mode === "fish" || (mode === "auto" && s.fishAudioApiKey?.trim())) {
      return { kind, provider: "fish", apiKey: s.fishAudioApiKey || "", allowed: !!s.fishAudioApiKey?.trim() };
    }
    if (mode === "modal" || (mode === "auto" && s.modalVoiceUrl?.trim())) {
      return { kind, provider: "modal", apiKey: s.keys.modal || "", endpoint: s.modalVoiceUrl?.trim(), allowed: !!s.modalVoiceUrl?.trim() };
    }
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    if (gemKey) return pick("gemini", gemKey, undefined, "gemini-2.5-flash-preview-tts");
    return { kind, provider: "native", apiKey: "local", allowed: true };
  }
  if (kind === "live") {
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    return pick("gemini", gemKey, undefined, "gemini-live");
  }
  if (kind === "embed") {
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    if (gemKey) return pick("gemini", gemKey, undefined, "text-embedding-004");
    if (s.ollamaUrl?.trim()) return { kind, provider: "ollama", apiKey: "local", endpoint: s.ollamaUrl.trim(), allowed: true };
    return { kind, provider: "local", apiKey: "local", allowed: true };
  }
  if (kind === "image") {
    if (s.falApiKey?.trim()) return { kind, provider: "fal", apiKey: s.falApiKey.trim(), allowed: true };
    const gemKey = orderedKeys("gemini")[0] || s.keys.gemini || "";
    if (gemKey) return pick("gemini", gemKey, undefined, "imagen-3");
    return { kind, provider: "none", apiKey: "", allowed: false, reason: "Brak klucza generowania obrazów (fal.ai lub Gemini)." };
  }
  // search
  return {
    kind,
    provider: "tavily",
    apiKey: (s.tavilyApiKey || "").trim(),
    allowed: !!(s.tavilyApiKey || "").trim(),
    ...(s.tavilyApiKey?.trim() ? {} : { reason: "Brak klucza Tavily." }),
  };
}

/** Zgłoś wynik usługi spoza głównego czatu (STT/TTS/embed/image/live) do zdrowia i budżetu AutoCore. */
export function reportOutcome(
  provider: string,
  model: string,
  apiKey: string,
  ok: boolean,
  opts: { latencyMs?: number; error?: unknown; usage?: TokenUsage } = {},
): void {
  const known: ProviderId[] = ["modal", "anthropic", "gemini", "groq", "cerebras", "mistral", "cohere", "openrouter", "nvidia", "github", "ollama", "webllm"];
  if (!known.includes(provider as ProviderId)) return;
  const pid = provider as ProviderId;
  if (ok) {
    reportSuccess(pid, model, apiKey, opts.latencyMs);
    if (opts.usage || pid === "modal") recordCall(pid, model, opts.usage, opts.latencyMs);
  } else if (opts.error !== undefined) {
    reportFailure(pid, model, apiKey, opts.error);
  }
}
