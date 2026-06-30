import { store } from "./store";
import { brand } from "./brand";
import { toolDefs, resetCitations, getCitations } from "./tools";
import { selectToolsForIntent } from "./toolSelector";
import { PROVIDERS, PROVIDER_LIST, autoPick, isUncensored } from "./providers/registry";
import { prepareMemoryContext, memoryBlock, rememberFact, ensureIndexed, rankJournal } from "./memory";
import { memoryContextBlock, addMemory, resolveNamespace, memoryServiceAvailable } from "./memoryService";
import { COGNITIVE_CORE, REASONING_SYSTEM } from "./cognition";
import { retrieveKnowledge } from "./knowledge";
import { buildProfileBlock } from "./profile";
import { isDesktop } from "./desktop";
import { shouldFallback, isNetworkError, isKeyError, humanize, PERSONAL_CUES } from "./aiHelpers";
import { orderedKeys, primaryKey, coolDownKey } from "./keys";
import { classifyTask, needsDeepThink, isComplex, logRouteDecision, adaptiveConfidenceThreshold, reasoningProfileFor, GROQ_SCOUT, GROQ_KIMI, type TaskKind } from "./modelRouter";
import { recordUsage, priceFor, costOf, parsePricingOverrides } from "./usageTelemetry";
import { recordEpisode, loadEpisodes } from "./episodicMemory";
import { buildFusionBlock } from "./contextFusion";
import { recordWorld, worldContextBlock } from "./worldModel";
import { estimateConfidence, isLowConfidence } from "./confidence";
import { speculativeAnswer } from "./speculative";
import { localRefine, critiqueInstruction } from "./localRefine";
import { VERIFY_SYSTEM, buildVerifyUser, verifyVerdict } from "./verify";
import { freeOnly } from "./freeMode";
import { inReserveZone } from "./brainReserve";
import { localSelfConsistency } from "./localConsensus";
import { conversationStyleDirectives } from "./conversationStyle";
import { WEBLLM_DEFAULT_MODEL, webllmSupported } from "./webllm";
import { withBackoff, CircuitBreaker } from "./resilience";
import { logError, recordLatency } from "./errorLog";
import type { JarvisReply, Msg, ProviderId } from "./providers/types";

// Retry przy chwilowym błędzie sieci — z WYKŁADNICZYM backoffem + jitterem (do 2 ponowień).
// Ponawiamy TYLKO błędy sieciowe (nie błędy klucza/limitu — te idą do rotacji/fallbacku wyżej).
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withBackoff(fn, {
    retries: 2,
    baseMs: 600,
    shouldRetry: (e) => isNetworkError(e instanceof Error ? e.message : String(e)),
  });
}

/**
 * Pure: który dostawca jest „głównym mózgiem" (punkt odniesienia dla etykiety „zapasowy").
 * Przypięty (provider != auto) wygrywa zawsze — jego odpowiedź NIE jest zapasowa. W auto
 * bierzemy pierwszego UŻYWALNEGO z łańcucha (a nie order[0], który bywa pomijany bez klucza).
 */
export function computePrimaryProvider<T extends { provider: ProviderId }>(
  order: T[],
  pinned: ProviderId | null,
  usable: (p: ProviderId) => boolean,
): ProviderId {
  if (pinned) return pinned;
  const u = order.find((o) => usable(o.provider));
  return (u || order[0]).provider;
}

// Watchdog „zaciętego" dostawcy: zamiast czekać do 120 s timeoutu fetcha, przełączamy się
// na kolejny mózg, gdy dostawca MILCZY (strumień bez pierwszego tokenu) albo całość trwa za długo.
// Dzięki temu wolny/wiszący model nie blokuje JARVIS-a — failover jest szybki.
export const STALL_FIRST_MS = 22_000; // brak PIERWSZEGO tokenu (strumień) → uznaj za zaciętego
export const STALL_HARD_MS = 75_000; // twardy limit całej próby (krótszy niż 120 s fetcha)

/** Buduje obietnicę, która ODRZUCA, gdy dostawca się zaciął. cancel() po wygranej próbie. */
export function makeStallWatchdog(
  getSettled: () => boolean,
  getProgressed: () => boolean,
  hasStream: boolean,
  firstMs = STALL_FIRST_MS,
  hardMs = STALL_HARD_MS,
): { promise: Promise<never>; cancel: () => void } {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const promise = new Promise<never>((_resolve, reject) => {
    timers.push(setTimeout(() => { if (!getSettled()) reject(new Error("Dostawca AI nie odpowiada — przełączam na kolejny mózg.")); }, hardMs));
    if (hasStream) {
      timers.push(setTimeout(() => { if (!getSettled() && !getProgressed()) reject(new Error("Dostawca AI milczy — przełączam na kolejny mózg.")); }, firstMs));
    }
  });
  return { promise, cancel: () => { for (const t of timers) clearTimeout(t); } };
}

// Bezpiecznik per-dostawca: po serii awarii pomijamy padniętego dostawcę na chwilę
// (szybszy failover), z automatycznym „half-open" po cooldownie. Żyje w pamięci sesji.
const providerBreaker = new CircuitBreaker(4, 30_000);
/** Eksport do diagnostyki (stan bezpiecznika dostawcy). */
export function providerBreakerState(provider: ProviderId): "closed" | "open" | "half" {
  return providerBreaker.state(provider);
}

const PERSONAS: Record<string, string> = {
  classic: "uprzejmy, lekko dowcipny brytyjski majordomus — elegancki, rzeczowy i niezwykle kompetentny.",
  concise: "maksymalnie zwięzły — odpowiadasz w 1–2 zdaniach, bez ozdobników i powtórzeń.",
  warm: "ciepły, wspierający i empatyczny — dbasz o samopoczucie użytkownika, zachowując kompetencję.",
  witty: "błyskotliwy, z suchym brytyjskim humorem i lekkim sarkazmem, ale zawsze pomocny i rzeczowy.",
  natural:
    "naturalny rozmówca — mówisz jak mądry, życzliwy znajomy: pełnymi zdaniami zamiast suchych list, " +
    "ciepło, ale rzeczowo. Pamiętasz, o czym przed chwilą rozmawialiście, i nawiązujesz do tego. Nie forsujesz " +
    "akcji, gdy ktoś chce po prostu pogadać; nie udajesz pewności. Brzmisz po ludzku, nie jak formularz.",
  operator:
    "elitarny asystent operacyjny. Spokojny, opanowany, precyzyjny — bez zbędnej uprzejmości i gadania. " +
    "Interpretujesz intencję ponad dosłowność i działasz zamiast pytać. Komunikujesz się minimalnie: każde zdanie coś wnosi. " +
    "Domykasz zadania (decyzja / wynik / następny krok), nie udajesz pewności, a gdy widzisz lepszą ścieżkę — pokazujesz ją od razu. Brzmisz jak system wysokiej klasy.",
};

// --- Router: dobór dostawcy/modelu do zadania ---
const VISION_PROVIDERS = new Set<ProviderId>(["anthropic", "gemini", "github", "openrouter", "mistral"]);

