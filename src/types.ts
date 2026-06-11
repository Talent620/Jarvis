// Współdzielone typy dla całej aplikacji JARVIS.

export type Role = "user" | "assistant";

export interface Citation {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  /** Tekst widoczny dla użytkownika. */
  text: string;
  /** Opcjonalny załączony obraz (wizja). */
  image?: { data: string; mediaType: string };
  /** Krótkie etykiety użytych narzędzi (np. "web_search", "add_task"). */
  tools?: string[];
  /** Źródła z wyszukiwania (tryb research). */
  citations?: Citation[];
  /** Wynik Trybu Konsylium (kilka modeli + ocena zgodności), jeśli użyty. */
  council?: { members: { label: string; text: string }[]; consensus: string; note: string };
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  tool: string;
  input: unknown;
  output?: string;
  status: "ok" | "error" | "denied";
  undo?: { collection: string; id: string };
  at: number;
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

export interface TallyItem {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  createdAt: number;
}

export interface MemoryFact {
  id: string;
  key: string;
  value: string;
  pinned?: boolean;
  /** Jeśli ustawione — fakt należy do projektu (inaczej globalny). */
  projectId?: string;
  /** Wektor semantyczny (text-embedding-004) do wyszukiwania trafnych faktów. */
  embedding?: number[];
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  text: string; // wyekstrahowana treść
  createdAt: number;
}

export interface SceneAction {
  entityId: string;
  action: "on" | "off" | "toggle";
}

export interface Scene {
  id: string;
  name: string;
  actions: SceneAction[];
  createdAt: number;
}

export interface AppData {
  tasks: Task[];
  notes: Note[];
  reminders: Reminder[];
  shopping: ShoppingItem[];
  calendar: CalendarEvent[];
  memory: MemoryFact[];
  scenes: Scene[];
  audit: AuditEntry[];
  projects: Project[];
  projectFiles: ProjectFile[];
  tally: TallyItem[];
  journal: JournalEntry[];
  leads: Lead[];
}

/** Lead sprzedażowy (mini-CRM / Pulpit Sprzedaży). */
export type LeadStatus = "new" | "contacted" | "offer" | "won" | "lost";
export interface Lead {
  id: string;
  company: string;
  url?: string;
  contact?: string; // e-mail / telefon
  niche?: string;
  location?: string;
  note?: string;
  /** Szacowana wartość zlecenia (PLN). */
  value?: number;
  /** Gotowy szkic oferty (cold mail) napisany przez JARVIS-a. */
  offer?: string;
  status: LeadStatus;
  createdAt: number;
  updatedAt: number;
}

/** Osobisty dziennik — przemyślenia użytkownika, oddzielne wpisy z tagami. */
export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** Nastrój/etykieta emocji (opcjonalnie). */
  mood?: string;
  /** Jeśli true — czat JARVIS-a może czytać ten wpis (kontekst). Domyślnie prywatne. */
  shared?: boolean;
  /** Przypięty wpis — zawsze na górze listy. */
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  /** Wybrany dostawca AI: "auto" lub konkretny (anthropic/gemini/groq/openrouter/nvidia/github). */
  provider: string;
  /** Klucze API per dostawca (przechowywane lokalnie na urządzeniu). */
  keys: Record<string, string>;
  /** Wybrany model (id) lub "auto". */
  model: string;
  /** Opcjonalny adres backend-proxy (omija CORS, chowa klucze). */
  proxyUrl: string;
  /** Adres backendu sync (ten sam Worker). */
  syncUrl: string;
  /** Prywatny token przestrzeni danych sync. */
  syncToken: string;
  /** Adres lokalnego modelu Ollama (np. http://192.168.0.10:11434). */
  ollamaUrl: string;
  /** Tryb nieocenzurowany — działa realnie tylko z modelem lokalnym (Ollama):
   *  JARVIS nie dokłada własnych zastrzeżeń/moralizowania i odpowiada wprost. */
  unfilteredLocal: boolean;
  /** Głębokie myślenie — przy złożonych pytaniach robi wewnętrzną analizę przed odpowiedzią. */
  deepThink: boolean;
  /** Wszczepiona wiedza ekspercka — dobiera modele mentalne do pytania (offline, za darmo). */
  expertKnowledge: boolean;
  /** Aktywny projekt/workspace ("" = ogólny). */
  activeProjectId: string;
  /** Motyw HUD: default | gold | green | red | purple. */
  theme: string;
  /** Imię użytkownika, którym zwraca się JARVIS. */
  userName: string;
  /** Preset osobowości: classic | concise | warm | witty | custom. */
  persona: string;
  /** Dodatkowy, własny opis osobowości (zawsze doklejany). */
  customPersona: string;
  /** Tryb tłumacza na żywo (JARVIS tłumaczy między językami). */
  interpreterMode: boolean;
  /** Język źródłowy tłumacza. */
  interpreterFrom: string;
  /** Język docelowy tłumacza. */
  interpreterTo: string;
  /** Czy włączyć wyszukiwanie w sieci (gdy dostawca je wspiera). */
  webSearch: boolean;
  /** Klucz Tavily (research z cytatami, niezależny od dostawcy). */
  tavilyApiKey: string;
  /** Czy mówić odpowiedzi na głos. */
  speak: boolean;
  /** Używaj darmowego głosu Gemini TTS (wysoka jakość, wymaga klucza Gemini). */
  geminiTts: boolean;
  /** Nazwa głosu Gemini TTS (np. Charon, Orus, Puck). */
  geminiVoice: string;
  /** Potwierdzanie akcji głosem (powiedz „tak"/„nie" w oknie zgody). */
  voiceConfirm: boolean;
  /** Subtelne dźwięki interfejsu (HUD). */
  soundCues: boolean;
  /** Wibracje (haptyka) przy akcjach. */
  haptics: boolean;
  /** Nazwa preferowanego głosu TTS (z systemu). */
  voiceName: string;
  /** Wysokość głosu (0.1–2). */
  voicePitch: number;
  /** Tempo głosu (0.1–2). */
  voiceRate: number;
  /** Ciągłe nasłuchiwanie słowa-klucza "Jarvis". */
  wakeWord: boolean;
  /** Po otwarciu aplikacji od razu zacznij słuchać i zapytaj, o co chodzi. */
  autoListenOnOpen: boolean;
  /** Po otwarciu pokaż proaktywne powitanie/raport. */
  proactiveOnOpen: boolean;
  /** Codzienny poranny briefing (pogoda + kalendarz + zadania) o ustalonej porze. */
  dailyBriefing: boolean;
  /** Godzina porannego briefingu w formacie HH:MM. */
  briefingTime: string;
  /** Automatyczne wyszukiwanie leadów kilka razy dziennie (gdy apka otwarta). */
  autoProspect: boolean;
  /** Nisza/branża do auto-prospektingu (np. „fryzjer"). */
  prospectNiche: string;
  /** Lokalizacja do auto-prospektingu (np. „Kraków"). */
  prospectLocation: string;
  /** Auto-pisanie szkiców ofert dla nowych leadów (czekają w Pulpicie). */
  autoDraftOffers: boolean;
  /** Natywny nasłuch słowa "Jarvis" w tle (uruchamia apkę głosem). */
  backgroundWake: boolean;
  /** Opcjonalny klucz ElevenLabs dla premium głosu JARVIS. */
  elevenLabsApiKey: string;
  /** ID głosu ElevenLabs. */
  elevenLabsVoiceId: string;
  /** Opcjonalny klucz Fish Audio (tani, topowy klon głosu). */
  fishAudioApiKey: string;
  /** reference_id głosu Fish Audio (np. sklonowany głos JARVIS). */
  fishAudioVoiceId: string;
  /** Desktop: obserwuj schowek i proaktywnie proponuj akcje (prywatność: domyślnie OFF). */
  clipboardWatch: boolean;
  /** Tryb Konsylium — przy złożonych pytaniach pytaj kilka modeli naraz i syntezuj. */
  councilMode: boolean;
  /** Adaptacyjny układ menu — sekcje układają się wg nawyków (pora dnia). */
  adaptiveUi: boolean;
  /** Słowo „Jarvis" otwiera pełnoekranowy tryb głosowy (zamiast zwykłego nasłuchu). */
  voiceModeWake: boolean;
  /** Adres instancji Home Assistant (np. http://homeassistant.local:8123). */
  homeAssistantUrl: string;
  /** Długoterminowy token dostępu Home Assistant. */
  homeAssistantToken: string;
}
