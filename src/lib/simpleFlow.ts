// === Tryb prosty i wspólny język UX (simpleFlow) ===
// Domyślny przepływ: Cel → Rekomendacja → Podgląd → Zatwierdź. Spójne, polskie nazewnictwo we
// wszystkich modułach (Sprzedaż, Kreator, Reklamy). Puste stany mają JEDNO sugerowane działanie, a
// każdy wynik pokazuje ŹRÓDŁO, STAN i NASTĘPNĄ AKCJĘ. Czyste i testowalne (logika, nie CSS). S9-safe.

export type SimpleStep = "goal" | "recommendation" | "preview" | "approve";

export const SIMPLE_STEPS: SimpleStep[] = ["goal", "recommendation", "preview", "approve"];

const STEP_LABELS: Record<SimpleStep, string> = {
  goal: "Cel",
  recommendation: "Rekomendacja",
  preview: "Podgląd",
  approve: "Zatwierdź",
};

export function stepLabel(step: SimpleStep): string {
  return STEP_LABELS[step];
}

/** Pure: następny/poprzedni krok (nie wychodzi poza zakres). */
export function nextStep(step: SimpleStep): SimpleStep {
  const i = SIMPLE_STEPS.indexOf(step);
  return SIMPLE_STEPS[Math.min(SIMPLE_STEPS.length - 1, i + 1)];
}
export function prevStep(step: SimpleStep): SimpleStep {
  const i = SIMPLE_STEPS.indexOf(step);
  return SIMPLE_STEPS[Math.max(0, i - 1)];
}

/** Pure: numer kroku (1..N) do wskaźnika postępu. */
export function stepIndex(step: SimpleStep): number {
  return SIMPLE_STEPS.indexOf(step) + 1;
}

export interface ResultMeta {
  source: string;      // skąd wynik (np. „OpenStreetMap", „AI", „finanse")
  state: string;       // stan (np. „szkic", „potwierdzone", „symulacja")
  nextAction: string;  // co dalej
}

/** Pure: znormalizuj metadane wyniku — każdy wynik ma źródło, stan i następną akcję. */
export function resultMeta(source: string, state: string, nextAction: string): ResultMeta {
  return { source: source || "nieznane", state: state || "—", nextAction: nextAction || "—" };
}

export interface EmptyStateSuggestion { message: string; action: string }

/** Pure: pusty stan z JEDNYM sugerowanym działaniem (bez martwych ekranów). */
export function emptyStateSuggestion(area: "leads" | "sites" | "campaigns" | "finance"): EmptyStateSuggestion {
  switch (area) {
    case "leads": return { message: "Brak leadów — zacznij od znalezienia firm w Twojej okolicy.", action: "Znajdź leady" };
    case "sites": return { message: "Brak stron — zbuduj pierwsze demo dla wybranej firmy.", action: "Zbuduj demo" };
    case "campaigns": return { message: "Brak kampanii — przygotuj pierwszą ofertę lub post.", action: "Utwórz kampanię" };
    case "finance": return { message: "Brak projektów finansowych — dodaj pierwszy przychód.", action: "Dodaj projekt" };
  }
}
