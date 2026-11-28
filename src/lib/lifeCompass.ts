// === JARVIS ANIOŁ STRÓŻ & KOMPAS ŻYCIA (Guardian Soul OS) ===
// 100% lokalny, prywatny silnik prowadzenia życiowego, wartości, małych obietnic (Przymierze ze Sobą),
// Skarbca Zwycięstw, Kapsuł Czasu i wykrywania emocjonalnej pogody z tarczą kryzysową.
// Działa identycznie na Ubuntu, Windows, Androidzie (APK/OTA) i Web — bez chmury i bez płatnych usług.
// ES2019 / Chrome 79 / Samsung S9 safe (bez lookbehind, bez \p{}, bez replaceAll, bez .at()).

export type CharacterPillarId =
  | "prawda"
  | "odwaga"
  | "slownosc"
  | "spokoj"
  | "energia"
  | "bliskosc"
  | "sens";

export interface CharacterPillarMeta {
  id: CharacterPillarId;
  label: string;
  shortLabel: string;
  icon: string;
  maxim: string;
  practice: string;
}

export const CHARACTER_PILLARS: CharacterPillarMeta[] = [
  {
    id: "prawda",
    label: "Prawda i Szczerość",
    shortLabel: "Prawda",
    icon: "🪞",
    maxim: "Najcenniejsza odwaga to nie okłamywać samego siebie.",
    practice: "Nazwij jedną rzecz po imieniu zamiast ją racjonalizować.",
  },
  {
    id: "odwaga",
    label: "Odwaga w Działaniu",
    shortLabel: "Odwaga",
    icon: "🦁",
    maxim: "Odwaga to nie brak lęku — to jeden uczciwy krok mimo niego.",
    practice: "Zrób najmniejszy możliwy ruch w sprawie, którą odkładasz.",
  },
  {
    id: "slownosc",
    label: "Słowność i Obietnice",
    shortLabel: "Słowność",
    icon: "🛡",
    maxim: "Zaufanie do siebie budujesz dotrzymując cichych obietnic, których nikt nie widzi.",
    practice: "Dotrzymaj jednej małej obietnicy danej sobie dzisiaj.",
  },
  {
    id: "spokoj",
    label: "Spokój i Panowanie",
    shortLabel: "Spokój",
    icon: "🌊",
    maxim: "Między bodźcem a reakcją jest chwila oddechu — w niej mieszka Twoja wolność.",
    practice: "Zanim odpowiesz w emocjach, weź 3 spokojne oddechy 4-4-6.",
  },
  {
    id: "energia",
    label: "Ciało, Sen i Granice",
    shortLabel: "Energia",
    icon: "🌿",
    maxim: "Nie jesteś maszyną — sen, ruch, woda i granice są paliwem charakteru.",
    practice: "Zadbaj o 15 minut ruchu i zamknij ekran przed snem.",
  },
  {
    id: "bliskosc",
    label: "Bliskość i Dobro",
    shortLabel: "Bliskość",
    icon: "🤍",
    maxim: "Człowiek rośnie, gdy dba o bliskich, umie przeprosić, podziękować i zostawić dobro.",
    practice: "Wyślij dziś jedną szczerą, dobrą wiadomość ważnej dla Ciebie osobie.",
  },
  {
    id: "sens",
    label: "Sens i Długi Horyzont",
    shortLabel: "Sens",
    icon: "🧭",
    maxim: "Każdy dzień to cichy głos oddany na człowieka, którym będziesz za 5 lat.",
    practice: "Zrób jedną rzecz, za którą przyszły Ty podziękuje Ci za rok.",
  },
];

export const SUGGESTED_VALUES: string[] = [
  "Prawda i uczciwość",
  "Słowność wobec siebie",
  "Spokój pod presją",
  "Troska o bliskich",
  "Odwaga mimo strachu",
  "Wdzięczność za codzienność",
  "Zdrowie i jasny umysł",
  "Szacunek do czasu",
  "Pokora i ciągła nauka",
  "Życzliwość bez interesowności",
];

