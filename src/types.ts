// Współdzielone typy dla całej aplikacji JARVIS.
import type { UserProfile } from "./lib/profile";

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
  /** Kto odpowiada za zadanie (np. „Ja", „Marek", „klient"). */
  owner?: string;
  /** Priorytet — gwiazdka, dzisiejszy fokus (widok „Priorytet" jak w Nozbe). */
  priority?: boolean;
  /** Przypisanie do projektu (Project.id) — puste = Skrzynka. */
  projectId?: string;
  /** Kontekst/etykieta (np. „telefon", „dom", „komputer"). */
  category?: string;
  /** Szczegóły / komentarze do zadania. */
  notes?: string;
  /** Powtarzalność: codziennie/tygodniowo/miesięcznie (po wykonaniu wraca). */
  repeat?: "daily" | "weekly" | "monthly";
  /** Źródło autopilota (np. „call:<leadId>") — do dedupu i auto-domykania. */
  sourceId?: string;
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

/**
 * Fiszka (Kapsuły Wiedzy): aktywne przypominanie + powtórki rozłożone w czasie
 * (algorytm SM-2, jak w Anki). JARVIS tworzy fiszki z Twoich notatek/dziennika/
 * researchu i odpytuje Cię w optymalnych odstępach, by wiedza została na stałe.
 */
export interface Flashcard {
  id: string;
  front: string; // pytanie
  back: string; // odpowiedź
  deck?: string; // temat/talia
  source?: string; // skąd pochodzi (notatka, dziennik, temat)
  // Stan SM-2:
  ease: number; // współczynnik łatwości (start 2.5)
  interval: number; // dni do następnej powtórki
  reps: number; // udane powtórki z rzędu
  lapses: number; // ile razy zapomniana
  due: number; // timestamp następnej powtórki
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
  flashcards: Flashcard[];
  bargainWatch: WatchedItem[];
}

/** Obserwowany przedmiot w Łowcy Okazji — pamięta najlepszą widzianą cenę. */
export interface WatchedItem {
  id: string;
  query: string;
  /** Próg alertu — gdy cena spadnie do/poniżej, oznaczamy „cel osiągnięty". */
  targetPrice?: number;
  /** Najniższa cena widziana dotąd. */
  bestPrice?: number;
  bestCurrency?: string;
  /** Ostatnio widziana cena (do wskazania kierunku zmiany). */
  lastPrice?: number;
  lastCheckedAt?: number;
  /** Historia cen (punkty w czasie) — do trendu i mini-wykresu. */
  history?: { at: number; price: number }[];
  createdAt: number;
}

/** Lead sprzedażowy (mini-CRM / Pulpit Sprzedaży). */
export type LeadStatus = "new" | "contacted" | "offer" | "won" | "lost";

/** Techniczny audyt strony leada (sprawdzany automatycznie, bez AI). */
export interface SiteAudit {
  ok: boolean;        // czy udało się pobrać stronę
  https?: boolean;    // szyfrowanie (kłódka)
  viewport?: boolean; // wersja mobilna (meta viewport)
  title?: string;     // tytuł strony (SEO)
  metaDesc?: boolean; // opis w Google (meta description)
  h1?: boolean;       // nagłówek główny (struktura SEO)
  og?: boolean;       // podgląd przy udostępnianiu (Open Graph)
  contact?: boolean;  // widoczny telefon/e-mail na stronie
  socials?: string[]; // znalezione sociale (facebook/instagram…)
  bytes?: number;     // rozmiar HTML (waga)
  error?: string;     // czemu nie udało się pobrać
}

/** Teczka klienta — wywiad + analiza AI + materiały sprzedażowe per lead. */
export interface LeadIntel {
  /** 0–100: szansa na sprzedaż (im wyżej, tym cieplejszy lead). */
  score: number;
  audit?: SiteAudit;
  /** Analiza AI: słabe punkty → co tracą → rozwiązanie do sprzedania. */
  analysis?: string;
  /** Spersonalizowany e-mail (pierwsza linia „Temat: …"). */
  email?: string;
  /** Skrypt rozmowy telefonicznej (otwarcie, pytania, obiekcje, domknięcie). */
  callScript?: string;
  updatedAt: number;
}

