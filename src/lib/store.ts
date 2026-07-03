import type { AppData, Settings } from "../types";
import { emptyProfile } from "./profile";
import { toast } from "./toast";
import { idbAvailable, idbGet, idbSet } from "./db";

const DATA_KEY = "jarvis.data.v2";
const SETTINGS_KEY = "jarvis.settings.v2";

// Kolekcje, które rosną (embeddingi pamięci, logi) — trzymane w IndexedDB zamiast localStorage,
// by zdjąć sufit ~5 MB (AUDIT.md dług #1). `store.data` zostaje w RAM i synchroniczne; tu tylko
// trwałość. Gdy IndexedDB niedostępny → wszystko wraca do localStorage (jak dotąd).
const IDB_COLLECTIONS: (keyof AppData)[] = ["memory", "sentMail", "contentPosts", "imageHistory", "siteProjects", "projectFiles"];
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
  imageHistory: [],
  siteProjects: [],
  financeProjects: [],
  world: { entities: [], relations: [] },
};

// Domyślna stopka e-mail (czysta, „wizytówkowa"): nazwisko, telefon, strona.
// Eksportowana, by migracja i testy korzystały z jednego źródła prawdy.
export const DEFAULT_EMAIL_SIGNATURE = "—\nMarcin Kubicki\ntel. +48 500 390 009\nwww.v-ai.pl";
// Dawne domyślne stopki (bez nazwiska) — gdy użytkownik nigdy nie zmieniał, podnosimy do nowej.
const LEGACY_EMAIL_SIGNATURES = ["—\ntel. +48 500 390 009\nwww.v-ai.pl"];

const defaultSettings: Settings = {
  // Domyślnie STAŁY umysł: najlepszy darmowy model (Gemini 2.5 Flash, #1 tool-calling) zamiast
  // auto-przełączania. Bez klucza Gemini router płynnie spada na dostawcę, do którego masz klucz.
  provider: "gemini",
  keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", cohere: "", openrouter: "", nvidia: "", github: "" },
  model: "gemini-2.5-flash",
  proxyUrl: "",
  smtpUser: "",
  smtpPass: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  emailSignature: DEFAULT_EMAIL_SIGNATURE,
  mailDailyLimit: 0,
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
  webllmEnabled: false,
  webllmModel: "",
  localStt: false,
  localTts: false,
  localFirstSimple: false,
  ollamaNumCtx: 4096,
  ollamaNumGpu: -1,
  ollamaNoThink: true,
  ollamaNumPredict: 0,
  ollamaModelSimple: "",
  ollamaModelComplex: "",
  ollamaModelVision: "",
  ollamaModelUncensored: "",
  confidenceGate: false,
  confidenceThreshold: 0.55,
  speculativeMode: false,
  councilIncludeLocal: false,
  adaptiveRouter: false,
  prewarmLocal: false,
  localRefine: false,
  localConsensus: false,
  responseLength: "balanced",
  intelligenceMode: "balanced",
  geminiAllowPreview: false,
  warmth: 0.5,
  ollamaUrl: "",
  sdUrl: "",
  sdModel: "",
  guardianProactive: false,
  guardianAutopilot: false,
  requireConsentAlways: false,
  bossFullAccess: false,
  bossVoice: "kapitan",
  freeMode: false,
  brainReservePct: 35,
  unfilteredLocal: false,
  deepThink: false,
  verifyHard: false,
  expertKnowledge: true,
  activeProjectId: "",
  theme: "default",
  panelDock: "center",
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
  voiceSystemPl: true,
  // Domyślnie STAŁY, premium głos JARVISA: tor Gemini (z kluczem) + przypięcie (bez podmian).
  // Bez klucza Gemini głos płynnie spada na stały polski głos systemowy.
  voiceMode: "gemini",
  voicePinned: true,
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
  prospectCount: 15,
  autoDraftOffers: false,
  followUpDays: 3,
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

/**
 * Audyt #1: twardo znormalizuj wczytane dane — KAŻDA kolekcja MUSI być tablicą, a `world`
 * poprawnym obiektem. Uszkodzony/częściowy localStorage (np. `tasks:null`, `world` bez
 * `relations`) inaczej wywala apkę przy `unshift`/`find`. Idempotentne, mutuje i zwraca `d`.
 */
export function normalizeData(d: AppData): AppData {
  const rec = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(emptyData) as (keyof AppData)[]) {
    if (k === "world") continue;
    if (!Array.isArray(rec[k as string])) rec[k as string] = [];
  }
  const w = d.world as { entities?: unknown; relations?: unknown } | undefined;
  if (!w || typeof w !== "object") d.world = { entities: [], relations: [] };
  else {
    if (!Array.isArray(w.entities)) w.entities = [];
    if (!Array.isArray(w.relations)) w.relations = [];
  }
  return d;
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
    } else {
      // localStorage całkowicie niedostępny (tryb prywatny / wyłączony w przeglądarce) — zapis
      // cicho przepada, a WSZYSTKIE dane znikną po odświeżeniu. Wcześniej połykaliśmy ten błąd
      // bez słowa; teraz ostrzegamy (z tym samym throttlingiem), zamiast udawać, że zapisano.
      const now = Date.now();
      if (now - lastQuotaWarn > 300_000) {
        lastQuotaWarn = now;
        toast("⚠ Pamięć przeglądarki niedostępna (tryb prywatny?) — zmiany NIE zapisują się i znikną po odświeżeniu. Zrób kopię w ⚙ → Dane.");
      }
    }
  }
}

