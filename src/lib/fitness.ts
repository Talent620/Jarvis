import { store } from "./store";
import { keyCount, primaryKey } from "./keys";
import { mailConfigured, hasBackend } from "./mailer";
import { lockIsSet } from "./lock";
import { PROVIDER_LIST } from "./providers/registry";

// Wskaźnik sprawności JARVIS-a: ile % jego możliwości masz realnie WŁĄCZONE.
// Każda funkcja ma WAGĘ odzwierciedlającą jej realną wartość; suma wag = 100% sprawności.
// Pokazujemy też, ile procent DODA włączenie każdej brakującej rzeczy (gainPct) — żeby było
// widać, co najbardziej opłaca się podpiąć. Wszystko liczone z USTAWIEŃ (deterministycznie,
// bez sieci) — szybkie, przewidywalne i testowalne.

export type FitCategory =
  | "Mózg AI"
  | "Komunikacja"
  | "Głos"
  | "Wyszukiwanie"
  | "Multimedia"
  | "Automatyzacja"
  | "Dom i integracje"
  | "Bezpieczeństwo";

export interface FitItem {
  id: string;
  label: string;
  category: FitCategory;
  weight: number;
  enabled: boolean;
  /** Ile % całej sprawności daje ta funkcja (po włączeniu). */
  gainPct: number;
  /** Jak ją włączyć i gdzie (po ludzku). */
  hint: string;
}

export interface CategoryFit {
  category: FitCategory;
  percent: number;
  enabledWeight: number;
  totalWeight: number;
  enabled: number;
  total: number;
}

export interface FitnessReport {
  percent: number;
  level: string;
  earnedWeight: number;
  totalWeight: number;
  enabledCount: number;
  totalCount: number;
  /** Wszystkie funkcje (włączone i nie), posortowane: najpierw brakujące o największym zysku. */
  items: FitItem[];
  /** Top brakujące funkcje (największy gainPct) — „co podpiąć najpierw". */
  topMissing: FitItem[];
  categories: CategoryFit[];
}

interface Cap {
  id: string;
  label: string;
  category: FitCategory;
  weight: number;
  on: () => boolean;
  hint: string;
}

// Liczba dostawców AI (poza lokalną Ollamą), którzy mają wpisany klucz.
function cloudProvidersWithKey(): number {
  return PROVIDER_LIST.filter((p) => p.id !== "ollama" && keyCount(p.id) > 0).length;
}

// lockIsSet() czyta localStorage bez ochrony — opakuj, by nie wywaliło w node/SSR (testy/CI).
function pinLockSet(): boolean {
  try {
    return lockIsSet();
  } catch {
    return false;
  }
}

function profileFilled(): boolean {
  const p = store.settings.profile as unknown as Record<string, unknown> | undefined;
  if (!p) return false;
  return Object.values(p).some(
    (v) => (typeof v === "string" && v.trim().length > 0) || (Array.isArray(v) && v.length > 0),
  );
}

