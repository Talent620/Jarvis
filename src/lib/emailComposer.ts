// === Akcje AI kompozytora e-mail (Email OS / PHASE 4) ===
// NIEINWAZYJNY moduł: przerabia istniejący tekst maila wg jednej akcji (skróć/rozwiń/CTA/ton/przepisz/
// personalizuj). Czyste buildery instrukcji (testowalne) + cienka warstwa askModel. Przy błędzie/braku
// mózgu zwraca tekst bez zmian — nigdy nie psuje draftu.

import { askModel } from "./brain";

export type ComposerAction = "shorten" | "expand" | "cta" | "formal" | "casual" | "personalize" | "rewrite";

export const COMPOSER_ACTIONS: { id: ComposerAction; label: string }[] = [
  { id: "shorten", label: "✂ Skróć" },
  { id: "expand", label: "➕ Rozwiń" },
  { id: "cta", label: "🎯 Mocniejsze CTA" },
  { id: "formal", label: "🎩 Formalnie" },
  { id: "casual", label: "😊 Luźniej" },
  { id: "personalize", label: "👤 Personalizuj" },
  { id: "rewrite", label: "✨ Przepisz" },
];

const GUIDE: Record<ComposerAction, string> = {
  shorten: "Skróć mail do 60–90 słów, zachowując sens, jedną korzyść i wyraźne CTA. Krótkie maile konwertują lepiej.",
  expand: "Rozwiń o 1–2 konkretne korzyści dla odbiorcy, nadal zwięźle (nie więcej niż ~140 słów).",
  cta: "Wzmocnij zakończenie JEDNYM jasnym, łatwym wezwaniem do działania (np. propozycja krótkiej rozmowy albo podgląd).",
  formal: "Nadaj bardziej formalny, profesjonalny ton (zachowaj naturalność, bez sztywności korpo).",
  casual: "Nadaj cieplejszy, bardziej swobodny i ludzki ton (bez spoufalania).",
  personalize: "Dodaj jedno zdanie personalizacji odnoszące się konkretnie do odbiorcy/jego firmy (jeśli brak danych — ogólne, ale trafne).",
  rewrite: "Przepisz mail świeżo i lepiej: inny układ, mocniejszy język KORZYŚCI, mniej o sobie, więcej o odbiorcy.",
};

/** Pure: instrukcja przeróbki maila dla danej akcji. */
export function composerInstruction(action: ComposerAction): string {
  return GUIDE[action] || GUIDE.rewrite;
}

const COMPOSER_SYSTEM =
  "Jesteś światowej klasy copywriterem cold e-mail B2B w Polsce. Przerabiasz GOTOWY mail wg jednej " +
  "instrukcji, zachowując jego cel i ewentualny temat (linia „Temat:”). Pisz naturalnie, bez słów-spamu " +
  "i CAPSów. Zwróć WYŁĄCZNIE gotowy mail (z tematem, jeśli był), bez komentarzy i bez markdownu.";

/** Przerób mail wg akcji. Przy błędzie/braku mózgu — zwraca oryginał (bez psucia draftu). */
export async function applyComposerAction(text: string, action: ComposerAction): Promise<string> {
  const t = (text || "").trim();
  if (!t) return text;
  try {
    const reply = await askModel({
      system: COMPOSER_SYSTEM,
      history: [{ role: "user", content: `${composerInstruction(action)}\n\nMail do przerobienia:\n${t}` }],
    });
    const out = (reply || "").trim();
    return out.length >= 20 ? out : text;
  } catch {
    return text;
  }
}