export const STARTER_PROMISES: Array<{ title: string; pillar: CharacterPillarId; why: string }> = [
  {
    title: "30 minut bez telefonu po przebudzeniu",
    pillar: "spokoj",
    why: "Zaczynam dzień własną myślą, a nie cudzym hałasem.",
  },
  {
    title: "Minimum 20 minut ruchu lub spaceru",
    pillar: "energia",
    why: "Silne ciało trzyma spokojną głowę.",
  },
  {
    title: "Nie odpowiadam w złości — najpierw 10 minut pauzy",
    pillar: "spokoj",
    why: "Chronię relacje i swój szacunek do siebie.",
  },
  {
    title: "Jedna trudna, odkładana rzecz zrobiona przed południem",
    pillar: "odwaga",
    why: "Odwaga rośnie z każdym małym przełamaniem oporu.",
  },
  {
    title: "Dobre słowo, telefon lub pomoc dla kogoś bliskiego",
    pillar: "bliskosc",
    why: "Najważniejsze w życiu są więzi, które pielęgnujemy.",
  },
];

export interface LifePromise {
  id: string;
  title: string;
  pillar: CharacterPillarId;
  why?: string;
  createdAt: number;
  active: boolean;
  /** Dni (YYYY-MM-DD), w których obietnica została dotrzymana. */
  keptDates: string[];
  /** Dni (YYYY-MM-DD), w których po potknięciu użytkownik świadomie wrócił na kurs (Zero-Wstydu). */
  comebackDates: string[];
}

export interface ProofEntry {
  id: string;
  text: string;
  pillar: CharacterPillarId;
  createdAt: number;
  source: "user" | "ritual" | "jarvis";
}

export interface TimeCapsule {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  /** Data odblokowania YYYY-MM-DD. */
  unlockDate: string;
  openedAt?: number;
}

export interface DailyRitual {
  date: string; // YYYY-MM-DD
  morningIntention?: string;
  morningPillar?: CharacterPillarId;
  kindnessAct?: string;
  eveningProud?: string;
  eveningGrateful?: string;
  eveningLesson?: string;
  mood?: number; // 1–5
  updatedAt: number;
}

export interface LifeCompassState {
  version: 1;
  northStar: string;
  selectedValues: string[];
  redLines: string[];
  promises: LifePromise[];
  proofVault: ProofEntry[];
  capsules: TimeCapsule[];
  rituals: DailyRitual[];
  updatedAt: number;
}

export type EmotionalWeather =
  | "crisis"
  | "storm"
  | "heavy"
  | "crossroads"
  | "late_night"
  | "spark"
  | "gratitude"
  | "calm";

export interface EmotionalWeatherReading {
  weather: EmotionalWeather;
  needsGuardian: boolean;
  label: string;
  guidance: string;
  crisisSupport?: string;
}

export interface CharacterRadarPoint {
  id: CharacterPillarId;
  label: string;
  shortLabel: string;
  icon: string;
  score: number; // 0–100 (liczone wyłącznie z realnych danych)
}

export interface CharacterProfileSummary {
  points: CharacterRadarPoint[];
  overallScore: number;
  keptTotal: number;
  comebacksTotal: number;
  proofCount: number;
  ritualDays: number;
  strongest: CharacterRadarPoint;
  needsCare: CharacterRadarPoint;
}

export interface GuardianHomeWhisper {
  kind: "capsule" | "morning" | "evening" | "late_night" | "compass";
  badge: string;
  title: string;
  body: string;
  primaryLabel: string;
  chatPrompt?: string;
}

export const LIFE_COMPASS_STORAGE_KEY = "jarvis.lifeCompass.v1";

export const POLISH_CRISIS_HELPLINES =
  "Jeśli jest Ci teraz bardzo ciężko i czujesz, że nie dajesz rady — nie zostawaj z tym sam(a). " +
  "Bezpłatne i anonimowe wsparcie w Polsce: 116 123 (Kryzysowy Telefon Zaufania dla dorosłych), " +
  "800 70 2222 (Centrum Wsparcia 24/7), 116 111 (dla młodzieży), a w nagłym zagrożeniu 112.";

const VALID_PILLARS = new Set<string>(CHARACTER_PILLARS.map((p) => p.id));

export function isValidPillar(id: unknown): id is CharacterPillarId {
  return typeof id === "string" && VALID_PILLARS.has(id);
}

export function normalizePillar(id: unknown): CharacterPillarId {
  return isValidPillar(id) ? id : "slownosc";
}

