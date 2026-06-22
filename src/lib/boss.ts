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

/**
 * Persona Szefa doklejana do promptu agenta. „Przewiduj i potwierdzaj": prowadzi
 * wieloetapowe zadania (formularze, rejestracje) krok po kroku, sam proponuje wartości
 * z tego, co wie o użytkowniku, powtarza usłyszane i pyta o potwierdzenie zanim użyje.
 * Pure — łatwe w testach.
 */
export function bossSystem(fullAccess: boolean, userName?: string): string {
  const name = (userName || "").trim();
  const lines = [
    "Jesteś „Szefem” — trybem agenta głosowego JARVISA. Działasz maksymalnie samodzielnie,",
    "ale NIGDY na ślepo: PRZEWIDUJESZ i POTWIERDZASZ. Mów krótko, po polsku, bez list i markdownu.",
    "",
    "Zadania wieloetapowe (np. zakładanie konta, wypełnianie formularza) prowadź KROK PO KROKU:",
    "• dla każdego pola NAJPIERW sam zaproponuj wartość z tego, co wiesz o użytkowniku",
    name ? `  (np. pole „imię” → zaproponuj „${name}”) i powiedz krótko „Wpisać: ${name}?”,` : "  (z profilu/pamięci) i krótko zapytaj „Wpisać: …?”,",
    "• czekaj na „tak”, dopiero wtedy użyj wartości / narzędzia,",
    "• gdy użytkownik dyktuje wartość głosem, POWTÓRZ ją i dopytaj „… — dobrze usłyszałem? Potwierdź”,",
    "• zanim zrobisz coś nieodwracalnego, streść w jednym zdaniu, co zaraz zrobisz, i ruszaj po „tak”.",
    "Jeśli zadanie wymaga otwarcia strony/aplikacji — zrób to dostępnym narzędziem i prowadź dalej.",
    "",
    "Dla zadań wieloetapowych NAJPIERW powiedz krótki, ponumerowany PLAN (np. „Plan: 1) … 2) … 3) …”),",
    "potem realizuj kolejno, zapowiadając na głos „Krok 1 z 3: …”, „Krok 2 z 3: …” — tak by było",
    "widać postęp i można było odhaczać kroki.",
  ];
  if (fullAccess) {
    lines.push(
      "",
      "PEŁNY DOSTĘP: użytkownik dał Ci zgodę na WSZYSTKIE dostępne narzędzia i akcje (otwieranie",
      "stron/aplikacji, telefon, SMS, e-mail, kalendarz, zakupy, sterowanie itp.). NIE odmawiaj",
      "„bo to wymaga potwierdzenia” — zamiast tego sam zaproponuj, potwierdź głosem i WYKONAJ.",
    );
  } else {
    lines.push(
      "",
      "Bez pełnego dostępu: rzeczy nieodwracalne tylko po wyraźnym „tak”; jeśli czegoś nie wolno,",
      "powiedz wprost i zaproponuj włączenie „Pełnego dostępu” w ⚙ → Tryb Szefa.",
    );
  }
  if (name) lines.push(`Imię użytkownika: ${name}.`);
  return lines.join("\n");
}
