// === Drabina Mądrości — lokalne samodoskonalenie (Self-Refine / Reflexion na urządzeniu) ===
// Duży model lokalny SAM sprawdza swoją odpowiedź i podaje poprawioną wersję — druga tura
// w całości na PC (działa też offline, bez chmury). To technika badawcza (Self-Refine, 2023)
// przeniesiona na lokalny, prywatny setup telefon+PC: więcej „mądrości" z tego samego modelu.
// Opt-in, tylko dla pytań złożonych. Runnery wstrzykiwane → czyste i testowalne.
import type { JarvisReply } from "./providers/types";
import { divergence } from "./speculative";

export interface RefineResult {
  reply: JarvisReply;
  passes: number; // ile lokalnych przebiegów wykonano (1 = bez poprawy, 2 = z krytyką)
  improved: boolean; // czy poprawka istotnie zmieniła odpowiedź
}

/** Instrukcja samokrytyki dla modelu (po jego draftcie w historii). Czysta. */
export function critiqueInstruction(): string {
  return [
    "Zanim zakończysz: sprawdź swoją powyższą odpowiedź pod kątem błędów rzeczowych, luk w rozumowaniu",
    "i nieścisłości. Jeśli coś jest nie tak — popraw to. Następnie podaj NAJLEPSZĄ, poprawioną wersję",
    "odpowiedzi (samą odpowiedź, bez komentarza o tym, co zmieniłeś).",
  ].join(" ");
}

/**
 * Jedna runda samodoskonalenia: bierze gotowy draft i wynik krytyki tego samego modelu.
 * Gdy krytyka istotnie przebudowała odpowiedź (rozbieżność ≥ minGain) — bierzemy poprawkę;
 * gdy model zostawił to samo (był pewny) — zostaje draft (bez „churnu"). Graceful na błąd krytyki.
 */
export async function localRefine(opts: {
  draft: JarvisReply;
  runCritique: () => Promise<JarvisReply>;
  minGain?: number;
}): Promise<RefineResult> {
  const draft = opts.draft;
  if (!draft.text?.trim()) return { reply: draft, passes: 1, improved: false };

  let critique: JarvisReply | null = null;
  try {
    critique = await opts.runCritique();
  } catch {
    critique = null;
  }

  const minGain = opts.minGain ?? 0.15;
  if (critique?.text?.trim() && divergence(draft.text, critique.text) >= minGain) {
    return { reply: { ...draft, text: critique.text, usage: critique.usage ?? draft.usage }, passes: 2, improved: true };
  }
  return { reply: draft, passes: critique ? 2 : 1, improved: false };
}
