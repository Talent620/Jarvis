// Czyste funkcje pomocnicze mózgu (bez zależności) — łatwe do testowania.

// Błędy, przy których warto spróbować kolejnego dostawcy (brak kredytów, limit,
// autoryzacja, a także martwy/nieprawidłowy model — np. zniknięte darmowe endpointy).
export function shouldFallback(msg: string): boolean {
  return /credit|billing|insufficient|quota|exceeded|rate.?limit|too low|payment|unauthorized|invalid.?api|forbidden|overloaded|unavailable|no endpoints|no allowed providers|not a valid model|invalid model|model.{0,3}not.{0,3}found|does not exist|unsupported model|\b(401|402|403|404|429|500|502|503)\b/i.test(
    msg,
  );
}

export const isNetworkError = (msg: string): boolean =>
  /failed to fetch|load failed|network|networkerror|timeout/i.test(msg);

// Błąd „na poziomie klucza" — limit, wyczerpany kredyt lub zła autoryzacja. Przy
// takim warto najpierw spróbować INNEGO klucza tego samego dostawcy (rotacja),
// zanim zejdziemy do kolejnego dostawcy.
export function isKeyError(msg: string): boolean {
  return /rate.?limit|too many requests|quota|exceeded|insufficient|credit|billing|payment|too low|unauthorized|invalid.?api|forbidden|\b(401|402|403|429)\b/i.test(
    msg,
  );
}

// Przetłumacz techniczny błąd na zrozumiały komunikat.
export function humanize(msg: string): string {
  if (isNetworkError(msg)) return "Brak połączenia z usługą AI. Sprawdź internet i klucz API (⚙ Ustawienia).";
  if (/401|unauthorized|invalid.?api|forbidden|403/i.test(msg))
    return "Klucz API jest nieprawidłowy, wygasł lub nie ma dostępu — sprawdź go w ⚙ Ustawienia.";
  if (/credit|billing|too low|payment|quota|insufficient/i.test(msg))
    return "Wybrany dostawca nie ma środków/limitu. Przełącz dostawcę lub dodaj inny klucz w ⚙.";
  if (/no endpoints|no allowed providers|not a valid model|invalid model|model.{0,3}not.{0,3}found|does not exist|unsupported model|404/i.test(msg))
    return "Wybrany model AI jest chwilowo niedostępny (np. darmowy model bez endpointów). Wybierz inny model lub dostawcę w ⚙ → AI.";
  return msg;
}

// Heurystyka złożoności zapytania — steruje doborem modelu (prosty/mocny).
export function isComplex(text: string): boolean {
  const t = text || "";
  return (
    t.length > 260 ||
    /(zaplanuj|research|analiz|porówn|napisz|\bkod\b|program|wyjaśnij|strategi|raport|e-?mail|mail do|przeanalizuj|podsumuj|stre[śs]|przet[łl]umacz)/i.test(t)
  );
}

// Sygnały, że wypowiedź niesie trwałą informację o użytkowniku (pamięć autonomiczna).
export const PERSONAL_CUES =
  /\b(jestem|mam|m[oó]j|moja|moje|moich|lubi[eę]|wol[eę]|nie\s?lubi[eę]|nienawidz[eę]|mieszkam|pracuj[eę]|nazywam|imi[eę]|żona|m[aąż]|partner|dziecko|c[oó]rk|syn|pies|kot|urodzi|adres|alergi|uczulony|dieta|wegeta|wegan|zawsze|nigdy|codziennie|preferuj[eę]|ulubion|zapami[eę]ta|wa[zż]ne|numer|telefon|email|e-mail)/i;
