// === ⬢ Tryb Szefa — agent głosowy przywoływany słowem „szef" ===
// Słowo-wyzwalacz w głównym czacie (wpisane albo wypowiedziane) otwiera pełnoekranowy
// Tryb Szefa: Matrix + głos robota + agentowa pętla (rozumie i WYKONUJE rozkazy przez
// narzędzia, z głosowym potwierdzeniem akcji nieodwracalnych). To rozwinięcie Strażnika.

import type { Settings } from "../types";

// „Głos robota": systemowy silnik (nie premium — premium ignoruje pitch), niski ton, lekko
// zwolnione tempo → maszynowy charakter, a wciąż zrozumiały po polsku.
export const ROBOT_VOICE: Partial<Settings> = { voiceMode: "system", voicePitch: 0.4, voiceRate: 0.96 };

export const BOSS_GREETING = "Tryb Szefa aktywny. Słucham rozkazów.";

// Czy wiadomość to przywołanie Szefa. Zachowawczo — tylko jasne wezwania, nie każde zdanie
// ze słowem „szef" (np. „mój szef dzwonił" NIE ma otwierać trybu).
const SUMMON = /^(hej |ok |halo |jarvis )?(szef(ie|uniu|unciu)?|tryb szefa|(przywo[łl]aj|wezwij|wo[łl]am|otw[oó]rz) (tryb )?szef[a]?)$/i;

export function isBossSummon(text: string): boolean {
  const t = (text || "").trim().replace(/[!.,?…]+$/u, "").toLowerCase();
  if (!t) return false;
  return SUMMON.test(t);
}