export function localDateStr(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysDateStr(days: number, now = Date.now()): string {
  return localDateStr(now + Math.max(1, Math.floor(days)) * 86_400_000);
}

export function createDefaultLifeCompass(): LifeCompassState {
  return {
    version: 1,
    northStar: "",
    selectedValues: [
      "Prawda i uczciwość",
      "Słowność wobec siebie",
      "Spokój pod presją",
      "Troska o bliskich",
    ],
    redLines: [
      "Nie podejmuję ważnych decyzji w złości ani późno w nocy",
    ],
    promises: [],
    proofVault: [],
    capsules: [],
    rituals: [],
    updatedAt: 0,
  };
}

export function sanitizeLifeCompass(raw: unknown): LifeCompassState {
  const base = createDefaultLifeCompass();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const northStar = typeof r.northStar === "string" ? r.northStar.trim().slice(0, 400) : base.northStar;
  const selectedValues = Array.isArray(r.selectedValues)
    ? r.selectedValues.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 60)).slice(0, 12)
    : base.selectedValues;
  const redLines = Array.isArray(r.redLines)
    ? r.redLines.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 140)).slice(0, 10)
    : base.redLines;

  const promises: LifePromise[] = Array.isArray(r.promises)
    ? r.promises
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string" && typeof (x as Record<string, unknown>).title === "string")
        .map((p) => ({
          id: String(p.id),
          title: String(p.title).trim().slice(0, 140),
          pillar: normalizePillar(p.pillar),
          why: typeof p.why === "string" ? p.why.trim().slice(0, 200) : undefined,
          createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
          active: p.active !== false,
          keptDates: Array.isArray(p.keptDates) ? p.keptDates.filter((d): d is string => typeof d === "string").slice(-365) : [],
          comebackDates: Array.isArray(p.comebackDates) ? p.comebackDates.filter((d): d is string => typeof d === "string").slice(-365) : [],
        }))
        .slice(0, 30)
    : [];

  const proofVault: ProofEntry[] = Array.isArray(r.proofVault)
    ? r.proofVault
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string" && typeof (x as Record<string, unknown>).text === "string")
        .map((e): ProofEntry => {
          const source: ProofEntry["source"] = e.source === "ritual" ? "ritual" : e.source === "jarvis" ? "jarvis" : "user";
          return {
            id: String(e.id),
            text: String(e.text).trim().slice(0, 260),
            pillar: normalizePillar(e.pillar),
            createdAt: typeof e.createdAt === "number" ? e.createdAt : Date.now(),
            source,
          };
        })
        .slice(0, 120)
    : [];

  const capsules: TimeCapsule[] = Array.isArray(r.capsules)
    ? r.capsules
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string" && typeof (x as Record<string, unknown>).body === "string")
        .map((c) => ({
          id: String(c.id),
          title: typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 100) : "List do przyszłego siebie",
          body: String(c.body).trim().slice(0, 1200),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          unlockDate: typeof c.unlockDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.unlockDate) ? c.unlockDate : addDaysDateStr(30),
          openedAt: typeof c.openedAt === "number" ? c.openedAt : undefined,
        }))
        .slice(0, 40)
    : [];

  const rituals: DailyRitual[] = Array.isArray(r.rituals)
    ? r.rituals
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).date === "string")
        .map((rt) => ({
          date: String(rt.date).slice(0, 10),
          morningIntention: typeof rt.morningIntention === "string" ? rt.morningIntention.trim().slice(0, 220) : undefined,
          morningPillar: isValidPillar(rt.morningPillar) ? rt.morningPillar : undefined,
          kindnessAct: typeof rt.kindnessAct === "string" ? rt.kindnessAct.trim().slice(0, 180) : undefined,
          eveningProud: typeof rt.eveningProud === "string" ? rt.eveningProud.trim().slice(0, 220) : undefined,
          eveningGrateful: typeof rt.eveningGrateful === "string" ? rt.eveningGrateful.trim().slice(0, 220) : undefined,
          eveningLesson: typeof rt.eveningLesson === "string" ? rt.eveningLesson.trim().slice(0, 220) : undefined,
          mood: typeof rt.mood === "number" && rt.mood >= 1 && rt.mood <= 5 ? Math.round(rt.mood) : undefined,
          updatedAt: typeof rt.updatedAt === "number" ? rt.updatedAt : Date.now(),
        }))
        .slice(0, 90)
    : [];

  return {
    version: 1,
    northStar,
    selectedValues,
    redLines,
    promises,
    proofVault,
    capsules,
    rituals,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

const listeners = new Set<() => void>();

export function subscribeLifeCompass(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function loadLifeCompass(): LifeCompassState {
  try {
    const raw = localStorage.getItem(LIFE_COMPASS_STORAGE_KEY);
    if (!raw) return createDefaultLifeCompass();
    return sanitizeLifeCompass(JSON.parse(raw));
  } catch {
    return createDefaultLifeCompass();
  }
}

export function saveLifeCompass(next: LifeCompassState): LifeCompassState {
  const clean = sanitizeLifeCompass({ ...next, updatedAt: Date.now() });
  try {
    localStorage.setItem(LIFE_COMPASS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* localStorage może być niedostępny w środowisku testowym/prywatnym */
  }
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* izoluj */
    }
  });
  return clean;
}

