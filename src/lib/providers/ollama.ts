import { throwIfAborted } from "../abort";
import { fetchTimeout } from "../http";
import { runTool } from "../tools";
import type { AskCtx, JarvisReply } from "./types";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[];
  tool_name?: string;
}

/**
 * Przybliżenie kosztu tekstu i schematów, nie tokenizer danego modelu. Obrazy mają
 * osobny zapas: rozmiar base64 nie odzwierciedla liczby tokenów wizyjnych.
 */
function estimateTokens(value: unknown): number {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json).length;
  return Math.ceil(bytes / 2.5);
}

function promptCost(messages: OllamaMessage[], tools: unknown[]): number {
  let images = 0;
  const text = messages.map(({ images: imgs, ...rest }) => { images += imgs?.length || 0; return rest; });
  return estimateTokens(text) + estimateTokens(tools) + images * 1024 + messages.length * 8;
}

function promptBudget(numCtx: number, numPredict?: number): number {
  const context = Number.isFinite(numCtx) && numCtx > 0 ? Math.floor(numCtx) : 4096;
  const reserve = Math.min(Math.max(256, numPredict && numPredict > 0 ? numPredict : 512), Math.floor(context / 2));
  return Math.max(0, context - reserve);
}

/** Usuwa wyłącznie najstarsze pełne tury, nigdy bieżącej wiadomości ani wywołań narzędzi. */
export function fitOllamaHistory(
  messages: OllamaMessage[], tools: unknown[], numCtx: number, numPredict?: number,
): OllamaMessage[] {
  const budget = promptBudget(numCtx, numPredict);
  const out = messages.slice();
  // Po systemie zostawiamy ostatnią turę użytkownika wraz z odpowiedziami narzędzi.
  while (promptCost(out, tools) > budget) {
    const latestUser = out.reduce((last, m, i) => m.role === "user" ? i : last, -1);
    if (latestUser <= 1) break;
    const nextUser = out.findIndex((m, i) => i > 1 && m.role === "user");
    if (nextUser < 0 || nextUser > latestUser) break;
    out.splice(1, nextUser - 1);
  }
  return out;
}

/** A conservative estimate: never send a known oversized current turn or silently cut it. */
export function assertOllamaContext(messages: OllamaMessage[], tools: unknown[], numCtx: number, numPredict?: number): void {
  const estimated = promptCost(messages, tools);
  const budget = promptBudget(numCtx, numPredict);
  if (estimated > budget) throw new Error(`Przekroczono szacowany budżet kontekstu Ollamy (${estimated} > ${budget} tokenów wejścia). Ogranicz kontekst projektu lub zestaw narzędzi. Nie wysłano niepełnego polecenia ani nie rozgrzewano modelu.`);
}

/** Approximate schema allowance for retrieval; the adapter rechecks the exact wire payload. */
export function ollamaToolSchemaBudget(system: string, currentUser: string, numCtx: number, numPredict?: number): number {
  const input = promptCost([{ role: "system", content: system }, { role: "user", content: currentUser }], []);
  // Room for response framing/tool-call wrappers and multilingual UTF-8 descriptions.
  return Math.max(0, Math.floor((promptBudget(numCtx, numPredict) - input - 256) * 1.5));
}

export interface OllamaCapabilityEvidence {
  model: string;
  installed: boolean | null;
  loadedBeforeProbe: boolean | null;
  advertised: string[];
  tools: "passed" | "failed" | "unknown";
  checkedAt: number;
  expiresAt: number;
  latencyMs?: number;
  reason?: string;
}
const capabilityCache = new Map<string, OllamaCapabilityEvidence>();
const cacheKey = (base: string, model: string) => `${base.replace(/\/+$/, "")}\n${model}`;
export function clearOllamaCapabilityCache(): void { capabilityCache.clear(); }
export function cachedOllamaCapabilities(base: string, model: string, now = Date.now()): OllamaCapabilityEvidence | null {
  const entry = capabilityCache.get(cacheKey(base, model));
  return entry && entry.expiresAt > now ? { ...entry, advertised: [...entry.advertised] } : null;
}

/** Explicit diagnostic, called by auto-configuration. No user data or real tools are sent.
 * A returned greeting is not proof: the model must emit exactly the bounded echo tool call.
 * The result measures this protocol test only, not overall reasoning/vision quality.
 */
