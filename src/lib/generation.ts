// Strażnik generowania — pozwala bezpiecznie „zatrzymać" odpowiedź JARVIS-a.
// Każdej generacji nadajemy rosnący token. Gdy użytkownik kliknie Stop (albo wyśle
// coś nowego), token się zmienia — a spóźniona odpowiedź ze starym tokenem jest
// odrzucana, więc nie wskakuje do czatu po fakcie. Czyste i w pełni testowalne.

let current = 0;
let controller = new AbortController();

/** Rozpocznij nową generację — zwraca jej token (zapamiętaj go na czas żądania). */
export function startGeneration(): number {
  controller.abort();
  controller = new AbortController();
  return ++current;
}

/** Anuluj bieżącą generację (Stop) — każdy wcześniejszy token przestaje być aktualny. */
export function cancelGeneration(): void {
  current++;
  controller.abort();
}

/** Czy token nadal opisuje aktualną generację (czyli wynik wolno pokazać). */
export function isCurrent(token: number): boolean {
  return token === current;
}

/** Cancellation signal for this generation; stale tokens receive an aborted signal. */
export function generationSignal(token: number): AbortSignal {
  if (isCurrent(token)) return controller.signal;
  const stale = new AbortController(); stale.abort(); return stale.signal;
}

/** Reset (do testów). */
export function resetGeneration(): void {
  controller.abort();
  controller = new AbortController();
  current = 0;
}
