// === Kontroler poznawczy — JEDEN centralny wybór sposobu działania ===
// Każda wiadomość przechodzi przez ten kontroler: decyduje, JAK JARVIS ma myśleć i działać
// (rozmowa? research? analiza? jedna akcja? cel wieloetapowy? obraz? dopytanie?). Najpierw
// szybka, LOKALNA klasyfikacja (zero API). Gemini structured uruchamiamy TYLKO przy niskiej
// pewności — i tylko, gdy wywołujący poda hak `escalate` (w runtime domyślnie go nie podajemy,
// więc zwykłe pytanie NIE uruchamia planera ani dodatkowych wywołań API).
//
// Buduje na istniejących, otestowanych modułach (NIE dubluje routera/planera):
//   classifyTask + reasoningProfileFor + needsDeepThink (modelRouter), looksMultiStep (agentPlanner),
//   model ryzyka (permissions). Czysty i testowalny. S9-safe (jawne klasy PL, bez /u, \p, lookbehind).
// Nie pokazuje toku myślenia (chain-of-thought) — `reason` to krótka, jawna etykieta.

import { classifyTask, needsDeepThink, reasoningProfileFor } from "./modelRouter";
import { looksMultiStep } from "./agentPlanner";
import type { ReasoningProfile } from "./providers/types";
import type { Risk } from "./permissions";

export type CognitiveMode =
  | "respond"          // zwykła rozmowa/wiedza — po prostu odpowiedz
  | "clarify"          // niejednoznaczne — dopytaj zamiast zgadywać
  | "research"         // potrzebne AKTUALNE dane z zewnątrz (grounding/web)
  | "analyze"          // głęboka analiza/porównanie/strategia
  | "single_action"    // jedna akcja narzędziem
  | "multi_step_goal"  // cel wieloetapowy → planer
  | "vision";          // wiadomość zawiera obraz

export interface CognitiveDecision {
  mode: CognitiveMode;
  confidence: number;            // 0..1 — pewność lokalnej klasyfikacji
  reasoningProfile: ReasoningProfile;
  needsCurrentData: boolean;     // czy potrzebny świeży research z sieci
  needsMemory: boolean;          // czy sięgnąć po pamięć/kontekst użytkownika
  needsTools: boolean;           // czy w grę wchodzą narzędzia
  needsVerification: boolean;    // czy wynik trzeba zweryfikować przed ogłoszeniem sukcesu
  risk: Risk;                    // read | write | outbound (najwyższe wykryte)
  reason: string;                // krótka, JAWNA etykieta (bez chain-of-thought)
}

// Próg, poniżej którego warto sięgnąć po structured classification (Gemini) — jeśli dostępne.
export const LOW_CONFIDENCE = 0.5;

// --- Sygnały lokalne (S9-safe regexy: bez /u, \p{L}, lookbehind) ---

// Świeże dane z zewnątrz: ceny/kursy/pogoda/wiadomości/„sprawdź w internecie".
const RESEARCH_CUES =
  /\b(aktualn|dziś|dzisiaj|teraz|obecn|najnowsz|ostatnie? (wiadomo|wieści|wiesci|notowani)|bieżąc|biezac|cena|ceny|kurs|notowani|pogod|wiadomośc|wiadomosc|newsy?|kto (wygrał|wygral|jest teraz)|ile kosztuje|sprawdź w (internecie|sieci|google)|sprawdz w (internecie|sieci|google)|wyszukaj|wygoogluj|w internecie|w 20\d\d roku|w 20\d\d r)\b/i;

// Akcja narzędziem (imperatyw). Outbound (na zewnątrz/nieodwracalne) i write (lokalny zapis).
const OUTBOUND_CUES =
  /\b(wyślij|wyslij|wyśl|wysłać|wyslac|wyślę|wysle|mail(a|em)?|e-?mail|sms|zadzwoń|zadzwon|dzwoń|dzwon|opublikuj|publikuj|postnij|zapłać|zaplac|płatnoś|platnos|przelej|przelew|reklam|kampani|wyślemy|wyslemy)\b/i;