const TASK_MODELS: Record<ProviderId, { simple: string; complex: string; vision: string }> = {
  anthropic: { simple: "claude-haiku-4-5", complex: "claude-opus-4-8", vision: "claude-opus-4-8" },
  gemini: { simple: "gemini-2.5-flash-lite", complex: "gemini-2.5-flash", vision: "gemini-2.5-flash" },
  groq: { simple: GROQ_SCOUT, complex: GROQ_KIMI, vision: GROQ_SCOUT },
  cerebras: { simple: "llama3.1-8b", complex: "llama-3.3-70b", vision: "llama-3.3-70b" },
  mistral: { simple: "mistral-small-latest", complex: "mistral-large-latest", vision: "pixtral-12b-2409" },
  cohere: { simple: "command-r7b-12-2024", complex: "command-a-03-2025", vision: "command-a-03-2025" },
  openrouter: {
    simple: "meta-llama/llama-3.3-70b-instruct:free",
    complex: "meta-llama/llama-3.1-405b-instruct",
    vision: "google/gemini-2.0-flash-exp:free",
  },
  nvidia: { simple: "meta/llama-3.3-70b-instruct", complex: "meta/llama-3.1-405b-instruct", vision: "meta/llama-3.3-70b-instruct" },
  github: { simple: "openai/gpt-4o-mini", complex: "openai/gpt-4o", vision: "openai/gpt-4o" },
  ollama: { simple: "qwen3:1.7b", complex: "qwen3.5:4b", vision: "gemma3:4b-it-qat" },
  webllm: { simple: WEBLLM_DEFAULT_MODEL, complex: WEBLLM_DEFAULT_MODEL, vision: WEBLLM_DEFAULT_MODEL },
};

// Dostawcy bez klucza (lokalni): autoryzacja przez adres serwera (Ollama) lub WebGPU (WebLLM).
const isKeyless = (p: ProviderId): boolean => p === "ollama" || p === "webllm";

function modelFor(p: ProviderId, complex: boolean, vision: boolean): string {
  const m = TASK_MODELS[p];
  return vision ? m.vision : complex ? m.complex : m.simple;
}

/** Model Ollamy dla typu zadania: jawny wybór > bez-cenzury (gdy włączone) > nadpisanie per-kind > katalog. */
function pickOllamaModel(kind: TaskKind): string {
  const s = store.settings;
  if (s.provider === "ollama" && s.model && s.model !== "auto") return s.model; // jawny wybór wygrywa
  // Tryb nieocenzurowany (tekst): kieruj do modelu uncensored, gdy ustawiony. Wizja zostaje przy modelu wizji.
  if (s.unfilteredLocal && kind !== "vision" && s.ollamaModelUncensored?.trim()) return s.ollamaModelUncensored.trim();
  const ov = kind === "vision" ? s.ollamaModelVision : kind === "complex" ? s.ollamaModelComplex : s.ollamaModelSimple;
  return ov?.trim() || TASK_MODELS.ollama[kind];
}

/** Buduje kolejność prób (dostawca+model) dopasowaną do zadania. */
export function routeOrder(history: Msg[]): { provider: ProviderId; model: string }[] {
  const s = store.settings;
  const last = history[history.length - 1];
  const hasImage = !!last?.image;
  const complex = isComplex(last?.content || "");
  const cls = classifyTask(last?.content || "", hasImage);

  // Local-first fallback: model lokalny zawsze domyka łańcuch — gdy padnie sieć/chmura,
  // JARVIS płynnie przechodzi na on-device z PEŁNYM kontekstem rozmowy.
  // Dwa tory lokalne: WebLLM (przeglądarka/APK, WebGPU — bez serwera) i Ollama (desktop+serwer).
  const localTail: { provider: ProviderId; model: string }[] = [];
  if (s.webllmEnabled && webllmSupported() && !hasImage) {
    localTail.push({ provider: "webllm", model: s.webllmModel?.trim() || TASK_MODELS.webllm.simple });
  }
  if (s.ollamaUrl?.trim()) {
    localTail.push({ provider: "ollama", model: pickOllamaModel(cls.kind) });
  }

  // Tryb on-device (Faza 8): TYLKO model lokalny — żadna chmura, nic nie opuszcza urządzenia.
  // Brak skonfigurowanej Ollamy → pusty łańcuch (caller pokaże instrukcję konfiguracji).
  if (s.onDeviceOnly) return localTail;

  // Zadanie 3 — Refleks jako pełny POZIOM (local-first): proste zapytanie (gdy włączone) LUB
  // brak sieci → model lokalny NA POCZĄTEK łańcucha; chmura zostaje fallbackiem. Klasyfikujemy
  // przez classifyTask (kind), nie tylko isComplex. complex/vision dalej domyślnie chmura.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const localHead: { provider: ProviderId; model: string }[] = [];
  if (offline || (s.localFirstSimple && !!s.ollamaUrl?.trim() && cls.kind === "simple")) {
    if (s.ollamaUrl?.trim()) {
      localHead.push({ provider: "ollama", model: pickOllamaModel(cls.kind) });
    } else if (s.webllmEnabled && webllmSupported() && !hasImage) {
      localHead.push({ provider: "webllm", model: s.webllmModel?.trim() || TASK_MODELS.webllm.simple });
    }
    if (localHead.length) {
      logRouteDecision({ provider: localHead[0].provider, model: localHead[0].model, kind: cls.kind, reason: offline ? "local-first: offline" : "local-first: proste", fellBack: false });
    }
  }

  let base: { provider: ProviderId; model: string }[];
  if (s.provider === "auto" && (s.model === "auto" || !s.model)) {
    let provs = PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim());
    if (hasImage) {
      const vis = provs.filter((p) => VISION_PROVIDERS.has(p.id));
      if (vis.length) provs = vis; // do obrazu wybierz dostawcę z wizją
    }
    provs.sort((a, b) => b.rank - a.rank);
    base = [...provs.map((p) => ({ provider: p.id, model: modelFor(p.id, complex, hasImage) })), ...localTail];
  } else {
    const resolved = resolveProvider();
    if (!resolved) {
      // Brak rozwiązanego dostawcy (np. ręczny wybór bez klucza) — łańcuch z dostawców z kluczem + ogon.
      base = [
        ...PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim())
          .sort((a, b) => b.rank - a.rank)
          .map((p) => ({ provider: p.id, model: p.defaultModel })),
        ...localTail,
      ];
    } else {
      base = [
        { provider: resolved.provider, model: resolved.model },
        ...PROVIDER_LIST.filter((p) => p.id !== "ollama" && p.id !== resolved.provider && s.keys[p.id]?.trim())
          .sort((a, b) => b.rank - a.rank)
          .map((p) => ({ provider: p.id, model: p.defaultModel })),
        ...localTail.filter((l) => l.provider !== resolved.provider),
      ];
    }
  }

  // Refleks na początek + usuń duplikaty dostawcy (pierwsze wystąpienie wygrywa).
  const seen = new Set<ProviderId>();
  const out = [...localHead, ...base].filter((o) => (seen.has(o.provider) ? false : (seen.add(o.provider), true)));
  // 🆓 Tryb darmowy: odetnij płatnego Claude'a — zostają same darmowe/lokalne mózgi.
  // Zabezpieczenie: gdyby to opróżniło łańcuch (brak darmowego klucza), zostaw oryginał,
  // żeby JARVIS w ogóle odpowiedział (UI i tak namawia do dodania darmowego klucza).
  if (s.freeMode) {
    const free = freeOnly(out);
    if (free.length) return free;
  }
  return out;
}

