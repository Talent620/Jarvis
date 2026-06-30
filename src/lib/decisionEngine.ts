// === Rada Strategiczna (decisionEngine): Strateg → Krytyk → Sędzia ===
// Przy WAŻNYCH decyzjach JARVIS kwestionuje własny pierwszy pomysł, ZANIM doradzi. Trzy role po
// kolei: Strateg proponuje, Krytyk szuka błędów/kosztów/ryzyk, Sędzia wybiera lub łączy najlepsze
// i zwraca STRUKTURĘ (rekomendacja, alternatywy, ryzyka, odwracalność, pierwszy bezpieczny krok,
// pewność). Tryb: economy OFF, balanced tylko na żądanie, maximum AUTO dla wysokiej stawki.
// Nie pokazujemy surowego toku myślenia — tylko wnioski. Rdzeń CZYSTY z wstrzykiwanym runnerem
// (testy bez API), runtime wpina dostawcę. S9-safe (bez /u, \p, lookbehind).

import type { IntelligenceMode } from "./geminiCapabilities";

export type DecisionRole = "strateg" | "krytyk" | "sedzia";
export type Reversibility = "reversible" | "hard_to_reverse" | "irreversible" | "unknown";

export interface DecisionInput {
  question: string;
  context?: string;
  stakes?: "low" | "high";
  reversible?: boolean;
  amount?: number;        // wydatek (duży → wysoka stawka)
}

export interface DecisionResult {
  recommendation: string;
  alternatives: string[];
  risks: string[];
  reversibility: Reversibility;
  firstSafeStep: string;
  confidence: number;     // 0..1
  ranBy: DecisionRole[];  // które role realnie się wypowiedziały
  note: string;
}

/** Runner roli — zwraca tekst roli (lub null, gdy brak modelu/limit API). Wstrzykiwany. */
export type RoleRunner = (role: DecisionRole, prompt: string, schema?: object) => Promise<string | null>;

const BIG_EXPENSE = 1000; // PLN — wydatek od tej kwoty traktujemy jako wysoką stawkę

const IRREVERSIBLE_CUES = /\b(wyślij|wyslij|opublikuj|publikuj|zapłać|zaplac|przelej|usuń|usun|skasuj|zwolnij|rozwiąż umow|rozwiaz umow|podpisz)\w*/i;

/** Pure: oszacuj odwracalność decyzji (z jawnej flagi lub z treści). */
export function inferReversibility(input: DecisionInput): Reversibility {
  if (input.reversible === true) return "reversible";
  if (input.reversible === false) return "irreversible";
  if (IRREVERSIBLE_CUES.test(input.question || "")) return "hard_to_reverse";
  return "unknown";
}

/** Pure: czy decyzja jest „wysokiej stawki"? (jawnie, duży wydatek albo nieodwracalna). */
export function isHighStakes(input: DecisionInput): boolean {
  if (input.stakes === "high") return true;
  if (typeof input.amount === "number" && input.amount >= BIG_EXPENSE) return true;
  return inferReversibility(input) === "irreversible" || inferReversibility(input) === "hard_to_reverse";
}

/**
 * Pure: czy uruchamiać Radę? economy=nigdy; balanced=tylko ręcznie; maximum=auto dla wysokiej
 * stawki (lub ręcznie). Dzięki temu zwykła rozmowa nie odpala trzech wywołań modelu.
 */
export function shouldRunDecisionCouncil(opts: { mode: IntelligenceMode; input: DecisionInput; manual?: boolean }): boolean {
  if (opts.manual) return opts.mode !== "economy";
  if (opts.mode === "economy" || opts.mode === "balanced") return false;
  return isHighStakes(opts.input); // maximum + wysoka stawka → automatycznie
}

// JSON Schema dla Sędziego (Gemini structured output). Walidowane przy parsowaniu.
export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    recommendation: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    reversibility: { type: "string", enum: ["reversible", "hard_to_reverse", "irreversible", "unknown"] },
    firstSafeStep: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["recommendation", "firstSafeStep"],
} as const;

const strategPrompt = (i: DecisionInput): string =>
  [
    "Rola: STRATEG. Zaproponuj najlepsze rozwiązanie decyzji biznesowej.",
    "Podaj zwięźle SAM WNIOSEK i krótkie uzasadnienie — bez rozpisywania toku myślenia.",
    i.context ? `Kontekst: ${i.context}` : "",
    `Decyzja: ${i.question}`,
  ].filter(Boolean).join("\n");

const krytykPrompt = (i: DecisionInput, strateg: string): string =>
  [
    "Rola: KRYTYK. Wskaż błędy, ukryte koszty, ryzyka i słabe założenia propozycji Stratega.",
    "Bądź konkretny i bezlitosny, ale rzeczowy. Tylko wnioski, nie tok myślenia.",
    `Decyzja: ${i.question}`,
    `Propozycja Stratega: ${strateg}`,
  ].join("\n");

