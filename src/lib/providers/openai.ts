import { runTool } from "../tools";
import { fetchTimeout } from "../http";
import type { AskCtx, JarvisReply } from "./types";

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

// Wspólny adapter dla dostawców z API zgodnym z OpenAI (chat/completions + function calling).
export function makeOpenAICompatible(
  endpoint: string,
  opts: { extraHeaders?: Record<string, string>; onlineSuffix?: boolean } = {},
) {
  return async function ask(ctx: AskCtx): Promise<JarvisReply> {
    const url = ctx.proxyUrl ? `${ctx.proxyUrl}/openai?u=${encodeURIComponent(endpoint)}` : endpoint;

    // OpenRouter potrafi włączyć web search przez sufiks ":online".
    const model =
      opts.onlineSuffix && ctx.webSearch && !ctx.model.includes(":online")
        ? `${ctx.model}:online`
        : ctx.model;

    const tools = ctx.tools.map((d) => ({
      type: "function",
      function: { name: d.name, description: d.description, parameters: d.input_schema },
    }));
    const hasTools = tools.length > 0;

    const messages: OAIMessage[] = [
      { role: "system", content: ctx.system },
      ...ctx.history.map((m) =>
        m.image
          ? ({
              role: m.role,
              content: [
                { type: "text", text: m.content || "Opisz, co widzisz na zdjęciu." },
                { type: "image_url", image_url: { url: `data:${m.image.mediaType};base64,${m.image.data}` } },
              ],
            } as unknown as OAIMessage)
          : ({ role: m.role, content: m.content } as OAIMessage),
      ),
    ];
    const used = new Set<string>();
    let guard = 0;

    while (guard++ < 8) {
      const res = await fetchTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ctx.apiKey}`,
          ...opts.extraHeaders,
        },
        // tool_choice/tools tylko gdy faktycznie mamy narzędzia — część API (Groq,
        // OpenRouter, NVIDIA) odrzuca puste „tools" z „tool_choice: auto".
        body: JSON.stringify({
          model,
          messages,
          ...(hasTools ? { tools, tool_choice: "auto" } : {}),
          max_tokens: 2048,
        }),
      }, 120000);
      // Brama/proxy może oddać HTML zamiast JSON — parsuj bezpiecznie i dołącz
      // kod statusu, by rotacja klucza / fallback dostawcy rozpoznały błąd.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);

      const msg: OAIMessage | undefined = data.choices?.[0]?.message;
      if (!msg) throw new Error("Pusta odpowiedź modelu.");
      messages.push(msg);

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          used.add(tc.function.name);
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            /* puste argumenty */
          }
          const out = await runTool(tc.function.name, args);
          messages.push({ role: "tool", tool_call_id: tc.id, content: out });
        }
        continue;
      }

      return { text: (msg.content || "").trim() || "…", tools: [...used] };
    }
    return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used] };
  };
}