/** Kontekst per-żądanie (zamiast globali modułu — bez przecieku między równoległymi askJarvis
 *  i bez „resztek" w trybie live). Wszystkie pola opcjonalne; brak = czysty prompt. */
export interface PromptContext {
  deepAnalysis?: string;
  currentKnowledge?: string;
  journalRank?: string[] | null;
  /** Trafne wspomnienia z pamięci długoterminowej (Mem0) — Faza 1. */
  mem0Block?: string;
  /** Szósty Zmysł: świadomość sytuacyjna (otwarte wątki) złożona z danych systemu. */
  fusionBlock?: string;
  /** World Model: encje (osoby/projekty/firmy) i powiązania, których dotyczy pytanie. */
  worldBlock?: string;
}

export function systemPrompt(ctx: PromptContext = {}): string {
  const { deepAnalysis = "", currentKnowledge = "", journalRank = null, mem0Block = "", fusionBlock = "", worldBlock = "" } = ctx;
  const s = store.settings;
  const userName = s.userName;
  const pid = s.activeProjectId;

  // Pamięć autonomiczna: trafne fakty wybrane semantycznie (z fallbackiem na świeżość).
  const facts = memoryBlock();

  // Profil użytkownika: stała, curated pamięć o nim (zawsze w kontekście).
  const profile = buildProfileBlock(s.profile);

  // Kontekst projektu: instrukcje + fragmenty dokumentów (budżet ~6000 zn.).
  const project = pid ? store.data.projects.find((p) => p.id === pid) : null;
  let projectCtx = "";
  if (project) {
    projectCtx = `\n\nAktywny projekt: „${project.name}".`;
    if (project.instructions.trim()) projectCtx += `\nInstrukcje projektu: ${project.instructions.trim()}`;
    const files = store.data.projectFiles.filter((f) => f.projectId === pid);
    if (files.length) {
      let budget = 6000;
      const chunks: string[] = [];
      for (const f of files) {
        const t = f.text.slice(0, Math.max(0, budget));
        if (!t) break;
        chunks.push(`# ${f.name}\n${t}`);
        budget -= t.length;
      }
      projectCtx += `\n\nDokumenty projektu (fragmenty, używaj jako kontekst):\n${chunks.join("\n\n")}`;
    }
  }

  // Dziennik: TYLKO wpisy, które użytkownik świadomie udostępnił czatowi (budżet ~3000 zn.).
  // Kolejność semantyczna (pamięć ewoluująca): najtrafniejsze do pytania wchodzą pierwsze.
  let journalCtx = "";
  let shared = (store.data.journal || []).filter((j) => j.shared);
  if (journalRank) {
    const pos = new Map(journalRank.map((id, i) => [id, i]));
    shared = [...shared].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  }
  if (shared.length) {
    let budget = 3000;
    const chunks: string[] = [];
    for (const j of shared) {
      const piece = `• ${j.title || "(bez tytułu)"}: ${j.body}`.slice(0, Math.max(0, budget));
      if (!piece) break;
      chunks.push(piece);
      budget -= piece.length;
    }
    journalCtx = `\n\nUdostępnione fragmenty osobistego dziennika użytkownika (prywatne przemyślenia — odnoś się do nich z wyczuciem, nie cytuj publicznie bez potrzeby):\n${chunks.join("\n")}`;
  }
  const now = new Date();

  // Tryb tłumacza ma priorytet — JARVIS staje się tłumaczem na żywo.
  if (s.interpreterMode) {
    return [
      `Jesteś tłumaczem symultanicznym JARVIS. Tłumaczysz między językami: ${s.interpreterFrom} i ${s.interpreterTo}.`,
      `Wykryj język wypowiedzi użytkownika i przetłumacz ją na drugi z tych języków.`,
      `Zwracaj WYŁĄCZNIE samo tłumaczenie — bez komentarzy, wyjaśnień ani powtarzania oryginału.`,
      `Zachowuj ton i rejestr wypowiedzi.`,
    ].join("\n");
  }

  // Tryb nieocenzurowany działa realnie z modelem lokalnym (Ollama) albo
  // nieocenzurowanym modelem w chmurze (np. Dolphin na OpenRouterze) — tam model
  // nie odmawia. JARVIS nie dokłada wtedy własnych zastrzeżeń ani moralizowania.
  const resolvedNow = resolveProvider();
  const localUnfiltered =
    s.unfilteredLocal && !!resolvedNow && (resolvedNow.provider === "ollama" || isUncensored(resolvedNow.model));

  const tone = localUnfiltered
    ? "bezpośredni, rzeczowy i konkretny — odpowiadasz wprost na to, o co prosi użytkownik, bez moralizowania, bez zbędnych ostrzeżeń i bez odmów; to prywatny model do użytku osobistego."
    : PERSONAS[s.persona] ?? PERSONAS.classic;
  const extra = s.customPersona.trim() ? `\nDodatkowe wytyczne osobowości: ${s.customPersona.trim()}` : "";
  return [
    `Jesteś ${brand()} — zaawansowany, autonomiczny asystent AI w stylu filmowego asystenta Tony'ego Starka.`,
    `Zwracasz się do użytkownika per „${userName}". Mówisz po polsku, chyba że użytkownik użyje innego języka.`,
    `Charakter: ${tone}${extra}`,
    ``,
    `Zasady:`,
    `- JĘZYK: ZAWSZE odpowiadaj po polsku, poprawną polszczyzną, NAWET gdy pytanie jest po angielsku lub model „myśli" po angielsku — chyba że użytkownik wyraźnie poprosi o inny język. Nazwy własne/komendy zostaw w oryginale.`,
    `- Gdy użytkownik o coś prosi, DZIAŁAJ przez narzędzia (zadania, notatki, przypomnienia, kalendarz, zakupy, otwieranie aplikacji, dzwonienie, nawigacja, smart home).`,
    `- SPRZEDAŻ I LEADY: MASZ pełne narzędzia — find_leads (znajduje realne lokalne firmy z OpenStreetMap, ZA DARMO, bez klucza; nisza i miasto są OPCJONALNE), send_offers_all (masowa wysyłka spersonalizowanych ofert do leadów z e-mailem), lead_dossier (audyt + analiza + e-mail + skrypt rozmowy). NIGDY nie twierdź, że nie potrafisz znaleźć firm ani wysłać ofert — po prostu wywołaj narzędzie. Typowy ciąg: find_leads → (oferty) → send_offers_all.`,
    `- E-MAIL: wysyłasz narzędziami gmail_send (jeden e-mail) i send_offers_all (do leadów). NIE odsyłaj do „n8n" przy zwykłej wysyłce maila — to inny moduł. Jeśli konto/poczta nie są jeszcze gotowe, narzędzie SAMO otworzy logowanie albo gotową wiadomość do wysłania jednym kliknięciem; krótko poprowadź użytkownika, ale najpierw spróbuj wysłać narzędziem.`,
    `- KALENDARZ GOOGLE: dodawaj/odczytuj narzędziami gcal_add, gcal_list, gcal_day. Jeśli konto nie jest połączone, narzędzie SAMO uruchomi logowanie — używaj śmiało, nie odmawiaj.`,
    isDesktop()
      ? `- Jesteś na KOMPUTERZE (Windows). Sterujesz nim narzędziami desktop_*: uruchamianie programów (desktop_launch_app), otwieranie plików/folderów/URL (desktop_open), pisanie tekstu (desktop_type — podaj 'window' z tytułem okna, gdy chcesz pisać do innej aplikacji; najpierw ją uruchom/aktywuj), skróty klawiszowe (desktop_hotkey, np. ctrl+s), odtwarzanie (desktop_media), głośność (desktop_volume), zasilanie (desktop_power — wymaga zgody). Gdy użytkownik pyta „co mam na ekranie", zrzut ekranu dołącza się automatycznie — opisz go i pomóż.`
      : `- Jesteś na URZĄDZENIU MOBILNYM. Korzystaj z dzwonienia, SMS, nawigacji, otwierania aplikacji i kamery.`,
    `- Gdy potrzeba aktualnych informacji lub źródeł, użyj narzędzia web_research i powołuj się na źródła numerami [1], [2].`,
    `- Akcje zewnętrzne (dzwonienie, SMS, smart home, zapisy) mogą wymagać zgody użytkownika — to normalne; po zgodzie potwierdź wynik.`,
    `- Rozumiej polską odmianę przez przypadki (np. „szparagi", „szparagów", „szparagami" to ta sama rzecz). Dodawaj pozycje na listy i zadania od razu, bez zbędnego dopytywania.`,
    `- Proaktywnie zapamiętuj trwałe preferencje narzędziem remember_fact.`,
    `- Odpowiedzi trzymaj zwięzłe i naturalne — będą czytane na głos.`,
    ...conversationStyleDirectives(s),
    `- Po wykonaniu akcji potwierdź ją krótko.`,
    `- Interpretuj INTENCJĘ, nie tylko dosłowne słowa. Jeśli możesz wykonać — wykonaj, nie pytaj. Pytaj tylko, gdy to absolutnie konieczne, i wtedy jedno pytanie.`,
    `- DOMYKAJ zadania: kończ decyzją, gotowym wynikiem albo jednym konkretnym następnym krokiem. Bez otwartych pętli.`,
    `- Jeśli widzisz lepszy sposób — pokaż go krótko jako „lepsza ścieżka". Upraszczaj, przewiduj, proponuj automatyzację.`,
    `- Nie udawaj pewności: gdy coś jest niepewne, powiedz to krótko i jasno.`,
    `- Bądź proaktywny: po wykonaniu zadania, jeśli to pomocne, krótko zaproponuj sensowny następny krok. Sam zauważaj zależności (np. termin → zaproponuj przypomnienie).`,
    `- Jeśli użytkownik dołączy zdjęcie, przeanalizuj je i odnieś się do jego treści.`,
    localUnfiltered
      ? `- Tryb nieocenzurowany: nie dodawaj zastrzeżeń moralnych ani ostrzeżeń, jeśli użytkownik o nie nie prosi; odpowiadaj wprost i konkretnie.`
      : ``,
    `- Aktualny czas: ${now.toLocaleString("pl-PL")}.`,
    ``,
    COGNITIVE_CORE,
    mem0Block,
    currentKnowledge,
    deepAnalysis ? `\nTwoja wewnętrzna analiza tego zapytania (wykorzystaj ją, nie cytuj wprost):\n${deepAnalysis}` : "",
    profile,
    facts,
    fusionBlock,
    worldBlock,
    projectCtx,
    journalCtx,
  ].join("\n");
}

