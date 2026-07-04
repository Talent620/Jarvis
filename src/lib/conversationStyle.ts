// === Styl rozmowy „premium" — opt-in dostrojenie długości i ciepła odpowiedzi ===
// Czyste dyrektywy dokładane do system-promptu. Przy DOMYŚLNYCH wartościach (balanced + 0.5)
// zwraca pustą listę → zachowanie bez zmian. Nie rusza istniejących person (te są kontraktem).
import type { Settings } from "../types";

export type ResponseLength = "concise" | "balanced" | "detailed";

/** Dyrektywy stylu z ustawień (długość + ciepło). Czysta. Puste = neutralnie (jak dotąd). */
export function conversationStyleDirectives(s: Pick<Settings, "responseLength" | "warmth">): string[] {
  const out: string[] = [];

  const len: ResponseLength = s.responseLength || "balanced";
  if (len === "concise") {
    out.push("- Długość: odpowiadaj zwięźle, 1–3 zdania, bez ozdobników i powtórzeń (sedno najpierw).");
  } else if (len === "detailed") {
    out.push("- Długość: rozwiń wyczerpująco i przejrzyście — sekcje, przykłady i kroki, gdy pomagają.");
  }
  // "balanced" → brak dyrektywy (domyślne zachowanie bez zmian)

  const w = typeof s.warmth === "number" ? s.warmth : 0.5;
  if (w >= 0.7) {
    out.push("- Ton: cieplej i bardziej po ludzku — odrobina empatii i lekkiego humoru, pełne zdania zamiast suchych list, gdy pasuje. Odnoś się do tego, co przed chwilą padło w rozmowie.");
  } else if (w <= 0.3) {
    out.push("- Ton: rzeczowo i formalnie — bez ozdobników, prosto do sedna.");
  }
  // ~0.5 → brak (neutralnie)

  return out;
}
