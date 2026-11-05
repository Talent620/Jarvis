/** Per-request controls; never mutate global settings for a temporary chat. */
export interface ConversationOptions {
  signal?: AbortSignal;
  memoryPolicy?: "normal" | "private";
}

/** Background learning must recheck this after awaits, including cancellation. */
export function canRetainConversation(options: ConversationOptions = {}): boolean {
  return options.memoryPolicy !== "private" && !options.signal?.aborted;
}

const MEMORY_TOOLS = new Set(["remember_fact", "forget_fact"]);

export function isMemoryToolBlocked(name: string, options: ConversationOptions = {}): boolean {
  return options.memoryPolicy === "private" && MEMORY_TOOLS.has(name);
}

export function redactConversationAudit(value: string, options?: ConversationOptions): string;
export function redactConversationAudit(value: unknown, options?: ConversationOptions): unknown;
export function redactConversationAudit(value: unknown, options: ConversationOptions = {}): unknown {
  if (options.memoryPolicy !== "private") return value;
  return typeof value === "string" ? "[Treść prywatnej rozmowy pominięta]" : { privateConversation: true };
}