export interface Lead {
  id: string;
  company: string;
  url?: string;
  contact?: string; // e-mail / telefon
  /** E-mail firmy (z OSM/strony), gdy znany — do wysyłki ofert. */
  email?: string;
  /** Adres (ulica, miasto) — z OSM. */
  address?: string;
  /** Godziny otwarcia — z OSM (wiesz, kiedy dzwonić). */
  hours?: string;
  niche?: string;
  location?: string;
  note?: string;
  /** Szacowana wartość zlecenia (PLN). */
  value?: number;
  /** Gotowy szkic oferty (cold mail) napisany przez JARVIS-a. */
  offer?: string;
  /** Teczka klienta: audyt, analiza AI, e-mail, skrypt rozmowy, scoring. */
  intel?: LeadIntel;
  /** Kiedy ostatnio nawiązano kontakt (mail/SMS/telefon) — do follow-upów. */
  lastContactedAt?: number;
  /** Ile follow-upów (ponagleń) już wysłano. */
  followUpCount?: number;
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
  /** Wysyłka e-maili wprost z aplikacji (desktop): adres Gmail/SMTP. */
  smtpUser: string;
  /** Hasło aplikacji (Gmail → Hasła aplikacji) — przechowywane lokalnie. */
  smtpPass: string;
  /** Serwer SMTP (domyślnie smtp.gmail.com). */
  smtpHost: string;
  /** Port SMTP (domyślnie 465 — szyfrowane TLS). */
  smtpPort: number;
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
  /** Stały profil użytkownika (zainteresowania, cele…) — wbudowana pamięć o nim. */
  profile: UserProfile;
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
  /** Klucz fal.ai — premium modele edycji obrazu (FLUX Kontext, Nano Banana Pro). */
  falApiKey: string;
  /** Osobne klucze Gemini TYLKO dla Studia Obrazów (wiele w nowych liniach/po przecinku).
   *  Niezależne od kluczy czatu — dedykowana pula na generowanie/edycję zdjęć z rotacją. */
  studioKeys?: string;
  /** Adres webhooka n8n — warstwa wykonawcza (automatyzacje robią rzeczy). */
  n8nUrl: string;
  /** Opcjonalny token autoryzacji do n8n. */
  n8nToken: string;
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
  /** Proaktywny Agent: JARVIS sam odzywa się w trakcie pracy (przypomnienia po
   *  terminie, zadania na dziś, follow-upy, wydarzenia za chwilę). Domyślnie wł. */
  proactiveAgent?: boolean;
  /** Codzienny poranny briefing (pogoda + kalendarz + zadania) o ustalonej porze. */
  dailyBriefing: boolean;
  /** Godzina porannego briefingu w formacie HH:MM. */
  briefingTime: string;
  /** Automatyczne wyszukiwanie leadów kilka razy dziennie (gdy apka otwarta). */
  autoProspect: boolean;
  /** Autopilot sprzedaży: sam zamienia leady w zadania (telefony, follow-upy). Domyślnie wł. */
  salesAutopilot?: boolean;
  /** Data ostatniego automatycznego planu (YYYY-MM-DD) — by uruchamiać raz dziennie. */
  lastAutoPlanAt?: string;
  /** Głos premium (Gemini) dla Trybu Tłumacza — np. „Aoede". */
  translatorVoice?: string;
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
  /** Blokada głosu — Tryb Słuchawki reaguje tylko na głos właściciela (profil). */
  voiceLock: boolean;
  /** Profil głosu właściciela (embedding mel) — z funkcji „Naucz głosu". */
  voiceProfile: number[];
  /** Próg dopasowania głosu (0–1, wyżej = surowiej). Domyślnie 0.6. */
  voiceMatch: number;
  /** Cisza (ms) kończąca turę przy kompletnym zdaniu — czułość przerywania. */
  endpointShortMs: number;
  /** Adaptacyjny układ menu — sekcje układają się wg nawyków (pora dnia). */
  adaptiveUi: boolean;
  /** Słowo „Jarvis" otwiera pełnoekranowy tryb głosowy (zamiast zwykłego nasłuchu). */
  voiceModeWake: boolean;
  /** Adres instancji Home Assistant (np. http://homeassistant.local:8123). */
  homeAssistantUrl: string;
  /** Długoterminowy token dostępu Home Assistant. */
  homeAssistantToken: string;
}