// Górne limity dla kolekcji automatycznie rosnących (logi), by nie dobić quoty.
// Dane tworzone wprost przez użytkownika (zadania, notatki, dziennik, leady) NIE są przycinane.
const COLLECTION_CAPS: Partial<Record<keyof AppData, number>> = {
  sentMail: 500,
  contentPosts: 500,
  imageHistory: 16, // obrazy są ciężkie (base64) — trzymaj tylko ostatnie przeróbki
  siteProjects: 20, // projekty stron (HTML + wersje) są ciężkie — rozsądny limit
};
/**
 * Atomowość A1: scal dwie listy rekordów po `id` — `primary` (nowsze, np. RAM) wygrywa przy
 * kolizji, a unikalne z `secondary` (np. zapisane w IDB) są dołączane. Dzięki temu zapisy, które
 * trafiły do RAM W TRAKCIE async hydratacji, NIE kasują danych z dysku (i odwrotnie). Pure.
 */
export function mergeById<T extends { id?: string }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of primary || []) { if (x && x.id) seen.add(x.id); out.push(x); }
  for (const x of secondary || []) { if (x && x.id && seen.has(x.id)) continue; out.push(x); }
  return out;
}

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
  // Stopka e-mail: gdy użytkownik nigdy jej nie zmieniał (stara domyślna), podnieś do nowej
  // z nazwiskiem. Własne, ręcznie ustawione stopki zostają nietknięte.
  if (LEGACY_EMAIL_SIGNATURES.includes(s.emailSignature)) s.emailSignature = DEFAULT_EMAIL_SIGNATURE;
  return s;
}

// Transformacja ustawień TUŻ PRZED zapisem na dysk (nie zmienia kopii w pamięci).
// Rejestrowana przez secretsVault, by wymazać klucze API z localStorage, gdy włączone
// jest szyfrowanie w spoczynku (klucze trzymane wtedy w osobnym, zaszyfrowanym blobie).
let settingsPersistTransform: (s: Settings) => Settings = (s) => s;
export function setSettingsPersistTransform(fn: (s: Settings) => Settings): void {
  settingsPersistTransform = fn;
}

// Moduł-level uchwyt na AKTUALNIE podpiętą instancję globalnych listenerów. Gwarantuje, że nawet
// po ponownej ewaluacji modułu (HMR) lub utworzeniu drugiej instancji Store, STARE listenery
// zostają odpięte przed podpięciem nowych — koniec narastania (wyciek listenerów/pamięci).
let boundStore: Store | null = null;

