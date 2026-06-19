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

// --- Anthropic (Claude) — zdarzenia SSE typu message_start / content_block_delta / ... ---
// UWAGA: w trybie strumieniowym wyłączamy „thinking" (caller), więc bloki to tekst + tool_use.

interface AnthBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  _json?: string;
}

export class AnthStreamAccumulator {
  usage = { inputTokens: 0, outputTokens: 0 };
  stopReason: string | null = null;
  private blocks: AnthBlock[] = [];

  push(obj: any): string {
    const t = obj?.type;
    if (t === "message_start") {
      this.usage.inputTokens += obj.message?.usage?.input_tokens || 0;
      return "";
    }
    if (t === "content_block_start") {
      const cb = obj.content_block || {};
      this.blocks[obj.index] = {
        type: cb.type,
        id: cb.id,
        name: cb.name,
        ...(cb.type === "text" ? { text: "" } : {}),
        ...(cb.type === "tool_use" ? { _json: "" } : {}),
      };
      return "";
    }
    if (t === "content_block_delta") {
      const d = obj.delta || {};
      const b = this.blocks[obj.index] || (this.blocks[obj.index] = { type: "text", text: "" });
      if (d.type === "text_delta") {
        b.text = (b.text || "") + (d.text || "");
        return d.text || "";
      }
      if (d.type === "input_json_delta") {
        b._json = (b._json || "") + (d.partial_json || "");
      }
      return "";
    }
    if (t === "content_block_stop") {
      const b = this.blocks[obj.index];
      if (b && b._json !== undefined) {
        try { b.input = JSON.parse(b._json || "{}"); } catch { b.input = {}; }
      }
      return "";
    }
    if (t === "message_delta") {
      if (obj.delta?.stop_reason) this.stopReason = obj.delta.stop_reason;
      this.usage.outputTokens += obj.usage?.output_tokens || 0;
      return "";
    }
    return "";
  }

  /** Bloki treści w formacie API (text + tool_use z poskładanym input). */
  content(): { type: string; text?: string; id?: string; name?: string; input?: unknown }[] {
    return this.blocks
      .filter((b) => b && b.type)
      .map((b) =>
        b.type === "text"
          ? { type: "text", text: b.text || "" }
          : { type: b.type, id: b.id, name: b.name, input: b.input ?? {} },
      );
  }
}

// --- Gemini — SSE z candidates[0].content.parts[] (text lub functionCall) ---

export class GeminiStreamAccumulator {
  usage = { inputTokens: 0, outputTokens: 0 };
  text = "";
  private functionCalls: { name: string; args: unknown }[] = [];

  push(obj: any): string {
    let out = "";
    const parts = obj?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p.text === "string" && p.text) {
          this.text += p.text;
          out += p.text;
        }
        if (p.functionCall?.name) {
          this.functionCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
        }
      }
    }
    const u = obj?.usageMetadata;
    if (u) {
      this.usage.inputTokens = u.promptTokenCount || this.usage.inputTokens;
      this.usage.outputTokens = u.candidatesTokenCount || this.usage.outputTokens;
    }
    return out;
  }

  calls(): { name: string; args: unknown }[] {
    return this.functionCalls;
  }
}