// Definicje możliwości. WAGA = realna wartość funkcji. Mózg AI dominuje (bez niego JARVIS
// nie myśli). Reszta to integracje i tryby, które dokładają konkretne zdolności.
function capabilities(): Cap[] {
  const s = store.settings;
  return [
    // — Mózg AI —
    { id: "ai_brain", label: "Mózg AI (klucz dostawcy)", category: "Mózg AI", weight: 22, on: () => cloudProvidersWithKey() >= 1 || !!s.ollamaUrl?.trim(),
      hint: "⚙ → AI → wklej dowolny klucz (Claude, Gemini, Groq, OpenRouter…). Bez tego JARVIS nie myśli — to fundament." },
    { id: "ai_backup", label: "Zapasowy mózg (2+ dostawców)", category: "Mózg AI", weight: 6, on: () => cloudProvidersWithKey() >= 2,
      hint: "⚙ → AI → dodaj klucz DRUGIEGO dostawcy. Gdy jeden padnie lub wyczerpie limit, JARVIS płynnie przełączy się na zapas." },
    { id: "ai_local", label: "Model lokalny (Ollama)", category: "Mózg AI", weight: 4, on: () => !!s.ollamaUrl?.trim(),
      hint: "⚙ → AI → Zaawansowane → adres Ollamy. Działa offline, bez limitów i kosztów, domyka łańcuch awaryjny." },
    { id: "deep_think", label: "Głębokie myślenie", category: "Mózg AI", weight: 1, on: () => !!s.deepThink,
      hint: "⚙ → AI → Zaawansowane → Głębokie myślenie. Przy trudnych pytaniach JARVIS najpierw analizuje wewnętrznie." },
    { id: "council", label: "Tryb Konsylium", category: "Mózg AI", weight: 1, on: () => !!s.councilMode,
      hint: "⚙ → AI → Tryb Konsylium. Złożone pytania konsultuje u kilku modeli naraz." },
    { id: "expert", label: "Wiedza ekspercka (offline)", category: "Mózg AI", weight: 1, on: () => s.expertKnowledge !== false,
      hint: "⚙ → AI → Zaawansowane → Wiedza ekspercka. Wszczepione modele mentalne, za darmo i bez sieci." },

    // — Komunikacja —
    { id: "mail", label: "Poczta (wysyłka e-maili)", category: "Komunikacja", weight: 9, on: () => mailConfigured(),
      hint: "⚙ → AI → 📨 Poczta: adres Gmail + hasło aplikacji. Odblokowuje wysyłkę maili i masowy mailing ofert do leadów." },

    // — Głos —
    { id: "stt", label: "Sterowanie głosem (rozpoznawanie mowy)", category: "Głos", weight: 6, on: () => primaryKey("groq").length > 0,
      hint: "⚙ → AI → wklej klucz Groq (darmowy). Włącza dyktowanie i komendy głosem na komputerze (Whisper)." },
    { id: "tts_premium", label: "Naturalny głos (TTS premium)", category: "Głos", weight: 4,
      on: () => (s.geminiTts !== false && primaryKey("gemini").length > 0) || !!s.elevenLabsApiKey?.trim() || !!s.fishAudioApiKey?.trim(),
      hint: "⚙ → Głos → włącz Gemini TTS (darmowy, wymaga klucza Gemini) albo dodaj ElevenLabs/Fish Audio — JARVIS brzmi naturalnie." },
    { id: "wake", label: "Słowo „Jarvis” (nasłuch)", category: "Głos", weight: 3, on: () => !!s.wakeWord || !!s.backgroundWake,
      hint: "⚙ → Głos → Ciągłe nasłuchiwanie słowa „Jarvis”. Komendy bez dotykania urządzenia." },
    { id: "speak", label: "Czytanie odpowiedzi na głos", category: "Głos", weight: 2, on: () => s.speak !== false,
      hint: "⚙ → Głos → Czytaj odpowiedzi na głos." },
    { id: "voice_lock", label: "Blokada głosu (tylko mój głos)", category: "Głos", weight: 2, on: () => !!s.voiceLock && (s.voiceProfile?.length || 0) > 0,
      hint: "⚙ → Głos → Naucz głosu, potem włącz „Reaguj tylko na mój głos”. Odsiewa innych i tło." },

    // — Wyszukiwanie —
    { id: "web_search", label: "Wyszukiwanie w sieci (Tavily)", category: "Wyszukiwanie", weight: 5, on: () => !!s.tavilyApiKey?.trim() && s.webSearch !== false,
      hint: "⚙ → AI → Research (Tavily): wklej klucz i włącz wyszukiwanie. Odpowiedzi ze świeżych źródeł z internetu, z przypisami." },

    // — Multimedia —
    { id: "images", label: "Obrazy (generowanie/edycja)", category: "Multimedia", weight: 3, on: () => primaryKey("gemini").length > 0 || !!s.studioKeys?.trim(),
      hint: "⚙ → AI → klucz Gemini (lub osobne klucze Studia). Tworzenie i edycja zdjęć (darmowe Nano Banana)." },
    { id: "images_premium", label: "Obrazy premium (fal.ai)", category: "Multimedia", weight: 2, on: () => !!s.falApiKey?.trim(),
      hint: "⚙ → AI → Studio premium → klucz fal.ai. Najwyższa jakość (FLUX, Nano Banana Pro)." },

    // — Automatyzacja —
    { id: "sales_autopilot", label: "Autopilot sprzedaży", category: "Automatyzacja", weight: 3, on: () => s.salesAutopilot !== false,
      hint: "⚙ → Zachowanie → Autopilot sprzedaży. Leady same stają się zadaniami (telefony, follow-upy)." },
    { id: "n8n", label: "Automatyzacje (n8n)", category: "Automatyzacja", weight: 3, on: () => !!s.n8nUrl?.trim(),
      hint: "⚙ → Integracje → n8n: adres webhooka. JARVIS uruchamia Twoje gotowe automatyzacje." },
    { id: "auto_prospect", label: "Auto-prospekting (sam szuka klientów)", category: "Automatyzacja", weight: 2, on: () => !!s.autoProspect,
      hint: "⚙ → Zachowanie → Auto-prospekting. JARVIS kilka razy dziennie sam znajduje nowe leady." },
    { id: "proactive", label: "Proaktywny agent", category: "Automatyzacja", weight: 2, on: () => s.proactiveAgent !== false,
      hint: "⚙ → Zachowanie → Proaktywny agent. Sam przypomina, podsuwa zadania i follow-upy." },
    { id: "briefing", label: "Poranny briefing", category: "Automatyzacja", weight: 1, on: () => !!s.dailyBriefing,
      hint: "⚙ → Zachowanie → Codzienny briefing o ustalonej porze." },

    // — Dom i integracje —
    { id: "backend", label: "Backend (sync + Gmail + Kalendarz)", category: "Dom i integracje", weight: 8, on: () => hasBackend(),
      hint: "⚙ → Integracje → Synchronizacja: adres + token. Odblokowuje kopię w chmurze, Gmaila i Kalendarz Google na wszystkich urządzeniach." },
    { id: "home_assistant", label: "Smart home (Home Assistant)", category: "Dom i integracje", weight: 3, on: () => !!s.homeAssistantUrl?.trim() && !!s.homeAssistantToken?.trim(),
      hint: "⚙ → Integracje → Home Assistant: adres + token. Sterowanie domem głosem i komendą." },

    // — Bezpieczeństwo —
    { id: "pin_lock", label: "Blokada PIN", category: "Bezpieczeństwo", weight: 2, on: () => pinLockSet(),
      hint: "⚙ → Dane → Blokada PIN. Chroni dostęp do aplikacji." },
    { id: "profile", label: "Profil użytkownika", category: "Bezpieczeństwo", weight: 2, on: () => profileFilled(),
      hint: "⚙ → Zachowanie → uzupełnij profil (cele, zainteresowania). JARVIS dopasowuje odpowiedzi do Ciebie." },
  ];
}