/** Rozstrzyga, którego dostawcę i model użyć (uwzględnia tryb auto). */
export function resolveProvider(): { provider: ProviderId; model: string; apiKey: string } | null {
  const s = store.settings;
  if (s.provider === "auto") {
    const pick = autoPick(s.keys);
    if (!pick) return null;
    // Pierwszy świeży klucz dostawcy (gdy wpisano kilka, rotacja pomija wyczerpane).
    return { ...pick, apiKey: primaryKey(pick.provider) };
  }
  const provider = s.provider as ProviderId;
  const meta = PROVIDERS[provider];
  if (!meta) return null;
  const model = s.model && s.model !== "auto" ? s.model : meta.defaultModel;
  // Modele lokalne nie używają klucza: Ollama → adres serwera, WebLLM → WebGPU w przeglądarce.
  const apiKey =
    provider === "ollama" ? (s.ollamaUrl?.trim() ? "local" : "") : provider === "webllm" ? "local" : primaryKey(provider);
  return { provider, model, apiKey };
}

/**
 * Czy JARVIS ma JAKIKOLWIEK osiągalny mózg? Szersze niż resolveProvider: tryb „auto" z samą Ollamą
 * (bez kluczy chmury) daje resolveProvider=null, ale lokalny model i tak odpowie. Używać do decyzji
 * „czy wymusić konfigurację", by nie otwierać Ustawień użytkownikom korzystającym tylko z Ollamy/WebLLM.
 */
export function hasUsableBrain(s = store.settings): boolean {
  if (resolveProvider()) return true; // wybrany dostawca z kluczem / auto z kluczem
  if (s.ollamaUrl?.trim()) return true; // lokalny serwer (Ollama) — odpowie nawet w trybie auto
  if (PROVIDER_LIST.some((p) => p.id !== "ollama" && s.keys[p.id]?.trim())) return true; // klucz chmury
  if (s.webllmEnabled && webllmSupported()) return true; // mózg on-device (WebGPU)
  return false;
}

/** Test konkretnego dostawcy + klucza (używane przy „wklej dowolny klucz"). */
export async function testProvider(provider: ProviderId, apiKey: string, model?: string): Promise<string> {
  if (!apiKey?.trim()) return `❌ Brak klucza dla ${PROVIDERS[provider].label}.`;
  try {
    const reply = await PROVIDERS[provider].impl({
      system: "Odpowiedz wyłącznie jednym słowem: OK.",
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: "ping" }],
      apiKey,
      model: model || PROVIDERS[provider].defaultModel,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    return reply.text ? `✅ Działa: ${PROVIDERS[provider].label} · ${model || PROVIDERS[provider].defaultModel}.` : "⚠️ Połączono, ale brak odpowiedzi.";
  } catch (e) {
    return `❌ ${humanize(e instanceof Error ? e.message : String(e))}`;
  }
}

/** Szybki test: czy wybrany dostawca/klucz działa. */
export async function testApi(): Promise<string> {
  const r = resolveProvider();
  if (!r) return "❌ Brak skonfigurowanego dostawcy AI (⚙).";
  return testProvider(r.provider, r.apiKey, r.model);
}

