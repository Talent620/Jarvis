import type { ToolDef } from "../tools";

export type ProviderId = "anthropic" | "gemini" | "groq" | "cerebras" | "mistral" | "cohere" | "openrouter" | "nvidia" | "github" | "ollama" | "webllm";

/** Profil rozumowania — ile „myślenia" włożyć w odpowiedź (wg rodzaju zadania). */
export type ReasoningProfile = "minimal" | "low" | "medium" | "high";

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

/** Strukturalna klasa powodu failoveru — z REALNEGO błędu, nigdy zgadywana. „unknown" jest
 *  uczciwym wyjściem, gdy błąd nie pasuje do żadnego wzorca (nie podstawiamy „był zajęty"). */
export type FallbackReasonKind =
  | "timeout"        // przekroczony czas oczekiwania
  | "quota"          // limit zapytań / brak środków (429/402, rate limit, billing)
  | "auth"           // klucz/dostęp (401/403, brak skonfigurowanego klucza)
  | "unavailable"    // dostawca/model niedostępny (5xx, overloaded, brak endpointów, bezpiecznik)
  | "low_confidence" // eskalacja Bramy Pewności: lokalny refleks był niepewny
  | "offline"        // błąd sieci po naszej stronie (brak internetu/połączenia)
  | "unknown";       // nie wiemy — i mówimy to wprost

export interface JarvisReply {
  text: string;
  tools: string[];
  citations?: { title: string; url: string }[];
  /** Który dostawca faktycznie odpowiedział (do informacji o failoverze). */
  via?: ProviderId;
  /** True, gdy odpowiedział dostawca zapasowy (główny nie odpowiedział/wyczerpany). */
  fellBack?: boolean;
  /** Prawdziwy, znany powód niepowodzenia głównego dostawcy (humanize() realnego błędu, odkażony
   *  z sekretów/stack trace) — gdy nieznany, zostaje pusty (NIGDY nie zgadujemy, np. „był zajęty"). */
  fellBackReason?: string;
  /** Strukturalna klasa powodu failoveru (patrz FallbackReasonKind). */
  fellBackReasonKind?: FallbackReasonKind;
  /** Zużycie tokenów zgłoszone przez API (gdy dostępne). */
  usage?: TokenUsage;
  /** Powód zakończenia od dostawcy (gdy zwraca): np. „length"/„max_tokens"/„MAX_TOKENS" = ucięcie. */
  finishReason?: string;
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
  /** Profil rozumowania — ile „myślenia" włożyć (wg rodzaju zadania, nie długości tekstu).
   *  Dostawcy z myśleniem (Gemini 2.5/3) mapują go na thinkingBudget / thinkingLevel. */
  reasoningProfile?: ReasoningProfile;
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
