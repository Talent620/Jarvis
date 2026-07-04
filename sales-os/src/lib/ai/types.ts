export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiCompletionOptions {
  system?: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionResult {
  text: string;
  provider: "mock" | "openai" | "anthropic";
  model: string;
  tokensUsed?: number;
  /** true when the deterministic fallback produced the text (no live model). */
  fallback: boolean;
}

export interface AiProvider {
  name: "mock" | "openai" | "anthropic";
  model: string;
  complete(opts: AiCompletionOptions): Promise<AiCompletionResult>;
}