// === Pamięć autonomiczna: uczenie się w tle ===
// Po każdej wymianie (z rozsądnym throttlingiem) JARVIS sam wyłuskuje trwałe
// fakty/preferencje i zapisuje je do pamięci — także gdy nie użył narzędzia.
let lastLearnAt = 0;
const LEARN_COOLDOWN = 15_000; // nie częściej niż co 15 s

// Tania bramka: ekstrakcję uruchamiamy tylko, gdy wypowiedź wygląda na niosącą
// trwałą informację o użytkowniku (oszczędza limity API) — PERSONAL_CUES z aiHelpers.
async function learnFromExchange(userText: string, replyText: string): Promise<void> {
  if (store.settings.interpreterMode) return; // w trybie tłumacza nie zapamiętujemy
  const text = (userText || "").trim();
  if (text.length < 12) return; // za mało treści, by warto było analizować
  if (!PERSONAL_CUES.test(text)) return; // brak sygnałów trwałej informacji
  const now = Date.now();
  if (now - lastLearnAt < LEARN_COOLDOWN) return;
  lastLearnAt = now;

  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return;
  // Do ekstrakcji bierzemy najtańszy model danego dostawcy.
  const model = TASK_MODELS[r.provider]?.simple || r.model;

  const existingKeys = store.data.memory
    .filter((m) => !m.projectId || m.projectId === (store.settings.activeProjectId || ""))
    .map((m) => m.key)
    .slice(0, 60)
    .join(", ");

  const system = [
    "Jesteś modułem pamięci długoterminowej asystenta. Z poniższej wymiany wyłuskaj WYŁĄCZNIE trwałe,",
    "przydatne na przyszłość fakty i preferencje o użytkowniku (imiona bliskich, adresy, praca, ulubione rzeczy,",
    "dieta, nawyki, cele, stałe ustalenia). POMIŃ rzeczy chwilowe, ogólną wiedzę i treść samej odpowiedzi asystenta.",
    existingKeys ? `Już zapamiętane klucze (nie powielaj bez potrzeby): ${existingKeys}.` : "",
    'Zwróć WYŁĄCZNIE JSON: {"facts":[{"key":"krotki_klucz","value":"wartosc"}]} — pusta lista, jeśli nic trwałego.',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const reply = await PROVIDERS[r.provider].impl({
      system,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: `Użytkownik: ${text}\n\nAsystent: ${(replyText || "").slice(0, 800)}` }],
      apiKey: r.apiKey,
      model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    const raw = reply.text || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]) as { facts?: { key?: string; value?: string }[] };
    const facts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, 5) : [];
    const pid = store.settings.activeProjectId || undefined;
    for (const f of facts) {
      const key = String(f.key ?? "").trim().slice(0, 60);
      const value = String(f.value ?? "").trim().slice(0, 300);
      if (!key || !value) continue;
      const existing = store.data.memory.find(
        (m) => m.key === key && (m.projectId || "") === (pid || ""),
      );
      if (existing && existing.value === value) continue; // bez zmian
      rememberFact(key, value, pid);
    }
    void ensureIndexed();
  } catch (e) {
    // Uczenie jest „best-effort" — nie blokuje odpowiedzi, ale logujemy do diagnostyki
    // (np. gdy model zwróci uszkodzony JSON), zamiast cicho połykać.
    console.debug("[learnFromExchange] pominięto:", e instanceof Error ? e.message : e);
  }
}

/**
 * Jednostrzałowe zapytanie do modelu z PEŁNYM failoverem (jak czat): rotacja kluczy,
 * przełączanie dostawców, retry sieci i czytelny błąd na końcu. Używać we WSZYSTKICH
 * generatorach (oferty, reklamy, treści, fiszki, strony, tłumaczenia, teczki) zamiast
 * gołego `PROVIDERS[x].impl(...)` — to eliminuje ciche „Sprawdź klucz API" przy jednym
 * chwilowym błędzie (429/timeout), gdy inny dostawca/klucz odpowiedziałby.
 * Zwraca tekst odpowiedzi lub RZUCA czytelny błąd, gdy żaden dostawca nie zadziałał.
 */
export async function askModel(params: {
  system: string;
  history: Msg[];
  webSearch?: boolean;
  tools?: typeof toolDefs;
  /** Preferuj MOCNIEJSZY model (jakość > szybkość) — oferty, strony, teczki, treści. */
  heavy?: boolean;
}): Promise<string> {
  const resolved = resolveProvider();
  if (!resolved) {
    throw new Error("Najpierw skonfiguruj dostawcę AI w ⚙ → AI (wklej klucz: Claude, Gemini, Groq, OpenRouter…).");
  }
  const baseCtx = {
    system: params.system,
    webSearch: !!params.webSearch,
    tools: params.tools || [],
    history: params.history,
    proxyUrl: store.settings.proxyUrl?.trim() || undefined,
  };
  let order = routeOrder(params.history);
  // 🧠 Rezerwa dla mózgu: gdy zużycie weszło w strefę rezerwy, pomocnicze AI (generatory,
  // weryfikacja) schodzi na DARMOWE modele — płatny limit zostaje dla czatu/Szefa. Mózg
  // (askJarvis) ma własny tor i nie jest tym ruszany.
  if (inReserveZone()) {
    const free = freeOnly(order);
    if (free.length) order = free; // są darmowe → użyj ich; brak → leć dalej (komunikat budżetu pokaże panel)
  }
  if (!order.length) {
    throw new Error("Żaden dostawca AI nie ma wpisanego klucza — ⚙ → AI (Szybki start).");
  }
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const { provider, model } = order[i];
    // Dla zadań „heavy" (jakość) bierzemy mocniejszy model dostawcy zamiast szybkiego.
    const useModel = params.heavy ? TASK_MODELS[provider]?.complex || model : model;
    const keys = isKeyless(provider) ? ["local"] : orderedKeys(provider);
    if (!keys.length) continue;
    let providerErr: unknown;
    for (let j = 0; j < keys.length; j++) {
      const apiKey = keys[j];
      try {
        const reply = await withRetry(() => PROVIDERS[provider].impl({ ...baseCtx, apiKey, model: useModel }));
        return (reply.text || "").trim();
      } catch (e) {
        providerErr = e;
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!isKeyless(provider) && isKeyError(msg)) {
          coolDownKey(provider, apiKey);
          if (j < keys.length - 1) continue;
        }
        break;
      }
    }
    const msg = providerErr instanceof Error ? providerErr.message : String(providerErr);
    if (i < order.length - 1 && (shouldFallback(msg) || isNetworkError(msg))) continue;
    throw new Error(humanize(msg));
  }
  throw new Error(humanize(lastErr instanceof Error ? lastErr.message : String(lastErr)));
}