export function updateLifeCompass(mutator: (prev: LifeCompassState) => LifeCompassState): LifeCompassState {
  const prev = loadLifeCompass();
  return saveLifeCompass(mutator(prev));
}

function makeLifeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Dodaj nową małą obietnicę (Przymierze ze Sobą). */
export function addLifePromise(title: string, pillar: CharacterPillarId = "slownosc", why?: string): LifeCompassState {
  const clean = (title || "").trim();
  if (!clean) return loadLifeCompass();
  return updateLifeCompass((prev) => {
    const exists = prev.promises.some((p) => p.active && p.title.toLowerCase() === clean.toLowerCase());
    if (exists) return prev;
    const item: LifePromise = {
      id: makeLifeId("oath"),
      title: clean.slice(0, 140),
      pillar: normalizePillar(pillar),
      why: why?.trim().slice(0, 200) || undefined,
      createdAt: Date.now(),
      active: true,
      keptDates: [],
      comebackDates: [],
    };
    return { ...prev, promises: [item, ...prev.promises].slice(0, 30) };
  });
}

/** Oznacz obietnicę jako dotrzymaną dzisiaj (toggle) lub zarejestruj bezwstydny Powrót na kurs. */
export function markPromiseToday(
  promiseId: string,
  action: "kept" | "comeback",
  now = Date.now(),
): LifeCompassState {
  const today = localDateStr(now);
  return updateLifeCompass((prev) => ({
    ...prev,
    promises: prev.promises.map((p) => {
      if (p.id !== promiseId) return p;
      if (action === "kept") {
        const has = p.keptDates.includes(today);
        const keptDates = has ? p.keptDates.filter((d) => d !== today) : [...p.keptDates, today];
        return { ...p, keptDates };
      }
      const comebackDates = p.comebackDates.includes(today) ? p.comebackDates : [...p.comebackDates, today];
      return { ...p, comebackDates };
    }),
  }));
}

/** Dodaj realny dowód siły/odwagi/wdzięczności do Skarbca Zwycięstw. */
export function addProofVictory(
  text: string,
  pillar: CharacterPillarId = "odwaga",
  source: ProofEntry["source"] = "user",
): LifeCompassState {
  const clean = (text || "").trim();
  if (!clean) return loadLifeCompass();
  return updateLifeCompass((prev) => {
    const entry: ProofEntry = {
      id: makeLifeId("proof"),
      text: clean.slice(0, 260),
      pillar: normalizePillar(pillar),
      createdAt: Date.now(),
      source,
    };
    return { ...prev, proofVault: [entry, ...prev.proofVault].slice(0, 120) };
  });
}

/** Zapisz list do przyszłego siebie (Kapsuła Czasu). */
export function addTimeCapsule(title: string, body: string, unlockDate: string): LifeCompassState {
  const cleanBody = (body || "").trim();
  if (!cleanBody) return loadLifeCompass();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(unlockDate) ? unlockDate : addDaysDateStr(30);
  return updateLifeCompass((prev) => {
    const capsule: TimeCapsule = {
      id: makeLifeId("cap"),
      title: (title || "").trim().slice(0, 100) || "List do przyszłego siebie",
      body: cleanBody.slice(0, 1200),
      createdAt: Date.now(),
      unlockDate: safeDate,
    };
    return { ...prev, capsules: [capsule, ...prev.capsules].slice(0, 40) };
  });
}

/** Zapisz lub zaktualizuj dzisiejszy Poranny Kompas / Wieczorne Lustro. */
export function upsertTodayRitual(
  patch: Partial<Omit<DailyRitual, "date" | "updatedAt">>,
  now = Date.now(),
): LifeCompassState {
  const today = localDateStr(now);
  return updateLifeCompass((prev) => {
    const existing = prev.rituals.find((r) => r.date === today);
    const merged: DailyRitual = {
      ...(existing || { date: today, updatedAt: now }),
      ...patch,
      date: today,
      updatedAt: now,
    };
    const rest = prev.rituals.filter((r) => r.date !== today);
    return { ...prev, rituals: [merged, ...rest].slice(0, 90) };
  });
}

