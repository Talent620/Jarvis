import { runTool } from "../tools";
import type { AskCtx, JarvisReply } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface Resp {
  content: Block[];
  stop_reason: string;
  error?: { message: string };
}
type AnthMsg = { role: "user" | "assistant"; content: any };

// Natywny adapter Claude — pełny tool-use + serwerowe wyszukiwanie w sieci.
export async function askAnthropic(ctx: AskCtx): Promise<JarvisReply> {
  const endpoint = ctx.proxyUrl ? `${ctx.proxyUrl}/anthropic` : API_URL;
  const tools: any[] = ctx.tools.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
  }));
  if (ctx.webSearch) tools.push({ type: "web_search_20260209", name: "web_search" });

  const messages: AnthMsg[] = ctx.history.map((m) => ({
    role: m.role,
    content: m.image
      ? [
          { type: "image", source: { type: "base64", media_type: m.image.mediaType, data: m.image.data } },
          { type: "text", text: m.content || "Opisz, co widzisz na zdjęciu." },
        ]
      : m.content,
  }));
  const used = new Set<string>();
  let guard = 0;

  while (guard++ < 8) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ctx.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ctx.model,
        max_tokens: 4096,
        system: ctx.system,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        tools,
        messages,
      }),
    });
    // Brama/proxy potrafi zwrócić HTML zamiast JSON — nie wywalaj się na parsowaniu,
    // a kod statusu dołącz do treści, by logika awaryjna rozpoznała 401/403/429/5xx.
    const data = (await res.json().catch(() => null)) as Resp | null;
    if (!res.ok || !data) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);

    messages.push({ role: "assistant", content: data.content });
    for (const b of data.content) {
      if ((b.type === "tool_use" || b.type === "server_tool_use") && b.name) used.add(b.name);
    }

    if (data.stop_reason === "pause_turn") continue;

    const toolUses = data.content.filter((b) => b.type === "tool_use");
    if (data.stop_reason === "tool_use" && toolUses.length) {
      const results = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name!, tu.input ?? {});
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { text: text || "…", tools: [...used] };
  }
  return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used] };
}