export class Store {
  data: AppData = normalizeData(read<AppData>(DATA_KEY, emptyData)); // #1: twarda normalizacja
  settings: Settings = normalizeSettings(read<Settings>(SETTINGS_KEY, defaultSettings));
  /** Rośnie przy każdej zmianie — używane jako snapshot dla Reacta. */
  version = 0;
  private listeners = new Set<Listener>();
  /** Czy duże kolekcje są obsługiwane przez IndexedDB (po udanej migracji/hydratacji). */
  private idbReady = false;
  private idbFlushTimer: ReturnType<typeof setTimeout> | null = null;
  // Atomowość A2: serializacja flushy IDB. `flushing` = trwa flush; `flushDirty` = dane zmieniły
  // się w trakcie i trzeba flush ponowić z najświeższym stanem.
  private flushing = false;
  private flushDirty = false;

  // STABILNE referencje handlerów — niezbędne, by removeEventListener faktycznie je odpiął.
  private onStorage = (e: StorageEvent) => {
    // storage event odpala się TYLKO w INNYCH kartach (nie w tej, która zapisała) — brak pętli.
    if (e.key === SETTINGS_KEY) {
      this.settings = normalizeSettings(read<Settings>(SETTINGS_KEY, defaultSettings));
      this.emit();
    } else if (e.key === DATA_KEY) {
      this.reloadDataFromDisk();
    }
  };
  private flushOnHide = () => {
    if (this.idbFlushTimer) { clearTimeout(this.idbFlushTimer); this.idbFlushTimer = null; void this.flushIdb(); }
  };
  private onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") this.flushOnHide();
  };

  constructor() {
    void this.initPersistence();
    this.bindGlobalListeners();
  }

  /**
   * Idempotentnie podepnij globalne listenery (#2 sync kart, #4 flush przy zamknięciu). NAJPIERW
   * odpina ewentualne poprzednie (HMR/druga instancja), więc listenery nie mogą narastać.
   */
  private bindGlobalListeners() {
    if (typeof window === "undefined") return;
    try {
      boundStore?.unbindGlobalListeners(); // anty-wyciek: usuń poprzednie powiązanie
      window.addEventListener("storage", this.onStorage);
      window.addEventListener("pagehide", this.flushOnHide);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
      boundStore = this;
    } catch { /* środowisko bez window/document — pomiń */ }
  }

  /** Odpnij globalne listenery (te same, stabilne referencje). */
  private unbindGlobalListeners() {
    if (typeof window === "undefined") return;
    try {
      window.removeEventListener("storage", this.onStorage);
      window.removeEventListener("pagehide", this.flushOnHide);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    } catch { /* ignore */ }
    if (boundStore === this) boundStore = null;
  }

  /**
   * Sprzątanie: odpina globalne listenery i kasuje timer flush. Wołać przy zamknięciu okna
   * Electrona / HMR / w testach. Additive — nie zmienia istniejącego API.
   */
  dispose(): void {
    this.unbindGlobalListeners();
    if (this.idbFlushTimer) { clearTimeout(this.idbFlushTimer); this.idbFlushTimer = null; }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version++;
    // Audyt #3: jeden wadliwy listener NIE może zablokować odświeżenia pozostałych komponentów.
    this.listeners.forEach((fn) => { try { fn(); } catch { /* izoluj błąd listenera */ } });
  }

  // Audyt #2: przeładuj dane po zmianie w innej karcie. Kolekcje user-facing (zadania, leady,
  // finanse…) są w blobie → adoptujemy je. Ciężkie kolekcje IDB zachowujemy z RAM (źródłem
  // prawdy dla nich jest IDB; pojawią się po naturalnym przeładowaniu apki).
  private reloadDataFromDisk() {
    try {
      const fresh = normalizeData(read<AppData>(DATA_KEY, emptyData));
      if (this.idbReady) {
        const cur = this.data as unknown as Record<string, unknown[]>;
        for (const c of IDB_COLLECTIONS) (fresh as unknown as Record<string, unknown[]>)[c] = cur[c] || [];
      }
      this.data = fresh;
      this.emit();
    } catch { /* ignore — zostaje bieżący stan RAM */ }
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
    // A2: tylko JEDEN flush naraz. Jeśli już leci — oznacz „brudne" i wróć; bieżący flush ponowi
    // przebieg z najświeższymi danymi. Eliminuje równoległe/przeplatane zapisy i stale-overwrite.
    if (this.flushing) { this.flushDirty = true; return; }
    this.flushing = true;
    try {
      do {
        this.flushDirty = false;
        const rec = this.data as unknown as Record<string, unknown[]>; // ZAWSZE najświeższe this.data
        let allOk = true;
        for (const c of IDB_COLLECTIONS) {
          const ok = await idbSet(c as string, rec[c as string]);
          if (!ok) allOk = false;
        }
        // 🛟 Sieć bezpieczeństwa: gdy zapis do IndexedDB zawiódł (transakcja przerwana, brak miejsca),
        // ciężkie kolekcje przepadłyby (slim blob ma puste tablice) — zapisz PEŁNY blob do localStorage.
        if (!allOk) {
          try { write(DATA_KEY, this.data); } catch { /* ostatnia deska — quota itp. obsłużone w write */ }
        }
      } while (this.flushDirty); // ktoś zmienił dane w trakcie flusha → przebieg jeszcze raz
    } finally {
      this.flushing = false;
    }
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
        // WAŻNE: nie ustawiaj idbReady=true PRZED hydratacją. Inaczej setData w trakcie `await idbGet`
        // poszedłby ścieżką „slim" i zapisałby PUSTE tablice z RAM do IDB, kasując zapisane dane.
        // W trakcie hydratacji zapisy idą do localStorage (pełne) — IDB pozostaje nietknięte.
        let lateOk = true;
        for (const c of IDB_COLLECTIONS) {
          const persisted = await idbGet<unknown[]>(c as string);
          const ram = rec[c as string];
          if (!Array.isArray(persisted)) {
            // Kolekcja NIGDY nie trafiła do IDB (np. nowo dodana do listy, jak projectFiles, u
            // wcześniej-zmigrowanego użytkownika). Zmigruj ją z RAM/localStorage do IDB TERAZ,
            // zanim persistData odchudzi localStorage — inaczej dane by zniknęły.
            if (Array.isArray(ram) && ram.length) lateOk = (await idbSet(c as string, ram)) && lateOk;
            continue;
          }
          // A1: gdy setData dopisał coś do RAM W TRAKCIE hydratacji, NIE wolno ani pominąć
          // zapisanych danych (utrata persisted), ani ich nadpisać (utrata nowych). SCAL je
          // (dedup po id, RAM nowsze wygrywa). Gdy RAM puste — po prostu wczytaj zapisane.
          rec[c as string] = Array.isArray(ram) && ram.length
            ? (mergeById(ram as { id?: string }[], persisted as { id?: string }[]) as unknown[])
            : persisted;
        }
        // Jeśli migracja nowej kolekcji do IDB się nie udała — NIE odchudzaj localStorage
        // (zostań na pełnym localStorage, zero utraty). Spróbujemy ponownie przy następnym starcie.
        if (!lateOk) return;
        this.idbReady = true; // dopiero teraz — hydratacja zakończona, można odchudzać do IDB
        this.emit();
      }
    } catch {
      this.idbReady = false; // jakikolwiek błąd → bezpieczny powrót do localStorage
    }
  }

  setData(mut: (d: AppData) => void) {
    // Audyt #5: mutator rzucający w połowie NIE może wywalić apki. Łapiemy, logujemy do konsoli
    // i kontynuujemy (zapis + emit bieżącego stanu), zamiast pozwolić wyjątkowi rozlać się po UI.
    try { mut(this.data); } catch (e) { try { console.error("[JARVIS] setData mutator error:", e); } catch { /* ignore */ } }
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

// HMR (tylko dev): przy podmianie modułu odpinamy listenery starej instancji, by nie narastały.
try {
  const hot = (import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } }).hot;
  if (hot) hot.dispose(() => store.dispose());
} catch { /* brak HMR (produkcja/testy) — pomiń */ }