const WRITE_CUES =
  /\b(dodaj|utwórz|utworz|stwórz|stworz|zapisz|usuń|usun|skasuj|zmień|zmien|zaktualizuj|ustaw|edytuj|oznacz|przenieś|przenies|zaplanuj|zarezerwuj|przypomnij|ponagl)\b/i;

// Osobiste/biznesowe odwołania → sięgnij po pamięć/kontekst użytkownika.
const PERSONAL_CUES =
  /\b(mój|moj|moja|moje|moich|moim|nasz|nasza|nasze|naszych|projekt|projekc|klient|klienc|lead|leady|leadów|leadow|faktur|przychod|przychód|firm|oferta|ofert|kalendarz|zadani|przypomnieni|spotkani|należnoś|naleznos|koszt|budżet|budzet)\b/i;

// Porównanie/decyzja/strategia → analiza (głębsze rozumowanie).
const ANALYZE_CUES =
  /\b(porównaj|porownaj|przeanalizuj|analiz|oceń|ocen|strateg|wybierz najlep|który (lepsz|warto)|ktory (lepsz|warto)|wady i zalety|za i przeciw|ryzyk|rekomenduj|doradź|doradz|opłaca|oplaca|decyzj)\b/i;

// Wyraźnie niejednoznaczne, ubogie polecenia (po przycięciu) → dopytaj.
const VAGUE_EXACT =
  /^(zrób to|zrob to|to|tamto|a (co|jak)( z (tym|tamtym|nim))?|i (co|jak)( dalej)?|co dalej|jak\??|no i\??|i\?|ok i co|hmm+|co teraz|a teraz)$/i;

const wordCount = (t: string): number => (t || "").trim().split(/\s+/).filter(Boolean).length;

/** Pure: najwyższe wykryte ryzyko z treści polecenia (outbound > write > read). */
export function riskFromText(text: string): Risk {
  const t = text || "";
  if (OUTBOUND_CUES.test(t)) return "outbound";
  if (WRITE_CUES.test(t)) return "write";
  return "read";
}

/**
 * Pure, LOKALNA klasyfikacja poznawcza — zero API. Zwraca komplet decyzji.
 * Priorytet: obraz > dopytanie(vague) > cel wieloetapowy > pojedyncza akcja > research > analiza > odpowiedź.
 */
export function classifyCognitionLocal(text: string, opts: { hasImage?: boolean } = {}): CognitiveDecision {
  const raw = text || "";
  const t = raw.trim();
  const low = t.toLowerCase();
  const wc = wordCount(t);
  const veryShort = wc <= 3;

  const baseKind = classifyTask(t, !!opts.hasImage).kind;
  const deep = needsDeepThink(t);
  const risk = riskFromText(t);
  const hasAction = OUTBOUND_CUES.test(t) || WRITE_CUES.test(t);
  const isResearch = RESEARCH_CUES.test(t);
  const isAnalyze = ANALYZE_CUES.test(t) || (baseKind === "complex" && !hasAction);
  const multi = looksMultiStep(t);
  const vague = !opts.hasImage && (VAGUE_EXACT.test(low) || (wc <= 2 && !hasAction && !isResearch));

  let mode: CognitiveMode;
  let confidence: number;
  if (opts.hasImage) { mode = "vision"; confidence = 0.95; }
  else if (vague) { mode = "clarify"; confidence = 0.4; }
  else if (multi) { mode = "multi_step_goal"; confidence = 0.8; }
  else if (hasAction) { mode = "single_action"; confidence = 0.75; }
  else if (isResearch) { mode = "research"; confidence = 0.8; }
  else if (isAnalyze) { mode = "analyze"; confidence = 0.7; }
  else { mode = "respond"; confidence = veryShort ? 0.85 : 0.7; }

  // Profil rozumowania ZGODNY z dotychczasowym runtime (reasoningProfileFor z rodzaju zadania),
  // by nie wprowadzać regresji; cele i analizy podbijamy do high (zasługują na głębię).
  let reasoningProfile: ReasoningProfile = reasoningProfileFor(baseKind, { deepThink: deep, veryShort });
  if (mode === "multi_step_goal" || mode === "analyze") reasoningProfile = "high";
  if (mode === "clarify") reasoningProfile = "minimal";

  const needsCurrentData = mode === "research" || isResearch;
  const needsTools = mode === "single_action" || mode === "multi_step_goal";
  const needsMemory = needsTools || mode === "analyze" || PERSONAL_CUES.test(t);
  const needsVerification = mode === "multi_step_goal" || (mode === "single_action" && risk !== "read") || mode === "analyze";

  const reason =
    mode === "vision" ? "wiadomość z obrazem"
    : mode === "clarify" ? "polecenie niejednoznaczne — dopytaj"
    : mode === "multi_step_goal" ? "cel wieloetapowy — zaplanuj kroki"
    : mode === "single_action" ? `pojedyncza akcja (ryzyko: ${risk})`
    : mode === "research" ? "potrzebne aktualne dane z sieci"
    : mode === "analyze" ? "analiza/porównanie — głębsze rozumowanie"
    : "zwykła odpowiedź";

  return { mode, confidence, reasoningProfile, needsCurrentData, needsMemory, needsTools, needsVerification, risk, reason };
}

