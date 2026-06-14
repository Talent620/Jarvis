// Strażnik generowania — pozwala bezpiecznie „zatrzymać" odpowiedź JARVIS-a.
// Każdej generacji nadajemy rosnący token. Gdy użytkownik kliknie Stop (albo wyśle
// coś nowego), token się zmienia — a spóźniona odpowiedź ze starym tokenem jest
// odrzucana, więc nie wskakuje do czatu po fakcie. Czyste i w pełni testowalne.

let current = 0;

/** Rozpocznij nową generację — zwraca jej token (zapamiętaj go na czas żądania). */
export function startGeneration(): number {
  return ++current;
}

/** Anuluj bieżącą generację (Stop) — każdy wcześniejszy token przestaje być aktualny. */
export function cancelGeneration(): void {
  current++;
}

/** Czy token nadal opisuje aktualną generację (czyli wynik wolno pokazać). */
export function isCurrent(token: number): boolean {
  return token === current;
}

/** Reset (do testów). */
export function resetGeneration(): void {
  current = 0;
}
