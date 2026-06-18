import type { AppData, Settings } from "../types";
import { emptyProfile } from "./profile";
import { toast } from "./toast";
import { idbAvailable, idbGet, idbSet } from "./db";

const DATA_KEY = "jarvis.data.v2";
const SETTINGS_KEY = "jarvis.settings.v2";

// Kolekcje, które rosną (embeddingi pamięci, logi) — trzymane w IndexedDB zamiast localStorage,
// by zdjąć sufit ~5 MB (AUDIT.md dług #1). `store.data` zostaje w RAM i synchroniczne; tu tylko
// trwałość. Gdy IndexedDB niedostępny → wszystko wraca do localStorage (jak dotąd).
const IDB_COLLECTIONS: (keyof AppData)[] = ["memory", "sentMail", "contentPosts"];
const IDB_MIGRATED_KEY = "jarvis.idb.migrated.v1";

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
  bargainWatch: [],
  sentMail: [],
  contentPosts: [],
};

const defaultSettings: Settings = {
  provider: "auto",
  keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" },
  model: "auto",
  proxyUrl: "",
  smtpUser: "",
  smtpPass: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  emailSignature: "—\ntel. +48 500 390 009\nwww.v-ai.pl",
  syncUrl: "",
  syncToken: "",
  salesOsUrl: "",
  salesOsToken: "",
  salesOsAutoSync: 0,
  memoryServiceUrl: "",
  memoryServiceToken: "",
  mcpServers: "",
  mcpAllowlist: "",
  aiPricingOverrides: "",
  aiMonthlyBudgetUsd: 0,
  onDeviceOnly: false,
  brandName: "",
  secretsAtRest: false,
  openrouterLowBalanceUsd: 0,
  localEmbeddings: false,
  ollamaUrl: "",
  unfilteredLocal: false,
  deepThink: false,
  expertKnowledge: true,
  activeProjectId: "",
  theme: "default",
  userName: "Sir",
  profile: { ...emptyProfile },
  persona: "classic",
  customPersona: "",
  interpreterMode: false,
  interpreterFrom: "polski",
  interpreterTo: "angielski",
  webSearch: true,
  tavilyApiKey: "",
  falApiKey: "",
  studioKeys: "",
  n8nUrl: "",
  n8nToken: "",
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
  proactiveAgent: true,
  dailyBriefing: false,
  briefingTime: "08:00",
  autoProspect: false,
  salesAutopilot: true,
  translatorVoice: "Aoede",
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
  voiceLock: false,
  voiceProfile: [],
  voiceMatch: 0.6,
  endpointShortMs: 900,
  adaptiveUi: true,
  voiceModeWake: false,
  homeAssistantUrl: "",
  homeAssistantToken: "",
  micDeviceId: "",
  googleClientId: "",
  googleClientSecret: "",
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

// Trwały sygnał przepełnienia pamięci (UI może pokazać baner). Nie tylko jednorazowy toast —
// po przepełnieniu KAŻDY kolejny zapis cicho przepada, więc utrzymujemy flagę i co jakiś czas
// ponawiamy ostrzeżenie, zamiast udawać, że dane się zapisały.
let storageFull = false;
let lastQuotaWarn = 0;
export function isStorageFull(): boolean {
  return storageFull;
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageFull = false;
  } catch (e) {
    const quota = e instanceof Error && (e.name === "QuotaExceededError" || /quota/i.test(e.message));
    if (quota) {
      storageFull = true;
      const now = Date.now();
      if (now - lastQuotaWarn > 300_000) { // ponów co ~5 min, nie tylko raz na sesję
        lastQuotaWarn = now;
        toast("⚠ Brak miejsca w pamięci — zrób kopię (⚙ → Dane) i wyczyść stare czaty/leady. Nowe zmiany NIE zapisują się!");
      }
    }
  }
}