// JSON Schema do structured classification (Gemini responseSchema) — używana TYLKO przy eskalacji.
export const COGNITION_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["respond", "clarify", "research", "analyze", "single_action", "multi_step_goal", "vision"] },
    confidence: { type: "number" },
    needsCurrentData: { type: "boolean" },
    needsMemory: { type: "boolean" },
    needsTools: { type: "boolean" },
    needsVerification: { type: "boolean" },
    risk: { type: "string", enum: ["read", "write", "outbound"] },
  },
  required: ["mode", "confidence"],
} as const;

/** Hak eskalacji: structured classification z modelu (wstrzykiwany — w testach mock, w runtime opcjonalny). */
export type CognitiveEscalator = (text: string) => Promise<Partial<CognitiveDecision> & { mode: CognitiveMode }>;

export interface DecideOpts {
  hasImage?: boolean;
  /** Hak do structured classification — wywołany TYLKO przy niskiej pewności lokalnej. */
  escalate?: CognitiveEscalator;
  lowConfidence?: number;
}

/**
 * Decyzja poznawcza: najpierw lokalnie (tanio). Jeśli pewność < progu I podano `escalate`,
 * dopiero wtedy sięga po structured classification i SCALA wynik (model nadpisuje tryb/flagi).
 * Bez `escalate` zwraca wyłącznie wynik lokalny — zwykłe pytanie nie uruchamia żadnego API.
 */
export async function decideCognition(text: string, opts: DecideOpts = {}): Promise<CognitiveDecision> {
  const local = classifyCognitionLocal(text, { hasImage: opts.hasImage });
  const threshold = opts.lowConfidence ?? LOW_CONFIDENCE;
  if (local.confidence >= threshold || !opts.escalate) return local;
  try {
    const esc = await opts.escalate(text);
    if (!esc || !esc.mode) return local;
    // Model nadpisuje tryb/flagi; resztę (reasoningProfile itd.) przeliczamy spójnie z lokalnym.
    const merged: CognitiveDecision = {
      ...local,
      ...esc,
      mode: esc.mode,
      confidence: typeof esc.confidence === "number" ? esc.confidence : 0.75,
    };
    // Tryb celu/analizy zawsze zasługuje na high; dopytanie zostaje minimalne.
    if (merged.mode === "multi_step_goal" || merged.mode === "analyze") merged.reasoningProfile = "high";
    if (merged.mode === "clarify") merged.reasoningProfile = "minimal";
    merged.needsTools = merged.mode === "single_action" || merged.mode === "multi_step_goal" || merged.needsTools === true;
    return merged;
  } catch {
    // Eskalacja padła (sieć/quota) → bezpiecznie zostajemy przy decyzji lokalnej.
    return local;
  }
}