const sedziaPrompt = (i: DecisionInput, strateg: string, krytyk: string): string =>
  [
    "Rola: SĘDZIA. Wybierz lub POŁĄCZ najlepsze elementy propozycji i krytyki w jedną rekomendację.",
    "Zwróć WYŁĄCZNIE JSON zgodny ze schematem (recommendation, alternatives, risks, reversibility,",
    "firstSafeStep, confidence 0..1). Bez toku myślenia, bez tekstu poza JSON.",
    `Decyzja: ${i.question}`,
    `Strateg: ${strateg}`,
    `Krytyk: ${krytyk}`,
  ].join("\n");

/** Pure: sparsuj odpowiedź Sędziego (JSON) na DecisionResult, z bezpiecznymi domyślnymi. */
export function parseDecision(raw: string, input: DecisionInput, ranBy: DecisionRole[]): DecisionResult | null {
  const m = raw && raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const rec = typeof j.recommendation === "string" ? j.recommendation.trim() : "";
  if (!rec) return null;
  const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const rev = ["reversible", "hard_to_reverse", "irreversible", "unknown"].includes(j.reversibility as string)
    ? (j.reversibility as Reversibility) : inferReversibility(input);
  let conf = typeof j.confidence === "number" ? j.confidence : 0.6;
  conf = Math.max(0, Math.min(1, conf));
  return {
    recommendation: rec,
    alternatives: arr(j.alternatives),
    risks: arr(j.risks),
    reversibility: rev,
    firstSafeStep: typeof j.firstSafeStep === "string" && j.firstSafeStep.trim() ? j.firstSafeStep.trim() : "Zacznij od małego, odwracalnego kroku i sprawdź wynik.",
    confidence: conf,
    ranBy,
    note: "",
  };
}

/** Deterministyczny fallback, gdy zabraknie modelu/limit API — uczciwy, ostrożny, bez zmyślania. */
export function fallbackDecision(input: DecisionInput, ranBy: DecisionRole[], note: string): DecisionResult {
  const rev = inferReversibility(input);
  return {
    recommendation: "Nie mam pełnej rady — brakuje modelu do narady. Podejmij decyzję ostrożnie i odwracalnie.",
    alternatives: [],
    risks: rev === "irreversible" || rev === "hard_to_reverse" ? ["Decyzja trudna do cofnięcia — zrób mały test przed pełnym krokiem."] : [],
    reversibility: rev,
    firstSafeStep: "Wykonaj najmniejszy odwracalny krok i zmierz efekt, zanim pójdziesz dalej.",
    confidence: 0.3,
    ranBy,
    note,
  };
}

/**
 * Uruchom Radę: Strateg → Krytyk → Sędzia (sekwencyjnie). Degraduje łagodnie: brak Stratega →
 * fallback; brak Krytyka → Sędzia ocenia samego Stratega; zła odpowiedź Sędziego → użyj Stratega
 * jako rekomendacji. Nigdy nie rzuca — zawsze zwraca uczciwy DecisionResult.
 */
export async function runDecisionCouncil(input: DecisionInput, runner: RoleRunner): Promise<DecisionResult> {
  const strateg = await runner("strateg", strategPrompt(input));
  if (!strateg) return fallbackDecision(input, [], "Brak dostępnego modelu (Strateg nie odpowiedział).");

  const krytyk = await runner("krytyk", krytykPrompt(input, strateg));
  const ranBy: DecisionRole[] = krytyk ? ["strateg", "krytyk"] : ["strateg"];

  const sedziaRaw = await runner("sedzia", sedziaPrompt(input, strateg, krytyk || "(krytyk niedostępny)"), DECISION_SCHEMA);
  if (sedziaRaw) {
    const parsed = parseDecision(sedziaRaw, input, [...ranBy, "sedzia"]);
    if (parsed) {
      parsed.note = krytyk ? "Rada: Strateg, Krytyk i Sędzia." : "Rada bez Krytyka (jeden model) — ostrożniej.";
      return parsed;
    }
  }
  // Sędzia zawiódł — oddaj propozycję Stratega jako rekomendację (uczciwie oznaczoną).
  return {
    recommendation: strateg,
    alternatives: [],
    risks: krytyk ? [krytyk] : [],
    reversibility: inferReversibility(input),
    firstSafeStep: "Zweryfikuj propozycję małym, odwracalnym krokiem przed pełnym wdrożeniem.",
    confidence: 0.45,
    ranBy,
    note: "Synteza Sędziego niedostępna — pokazuję propozycję Stratega z uwagami Krytyka.",
  };
}
