// === Doradca błędów (errorAdvisor) — każdy błąd ma LUDZKIE wyjaśnienie i KROK PO KROKU jak naprawić ===
// PO CO: użytkownik widział surowe „Internal Server Error (500)” albo gołe „…” i nie wiedział, co
// zrobić, żeby czat odpowiedział. Ten moduł zamienia KAŻDY błąd (i pustą odpowiedź modelu) na:
// (1) zrozumiałe polskie zdanie „co się stało i czyja to wina”, (2) NUMEROWANE kroki naprawy,
// (3) przycisk prowadzący we właściwe miejsce. Rozszerza (nie dubluje) humanize() z aiHelpers.
// Czyste funkcje — testowalne bez UI. S9-safe (bez /u, \p{...}, lookbehind).

import { humanize } from "./aiHelpers";

/** Dokąd prowadzi przycisk naprawy (App tłumaczy nav na openScreen/akcję). */
export type FixNav = "settings" | "retry";

export interface ErrorAdvice {
  /** Ludzkie wyjaśnienie PO POLSKU: co się stało + czyja to wina. Nigdy surowy stack. */
  human: string;
  /** Numerowane kroki naprawy „krok po kroku” — konkretne, do wykonania od razu. */
  steps: string[];
  /** Przycisk naprawy (etykieta + cel). Brak = wystarczy „🔄 Ponów”. */
  fix?: { label: string; nav: FixNav };
}

const FIX_AI = { label: "⚙ Napraw w Ustawieniach → AI", nav: "settings" as FixNav };

// Najczęstsza recepta: wklej działający klucz Gemini i upewnij się, że wybrany dostawca go ma.
const STEPS_KEY: string[] = [
  "Kliknij przycisk „⚙ Napraw w Ustawieniach → AI” poniżej.",
  "W polu „Klucz Gemini” wklej darmowy klucz ze strony aistudio.google.com/apikey.",
  "Upewnij się, że „Dostawca” jest ustawiony na „Gemini” lub „Auto” (a nie na dostawcę bez klucza).",
  "Zamknij Ustawienia i napisz wiadomość jeszcze raz (albo kliknij „🔄 Ponów”).",
];

/**
 * Pure: sklasyfikuj surowy błąd tury czatu na poradę z krokami. Pierwsza pasująca klasa wygrywa.
 */
export function adviseError(raw: string): ErrorAdvice {
  const msg = (raw || "").trim();
  const m = msg.toLowerCase();

  // Awaria po stronie dostawcy (5xx / przeciążenie) — NIE wina użytkownika.
  if (/\b5\d\d\b|internal server error|internal error|server error|overloaded|przeci[ąa][żz]|service unavailable|bad gateway|temporarily unavailable/i.test(m)) {
    return {
      human: "Serwer dostawcy AI ma chwilową awarię (błąd po ich stronie — nie zrobiłeś nic złego).",
      steps: [
        "Kliknij „🔄 Ponów” — takie awarie zwykle mijają po chwili.",
        "Jeśli błąd wraca, kliknij „⚙ Napraw” i przełącz „Dostawca” na innego (np. z Gemini na Groq/Cerebras) albo ustaw „Auto”.",
        "Sprawdź, że masz internet (spróbuj otworzyć dowolną stronę).",
      ],
      fix: { label: "⚙ Przełącz dostawcę (Ustawienia → AI)", nav: "settings" },
    };
  }
  // Limit zapytań (429).
  if (/\b429\b|rate.?limit|too many requests|resource.?exhausted/i.test(m)) {
    return {
      human: "Dostawca AI chwilowo ogranicza liczbę zapytań (wyczerpany limit darmowego planu).",
      steps: [
        "Odczekaj około minuty i kliknij „🔄 Ponów”.",
        "Jeśli spieszysz się: kliknij „⚙ Napraw” i przełącz na innego dostawcę albo dodaj drugi klucz.",
      ],
      fix: FIX_AI,
    };
  }
  // Klucz API: brak / nieprawidłowy / wygasł.
  if (/brak klucza|api key|klucz .*(nieprawid|pusty|wygas)|\b401\b|\b403\b|unauthorized|forbidden|invalid.?api|oauth 2 access token|invalid authentication/i.test(m)) {
    return {
      human: "Klucz API nie działa (pusty, błędny albo wygasł) — dlatego czat nie odpowiada.",
      steps: STEPS_KEY,
      fix: { label: "⚙ Wklej klucz (Ustawienia → AI)", nav: "settings" },
    };
  }
  // Środki / limity konta.
  if (/credit|billing|too low|payment|quota|insufficient/i.test(m)) {
    return {
      human: "Ten dostawca AI nie ma środków lub wyczerpał limit.",
      steps: [
        "Kliknij „⚙ Napraw” i przełącz „Dostawca” na darmowego (np. Gemini) albo „Auto”.",
        "Albo dodaj inny, działający klucz API i wybierz tego dostawcę.",
        "Wróć i kliknij „🔄 Ponów”.",
      ],
      fix: FIX_AI,
    };
  }
  // Lokalny serwer (Ollama) nieosiągalny.
  if (/\b11434\b|ollama/i.test(m) && /failed|refused|connect|timeout|network|fetch/i.test(m)) {
    return {
      human: "Nie mogę połączyć się z lokalnym modelem (Ollama) — komputer lub serwer jest niedostępny.",
      steps: [
        "Sprawdź, czy komputer z Ollamą jest włączony i w tej samej sieci (np. Tailscale połączony).",
        "Albo kliknij „⚙ Napraw” i przełącz mózg na chmurę (Gemini/Auto) z działającym kluczem.",
        "Wróć i kliknij „🔄 Ponów”.",
      ],
      fix: FIX_AI,
    };
  }
  // Sieć / timeout / zawieszenie (w tym backstop z App: „odpowiedź trwała zbyt długo”).
  if (/timeout|abort|failed to fetch|load failed|network|net::|przekroczono czas|trwała zbyt długo|zbyt długo/i.test(m)) {
    return {
      human: "Nie udało się uzyskać odpowiedzi — połączenie z AI zerwało się albo trwało zbyt długo.",
      steps: [
        "Sprawdź internet (Wi-Fi / zasięg) i kliknij „🔄 Ponów”.",
        "Jeśli wisi za każdym razem: kliknij „⚙ Napraw” i przełącz „Dostawca” na innego albo „Auto”.",
        "Spróbuj krótszym, prostszym poleceniem.",
      ],
      fix: FIX_AI,
    };
  }
  // Model niedostępny / nieistniejący.
  if (/no endpoints|not a valid model|invalid model|model.{0,3}not.{0,3}found|does not exist|unsupported model|\b404\b/i.test(m)) {
    return {
      human: "Wybrany model AI jest niedostępny (mógł zostać wycofany albo nie ma darmowych serwerów).",
      steps: [
        "Kliknij „⚙ Napraw” → w „Ustawienia → AI” ustaw „Model” na „Auto” (albo „Gemini 2.5 Flash”).",
        "Ustaw „Tryb” na „Zrównoważony”.",
        "Wróć i kliknij „🔄 Ponów”.",
      ],
      fix: FIX_AI,
    };
  }
  // Nieznany błąd: humanize + ZAWSZE kroki i droga naprawy.
  const human = humanize(msg);
  return {
    human: human === msg ? `Coś poszło nie tak: ${truncate(msg, 160)}` : human,
    steps: [
      "Kliknij „🔄 Ponów” — część błędów jest chwilowa.",
      "Jeśli wraca: kliknij „⚙ Napraw” i sprawdź w „Ustawienia → AI”, czy wybrany dostawca ma wklejony klucz.",
    ],
    fix: FIX_AI,
  };
}

