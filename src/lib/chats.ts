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

// Usuwa ciężkie obrazy (base64) z sesji poza `keepFirst` najnowszymi — w historii
// zostaje znacznik, dzięki czemu zdjęcia nie wysadzają limitu localStorage.
export function stripImages(list: ChatSession[], keepFirst: number): ChatSession[] {
  return list.map((c, i) =>
    i < keepFirst
      ? c
      : {
          ...c,
          messages: c.messages.map((m) =>
            m.image ? { ...m, image: undefined, text: m.text || "📷 (zdjęcie)" } : m,
          ),
        },
  );
}

export function saveChats(list: ChatSession[]): void {
  const capped = list.slice(0, 50);
  // Próbuj zapisać; przy przekroczeniu limitu degraduj coraz agresywniej,
  // zamiast po cichu nie zapisać nic.
  const attempts: (() => string)[] = [
    () => JSON.stringify(capped),
    () => JSON.stringify(stripImages(capped, 3)), // obrazy tylko w 3 najnowszych
    () => JSON.stringify(stripImages(capped, 1)), // obrazy tylko w aktywnej
    () => JSON.stringify(stripImages(capped.slice(0, 20), 1)), // mniej sesji
    () => JSON.stringify(stripImages(capped.slice(0, 8), 0)), // ostatnia deska ratunku
  ];
  for (const build of attempts) {
    try {
      localStorage.setItem(KEY, build());
      return;
    } catch {
      /* limit — spróbuj agresywniej */
    }
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
