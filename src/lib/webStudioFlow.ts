// === Kreator stron w 4 krokach (webStudioFlow) — czysty model przepływu ===
// Prosty widok: 1) Brief → 2) Plan → 3) Budowa i podgląd → 4) Dostarczenie klientowi. Zawsze widać
// JEDEN krok bieżący i JEDNĄ główną akcję. Zaawansowane opcje (SEO/CRO/kod/wersje/robots/sitemap/
// pakiety/wycena) są poza tym torem. Logika kroku jest czysta i testowalna. S9-safe.

export type WebStep = "brief" | "plan" | "build" | "deliver";

export interface WebFlowState {
  hasBrief: boolean;      // opisano firmę/brief albo wpisano polecenie
  hasBlueprint: boolean;  // zaplanowano stronę (blueprint)
  hasSafeHtml: boolean;   // zbudowano stronę, która przeszła walidację (można dostarczyć)
}

export interface WebStepInfo { id: WebStep; index: number; label: string; mainAction: string }

export const WEB_STEPS: { id: WebStep; label: string; mainAction: string }[] = [
  { id: "brief", label: "Brief", mainAction: "Zaplanuj stronę" },
  { id: "plan", label: "Plan", mainAction: "Zbuduj stronę" },
  { id: "build", label: "Budowa i podgląd", mainAction: "Zbuduj / popraw" },
  { id: "deliver", label: "Dostarczenie", mainAction: "Dostarcz klientowi" },
];

/** Pure: bieżący krok kreatora wynika ze stanu (od końca: gotowa strona → dostarczenie). */
export function currentStep(s: WebFlowState): WebStep {
  if (s.hasSafeHtml) return "deliver";
  if (s.hasBlueprint) return "build";
  if (s.hasBrief) return "plan";
  return "brief";
}

/** Pure: indeks kroku 0..3 (do paska postępu). */
export function stepIndex(step: WebStep): number {
  return WEB_STEPS.findIndex((s) => s.id === step);
}

/** Pure: pełne info o bieżącym kroku (etykieta + JEDNA główna akcja). */
export function currentStepInfo(s: WebFlowState): WebStepInfo {
  const step = currentStep(s);
  const idx = stepIndex(step);
  const meta = WEB_STEPS[idx];
  return { id: step, index: idx, label: meta.label, mainAction: meta.mainAction };
}
