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

/** Natywne API Ollamy: respektuje think=false i zachowuje prawidłowe wywołania narzędzi. */
export async function askOllamaNative(
  ctx: AskCtx,
  config: { base: string; think: boolean; options: Record<string, number> },
): Promise<JarvisReply> {
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
        messages,
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
      const error = data?.error || `Ollama HTTP ${response.status}`;
      if (useTools && /does not support tools|tools?.*not support/i.test(error)) { useTools = false; continue; }
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
