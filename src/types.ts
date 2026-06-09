// Współdzielone typy dla całej aplikacji JARVIS.

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  /** Tekst widoczny dla użytkownika. */
  text: string;
  /** Krótkie etykiety użytych narzędzi (np. "web_search", "add_task"). */
  tools?: string[];
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  due?: string; // ISO
  createdAt: number;
}

export interface Note {
  id: string;
  text: string;
  createdAt: number;
}

export interface Reminder {
  id: string;
  text: string;
  at: string; // ISO datetime
  fired: boolean;
  createdAt: number;
}

export interface ShoppingItem {
  id: string;
  name: string;
  qty?: string;
  done: boolean;
  createdAt: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  end?: string; // ISO
  location?: string;
  createdAt: number;
}

export interface MemoryFact {
  id: string;
  key: string;
  value: string;
  createdAt: number;
}

export interface AppData {
  tasks: Task[];
  notes: Note[];
  reminders: Reminder[];
  shopping: ShoppingItem[];
  calendar: CalendarEvent[];
  memory: MemoryFact[];
}

export interface Settings {
  /** Klucz API Anthropic (przechowywany lokalnie na urządzeniu). */
  anthropicApiKey: string;
  /** Model Claude. */
  model: string;
  /** Imię użytkownika, którym zwraca się JARVIS. */
  userName: string;
  /** Czy włączyć wyszukiwanie w sieci (narzędzie serwerowe Claude). */
  webSearch: boolean;
  /** Czy mówić odpowiedzi na głos. */
  speak: boolean;
  /** Nazwa preferowanego głosu TTS (z systemu). */
  voiceName: string;
  /** Wysokość głosu (0.1–2). */
  voicePitch: number;
  /** Tempo głosu (0.1–2). */
  voiceRate: number;
  /** Ciągłe nasłuchiwanie słowa-klucza "Jarvis". */
  wakeWord: boolean;
  /** Opcjonalny klucz ElevenLabs dla premium głosu JARVIS. */
  elevenLabsApiKey: string;
  /** ID głosu ElevenLabs. */
  elevenLabsVoiceId: string;
}
