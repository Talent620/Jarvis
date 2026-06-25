// === ⬢ Tryb Szefa — agent głosowy przywoływany słowem „szef" ===
// Słowo-wyzwalacz w głównym czacie (wpisane albo wypowiedziane) otwiera pełnoekranowy
// Tryb Szefa: Matrix + głos robota + agentowa pętla (rozumie i WYKONUJE rozkazy przez
// narzędzia, z głosowym potwierdzeniem akcji nieodwracalnych). To rozwinięcie Strażnika.

import type { Settings } from "../types";

// „Głos robota": systemowy silnik (nie premium — premium ignoruje pitch), niski ton, lekko
// zwolnione tempo → maszynowy charakter, a wciąż zrozumiały po polsku.
export const ROBOT_VOICE: Partial<Settings> = { voiceMode: "system", voicePitch: 0.4, voiceRate: 0.96 };

export const BOSS_GREETING = "Tryb Szefa aktywny. Słucham rozkazów.";

// DOKTRYNA SZEFA — przelana metoda działania klasy światowej (sposób myślenia elitarnego
// agenta). To „mój rozum" oddany Szefowi: jak rozkłada problem, weryfikuje, działa i nie ściemnia.
export const BOSS_DOCTRINE = [
  "DOKTRYNA (tak myślisz i działasz — klasa światowa):",
  "1) ZROZUM CEL: ustal, co użytkownik NAPRAWDĘ chce osiągnąć (nie tylko dosłowne słowa). Dopytaj tylko, gdy to realnie zmienia plan.",
  "2) ROZŁÓŻ I ZAPLANUJ: trudne zadanie podziel na najmniejsze pewne kroki; pomyśl 2 kroki do przodu.",
  "3) SPRAWDZAJ, NIE ZGADUJ: zanim coś stwierdzisz lub zmienisz — sięgnij po fakty (pamięć, narzędzia odczytu, stan systemu). Opieraj się na rzeczywistości, nie na założeniach.",
  "4) DZIAŁAJ, NIE GADAJ: masz narzędzia — używaj ich i DOMYKAJ zadanie. Łańcuch: znajdź → zdecyduj → wykonaj → potwierdź wynik. Lepiej zrobić niż opisać, jak by się zrobiło.",
  "5) UCZCIWOŚĆ ABSOLUTNA: nigdy nie zmyślaj. Nie wiesz — powiedz wprost i podaj następny krok. Coś nie działa/jest do poprawki — powiedz to bez owijania.",
  "6) PRZEWIDUJ I POTWIERDZAJ: proponuj wartości z wiedzy o użytkowniku; przed czymś nieodwracalnym streść w 1 zdaniu i czekaj na „tak”.",
  "7) NAJMOCNIEJSZY ROZUM: do trudnych rzeczy myśl wolniej i dokładniej (rozumuj wewnętrznie, wnioski podaj zwięźle); używasz automatycznie najlepszego dostępnego modelu.",
  "8) PAMIĘĆ I CIĄGŁOŚĆ: korzystaj z tego, co już wiesz o użytkowniku i projekcie; dotrzymuj obietnic co do tego, co zostało zrobione.",
  "9) BEZPIECZEŃSTWO: działasz w interesie użytkownika; nie robisz rzeczy szkodliwych ani masowo niebezpiecznych.",
  "Twój cel: być najmądrzejszym, najskuteczniejszym i najuczciwszym asystentem, jakiego użytkownik może mieć.",
].join("\n");

// Czy wiadomość to przywołanie Szefa. Zachowawczo — tylko jasne wezwania, nie każde zdanie
// ze słowem „szef" (np. „mój szef dzwonił" NIE ma otwierać trybu).
const SUMMON = /^(hej |ok |halo |jarvis )?(szef(ie|uniu|unciu)?|tryb szefa|(przywo[łl]aj|wezwij|wo[łl]am|otw[oó]rz) (tryb )?szef[a]?)$/i;

export function isBossSummon(text: string): boolean {
  const t = (text || "").trim().replace(/[!.,?…]+$/u, "").toLowerCase();
  if (!t) return false;
  return SUMMON.test(t);
}

export interface BossAction { icon: string; label: string; command: string }

export type BossMeta = "stop" | "repeat" | null;

/**
 * Deterministyczne META-rozkazy głosowe Szefa — obsłużone BEZ modelu (natychmiast, pewnie, za darmo):
 * „stop/anuluj/cisza" → przerwij; „powtórz/jeszcze raz" → powtórz ostatnią odpowiedź. Tylko krótkie,
 * jednoznaczne frazy (≤35 zn.), by nie łapać normalnych poleceń. Czyste i testowalne.
 */
export function parseBossMeta(text: string): BossMeta {
  const t = (text || "").trim().toLowerCase().replace(/[!.,?…]+$/u, "");
  if (!t || t.length > 35) return null;
  if (/^(stop|anuluj|przerwij|cisza|cicho|do[śs][ćc]|wystarczy|zatrzymaj( się)?|przesta[ńn])$/.test(t)) return "stop";
  if (/^(powt[oó]rz( to)?|jeszcze raz|powiedz (jeszcze raz|to ponownie)|nie dos[łl]ysza[łl]em)$/.test(t)) return "repeat";
  return null;
}

/**
 * Szybkie, KOMPLETNE rozkazy do jednego dotknięcia w Trybie Szefa. Dwie korzyści: niezawodność
 * (tor tekstowy — zero przesłyszeń STT) i odkrywalność (widać, co można powiedzieć). Kontekstowe:
 * pora dnia + liczba otwartych zadań. Czyste i testowalne (godzinę i licznik podajemy z zewnątrz).
 */
export function bossQuickActions(hour: number, pendingTasks = 0): BossAction[] {
  const morning = hour >= 4 && hour < 11;
  const actions: BossAction[] = [
    morning
      ? { icon: "🌅", label: "Odprawa poranna", command: "Zrób mi krótką odprawę poranną: co dziś najważniejsze i od czego zacząć." }
      : { icon: "📋", label: "Odprawa", command: "Zrób mi krótką odprawę: co najważniejsze teraz i co wymaga uwagi." },
    { icon: "📅", label: "Co mam dziś?", command: "Co mam dziś do zrobienia? Wymień najważniejsze." },
    pendingTasks > 0
      ? { icon: "✅", label: `Zadania (${pendingTasks})`, command: "Pokaż moje otwarte zadania i doradź, od czego zacząć." }
      : { icon: "✅", label: "Dodaj zadanie", command: "Dodaj zadanie: " },
    { icon: "🧠", label: "Co o mnie wiesz?", command: "Co o mnie wiesz? Podsumuj krótko najważniejsze." },
  ];
  return actions;
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
    BOSS_DOCTRINE,
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
