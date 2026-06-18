import { runTool } from "../tools";
import { fetchTimeout, appTokenHeader } from "../http";
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
  usage?: { input_tokens?: number; output_tokens?: number };
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
  let inTok = 0;
  let outTok = 0;
  let guard = 0;
  // Niektóre modele/bramki nie przyjmują adaptacyjnego myślenia ani „effort".
  // Zaczynamy z nimi (najlepsza jakość), a przy błędzie 400 o ich braku —
  // automatycznie ponawiamy bez tych pól. W trybie szybkim (ctx.fast) od razu
  // pomijamy myślenie — niższe opóźnienie (np. tłumaczenie na żywo).
  let richThinking = !ctx.fast;

  while (guard++ < 8) {
    const body: Record<string, unknown> = {
      model: ctx.model,
      max_tokens: 8192,
      system: ctx.system,
      tools,
      messages,
    };
    if (richThinking) {
      body.thinking = { type: "adaptive" };
      body.output_config = { effort: "high" };
    }
    const res = await fetchTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ctx.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        ...(ctx.proxyUrl ? appTokenHeader() : {}),
      },
      body: JSON.stringify(body),
    }, 120000);
    // Brama/proxy potrafi zwrócić HTML zamiast JSON — nie wywalaj się na parsowaniu,
    // a kod statusu dołącz do treści, by logika awaryjna rozpoznała 401/403/429/5xx.
    const data = (await res.json().catch(() => null)) as Resp | null;
    if (!res.ok || !data) {
      const msg = data?.error?.message || "Błąd API";
      // Model nie wspiera adaptacyjnego myślenia/effortu → ponów BEZ tych pól.
      if (res.status === 400 && richThinking && /thinking|adaptive|effort|output_config|budget/i.test(msg)) {
        richThinking = false;
        guard--; // ta próba się nie liczy do limitu pętli
        continue;
      }
      throw new Error(`${msg} (${res.status})`);
    }

    if (data.usage) {
      inTok += data.usage.input_tokens || 0;
      outTok += data.usage.output_tokens || 0;
    }
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
    return { text: text || "…", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
  }
  return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
}
