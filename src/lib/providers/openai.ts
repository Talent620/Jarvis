import { runTool } from "../tools";
import { fetchTimeout, appTokenHeader } from "../http";
import { OAIStreamAccumulator, drainSSE } from "../stream";
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
  opts: { extraHeaders?: Record<string, string>; onlineSuffix?: boolean; extraBody?: Record<string, unknown> } = {},
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
    let inTok = 0;
    let outTok = 0;
    let guard = 0;
    let canStream = !!ctx.onToken; // strumieniujemy tylko, gdy caller chce deltami

    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${ctx.apiKey}`,
      ...opts.extraHeaders,
      ...(ctx.proxyUrl ? appTokenHeader() : {}),
    };
    // extraBody płytko domieszane — domyślnie puste (zero zmian dla pozostałych dostawców);
    // Ollama dokłada tu keep_alive/options (Zadanie 4).
    const baseBody = { model, messages, ...(hasTools ? { tools, tool_choice: "auto" } : {}), max_tokens: 2048, ...(opts.extraBody || {}) };

    // Pełna odpowiedź (bez strumienia) — ścieżka klasyczna / fallback.
    const requestFull = async (): Promise<OAIMessage> => {
      const res = await fetchTimeout(url, { method: "POST", headers, body: JSON.stringify(baseBody) }, 120000);
      // Brama/proxy może oddać HTML zamiast JSON — parsuj bezpiecznie i dołącz kod statusu.
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
      if (data.usage) { inTok += data.usage.prompt_tokens || 0; outTok += data.usage.completion_tokens || 0; }
      const m: OAIMessage | undefined = data.choices?.[0]?.message;
      if (!m) throw new Error("Pusta odpowiedź modelu.");
      return m;
    };

    // Strumieniowanie (SSE) — treść leci deltami przez ctx.onToken; narzędzia składamy z fragmentów.
    const requestStream = async (): Promise<OAIMessage> => {
      const res = await fetchTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify({ ...baseBody, stream: true, stream_options: { include_usage: true } }) },
        120000,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("stream-unsupported"); // brak strumienia → fallback do pełnej
      const dec = new TextDecoder();
      const acc = new OAIStreamAccumulator();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, rest } = drainSSE(buf);
        buf = rest;
        for (const ev of events) {
          const delta = acc.push(ev);
          if (delta) ctx.onToken?.(delta);
        }
      }
      const tail = drainSSE(buf + "\n\n");
      for (const ev of tail.events) {
        const delta = acc.push(ev);
        if (delta) ctx.onToken?.(delta);
      }
      if (acc.usage) { inTok += acc.usage.inputTokens; outTok += acc.usage.outputTokens; }
      const tcs = acc.toolCalls();
      return {
        role: "assistant",
        content: acc.content || null,
        ...(tcs.length ? { tool_calls: tcs.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) } : {}),
      };
    };

    while (guard++ < 8) {
      let msg: OAIMessage;
      try {
        msg = canStream ? await requestStream() : await requestFull();
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        // Hiccup strumienia (nie sieć/timeout) → zdegraduj do pełnej odpowiedzi, by NIE zawieść tury.
        if (canStream && !/timeout|abort|failed to fetch|load failed|network/i.test(em)) {
          canStream = false;
          msg = await requestFull();
        } else {
          throw e;
        }
      }
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

      return { text: (msg.content || "").trim() || "…", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
    }
    return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
  };
}
