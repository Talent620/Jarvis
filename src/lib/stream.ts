// Strumieniowanie odpowiedzi (SSE) dla API zgodnego z OpenAI. Akumulator składa fragmenty
// treści i wywołań narzędzi przychodzące w deltach — testowalny niezależnie od sieci.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OAIStreamAccumulator {
  content = "";
  usage?: { inputTokens: number; outputTokens: number };
  finishReason: string | null = null;
  private tc: StreamToolCall[] = [];

  /** Wchłoń jeden obiekt JSON z linii `data:`. Zwraca PRZYROST treści (deltę) do onToken. */
  push(obj: any): string {
    const choice = obj?.choices?.[0];
    const delta = choice?.delta || {};
    let out = "";
    if (typeof delta.content === "string" && delta.content) {
      this.content += delta.content;
      out = delta.content;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const t of delta.tool_calls) {
        const i = typeof t.index === "number" ? t.index : 0;
        const cur = this.tc[i] || (this.tc[i] = { id: "", name: "", arguments: "" });
        if (t.id) cur.id = t.id;
        if (t.function?.name) cur.name += t.function.name;
        if (t.function?.arguments) cur.arguments += t.function.arguments;
      }
    }
    if (choice?.finish_reason) this.finishReason = choice.finish_reason;
    if (obj?.usage) {
      this.usage = {
        inputTokens: obj.usage.prompt_tokens || 0,
        outputTokens: obj.usage.completion_tokens || 0,
      };
    }
    return out;
  }

  /** Zebrane (kompletne) wywołania narzędzi, bez „dziur". */
  toolCalls(): StreamToolCall[] {
    return this.tc.filter((t) => t && t.name);
  }
}

/**
 * Wyodrębnij kompletne zdarzenia SSE z bufora tekstu. Zwraca sparsowane obiekty `data:`
 * (pomija `[DONE]` i nie-data linie) oraz RESZTĘ bufora (niedokończona linia) do doklejenia.
 */
export function drainSSE(buffer: string): { events: any[]; rest: string } {
  const events: any[] = [];
  // Zdarzenia rozdzielone podwójnym newline; trzymamy ostatni (potencjalnie niepełny) fragment.
  const parts = buffer.split(/\n\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    for (const line of block.split(/\n/)) {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m) continue;
      const payload = m[1].trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        /* niekompletny/uszkodzony fragment — pomiń */
      }
    }
  }
  return { events, rest };
}
