// === Strukturalny planer zadań (agent) ===
// Dla NAPRAWDĘ wieloetapowych poleceń model zwraca PLAN w ustalonym schemacie JSON, a aplikacja
// go WALIDUJE: poprawny JSON nie oznacza poprawnego planu. Narzędzie musi istnieć w rejestrze i
// być dozwolone; model nie może wymyślić narzędzia ani ominąć bramki zgód. Czyste i testowalne.
// S9-safe. Plan jest WEWNĘTRZNY — użytkownik widzi tylko krótki status i rezultat.

import type { Risk } from "./permissions";

export interface PlanStep {
  id: string;
  intent: string;
  tool?: string; // nazwa narzędzia z rejestru (opcjonalnie — krok może być czysto myślowy)
  arguments?: Record<string, unknown>;
  dependsOn?: string[];
  requiresConsent?: boolean;
  successCriteria?: string;
}

export interface AgentPlan {
  goal: string;
  assumptions?: string[];
  missingInformation?: string[];
  steps: PlanStep[];
  confidence?: number;
}

// JSON Schema do structured output (Gemini responseSchema). Minimalny, bez additionalProperties.
export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    goal: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          intent: { type: "string" },
          tool: { type: "string" },
          arguments: { type: "object" },
          dependsOn: { type: "array", items: { type: "string" } },
          requiresConsent: { type: "boolean" },
          successCriteria: { type: "string" },
        },
        required: ["id", "intent"],
      },
    },
    confidence: { type: "number" },
  },
  required: ["goal", "steps"],
} as const;

export interface PlanValidation {
  ok: boolean;
  errors: string[];
  /** Jedno konkretne pytanie, gdy brakuje krytycznej informacji (inaczej null). */
  question: string | null;
}

/** Pure: czy graf zależności kroków ma cykl? (DFS po id). */
export function hasDependencyCycle(steps: PlanStep[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=biały,1=szary,2=czarny
  const visit = (id: string): boolean => {
    const st = state.get(id) || 0;
    if (st === 1) return true; // wróciliśmy do szarego → cykl
    if (st === 2) return false;
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn || []) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const s of steps) if (visit(s.id)) return true;
  return false;
}

/**
 * Pure: zwaliduj plan. Poprawny JSON ≠ poprawny plan.
 * - każde narzędzie kroku MUSI istnieć w rejestrze (model nie wymyśla narzędzi),
 * - krok z narzędziem `outbound` MUSI mieć requiresConsent=true (nie da się ominąć zgód),
 * - dependsOn wskazuje istniejące id, brak cykli, id unikalne,
 * - brak krytycznej informacji → jedno konkretne pytanie (zamiast działać po omacku).
 */
export function validatePlan(
  plan: AgentPlan,
  opts: { toolExists: (name: string) => boolean; riskOf: (name: string) => Risk },
): PlanValidation {
  const errors: string[] = [];
  if (!plan || typeof plan !== "object") return { ok: false, errors: ["Plan nie jest obiektem."], question: null };
  if (!plan.goal?.trim()) errors.push("Brak celu (goal).");
  if (!Array.isArray(plan.steps) || !plan.steps.length) errors.push("Plan nie ma kroków.");

  const ids = new Set<string>();
  for (const s of plan.steps || []) {
    if (!s.id?.trim()) { errors.push("Krok bez id."); continue; }
    if (ids.has(s.id)) errors.push(`Zduplikowane id kroku: ${s.id}.`);
    ids.add(s.id);
    if (s.tool) {
      if (!opts.toolExists(s.tool)) errors.push(`Nieznane narzędzie: ${s.tool} (model nie może go wymyślić).`);
      else if (opts.riskOf(s.tool) === "outbound" && s.requiresConsent !== true) {
        errors.push(`Krok ${s.id} używa narzędzia zewnętrznego (${s.tool}), ale nie oznaczył requiresConsent — zgoda jest obowiązkowa.`);
      }
    }
  }
  // dependsOn → istniejące id
  for (const s of plan.steps || []) {
    for (const dep of s.dependsOn || []) {
      if (!ids.has(dep)) errors.push(`Krok ${s.id} zależy od nieistniejącego ${dep}.`);
    }
  }
  if (Array.isArray(plan.steps) && hasDependencyCycle(plan.steps)) errors.push("Cykl zależności między krokami.");

  // Brak krytycznej informacji → jedno konkretne pytanie.
  const missing = (plan.missingInformation || []).map((m) => m.trim()).filter(Boolean);
  const question = errors.length === 0 && missing.length ? missing[0] : null;

  return { ok: errors.length === 0, errors, question };
}

/**
 * Pure: kroki POZOSTAŁE do zrobienia (nie ma ich w zbiorze potwierdzonych). Do napraw/replanu
 * podajemy modelowi WYŁĄCZNIE te kroki — nie ruszamy już potwierdzonych (i nie powtarzamy ich).
 */
export function remainingSteps(plan: AgentPlan, confirmedIds: Iterable<string>): PlanStep[] {
  const done = new Set(confirmedIds);
  return (plan.steps || []).filter((s) => !done.has(s.id));
}

/** Czy polecenie jest na tyle wieloetapowe, że warto je zaplanować? (proste słowa-łączniki). */
export function looksMultiStep(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (t.split(/\s+/).filter(Boolean).length < 4) return false;
  // łączniki sekwencji + co najmniej 2 czasowniki-akcje to sygnał planu
  const connectors = [" i ", " oraz ", " potem ", " następnie ", " a później ", ", a ", " then "];
  const verbs = ["znajd", "przygotuj", "wyślij", "wyslij", "dodaj", "utwórz", "utworz", "stwórz", "stworz", "zaplanuj", "oceń", "ocen", "porównaj", "porownaj", "napisz", "zbuduj", "umów", "umow", "przypom", "ponagl", "oznacz", "zaktualizuj"];
  const hasConn = connectors.some((c) => t.includes(c));
  const verbCount = verbs.filter((v) => t.includes(v)).length;
  return hasConn && verbCount >= 2;
}
