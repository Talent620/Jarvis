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

export interface ChatSaveResult {
  ok: boolean; // czy cokolwiek zapisano
  degraded: boolean; // czy trzeba było obciąć obrazy/sesje (utrata szczegółów)
  tier: number; // który poziom próby zadziałał (0 = pełny zapis)
  keptSessions: number; // ile sesji realnie zapisano
}

// Pozwól UI dowiedzieć się o degradacji (zamiast cichego console.error).
let storageWarner: ((r: ChatSaveResult) => void) | null = null;
export function setChatStorageWarner(fn: ((r: ChatSaveResult) => void) | null): void { storageWarner = fn; }

export function saveChats(list: ChatSession[]): ChatSaveResult {
  const capped = list.slice(0, 50);
  // Próbuj zapisać; przy przekroczeniu limitu degraduj coraz agresywniej,
  // zamiast po cichu nie zapisać nic. Każdy poziom wie, ile sesji zachowuje.
  const attempts: { build: () => string; kept: number }[] = [
    { build: () => JSON.stringify(capped), kept: capped.length },
    { build: () => JSON.stringify(stripImages(capped, 3)), kept: capped.length }, // obrazy tylko w 3 najnowszych
    { build: () => JSON.stringify(stripImages(capped, 1)), kept: capped.length }, // obrazy tylko w aktywnej
    { build: () => JSON.stringify(stripImages(capped.slice(0, 20), 1)), kept: Math.min(20, capped.length) }, // mniej sesji
    { build: () => JSON.stringify(stripImages(capped.slice(0, 8), 0)), kept: Math.min(8, capped.length) }, // ostatnia deska ratunku
  ];
  for (let i = 0; i < attempts.length; i++) {
    try {
      localStorage.setItem(KEY, attempts[i].build());
      const res: ChatSaveResult = { ok: true, degraded: i > 0, tier: i, keptSessions: attempts[i].kept };
      if (res.degraded) storageWarner?.(res); // utrata szczegółów — zgłoś do UI
      return res;
    } catch {
      /* limit — spróbuj agresywniej */
    }
  }
  // Wszystkie próby wyczerpały limit — nie gub po cichu, zasygnalizuj.
  console.error("[chats] Nie udało się zapisać historii czatu — pamięć (localStorage) pełna.");
  const res: ChatSaveResult = { ok: false, degraded: true, tier: attempts.length, keptSessions: 0 };
  storageWarner?.(res);
  return res;
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
