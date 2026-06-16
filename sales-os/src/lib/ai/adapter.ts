import type { AiCompletionOptions, AiCompletionResult, AiProvider } from "./types";

const PROVIDER = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
const API_KEY = process.env.AI_API_KEY ?? "";
const MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";
const BASE_URL = process.env.AI_BASE_URL ?? "";

class OpenAiProvider implements AiProvider {
  name = "openai" as const;
  model = MODEL;

  async complete(opts: AiCompletionOptions): Promise<AiCompletionResult> {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      ...opts.messages,
    ];
    const res = await fetch(`${BASE_URL || "https://api.openai.com"}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 900,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content?.trim() ?? "",
      provider: "openai",
      model: this.model,
      tokensUsed: data.usage?.total_tokens,
      fallback: false,
    };
  }
}

class AnthropicProvider implements AiProvider {
  name = "anthropic" as const;
  model = MODEL.startsWith("claude") ? MODEL : "claude-3-5-sonnet-latest";

  async complete(opts: AiCompletionOptions): Promise<AiCompletionResult> {
    const res = await fetch(`${BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 900,
        temperature: opts.temperature ?? 0.7,
        system: opts.system,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const text = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
      : "";
    return {
      text,
      provider: "anthropic",
      model: this.model,
      tokensUsed:
        (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) || undefined,
      fallback: false,
    };
  }
}

/** Returns a live provider, or null when running on the built-in mock. */
export function getLiveProvider(): AiProvider | null {
  if (PROVIDER === "openai" && API_KEY) return new OpenAiProvider();
  if (PROVIDER === "anthropic" && API_KEY) return new AnthropicProvider();
  return null;
}

export const aiConfig = { provider: PROVIDER, model: MODEL };
