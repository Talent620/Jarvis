import type { ToolDef } from "../tools";

export type ProviderId = "anthropic" | "gemini" | "groq" | "cerebras" | "mistral" | "openrouter" | "nvidia" | "github" | "ollama" | "webllm";

export interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Opcjonalny obraz dołączony do wiadomości (wizja). */
  image?: { data: string; mediaType: string };
}

/** Zużycie tokenów (do telemetrii kosztów — Faza 5). Sumowane przez całą turę (z pętlą narzędzi). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JarvisReply {
  text: string;
  tools: string[];
  citations?: { title: string; url: string }[];
  /** Który dostawca faktycznie odpowiedział (do informacji o failoverze). */
  via?: ProviderId;
  /** True, gdy odpowiedział dostawca zapasowy (główny był zajęty/wyczerpany). */
  fellBack?: boolean;
  /** Zużycie tokenów zgłoszone przez API (gdy dostępne). */
  usage?: TokenUsage;
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
  /** Tryb szybki — pomija „głębokie myślenie" (niższa jakość, dużo niższe
   *  opóźnienie). Do zadań prostych/czasowo wrażliwych, np. tłumaczenia na żywo. */
  fast?: boolean;
  /** Callback strumieniowania: wywoływany z każdą deltą tekstu w miarę generowania.
   *  Gdy podany, adapter streamuje odpowiedź (jeśli potrafi); inaczej zwraca całość naraz. */
  onToken?: (delta: string) => void;
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