function levelOf(percent: number): string {
  if (percent >= 95) return "Pełnia mocy ⚡";
  if (percent >= 75) return "Ekspert";
  if (percent >= 50) return "Zaawansowany";
  if (percent >= 25) return "Rozwinięty";
  return "Podstawowy";
}

/** Policz sprawność z bieżących ustawień. Czyste i deterministyczne (bez sieci). */
export function computeFitness(): FitnessReport {
  const caps = capabilities();
  const totalWeight = caps.reduce((a, c) => a + c.weight, 0) || 1;
  const items: FitItem[] = caps.map((c) => ({
    id: c.id,
    label: c.label,
    category: c.category,
    weight: c.weight,
    enabled: c.on(),
    gainPct: Math.round((c.weight / totalWeight) * 1000) / 10, // 0,1% dokładności
    hint: c.hint,
  }));

  const earnedWeight = items.filter((i) => i.enabled).reduce((a, i) => a + i.weight, 0);
  const percent = Math.round((earnedWeight / totalWeight) * 100);

  const cats = new Map<FitCategory, CategoryFit>();
  for (const i of items) {
    const c = cats.get(i.category) || { category: i.category, percent: 0, enabledWeight: 0, totalWeight: 0, enabled: 0, total: 0 };
    c.totalWeight += i.weight;
    c.total += 1;
    if (i.enabled) {
      c.enabledWeight += i.weight;
      c.enabled += 1;
    }
    cats.set(i.category, c);
  }
  const categories = [...cats.values()].map((c) => ({
    ...c,
    percent: Math.round((c.enabledWeight / (c.totalWeight || 1)) * 100),
  }));

  // Sortowanie listy: najpierw brakujące (najwyższy zysk na górze), potem włączone.
  const sorted = [...items].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? 1 : -1;
    return b.weight - a.weight;
  });
  const topMissing = sorted.filter((i) => !i.enabled).slice(0, 5);

  return {
    percent,
    level: levelOf(percent),
    earnedWeight,
    totalWeight,
    enabledCount: items.filter((i) => i.enabled).length,
    totalCount: items.length,
    items: sorted,
    topMissing,
    categories,
  };
}