export async function probeOllamaTools(base: string, model: string, options: { signal?: AbortSignal; now?: () => number; force?: boolean } = {}): Promise<OllamaCapabilityEvidence> {
  base = base.replace(/\/+$/, "");
  const now = options.now || Date.now;
  throwIfAborted(options.signal);
  const cached = cachedOllamaCapabilities(base, model, now());
  if (cached && !options.force) return cached;
  const started = now();
  const evidence: OllamaCapabilityEvidence = { model, installed: null, loadedBeforeProbe: null, advertised: [], tools: "unknown", checkedAt: started, expiresAt: started + 30_000 };
  const json = async (path: string, body?: unknown, timeout = 8000) => {
    const response = await fetchTimeout(`${base}${path}`, { signal: options.signal, ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }, timeout);
    if (!response.ok) throw new Error(`Ollama ${path}: HTTP ${response.status}`);
    return response.json();
  };
  try {
    const tags = await json("/api/tags");
    const canonical = (name: string) => name.includes(":") ? name : `${name}:latest`;
    evidence.installed = Array.isArray(tags.models) && tags.models.some((m: { name?: string; model?: string }) => canonical(m.name || m.model || "") === canonical(model));
    if (!evidence.installed) { evidence.reason = "Model nie jest zainstalowany; nie pobrano go automatycznie."; return evidence; }
    try {
      const ps = await json("/api/ps");
      if (Array.isArray(ps.models)) evidence.loadedBeforeProbe = ps.models.some((m: { name?: string; model?: string }) => canonical(m.name || m.model || "") === canonical(model));
    } catch { throwIfAborted(options.signal); /* older service: loaded unknown */ }
    const metadata = await json("/api/show", { model });
    evidence.advertised = Array.isArray(metadata.capabilities) ? metadata.capabilities.filter((v: unknown): v is string => typeof v === "string") : [];
    const nonce = `qa-${crypto.randomUUID()}`;
    const result = await json("/api/chat", {
      model, stream: false, think: false,
      options: { temperature: 0, num_ctx: 2048, num_predict: 128 },
      messages: [{ role: "user", content: `Call jarvis_capability_echo exactly once with value ${JSON.stringify(nonce)}. Do not reply with prose.` }],
      tools: [{ type: "function", function: { name: "jarvis_capability_echo", description: "Return the supplied value; no effects.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } } }],
    }, 30_000);
    throwIfAborted(options.signal);
    const calls = result.message?.tool_calls;
    let args = calls?.[0]?.function?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
    evidence.tools = calls?.length === 1 && calls[0]?.function?.name === "jarvis_capability_echo" && args?.value === nonce && Object.keys(args).length === 1 ? "passed" : "failed";
    evidence.reason = evidence.tools === "passed" ? "Potwierdzono izolowane wywołanie narzędzia; nie jest to test całego agenta." : "Model nie zwrócił wymaganego wywołania narzędzia.";
    evidence.expiresAt = now() + (evidence.tools === "passed" ? 10 * 60_000 : 30_000);
  } catch {
    throwIfAborted(options.signal);
    evidence.reason = "Próba możliwości nie została ukończona (usługa, protokół lub timeout).";
  } finally {
    evidence.latencyMs = Math.max(0, now() - started);
    evidence.checkedAt = now();
    if (!options.signal?.aborted) {
      if (capabilityCache.size >= 64) capabilityCache.delete(capabilityCache.keys().next().value!);
      capabilityCache.set(cacheKey(base, model), { ...evidence, advertised: [...evidence.advertised] });
    }
  }
  return evidence;
}

/** Natywne API Ollamy: respektuje think=false i zachowuje prawidłowe wywołania narzędzi. */
export async function askOllamaNative(
  ctx: AskCtx,
  config: { base: string; think: boolean; options: Record<string, number> },
): Promise<JarvisReply> {
  throwIfAborted(ctx.signal);
  if (ctx.requiresTools && !ctx.tools.length) throw new Error("Brak narzędzia dobranego do polecenia w dostępnym budżecie kontekstu. Nie wykonano działania; doprecyzuj zasób lub sprawdź konfigurację narzędzi.");
  // Metadane modelu muszą potwierdzać obsługę obrazu. Bez tego model tekstowy
  // mógłby odpowiedzieć na podstawie samej historii i udawać analizę ekranu.
  if (ctx.history.some((message) => !!message.image)) {
    let capabilities: unknown;
    try {
      const r = await fetchTimeout(`${config.base}/api/show`, {
        signal: ctx.signal,
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: ctx.model }),
      }, 15000);
      if (r.ok) capabilities = (await r.json() as { capabilities?: unknown }).capabilities;
    } catch { throwIfAborted(ctx.signal); /* brak potwierdzenia — nie przekazuj obrazu */ }
    if (!Array.isArray(capabilities) || !capabilities.includes("vision")) {
      throw new Error("Nie mogę potwierdzić obsługi obrazów przez ten model Ollamy. Wybierz zainstalowany model wizyjny i sprawdź jego możliwości w Ollamie.");
    }
  }
  const messages: OllamaMessage[] = [
    { role: "system", content: ctx.system },
    ...ctx.history.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.image ? { images: [message.image.data] } : {}),
    } as OllamaMessage)),
  ];
  const tools = ctx.tools.map((def) => ({
    type: "function",
    function: { name: def.name, description: def.description, parameters: def.input_schema },
  }));
  const used = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let useTools = tools.length > 0;

  throwIfAborted(ctx.signal);
  for (let guard = 0; guard < 8; guard += 1) {
    throwIfAborted(ctx.signal);
    const fitted = fitOllamaHistory(messages, useTools ? tools : [], config.options.num_ctx ?? 4096, config.options.num_predict);
    assertOllamaContext(fitted, useTools ? tools : [], config.options.num_ctx ?? 4096, config.options.num_predict);
    const response = await fetchTimeout(`${config.base}/api/chat`, {
      signal: ctx.signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: ctx.model,
        messages: fitted,
        stream: false,
        think: config.think,
        keep_alive: "30m",
        options: config.options,
        ...(useTools ? { tools } : {}),
      }),
    }, 180_000);
    const data = await response.json().catch(() => null) as {
      error?: string;
      message?: OllamaMessage;
      prompt_eval_count?: number;
      eval_count?: number;
    } | null;
    if (!response.ok || !data?.message) {
      const rawError = data?.error;
      const error = typeof rawError === "string"
        ? rawError
        : rawError && typeof rawError === "object" && "message" in rawError
          ? String((rawError as { message?: unknown }).message || `Ollama HTTP ${response.status}`)
          : `Ollama HTTP ${response.status}`;
      if (useTools && /does not support tools|tools?.*not support/i.test(error)) {
        if (ctx.requiresTools) throw new Error("Ten model nie obsługuje narzędzi wymaganych do wykonania polecenia. Nie wykonano działania; wybierz zgodny model lokalny.");
        useTools = false; continue;
      }
      if (/(context (?:length|window|size).*(?:exceed|limit|too (?:long|large)|overflow)|(?:exceed|too (?:long|large)|overflow).*(?:context (?:length|window|size))|too many tokens)/i.test(error)) {
        throw new Error(`Ollama odrzuciła zapytanie: przekroczono kontekst modelu. Skróć polecenie lub ogranicz kontekst projektu; nie zmieniono modelu ani ustawień. Szczegóły: ${error}`);
      }
      throw new Error(error);
    }
    inputTokens += data.prompt_eval_count || 0;
    outputTokens += data.eval_count || 0;
    throwIfAborted(ctx.signal);
    const message = data.message;
    messages.push(message);
    throwIfAborted(ctx.signal);
    const calls = message.tool_calls || [];
    if (calls.length) {
      for (const call of calls) {
        const name = call.function.name;
        if (!useTools || !ctx.tools.some((tool) => tool.name === name)) throw new Error(`Model zażądał narzędzia spoza udostępnionego zestawu: ${name}. Nie wykonano działania.`);
        used.add(name);
        let args: unknown = call.function.arguments || {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { throw new Error(`Niepoprawny JSON argumentów narzędzia ${name}. Nie wykonano działania.`); }
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`Niepoprawne argumenty narzędzia ${name}. Nie wykonano działania.`);
        const output = await runTool(name, args, { signal: ctx.signal });
        messages.push({ role: "tool", tool_name: name, content: output });
      }
      continue;
    }
    const text = (message.content || "").trim();
    if (text) ctx.onToken?.(text);
    return { text: text || "…", tools: [...used], usage: { inputTokens, outputTokens } };
  }
  return { text: "Zatrzymałem pętlę narzędzi po ośmiu krokach.", tools: [...used], usage: { inputTokens, outputTokens } };
}