/** Pure: porada, gdy JARVIS w ogóle nie ma skonfigurowanego mózgu (preflight PRZED wysłaniem). */
export function adviseNoBrain(): ErrorAdvice {
  return {
    human: "Czat nie odpowiada, bo żaden mózg AI nie jest teraz skonfigurowany — najpewniej zmiana w ustawieniach usunęła klucz albo przełączyła dostawcę bez klucza.",
    steps: STEPS_KEY,
    fix: { label: "⚙ Napraw mózg (Ustawienia → AI)", nav: "settings" },
  };
}

/**
 * Pure: porada, gdy model ODPOWIEDZIAŁ, ale PUSTO (samo „…”). To najczęstsza przyczyna „widzę
 * kropki i nie wiem czemu”: zły/za słaby model, filtr treści albo zbyt złożone polecenie.
 */
export function adviseEmptyReply(): ErrorAdvice {
  return {
    human: "Model odebrał wiadomość, ale zwrócił PUSTĄ odpowiedź (dlatego widzisz tylko „…”). Najczęściej to kwestia wybranego modelu albo zbyt złożonego polecenia.",
    steps: [
      "Kliknij „🔄 Ponów” i spróbuj krótszym, prostszym poleceniem.",
      "Jeśli wraca: kliknij „⚙ Napraw” → w „Ustawienia → AI” ustaw „Model” na „Auto” i „Tryb” na „Zrównoważony”.",
      "Upewnij się, że „Dostawca” ma wklejony działający klucz (np. Gemini).",
    ],
    fix: FIX_AI,
  };
}

/** Pure: czy tekst odpowiedzi jest w praktyce PUSTY (nic albo same kropki/wielokropek/spacje)? */
export function isEmptyReplyText(text: string | undefined | null): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  return /^[….\s]+$/.test(t); // „…”, „...”, „. . .” itp. — brak realnej treści
}

/**
 * Pure: złóż pełną wiadomość dla użytkownika z porady — nagłówek + numerowane kroki.
 * Bąbel czatu ma white-space: pre-wrap, więc znaki nowej linii renderują się jako lista.
 */
export function adviceMessage(adv: ErrorAdvice, prefix = "⚠"): string {
  const head = `${prefix} ${adv.human}`;
  if (!adv.steps.length) return head;
  const steps = adv.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `${head}\n\nJak to naprawić:\n${steps}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