/** Pure: Kapsuły Czasu gotowe do otwarcia dzisiaj (unlockDate <= dzisiaj i jeszcze nieotwarte). */
export function readyTimeCapsules(state: LifeCompassState, now = Date.now()): TimeCapsule[] {
  const today = localDateStr(now);
  return state.capsules.filter((c) => !c.openedAt && c.unlockDate <= today);
}

// --- Wykrywanie emocjonalnej pogody + Tarcza Kryzysowa (ES2019 / S9-safe) ---

const CRISIS_RE =
  /(chc[ęe]\s+umrze[ćc]|nie\s+chc[ęe]\s+(?:ju[żz]\s+)?[żz]y[ćc]|samob[óo]jstw|odebra[ćc]\s+sobie\s+[żz]ycie|sko[ńn]czy[ćc]\s+ze\s+sob[ąa]|zabi[ćc]\s+si[ęe]|nie\s+ma\s+sensu\s+[żz]y[ćc]|krzywd[ęe]\s+sobie)/i;

const STORM_RE =
  /(nie\s+daj[ęe]\s+rady|za[łl]ama[łl]|beznadziej|jestem\s+do\s+niczego|nienawidz[ęe]\s+siebie|p[łl]acz[ęe]|panik|boje\s+si[ęe]\s+wszystkiego|rozpadam\s+si[ęe]|straci[łl]em\s+sens|wszystko\s+si[ęe]\s+wali)/i;

const HEAVY_RE =
  /(ci[ęe][żz]ki\s+dzie[ńn]|jestem\s+zm[ęe]czon|wypalon|samotn|smutn|przygn[ęe]b|brakuje\s+mi\s+si[łl]|nie\s+mam\s+si[łl]|zdo[łl]owan|stresuj[ęe]\s+si[ęe]|wstydz[ęe]\s+si[ęe]|zawalilem|zawali[łl]em|odpuszczam|chc[ęe]\s+si[ęe]\s+podda[ćc]|mam\s+do[śs][ćc]|boję\s+si[ęe]|martwi[ęe]\s+si[ęe]|pogadaj\s+ze\s+mn[ąa])/i;

const CROSSROADS_RE =
  /(jak\s+post[ąa]pi[ćc]|dylemat|sumieni|warto[śs]c|lepszym\s+cz[łl]owiekiem|pok[óo]j\s+ducha|przeprosi[ćc]|wybaczy[ćc]|z[łl]o[śs][ćc]\s+mnie|k[łl][óo]tni|relacj|rodzin|związk|zwi[ąa]zk|nie\s+wiem\s+co\s+robi[ćc]\s+ze\s+swoim|kim\s+chc[ęe]\s+by[ćc]|sens\s+[żz]ycia|prowad[źz]\s+mnie|motywuj)/i;

const GRATITUDE_RE =
  /(uda[łl]o\s+mi\s+si[ęe]|jestem\s+dumn|wdzi[ęe]czn|prze[łl]ama[łl]em|dotrzyma[łl]em|pokona[łl]em|czuj[ęe]\s+spok[óo]j|dobry\s+dzie[ńn]|zwyci[ęe]stw)/i;