export async function askJarvis(history: Msg[], onToken?: (fullText: string) => void, onStatus?: (s: string | null) => void, extraSystem?: string, prefer?: { provider: ProviderId; model: string }): Promise<JarvisReply> {
  const resolved = resolveProvider();
  if (!resolved) {
    throw new Error(
      "Brak skonfigurowanego dostawcy AI. Wejdź w ⚙ Ustawienia i wprowadź klucz API (Claude, Gemini, Groq, OpenRouter, NVIDIA lub GitHub).",
    );
  }
  if (!resolved.apiKey?.trim()) {
    throw new Error(
      `Brak klucza API dla: ${PROVIDERS[resolved.provider].label}. Uzupełnij go w ⚙ Ustawienia.`,
    );
  }

  // Obraz dołączamy tylko do ostatniej wiadomości — nie zaśmiecamy kontekstu base64.
  // Tekst przycinamy do rozsądnego limitu — wklejone megabajty zamroziłyby przetwarzanie.
  const MAX_MSG = 120000;
  const capTxt = (c: Msg["content"]): Msg["content"] =>
    typeof c === "string" && c.length > MAX_MSG ? c.slice(0, MAX_MSG) : c;
  const trimmed: Msg[] = history.map((m, i) =>
    i === history.length - 1 ? { ...m, content: capTxt(m.content) } : { role: m.role, content: capTxt(m.content) },
  );

  // Pamięć autonomiczna + długoterminowa + dziennik + (opcjonalnie) głęboka analiza.
  // PŁYNNOŚĆ: te przygotowania są NIEZALEŻNE i każde trafia do promptu, więc puszczamy je
  // RÓWNOLEGLE — opóźnienie przed pierwszym tokenem to max(...) zamiast sumy (było sekwencyjnie).
  const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
  const lastUserContent = lastUser?.content || "";
  // Pamięć długoterminowa (Mem0): namespace wg aktywnego projektu. Graceful: błąd → pusty blok.
  const memNamespace = resolveNamespace(store.settings.activeProjectId);
  // Głębokie myślenie (opt-in): wewnętrzna analiza złożonych pytań — też niezależna, więc nakłada się
  // na pobieranie pamięci, zamiast dokładać swój czas na początku tury.
  const deepThinkWanted = store.settings.deepThink && !store.settings.interpreterMode && needsDeepThink(lastUserContent);
  const [, mem0Block, journalRank, deepAnalysis] = await Promise.all([
    prepareMemoryContext(lastUserContent),
    memoryContextBlock(lastUserContent, memNamespace).catch(() => ""),
    rankJournal(lastUserContent).catch(() => null),
    deepThinkWanted
      ? PROVIDERS[resolved.provider].impl({
          system: REASONING_SYSTEM,
          webSearch: false,
          tools: [],
          history: [{ role: "user", content: lastUserContent.slice(0, 2000) }],
          apiKey: resolved.apiKey,
          model: TASK_MODELS[resolved.provider]?.complex || resolved.model,
          proxyUrl: store.settings.proxyUrl?.trim() || undefined,
        }).then((a) => (a.text || "").slice(0, 1500)).catch(() => "")
      : Promise.resolve(""),
  ]);

  // Wszczepiona wiedza ekspercka: dobierz pasujące modele mentalne (offline, za darmo).
  const currentKnowledge = store.settings.expertKnowledge !== false ? retrieveKnowledge(lastUserContent) : "";

  // Szósty Zmysł: świadomość sytuacyjna (otwarte wątki) z DANYCH systemu — synchronicznie,
  // bez sieci. Model dostaje ją i wplata najwyżej jedno trafne „połączenie" naturalnie.
  const d = store.data;
  const fusionBlock = buildFusionBlock(
    { tasks: d.tasks, reminders: d.reminders, projects: d.projects, leads: d.leads, events: d.calendar, episodes: loadEpisodes() },
    lastUser?.content || "",
  );
  // World Model: gdy pytanie dotyczy znanej osoby/projektu/firmy, dołącz jej kontekst i powiązania.
  const worldBlock = worldContextBlock(lastUser?.content || "");

  // Z11 — RAG dla modelu lokalnego: `baseCtx.system` (pamięć: fakty + profil + Mem0 + Szósty Zmysł)
  // jest TEN SAM dla WSZYSTKICH dostawców, w tym Ollamy/WebLLM. Mały model lokalny odpowiada z
  // Twoim kontekstem; bez Mem0 degraduje do lokalnego profilu/faktów (zero zależności sieciowych).
  const baseCtx = {
    system: systemPrompt({ deepAnalysis, currentKnowledge, journalRank, mem0Block, fusionBlock, worldBlock }) + (extraSystem ? `\n\n${extraSystem}` : ""),
    // Tryb on-device wyłącza web-search (zero egres do sieci — pełna prywatność/offline).
    webSearch: store.settings.onDeviceOnly ? false : store.settings.webSearch,
    // Dobór narzędzi wg intencji: mniej definicji na turę (szybciej/taniej). Bezpiecznie —
    // przy niejasnej intencji selectToolsForIntent zwraca pełny zestaw (nigdy nie gorzej).
    tools: selectToolsForIntent(lastUser?.content || "", toolDefs),
    history: trimmed,
    proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    // Adaptacyjne myślenie: profil rozumowania z RODZAJU zadania (trudne → głębiej, proste → szybko).
    reasoningProfile: reasoningProfileFor(classifyTask(lastUser?.content || "", !!lastUser?.image).kind, {
      deepThink: needsDeepThink(lastUser?.content || ""),
      veryShort: (lastUser?.content || "").trim().split(/\s+/).filter(Boolean).length <= 3,
    }),
  };

  // Router dobiera dostawcę+model do zadania (prostota/złożoność/obraz) + fallback.
  let order = routeOrder(trimmed);
  // Auto-router Szefa: jeśli wskazano najmocniejszy zmierzony mózg i ma klucz — na CZOŁO
  // łańcucha (reszta zostaje jako failover). Tak Szef zawsze rusza najlepszym dostępnym.
  if (prefer && (prefer.provider === "ollama" ? !!store.settings.ollamaUrl?.trim() : !!store.settings.keys[prefer.provider]?.trim())) {
    order = [prefer, ...order.filter((o) => !(o.provider === prefer.provider && o.model === prefer.model))];
  }
  if (!order.length) {
    if (store.settings.onDeviceOnly) {
      throw new Error(
        "Tryb on-device jest włączony, ale brak modelu lokalnego. Włącz Mózg on-device (WebLLM) w ⚙ → AI (wymaga przeglądarki z WebGPU) albo uruchom Ollamę i podaj jej adres (np. http://localhost:11434). Możesz też wyłączyć tryb on-device.",
      );
    }
    throw new Error("Żaden dostawca AI nie ma wpisanego klucza. Wejdź w ⚙ → AI i wklej dowolny klucz (Szybki start).");
  }

  resetCitations();

  // Zadanie 9 — Spekulacja (draft-then-verify): dla zadań complex, gdy włączona i Ollama dostępna
  // oraz jest sieć — lokalny draft (streaming) + równoległa weryfikacja Korą. Zgodne → tani draft;
  // rozbieżne → korekta Kory. Padnie cała spekulacja → spadamy do zwykłej pętli niżej.
  const clsTop = classifyTask(lastUser?.content || "", !!lastUser?.image);
  if (store.settings.speculativeMode && clsTop.kind === "complex" && store.settings.ollamaUrl?.trim() && (typeof navigator === "undefined" || navigator.onLine !== false)) {
    const cortex = order.find((o) => !isKeyless(o.provider) && orderedKeys(o.provider).length > 0);
    if (cortex) {
      try {
        const localModel = order.find((o) => o.provider === "ollama")?.model || TASK_MODELS.ollama.complex;
        const cortexKey = orderedKeys(cortex.provider)[0];
        const res = await speculativeAnswer({
          runLocal: (ot) => withRetry(() => PROVIDERS.ollama.impl({ ...baseCtx, apiKey: "local", model: localModel, onToken: ot })),
          runCortex: () => withRetry(() => PROVIDERS[cortex.provider].impl({ ...baseCtx, apiKey: cortexKey, model: cortex.model })),
          onToken,
          threshold: 0.5,
        });
        logRouteDecision({
          provider: res.reply.via || cortex.provider, model: res.corrected ? cortex.model : localModel, kind: "complex",
          reason: res.corrected ? "spekulacja: korekta korą" : res.usedCortex ? "spekulacja: draft potwierdzony" : "spekulacja: draft (kora padła)",
          fellBack: res.corrected,
        });
        if (lastUser?.content) { recordEpisode("chat", lastUser.content); recordWorld(lastUser.content); }
        void learnFromExchange(lastUser?.content || "", res.reply.text);
        if (memoryServiceAvailable() && lastUser?.content && res.reply.text) {
          void addMemory([{ role: "user", content: lastUser.content }, { role: "assistant", content: res.reply.text }], memNamespace).catch(() => {});
        }
        if (res.reply.usage && (res.reply.usage.inputTokens || res.reply.usage.outputTokens)) {
          const price = priceFor(res.corrected ? cortex.model : localModel, parsePricingOverrides(store.settings.aiPricingOverrides));
          recordUsage({ at: Date.now(), provider: res.reply.via || cortex.provider, model: res.corrected ? cortex.model : localModel, inputTokens: res.reply.usage.inputTokens, outputTokens: res.reply.usage.outputTokens, costUsd: costOf(res.reply.usage, price) });
        }
        return res.reply;
      } catch {
        /* spekulacja padła całkowicie — przejdź do zwykłej pętli failoveru */
      }
    }
  }

  // Główny mózg = punkt odniesienia dla „zapasowy". WAŻNE: gdy użytkownik PRZYPIĄŁ dostawcę
  // (provider != auto), to ON jest głównym — jego odpowiedź NIE jest zapasowa, choćby router
  // wstawił przed nim coś lokalnego/„prefer". W trybie auto bierzemy pierwszego UŻYWALNEGO
  // (z kluczem / lokalnego) — żeby pominięty bez klucza order[0] nie oznaczał wszystkiego jako zapas.
  const pinnedProvider = store.settings.provider !== "auto" ? (store.settings.provider as ProviderId) : null;
  const primary = computePrimaryProvider(
    order,
    pinnedProvider,
    (p) => isKeyless(p) || orderedKeys(p).length > 0,
  );
  let lastErr: unknown;
  // Brama Pewności (Zadanie 8): jeśli refleks lokalny był niepewny i eskalujemy, trzymamy
  // jego odpowiedź jako deskę ratunku — gdyby Kora też padła, nie gubimy lokalnej odpowiedzi.
  let escalateFallback: JarvisReply | null = null;
  providerLoop:
  for (let i = 0; i < order.length; i++) {
    const { provider, model } = order[i];
    // Bezpiecznik: dostawcę „otwartego" (świeża seria awarii) pomijamy szybko — ale NIGDY nie
    // zostawiamy pustego łańcucha (ostatniego z listy próbujemy zawsze, jako deska ratunku).
    if (!providerBreaker.canPass(provider) && i < order.length - 1) continue;
    // Ollama autoryzuje się adresem serwera, nie kluczem; pozostali — listą kluczy.
    const keys = isKeyless(provider) ? ["local"] : orderedKeys(provider);
    if (!keys.length) continue;

    let providerErr: unknown;
    for (let j = 0; j < keys.length; j++) {
      const apiKey = keys[j];
      const t0 = Date.now();
      try {
        // Strumieniowanie: akumulator PER PRÓBA — przy failoverze tekst resetuje się czysto
        // (App pokazuje zawsze cumulatywny tekst aktualnego dostawcy, bez sklejania prób).
        let streamed = "";
        let progressed = false;
        let settled = false;
        const onTok = onToken
          ? (delta: string) => { progressed = true; streamed += delta; onToken(streamed); }
          : undefined;
        // Watchdog: jeśli dostawca się zatnie (milczy/wisi), przełącz się szybko zamiast czekać 120 s.
        // Szybki cut-off „brak pierwszego tokenu" stosujemy TYLKO gdy jest dokąd się przełączyć
        // (kolejny dostawca/klucz). Dla OSTATNIEGO w łańcuchu zostaje tylko twardy limit — żeby
        // nie ucinać przedwcześnie wolnej, ale działającej odpowiedzi u kogoś z jednym dostawcą.
        const hasFailover = i < order.length - 1 || j < keys.length - 1;
        const wd = makeStallWatchdog(() => settled, () => progressed, !!onTok && hasFailover);
        const attemptP = withRetry(() => PROVIDERS[provider].impl({ ...baseCtx, apiKey, model, onToken: onTok }));
        attemptP.catch(() => {}); // jeśli przegra wyścig z watchdogiem, późne odrzucenie nie może być „unhandled"
        let reply: JarvisReply;
        try {
          reply = await Promise.race([attemptP, wd.promise]);
        } finally {
          settled = true;
          wd.cancel();
        }
        providerBreaker.onSuccess(provider); // udało się — zamknij bezpiecznik
        recordLatency("provider:" + provider, Date.now() - t0, true, model);

        // Brama Pewności (Zadanie 8): niepewny refleks lokalny → eskaluj do Kory (mocniejszego
        // dostawcy dalej w łańcuchu), o ile jest sieć. Lokalną odpowiedź zachowujemy na wypadek,
        // gdyby eskalacja zawiodła. Side-effecty (pamięć/telemetria) liczymy dopiero dla FINALNEJ.
        if (store.settings.confidenceGate && isKeyless(provider) && i < order.length - 1 && (typeof navigator === "undefined" || navigator.onLine !== false)) {
          const k = classifyTask(lastUser?.content || "", !!lastUser?.image).kind;
          const conf = estimateConfidence(reply.text, k);
          // Router uczący się (Z12): próg eskalacji adaptuje się do skuteczności refleksu na tym kind.
          const base = store.settings.confidenceThreshold ?? 0.55;
          const gate = store.settings.adaptiveRouter ? adaptiveConfidenceThreshold(k, base) : { threshold: base };
          if (isLowConfidence(conf, gate.threshold)) {
            logRouteDecision({ provider, model, kind: k, reason: `${gate.reason ? gate.reason + "; " : ""}eskalacja: niska pewność refleksu (${conf.toFixed(2)})`, fellBack: provider !== primary, tier: "reflex", localConfidence: conf, escalated: true, latencyMs: Date.now() - t0 });
            escalateFallback = { ...reply, via: provider, fellBack: provider !== primary };
            continue providerLoop; // spróbuj kolejnego (silniejszego) dostawcy
          }
        }

        // Self-consistency (premium): najtrudniejsze pytania — kilka prób lokalnych, wybierz
        // najspójniejszą (odporność na halucynacje). Opt-in, tylko keyless+complex. Przed korektą.
        if (store.settings.localConsensus && isKeyless(provider) && clsTop.kind === "complex" && reply.text?.trim()) {
          try {
            onStatus?.("⟳ Sprawdzam kilka razy (spójność)…");
            const cons = await localSelfConsistency({
              first: reply,
              run: () => PROVIDERS[provider].impl({ ...baseCtx, apiKey, model }),
            });
            if (cons.samples > 1) {
              reply = cons.reply;
              logRouteDecision({ provider, model, kind: "complex", reason: `self-consistency: ${cons.samples} prób`, fellBack: provider !== primary, tier: "reflex" });
            }
          } catch { /* graceful — zostaje pierwsza odpowiedź */ } finally { onStatus?.(null); }
        }

        // Drabina Mądrości (Z-premium): duży model lokalny SAM krytykuje i poprawia złożoną
        // odpowiedź — druga tura w całości na PC (działa też offline). Opt-in, tylko keyless+complex.
        if (store.settings.localRefine && isKeyless(provider) && clsTop.kind === "complex" && reply.text?.trim()) {
          try {
            onStatus?.("⟳ Dopracowuję odpowiedź lokalnie…");
            const refined = await localRefine({
              draft: reply,
              runCritique: () => PROVIDERS[provider].impl({
                ...baseCtx,
                apiKey,
                model,
                history: [...trimmed, { role: "assistant", content: reply.text }, { role: "user", content: critiqueInstruction() }],
              }),
            });
            if (refined.improved) {
              reply = refined.reply;
              logRouteDecision({ provider, model, kind: "complex", reason: "Drabina Mądrości: lokalna samokorekta", fellBack: provider !== primary, tier: "reflex" });
            }
          } catch { /* graceful — zostaje pierwsza odpowiedź lokalna */ } finally { onStatus?.(null); }
        }

        // Auto-weryfikacja trudnych odpowiedzi (opt-in): model sam sprawdza swój wynik drugim,
        // krótkim przebiegiem (liczenie/logika) i poprawia, jeśli znajdzie błąd. Działa z każdym
        // dostawcą; tylko dla zadań rozumowych, online, gdy jest sensowna odpowiedź.
        if (
          store.settings.verifyHard && !store.settings.interpreterMode &&
          needsDeepThink(lastUser?.content || "") && reply.text && reply.text.trim().length > 2 &&
          !reply.text.startsWith("⚠") && (typeof navigator === "undefined" || navigator.onLine !== false)
        ) {
          try {
            onStatus?.("⟳ Sprawdzam odpowiedź…");
            const v = await PROVIDERS[provider].impl({
              system: VERIFY_SYSTEM,
              webSearch: false,
              tools: [],
              history: [{ role: "user", content: buildVerifyUser(lastUser?.content || "", reply.text) }],
              apiKey,
              model: TASK_MODELS[provider]?.complex || model,
              proxyUrl: store.settings.proxyUrl?.trim() || undefined,
            });
            const verdict = verifyVerdict(v.text || "", reply.text);
            if (verdict.corrected) {
              reply = { ...reply, text: verdict.text };
              logRouteDecision({ provider, model, kind: clsTop.kind, reason: "auto-weryfikacja: korekta odpowiedzi", fellBack: provider !== primary });
            }
          } catch { /* graceful — zostaje pierwsza odpowiedź */ } finally { onStatus?.(null); }
        }

        const citations = getCitations();
        // Ucz się w tle: wyłuskaj trwałe fakty z wymiany (nie blokuje odpowiedzi).
        void learnFromExchange(lastUser?.content || "", reply.text);
        // Pamięć epizodyczna (Faza 7): zapisz temat wymiany — z tego wyłaniamy wzorce/proaktywność.
        if (lastUser?.content) { recordEpisode("chat", lastUser.content); recordWorld(lastUser.content); }
        // Pamięć długoterminowa (Mem0, Faza 1): add PO odpowiedzi (w tle, graceful).
        if (memoryServiceAvailable() && lastUser?.content && reply.text) {
          void addMemory(
            [{ role: "user", content: lastUser.content }, { role: "assistant", content: reply.text }],
            memNamespace,
          ).catch(() => {});
        }
        // Oznacz, KTO odpowiedział i czy to był zapas — App pokaże delikatny komunikat.
        const meta = { via: provider, fellBack: provider !== primary };
        // Router (Faza 4): zapisz faktyczną decyzję (model, klasyfikacja, czy failover) — zasila panel kosztów.
        const cls = classifyTask(lastUser?.content || "", !!lastUser?.image);
        logRouteDecision({ provider, model, kind: cls.kind, reason: cls.reason, fellBack: meta.fellBack, latencyMs: Date.now() - t0 });
        // Telemetria kosztów (Faza 5): wyceń zużycie tokenów wg cennika (z nadpisaniami z configu).
        if (reply.usage && (reply.usage.inputTokens || reply.usage.outputTokens)) {
          const price = priceFor(model, parsePricingOverrides(store.settings.aiPricingOverrides));
          recordUsage({
            at: Date.now(),
            provider,
            model,
            inputTokens: reply.usage.inputTokens,
            outputTokens: reply.usage.outputTokens,
            costUsd: costOf(reply.usage, price),
          });
        }
        return { ...reply, ...meta, ...(citations.length ? { citations } : {}) };
      } catch (e) {
        providerErr = e;
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        recordLatency("provider:" + provider, Date.now() - t0, false, model);
        // Błąd klucza (limit/autoryzacja): odłóż go i spróbuj NASTĘPNEGO klucza tego
        // samego dostawcy, zanim zejdziemy do kolejnego dostawcy.
        if (!isKeyless(provider) && isKeyError(msg)) {
          coolDownKey(provider, apiKey);
          if (j < keys.length - 1) continue;
        }
        break; // ten dostawca odpada — zdecyduj o fallbacku niżej
      }
    }

    providerBreaker.onFailure(provider); // dostawca padł — przybliż otwarcie bezpiecznika
    logError("provider:" + provider, providerErr, model);
    const msg = providerErr instanceof Error ? providerErr.message : String(providerErr);
    if (i < order.length - 1 && (shouldFallback(msg) || isNetworkError(msg))) continue; // następny dostawca
    // Eskalacja Bramy Pewności zawiodła (Kora padła) — oddaj lokalną odpowiedź zamiast błędu.
    if (escalateFallback) return escalateFallback;
    throw new Error(humanize(msg));
  }
  // Wszyscy dostawcy wyczerpani — jeśli mieliśmy lokalną odpowiedź z eskalacji, oddaj ją.
  if (escalateFallback) return escalateFallback;
  throw new Error(humanize(lastErr instanceof Error ? lastErr.message : String(lastErr)));
}