// Górne limity dla kolekcji automatycznie rosnących (logi), by nie dobić quoty.
// Dane tworzone wprost przez użytkownika (zadania, notatki, dziennik, leady) NIE są przycinane.
const COLLECTION_CAPS: Partial<Record<keyof AppData, number>> = {
  sentMail: 500,
  contentPosts: 500,
};
function capCollections(d: AppData): void {
  const rec = d as unknown as Record<string, unknown[]>;
  for (const k in COLLECTION_CAPS) {
    const cap = COLLECTION_CAPS[k as keyof AppData]!;
    const arr = rec[k];
    if (Array.isArray(arr) && arr.length > cap) rec[k] = arr.slice(0, cap);
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
  // BFF: jeśli build podał VITE_BFF_URL, a użytkownik nie ustawił własnego proxy —
  // domyślnie kieruj cały ruch AI przez BFF (klucze są tam, po stronie serwera).
  try {
    const bff = (import.meta as { env?: Record<string, string> }).env?.VITE_BFF_URL?.trim();
    if (bff && !s.proxyUrl?.trim()) s.proxyUrl = bff;
  } catch {
    /* brak import.meta.env (środowisko nie-Vite) — pomiń */
  }
  s.profile = { ...emptyProfile, ...(s.profile || {}) };
  return s;
}

// Transformacja ustawień TUŻ PRZED zapisem na dysk (nie zmienia kopii w pamięci).
// Rejestrowana przez secretsVault, by wymazać klucze API z localStorage, gdy włączone
// jest szyfrowanie w spoczynku (klucze trzymane wtedy w osobnym, zaszyfrowanym blobie).
let settingsPersistTransform: (s: Settings) => Settings = (s) => s;
export function setSettingsPersistTransform(fn: (s: Settings) => Settings): void {
  settingsPersistTransform = fn;
}

class Store {
  data: AppData = read<AppData>(DATA_KEY, emptyData);
  settings: Settings = normalizeSettings(read<Settings>(SETTINGS_KEY, defaultSettings));
  /** Rośnie przy każdej zmianie — używane jako snapshot dla Reacta. */
  version = 0;
  private listeners = new Set<Listener>();
  /** Czy duże kolekcje są obsługiwane przez IndexedDB (po udanej migracji/hydratacji). */
  private idbReady = false;
  private idbFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.initPersistence();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  // Trwałość danych: gdy IndexedDB gotowy, duże kolekcje idą do IDB, a w localStorage
  // zostaje odchudzony blob (bez nich). Inaczej — pełny blob w localStorage (zachowanie sprzed).
  private persistData() {
    if (this.idbReady) {
      const slim = { ...this.data } as AppData;
      for (const c of IDB_COLLECTIONS) (slim as unknown as Record<string, unknown[]>)[c] = [];
      write(DATA_KEY, slim);
      this.scheduleIdbFlush();
    } else {
      write(DATA_KEY, this.data);
    }
  }

  // Debounce: duże tablice zapisujemy do IDB zbiorczo, nie na każdą mikro-zmianę.
  private scheduleIdbFlush() {
    if (this.idbFlushTimer) clearTimeout(this.idbFlushTimer);
    this.idbFlushTimer = setTimeout(() => {
      this.idbFlushTimer = null;
      void this.flushIdb();
    }, 300);
  }

  private async flushIdb() {
    const rec = this.data as unknown as Record<string, unknown[]>;
    for (const c of IDB_COLLECTIONS) await idbSet(c as string, rec[c as string]);
  }

  // Jednorazowa migracja localStorage → IndexedDB + hydratacja przy starcie. Bezpieczne:
  // dane usuwamy z localStorage DOPIERO po udanym zapisie do IDB i ustawieniu flagi (idempotentne).
  private async initPersistence() {
    if (!idbAvailable()) return; // brak IDB → pełny localStorage, jak dotąd
    try {
      const rec = this.data as unknown as Record<string, unknown[]>;
      const migrated = (() => { try { return localStorage.getItem(IDB_MIGRATED_KEY) === "1"; } catch { return false; } })();
      if (!migrated) {
        let ok = true;
        for (const c of IDB_COLLECTIONS) {
          const arr = rec[c as string];
          if (Array.isArray(arr) && arr.length) ok = (await idbSet(c as string, arr)) && ok;
        }
        if (!ok) return; // migracja nieudana — zostajemy na localStorage (zero utraty)
        try { localStorage.setItem(IDB_MIGRATED_KEY, "1"); } catch { /* ignore */ }
        this.idbReady = true;
        this.persistData(); // odchudź blob localStorage (duże kolekcje są już w IDB)
      } else {
        this.idbReady = true;
        for (const c of IDB_COLLECTIONS) {
          const arr = await idbGet<unknown[]>(c as string);
          // Nie nadpisuj świeżych zapisów, gdyby setData wyprzedził hydratację.
          if (Array.isArray(arr) && !rec[c as string]?.length) rec[c as string] = arr;
        }
        this.emit();
      }
    } catch {
      this.idbReady = false; // jakikolwiek błąd → bezpieczny powrót do localStorage
    }
  }

  setData(mut: (d: AppData) => void) {
    mut(this.data);
    capCollections(this.data); // utnij rozrośnięte logi (sentMail/contentPosts) przed zapisem
    this.persistData();
    this.emit();
  }

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    // Na dysk idzie wersja po transformacji (np. z wymazanymi kluczami); pamięć bez zmian.
    write(SETTINGS_KEY, settingsPersistTransform(this.settings));
    this.emit();
  }
}

export const store = new Store();
