// Tłumaczenie tekstu przez aktywny model AI (Claude/Gemini/Groq…). Minimalne,
// szybkie wywołanie: bez narzędzi, bez myślenia — sam przekład. Używane przez
// Tryb Tłumacza (rozmowa na żywo dwóch osób w różnych językach).

import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { store } from "./store";

/** System prompt tłumacza — wyłącznie przekład, zero komentarzy. */
export function buildTranslatePrompt(targetName: string): string {
  return [
    `Jesteś tłumaczem symultanicznym. Przetłumacz wypowiedź użytkownika na język: ${targetName}.`,
    "ZASADY:",
    `- Zwróć WYŁĄCZNIE tłumaczenie na ${targetName} — żadnych komentarzy, wyjaśnień, oryginału ani cudzysłowów.`,
    "- Zachowaj sens, ton i rejestr (potoczny zostaje potoczny).",
    "- Tłumacz naturalnie, jak żywy człowiek, a nie słowo w słowo.",
    "- Jeśli tekst jest już w języku docelowym, po prostu go popraw/przepisz naturalnie.",
  ].join("\n");
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
export async function translateText(text: string, targetName: string): Promise<string> {
  const clean = text.trim();
  if (!clean) return "";
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return "";
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: buildTranslatePrompt(targetName),
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: clean }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    return cleanTranslation(reply.text || "");
  } catch {
    return "";
  }
}
