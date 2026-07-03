// === Doradca błędów (errorAdvisor) — każdy błąd ma LUDZKIE wyjaśnienie i DROGĘ NAPRAWY ===
// PO CO: użytkownik widział surowe „⚠ Internal Server Error (500)" i nie wiedział, co robić.
// Ten moduł zamienia KAŻDY błąd tury czatu na: (1) zrozumiałe polskie zdanie „co się stało
// i czyja to wina", (2) opcjonalny przycisk naprawy prowadzący we właściwe miejsce.
// Rozszerza (nie dubluje) humanize() z aiHelpers — humanize tłumaczy TREŚĆ, my dokładamy
// klasyfikację AKCJI i brakujące klasy (5xx). Czyste funkcje — testowalne bez UI. S9-safe.

import { humanize } from "./aiHelpers";

/** Dokąd prowadzi przycisk naprawy (App tłumaczy nav na openScreen/akcję). */
export type FixNav = "settings" | "retry";

export interface ErrorAdvice {
  /** Ludzkie wyjaśnienie PO POLSKU: co się stało + co zrobić. Nigdy surowy stack/ang. bełkot. */
  human: string;
  /** Przycisk naprawy (etykieta + cel). Brak = wystarczy istniejące „🔄 Ponów". */
  fix?: { label: string; nav: FixNav };
}

const FIX_AI = { label: "⚙ Napraw w Ustawieniach → AI", nav: "settings" as FixNav };

/**
 * Pure: sklasyfikuj surowy błąd tury czatu na poradę z akcją. Kolejność ma znaczenie —
 * pierwsza pasująca klasa wygrywa (od najbardziej specyficznych do ogólnych).
 */
export function adviseError(raw: string): ErrorAdvice {
  const msg = (raw || "").trim();
  const m = msg.toLowerCase();

  // Awaria po stronie dostawcy (5xx/przeciążenie) — TO NIE WINA UŻYTKOWNIKA. Jasno to mówimy.
  if (/\b(5\d\d)\b|internal server error|internal error|server error|overloaded|przeci[ąa][żz]|service unavailable|bad gateway|temporarily unavailable/i.test(m)) {
    return {
      human:
        "Serwer dostawcy AI ma chwilową awarię (błąd po ich stronie — nie zrobiłeś nic złego). " +
        "Zwykle mija po chwili: kliknij „Ponów”. Jeśli się powtarza, przełącz mózg na innego dostawcę.",
      fix: { label: "⚙ Przełącz mózg (Ustawienia → AI)", nav: "settings" },
    };
  }
  // Limit zapytań (429) — osobno od 5xx, bo rada jest inna (odczekać, nie zgłaszać awarii).
  if (/\b429\b|rate.?limit|too many requests|resource.?exhausted/i.test(m)) {
    return {
      human:
        "Dostawca AI chwilowo ogranicza liczbę zapytań (limit darmowego planu). " +
        "Odczekaj minutę i kliknij „Ponów” — albo przełącz się na innego dostawcę/klucz.",
      fix: FIX_AI,
    };
  }
  // Klucz API: brak/nieprawidłowy/wygasł — prowadź prosto do miejsca wklejenia klucza.
  if (/brak klucza|api key|klucz .*(nieprawid|pusty|wygas)|\b401\b|\b403\b|unauthorized|forbidden|invalid.?api|oauth 2 access token|invalid authentication/i.test(m)) {
    return {
      human:
        "Klucz API nie działa (pusty, błędny albo wygasł) — dlatego czat nie odpowiada. " +
        "Wklej poprawny klucz i gotowe. Darmowy klucz Gemini: aistudio.google.com/apikey.",
      fix: { label: "⚙ Wklej klucz (Ustawienia → AI)", nav: "settings" },
    };
  }
  // Środki/limity konta (billing/quota).
  if (/credit|billing|too low|payment|quota|insufficient/i.test(m)) {
    return {
      human: "Ten dostawca AI nie ma środków lub wyczerpał limit. Przełącz mózg na innego dostawcę albo dodaj inny klucz.",
      fix: FIX_AI,
    };
  }
  // Lokalny serwer (Ollama) nieosiągalny — humanize ma już dobrą treść; dokładamy akcję.
  if (/\b11434\b|ollama/i.test(m) && /failed|refused|connect|timeout|network|fetch/i.test(m)) {
    return { human: humanize(msg), fix: FIX_AI };
  }
  // Sieć/timeout — rada bez przycisku ustawień (nic tam nie naprawi); „Ponów” wystarczy.
  if (/timeout|abort|failed to fetch|load failed|network|net::|przekroczono czas/i.test(m)) {
    return {
      human: "Nie udało się połączyć z usługą AI (internet przerwał albo odpowiedź trwała za długo). Sprawdź zasięg/Wi-Fi i kliknij „Ponów”.",
    };
  }
  // Model niedostępny/nieistniejący.
  if (/no endpoints|not a valid model|invalid model|model.{0,3}not.{0,3}found|does not exist|unsupported model|\b404\b/i.test(m)) {
    return {
      human: "Wybrany model AI jest niedostępny (mógł zostać wycofany). Wybierz inny model lub dostawcę.",
      fix: FIX_AI,
    };
  }
  // Nieznany błąd: humanize + ZAWSZE jakaś droga naprawy (ustawienia AI to najczęstsza przyczyna).
  const human = humanize(msg);
  return {
    human: human === msg
      ? `Coś poszło nie tak: ${truncate(msg, 160)} Kliknij „Ponów” — a jeśli wraca, zajrzyj do ustawień AI.`
      : human,
    fix: FIX_AI,
  };
}

/** Pure: porada, gdy JARVIS w ogóle nie ma skonfigurowanego mózgu (preflight PRZED wysłaniem). */
export function adviseNoBrain(): ErrorAdvice {
  return {
    human:
      "Czat nie odpowiada, bo żaden mózg AI nie jest teraz skonfigurowany — najpewniej zmiana w ustawieniach " +
      "usunęła klucz albo przełączyła dostawcę bez klucza. Wklej klucz API (darmowy Gemini: aistudio.google.com/apikey) " +
      "albo podaj adres lokalnego modelu (Ollama).",
    fix: { label: "⚙ Napraw mózg (Ustawienia → AI)", nav: "settings" },
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
