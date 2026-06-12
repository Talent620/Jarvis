import type { AppData, Settings } from "../types";

const DATA_KEY = "jarvis.data.v2";
const SETTINGS_KEY = "jarvis.settings.v2";

const emptyData: AppData = {
  tasks: [],
  notes: [],
  reminders: [],
  shopping: [],
  calendar: [],
  memory: [],
  scenes: [],
  audit: [],
  projects: [],
  projectFiles: [],
  tally: [],
  journal: [],
  leads: [],
  flashcards: [],
};

const defaultSettings: Settings = {
  provider: "auto",
  keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" },
  model: "auto",
  proxyUrl: "",
  syncUrl: "",
  syncToken: "",
  ollamaUrl: "",
  unfilteredLocal: false,
  deepThink: false,
  expertKnowledge: true,
  activeProjectId: "",
  theme: "default",
  userName: "Sir",
  persona: "classic",
  customPersona: "",
  interpreterMode: false,
  interpreterFrom: "polski",
  interpreterTo: "angielski",
  webSearch: true,
  tavilyApiKey: "",
  speak: true,
  geminiTts: true,
  geminiVoice: "Charon",
  voiceConfirm: true,
  soundCues: true,
  haptics: true,
  voiceName: "",
  voicePitch: 0.9,
  voiceRate: 1.0,
  wakeWord: false,
  autoListenOnOpen: false,
  proactiveOnOpen: true,
  dailyBriefing: false,
  briefingTime: "08:00",
  autoProspect: false,
  prospectNiche: "",
  prospectLocation: "",
  autoDraftOffers: false,
  backgroundWake: false,
  elevenLabsApiKey: "",
  elevenLabsVoiceId: "",
  fishAudioApiKey: "",
  fishAudioVoiceId: "",
  clipboardWatch: false,
  councilMode: false,
  adaptiveUi: true,
  voiceModeWake: false,
  homeAssistantUrl: "",
  homeAssistantToken: "",
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

// --- Reaktywny magazyn z prostym pub/sub ---

type Listener = () => void;

function normalizeSettings(s: Settings & { anthropicApiKey?: string }): Settings {
  // Uzupełnij brakujące klucze dostawców i zmigruj stary pojedynczy klucz Anthropic.
  s.keys = { ...defaultSettings.keys, ...(s.keys || {}) };
  if (s.anthropicApiKey && !s.keys.anthropic) {
    s.keys.anthropic = s.anthropicApiKey;
    s.provider = "anthropic";
  }
  delete s.anthropicApiKey;
  // Uzupełnij brakujące klucze wartościami wstrzykniętymi przy budowie (Secrets).
  const injected = typeof __DEFAULT_KEYS__ !== "undefined" ? __DEFAULT_KEYS__ : {};
  for (const k of Object.keys(s.keys)) {
    if (!s.keys[k] && injected[k]) s.keys[k] = injected[k];
  }
  // Tavily (research) nie jest dostawcą AI — ma własne pole w ustawieniach.
  if (!s.tavilyApiKey && (injected as Record<string, string>).tavily) {
    s.tavilyApiKey = (injected as Record<string, string>).tavily;
  }
  return s;
}

class Store {
  data: AppData = read<AppData>(DATA_KEY, emptyData);
  settings: Settings = normalizeSettings(read<Settings>(SETTINGS_KEY, defaultSettings));
  /** Rośnie przy każdej zmianie — używane jako snapshot dla Reacta. */
  version = 0;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  setData(mut: (d: AppData) => void) {
    mut(this.data);
    write(DATA_KEY, this.data);
    this.emit();
  }

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    write(SETTINGS_KEY, this.settings);
    this.emit();
  }
}

export const store = new Store();