/** Pure: odczytaj pogodę emocjonalną wiadomości użytkownika (z twardą Tarczą Kryzysową). */
export function detectEmotionalWeather(userText: string, now = Date.now()): EmotionalWeatherReading {
  const t = (userText || "").trim();
  const h = new Date(now).getHours();
  const isLateNight = h >= 23 || h < 5;

  if (t && CRISIS_RE.test(t)) {
    return {
      weather: "crisis",
      needsGuardian: true,
      label: "Tarcza Kryzysowa",
      guidance:
        "WYKRYTO SYGNAŁ KRYZYSU: Odpowiedz z najwyższym ludzkim ciepłem, spokojem i szacunkiem. " +
        "Nie oceniaj, nie praw kazań, nie udawaj lekarza. Podkreśl, że życie użytkownika ma wartość i podaj realne numery wsparcia w Polsce (116 123, 800 70 2222, 112).",
      crisisSupport: POLISH_CRISIS_HELPLINES,
    };
  }

  if (t && STORM_RE.test(t)) {
    return {
      weather: "storm",
      needsGuardian: true,
      label: "Burza emocji",
      guidance:
        "Użytkownik przechodzi bardzo trudny moment. Najpierw go wysłuchaj i uznaj ciężar chwili po ludzku (zero toksycznego optymizmu!). " +
        "Potem delikatnie przypomnij realny dowód z jego Skarbca Zwycięstw (jeśli istnieje) i zaproponuj JEDEN mały, kojący krok (np. oddech 4-4-6 albo rozmowę bez presji).",
    };
  }

  if (t && HEAVY_RE.test(t)) {
    return {
      weather: "heavy",
      needsGuardian: true,
      label: "Cięższy moment",
      guidance:
        "Użytkownik jest zmęczony, przytłoczony lub potrzebuje szczerego kolegi. Bądź obok ciepło, bez lania wody i bez sztucznych pochwał. " +
        "Pomóż mu oddzielić zmęczenie chwili od jego prawdziwej wartości; zaproponuj jeden uczciwy, lekki ruch albo chwilę wytchnienia.",
    };
  }

  if (t && CROSSROADS_RE.test(t)) {
    return {
      weather: "crossroads",
      needsGuardian: true,
      label: "Rozdroże / Wartości",
      guidance:
        "Użytkownik dotyka ważnej decyzji życiowej, relacji lub pracy nad sobą. Bądź mądrym lustrem: odwołaj się do jego własnych Wartości, Gwiazdy Północnej i Granic. " +
        "Nie przytakuj na ślepo — jeśli widzisz pułapkę ego, złości albo ucieczki, nazwij ją życzliwie i szczerze.",
    };
  }

  if (t && GRATITUDE_RE.test(t)) {
    return {
      weather: "gratitude",
      needsGuardian: false,
      label: "Moment siły",
      guidance:
        "Użytkownik dzieli się realnym zwycięstwem lub wdzięcznością. Doceń to konkretnie i rzeczowo (bez przesłodzonego lizusostwa) i rozważ zapisanie tego dowodu narzędziem save_life_victory.",
    };
  }

  if (isLateNight && t.length > 20) {
    return {
      weather: "late_night",
      needsGuardian: false,
      label: "Późna noc",
      guidance:
        "Jest późna noc — odpowiadaj spokojniej. Jeśli użytkownik rozmyśla o ciężkich sprawach, życzliwie przypomnij, że po północy głowa wyolbrzymia lęki, a sen jest częścią dbania o siebie.",
    };
  }

  return {
    weather: "calm",
    needsGuardian: false,
    label: "Spokojny kurs",
    guidance: "",
  };
}

/** Pure: policz realny 7-osiowy profil charakteru wyłącznie z faktycznych działań użytkownika. */
export function computeCharacterProfile(
  state: LifeCompassState,
  external: { flowMinutes?: number; completedTasks?: number; journalEntries?: number } = {},
): CharacterProfileSummary {
  const scores: Record<CharacterPillarId, number> = {
    prawda: 15,
    odwaga: 15,
    slownosc: 15,
    spokoj: 15,
    energia: 15,
    bliskosc: 15,
    sens: 15,
  };

  let keptTotal = 0;
  let comebacksTotal = 0;
  for (const p of state.promises) {
    const kept = p.keptDates.length;
    const comebacks = p.comebackDates.length;
    keptTotal += kept;
    comebacksTotal += comebacks;
    scores[p.pillar] += kept * 9 + comebacks * 6;
    scores.slownosc += kept * 4 + comebacks * 3;
  }

  for (const entry of state.proofVault) {
    scores[entry.pillar] += 10;
  }

  for (const r of state.rituals) {
    if (r.morningIntention) {
      scores.sens += 5;
      if (r.morningPillar) scores[r.morningPillar] += 5;
    }
    if (r.kindnessAct) scores.bliskosc += 8;
    if (r.eveningProud) scores.prawda += 5;
    if (r.eveningGrateful) scores.bliskosc += 5;
    if (r.eveningLesson) scores.prawda += 6;
  }

  if (state.northStar.trim()) scores.sens += 12;
  if (state.redLines.length > 0) scores.spokoj += Math.min(15, state.redLines.length * 5);
  if (state.capsules.length > 0) scores.sens += Math.min(16, state.capsules.length * 8);

  const flowMin = Math.max(0, external.flowMinutes || 0);
  if (flowMin > 0) {
    scores.spokoj += Math.min(20, Math.round(flowMin / 15));
    scores.odwaga += Math.min(15, Math.round(flowMin / 20));
  }
  const doneTasks = Math.max(0, external.completedTasks || 0);
  if (doneTasks > 0) {
    scores.slownosc += Math.min(18, doneTasks * 2);
  }
  const journals = Math.max(0, external.journalEntries || 0);
  if (journals > 0) {
    scores.prawda += Math.min(18, journals * 3);
  }

  const points: CharacterRadarPoint[] = CHARACTER_PILLARS.map((meta) => ({
    id: meta.id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    icon: meta.icon,
    score: Math.min(100, Math.max(0, Math.round(scores[meta.id]))),
  }));

  const overallScore = Math.round(points.reduce((s, p) => s + p.score, 0) / points.length);
  const sorted = [...points].sort((a, b) => b.score - a.score);

  return {
    points,
    overallScore,
    keptTotal,
    comebacksTotal,
    proofCount: state.proofVault.length,
    ritualDays: state.rituals.length,
    strongest: sorted[0],
    needsCare: sorted[sorted.length - 1],
  };
}

