// Drobne, czyste pomocniki UX czatu — wydzielone, by były testowalne bez DOM-u/Reacta.

/** Widok przewijalny opisany trzema liczbami (jak element DOM). */
export interface ScrollBox { scrollTop: number; scrollHeight: number; clientHeight: number }

/**
 * Pure: czy użytkownik jest „blisko dołu" listy. Gdy tak — auto-przewijanie do nowej wiadomości
 * jest pożądane; gdy przewinął w górę (czyta historię) — NIE wyrywamy go na dół.
 * `threshold` to margines w px (domyślnie 120).
 */
export function isNearBottom(box: ScrollBox, threshold = 120): boolean {
  const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
  return distance <= threshold;
}

/**
 * Pure: podpowiedzi startowe zależne od pory dnia i kontekstu — bardziej „żywe" niż stała lista.
 * Rano proponuje raport, wieczorem podsumowanie; gdy są zadania na dziś, podbija je na górę.
 */
export function starterSuggestions(now: Date, opts: { tasksToday?: number; desktop?: boolean } = {}): string[] {
  const h = now.getHours();
  const out: string[] = [];
  if (opts.tasksToday && opts.tasksToday > 0) {
    out.push(opts.tasksToday === 1 ? "Co mam dziś do zrobienia?" : `Pokaż moje ${opts.tasksToday} zadania na dziś`);
  }
  if (h < 11) out.push("Przedstaw raport poranny", "Co dziś w kalendarzu?");
  else if (h < 17) out.push("Co mam dziś do zrobienia?", "Co nowego w wiadomościach?");
  else out.push("Podsumuj mój dzień", "Co zaplanować na jutro?");
  out.push(opts.desktop ? "Co mam na ekranie?" : "Jaka jest pogoda?");
  // Unikaj duplikatów (gdy zadania pokryły się z porą dnia) i ogranicz do 5.
  return [...new Set(out)].slice(0, 5);
}
