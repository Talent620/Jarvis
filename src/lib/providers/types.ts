import type { ToolDef } from "../tools";

export type ProviderId = "anthropic" | "gemini" | "groq" | "openrouter" | "nvidia" | "github" | "ollama";

export interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Opcjonalny obraz dołączony do wiadomości (wizja). */
  image?: { data: string; mediaType: string };
}

export interface JarvisReply {
  text: string;
  tools: string[];
  citations?: { title: string; url: string }[];
}

/** Kontekst pojedynczego zapytania przekazywany adapterowi dostawcy. */
export interface AskCtx {
  apiKey: string;
  model: string;
  system: string;
  webSearch: boolean;
  tools: ToolDef[];
  history: Msg[];
  /** Opcjonalny adres backend-proxy (omija CORS, ukrywa klucz). */
  proxyUrl?: string;
}

export type ProviderImpl = (ctx: AskCtx) => Promise<JarvisReply>;

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Ranga jakości do trybu „auto" (wyżej = lepszy). */
  rank: number;
  models: ModelOption[];
  defaultModel: string;
  keysUrl: string;
  impl: ProviderImpl;
  /** Czy dostawca zwykle wymaga proxy w przeglądarce (CORS). */
  needsProxy?: boolean;
}
