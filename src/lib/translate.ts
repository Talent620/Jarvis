// Tłumaczenie tekstu przez aktywny model AI (Claude/Gemini/Groq…). Minimalne,
// szybkie wywołanie: bez narzędzi, bez myślenia — sam przekład. Używane przez
// Tryb Tłumacza (rozmowa na żywo dwóch osób w różnych językach).

import { askModel } from "./brain";

/** System prompt tłumacza — wyłącznie przekład, zero komentarzy.
 *  `context` to kilka ostatnich wypowiedzi (dla ciągłości i poprawnych zaimków). */
export function buildTranslatePrompt(targetName: string, context?: string[]): string {
  const lines = [
    `Jesteś tłumaczem symultanicznym w rozmowie na żywo między dwojgiem ludzi. Przetłumacz wypowiedź na język: ${targetName}.`,
    "ZASADY:",
    `- Zwróć WYŁĄCZNIE tłumaczenie na ${targetName} — żadnych komentarzy, wyjaśnień, oryginału ani cudzysłowów.`,
    "- To rozmowa towarzyska, często flirt/poznawanie się — tłumacz ciepło, naturalnie i z emocjami, tak jak mówią ludzie, a NIE słowo w słowo.",
    "- Zachowaj ton i rejestr: żart zostaje żartem, czułość czułością, forma na ty zostaje na ty.",
    "- Zachowaj imiona, nazwy i liczby bez zmian.",
    "- Jeśli tekst jest już w języku docelowym, po prostu przepisz go naturalnie.",
  ];
  if (context && context.length) {
    lines.push(
      "",
      "KONTEKST OSTATNICH WYPOWIEDZI (tylko dla ciągłości i poprawnych zaimków — NIE tłumacz tego, NIE powtarzaj):",
      ...context.slice(-6).map((c) => `- ${c}`),
    );
  }
  return lines.join("\n");
}

/** Oczyść odpowiedź modelu z typowych dodatków (etykiety, cudzysłowy). */
export function cleanTranslation(raw: string): string {
  let t = (raw || "").trim();
  // Usuń etykiety typu „Tłumaczenie:", „Translation:", „Переклад:".
  t = t.replace(/^\s*(t[łl]umaczenie|translation|переклад|перевод)\s*[:\-—]\s*/i, "");
  // Zdejmij otaczające cudzysłowy (proste i typograficzne).
  t = t.replace(/^["'„»«]\s*/, "").replace(/\s*["'”»«]$/, "");
  return t.trim();
}

/**
 * Przetłumacz `text` na język `targetName` (np. „ukraiński", „polski").
 * Zwraca przekład albo pusty string przy błędzie/braku dostawcy.
 */
export async function translateText(text: string, targetName: string, context?: string[]): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  try {
    return cleanTranslation(await askModel({ system: buildTranslatePrompt(targetName, context), history: [{ role: "user", content: clean }] }));
  } catch {
    return "";
  }
}
