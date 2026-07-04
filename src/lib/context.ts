import type { ChatMessage } from "../types";

// Budowanie okna kontekstu rozmowy dla modelu. Kluczowe dla „pamiętania": z
// historii WYRZUCAMY automatyczne komunikaty systemowe (powitania, przypomnienia,
// briefingi, potwierdzenia trybu), bo to nie jest rozmowa — tylko zaśmiecały okno
// i wypychały to, co użytkownik realnie napisał. Zostaje czysty dialog.

// Etykiety narzędzi oznaczające komunikat SYSTEMOWY (nie część dialogu user↔AI).
const SYSTEM_TAGS = new Set(["wake", "proactive", "reminder", "briefing", "tryb", "easter-egg", "prospect"]);

export function isSystemMessage(m: ChatMessage): boolean {
  return m.role === "assistant" && !!m.tools?.some((t) => SYSTEM_TAGS.has(t));
}

export interface CtxMsg {
  role: "user" | "assistant";
  content: string;
  image?: { data: string; mediaType: string };
}

/**
 * Zwraca okno kontekstu: czysty dialog (bez komunikatów systemowych),
 * przycięty do ostatnich `max` wiadomości (domyślnie 30 — sporo więcej niż 20).
 */
export function buildContext(messages: ChatMessage[], max = 30): CtxMsg[] {
  return messages
    .filter((m) => !isSystemMessage(m))
    .slice(-max)
    .map((m) => ({ role: m.role, content: m.text, image: m.image }));
}