/** Pure: zbuduj zwięzły, żywy blok Anioła Stróża & Kompasu Życia wstrzykiwany do promptu systemowego JARVISA. */
export function buildLifeCompassPromptBlock(
  state: LifeCompassState,
  userText = "",
  now = Date.now(),
): string {
  const weather = detectEmotionalWeather(userText, now);
  const today = localDateStr(now);
  const todayRitual = state.rituals.find((r) => r.date === today);
  const activePromises = state.promises.filter((p) => p.active);
  const unlockedCapsules = readyTimeCapsules(state, now);

  const hasCustomData = Boolean(
    state.northStar.trim() ||
    activePromises.length > 0 ||
    state.proofVault.length > 0 ||
    todayRitual ||
    unlockedCapsules.length > 0,
  );

  // Jeśli brak danych i pogoda jest neutralna — wstrzyknij tylko lekki fundament wartości (bez marnowania tokenów).
  if (!hasCustomData && !weather.needsGuardian && weather.weather === "calm") {
    return [
      "KOMPAS CZŁOWIECZEŃSTWA JARVIS (zawsze w tle):",
      "- Jesteś nie tylko narzędziem, ale lojalnym kolegą i mądrym stróżem rozwoju użytkownika: szanujesz prawdę, godność, zdrowy rozsądek, relacje i odpoczynek.",
      "- Nigdy nie przytakuj bezmyślnie rzeczom, które szkodzą użytkownikowi — mów szczerze, życzliwie i po ludzku. Gdy użytkownik składa sobie obietnicę lub przeżywa małe zwycięstwo, możesz zapisać je narzędziami save_life_promise / save_life_victory.",
    ].join("\n");
  }

  const lines: string[] = ["KOMPAS ŻYCIA I ANIOŁ STRÓŻ (Prywatna pamięć rozwoju użytkownika — używaj z wyczuciem i szacunkiem):"];

  if (state.northStar.trim()) {
    lines.push(`- Gwiazda Północna („Kim się staję”): ${state.northStar.trim()}`);
  }
  if (state.selectedValues.length > 0) {
    lines.push(`- Wybrane wartości: ${state.selectedValues.slice(0, 6).join(", ")}`);
  }
  if (state.redLines.length > 0) {
    lines.push(`- Granice, których strzeże: ${state.redLines.slice(0, 4).join(" | ")}`);
  }
  if (todayRitual?.morningIntention) {
    lines.push(`- Dzisiejsza intencja poranna: „${todayRitual.morningIntention}”`);
  }
  if (activePromises.length > 0) {
    const summary = activePromises
      .slice(0, 4)
      .map((p) => `${p.title} (${p.keptDates.includes(today) ? "dziś ✓" : "czeka"}, łącznie ${p.keptDates.length}×)`)
      .join("; ");
    lines.push(`- Przymierze ze Sobą (obietnice): ${summary}`);
  }
  if (state.proofVault.length > 0 && (weather.weather === "storm" || weather.weather === "heavy" || weather.weather === "crossroads" || state.proofVault.length <= 3)) {
    const proofs = state.proofVault
      .slice(0, 3)
      .map((e) => `„${e.text}”`)
      .join("; ");
    lines.push(`- Prawdziwe dowody siły użytkownika (Skarbiec Zwycięstw — przypomnij w chwili zwątpienia): ${proofs}`);
  }
  if (unlockedCapsules.length > 0) {
    lines.push(`- ⏳ ODBLOKOWANY LIST Z PRZESZŁOŚCI (${unlockedCapsules[0].title}): czeka na przeczytanie w Aniele Stróżu.`);
  }
  if (weather.guidance) {
    lines.push(`- Pogoda emocjonalna [${weather.label}]: ${weather.guidance}`);
  }
  if (weather.crisisSupport) {
    lines.push(`- OBOWIĄZKOWE NUMERY WSPARCIA: ${weather.crisisSupport}`);
  }

  return lines.join("\n");
}

