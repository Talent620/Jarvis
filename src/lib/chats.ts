import type { ChatMessage } from "../types";

// Historia wielu rozmów (trwała w localStorage).
const KEY = "jarvis.chats.v1";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export function loadChats(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveChats(list: ChatSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* ignore */
  }
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  return (first?.text.trim() || "Rozmowa").slice(0, 48);
}

// Zapisz/zaktualizuj sesję na liście i zwróć posortowaną listę (najnowsze pierwsze).
export function upsertChat(active: ChatSession): ChatSession[] {
  const list = loadChats().filter((c) => c.id !== active.id);
  list.unshift(active);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  saveChats(list);
  return list;
}
