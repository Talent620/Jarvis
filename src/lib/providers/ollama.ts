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

/** Usuwa wyłącznie najstarsze pełne tury, nigdy bieżącej wiadomości ani wywołań narzędzi. */
export function fitOllamaHistory(
  messages: OllamaMessage[], tools: unknown[], numCtx: number, numPredict?: number,
): OllamaMessage[] {
  const context = Number.isFinite(numCtx) && numCtx > 0 ? Math.floor(numCtx) : 4096;
  const reserve = Math.min(Math.max(256, numPredict && numPredict > 0 ? numPredict : 512), Math.floor(context / 2));
  const budget = Math.max(0, context - reserve);
  const out = messages.slice();
  const cost = () => {
    let images = 0;
    const textOnly = out.map(({ images: imgs, ...rest }) => { images += imgs?.length || 0; return rest; });
    return estimateTokens(textOnly) + estimateTokens(tools) + images * 1024 + out.length * 8;
  };
  // Po systemie zostawiamy ostatnią turę użytkownika wraz z odpowiedziami narzędzi.
  while (cost() > budget) {
    const latestUser = out.reduce((last, m, i) => m.role === "user" ? i : last, -1);
    if (latestUser <= 1) break;
    const nextUser = out.findIndex((m, i) => i > 1 && m.role === "user");
    if (nextUser < 0 || nextUser > latestUser) break;
    out.splice(1, nextUser - 1);
  }
  return out;
}

/** Natywne API Ollamy: respektuje think=false i zachowuje prawidłowe wywołania narzędzi. */
export async function askOllamaNative(
  ctx: AskCtx,
  config: { base: string; think: boolean; options: Record<string, number> },
): Promise<JarvisReply> {
  // Metadane modelu muszą potwierdzać obsługę obrazu. Bez tego model tekstowy
  // mógłby odpowiedzieć na podstawie samej historii i udawać analizę ekranu.
  if (ctx.history.some((message) => !!message.image)) {
    let capabilities: unknown;
    try {
      const r = await fetchTimeout(`${config.base}/api/show`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: ctx.model }),
      }, 15000);
      if (r.ok) capabilities = (await r.json() as { capabilities?: unknown }).capabilities;
    } catch { /* brak potwierdzenia — nie przekazuj obrazu */ }
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

  for (let guard = 0; guard < 8; guard += 1) {
    const response = await fetchTimeout(`${config.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: ctx.model,
        messages: fitOllamaHistory(messages, useTools ? tools : [], config.options.num_ctx ?? 4096, config.options.num_predict),
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
      if (useTools && /does not support tools|tools?.*not support/i.test(error)) { useTools = false; continue; }
      if (/(context (?:length|window|size).*(?:exceed|limit|too (?:long|large)|overflow)|(?:exceed|too (?:long|large)|overflow).*(?:context (?:length|window|size))|too many tokens)/i.test(error)) {
        throw new Error(`Ollama odrzuciła zapytanie: przekroczono kontekst modelu. Skróć polecenie lub ogranicz kontekst projektu; nie zmieniono modelu ani ustawień. Szczegóły: ${error}`);
      }
      throw new Error(error);
    }
    inputTokens += data.prompt_eval_count || 0;
    outputTokens += data.eval_count || 0;
    const message = data.message;
    messages.push(message);
    const calls = message.tool_calls || [];
    if (calls.length) {
      for (const call of calls) {
        const name = call.function.name;
        used.add(name);
        let args: unknown = call.function.arguments || {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const output = await runTool(name, args);
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