/** Pure: zbuduj czułą, nieinwazyjną kartę Anioła Stróża na ekran startowy (dopasowaną do pory dnia i stanu). */
export function buildGuardianHomeWhisper(state: LifeCompassState, now = Date.now()): GuardianHomeWhisper {
  const unlocked = readyTimeCapsules(state, now);
  if (unlocked.length > 0) {
    return {
      kind: "capsule",
      badge: "⏳ LIST Z PRZESZŁOŚCI ODBLOKOWANY",
      title: unlocked[0].title,
      body: "Twój list napisany do przyszłego siebie właśnie dojrzał i czeka w Skarbcu Czasu.",
      primaryLabel: "Otwórz list",
    };
  }

  const today = localDateStr(now);
  const ritual = state.rituals.find((r) => r.date === today);
  const h = new Date(now).getHours();

  if (h >= 23 || h < 5) {
    return {
      kind: "late_night",
      badge: "🌌 NOCNA OPIEKA ANIOŁA STRÓŻA",
      title: "Późna godzina — odłóż ciężar dnia",
      body: "Po północy zmęczona głowa wyolbrzymia problemy. Jeśli coś Cię męczy, zrzuć to ze mnie w 2 zdaniach albo weź 60 s oddechu przed snem.",
      primaryLabel: "Oddech / Rozmowa",
      chatPrompt: "Jest późno i mam dużo w głowie — pomóż mi spokojnie zamknąć ten dzień i odpocząć.",
    };
  }

  if (h >= 5 && h < 12 && !ritual?.morningIntention) {
    return {
      kind: "morning",
      badge: "🌅 PORANNY KOMPAS",
      title: state.northStar.trim()
        ? `Kurs: ${state.northStar.trim().slice(0, 72)}`
        : "Ustaw jedną spokojną intencję na dzisiaj",
      body: "30 sekund przed startem dnia: jedna wartość, jedna mała obietnica sobie i jasna głowa.",
      primaryLabel: "Ustaw kompas dnia",
    };
  }

  if (h >= 19 && h < 23 && !ritual?.eveningProud) {
    return {
      kind: "evening",
      badge: "🌙 WIECZORNE LUSTRO",
      title: "Zanim zamkniesz dzień — zobacz, co zrobiłeś dobrze",
      body: "1 powód do cichej dumy, 1 wdzięczność i 1 spokojna lekcja na jutro (bez wyrzutów sumienia).",
      primaryLabel: "Zamknij dzień w spokoju",
      chatPrompt: "Zrób ze mną spokojne wieczorne podsumowanie dnia — co poszło dobrze i jaką jedną lekcję zabieram na jutro?",
    };
  }

  const activePromises = state.promises.filter((p) => p.active);
  const keptToday = activePromises.filter((p) => p.keptDates.includes(today)).length;
  if (activePromises.length > 0) {
    const nextUnkept = activePromises.find((p) => !p.keptDates.includes(today));
    return {
      kind: "compass",
      badge: `🪽 ANIOŁ STRÓŻ · PRZYMIERZE ${keptToday}/${activePromises.length}`,
      title: nextUnkept ? `Mała obietnica na dziś: ${nextUnkept.title}` : "Wszystkie dzisiejsze obietnice dotrzymane ✓",
      body: nextUnkept
        ? "Jeden mały, uczciwy krok buduje zaufanie do samego siebie silniej niż wielkie plany."
        : "Zasłużyłeś na spokojny oddech — dodaj to zwycięstwo do Skarbca, żeby pamiętać o swojej sile.",
      primaryLabel: "Otwórz Kompas",
    };
  }

  const dayIdx = Math.floor(now / 86_400_000) % CHARACTER_PILLARS.length;
  const pillar = CHARACTER_PILLARS[dayIdx];
  return {
    kind: "compass",
    badge: `🪽 ANIOŁ STRÓŻ · ${pillar.icon} ${pillar.label.toUpperCase()}`,
    title: pillar.maxim,
    body: pillar.practice,
    primaryLabel: "Otwórz Anioła Stróża",
    chatPrompt: "Pogadaj ze mną szczerze jak mądry kolega i anioł stróż — pomóż mi poukładać to, co dziś najważniejsze.",
  };
}
