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
 * Pure: podpowiedzi startowe zależne od pory dnia, kontekstu i JĘZYKA — bardziej „żywe" niż
 * stała lista. Rano proponuje raport, wieczorem podsumowanie; zadania na dziś na górze.
 */
export function starterSuggestions(now: Date, opts: { tasksToday?: number; desktop?: boolean; lang?: "pl" | "en" } = {}): string[] {
  const h = now.getHours();
  const en = opts.lang === "en";
  const out: string[] = [];
  if (opts.tasksToday && opts.tasksToday > 0) {
    out.push(en
      ? (opts.tasksToday === 1 ? "What do I have to do today?" : `Show my ${opts.tasksToday} tasks for today`)
      : (opts.tasksToday === 1 ? "Co mam dziś do zrobienia?" : `Pokaż moje ${opts.tasksToday} zadania na dziś`));
  }
  if (h < 11) out.push(...(en ? ["Give me the morning report", "What's on my calendar today?"] : ["Przedstaw raport poranny", "Co dziś w kalendarzu?"]));
  else if (h < 17) out.push(...(en ? ["What do I have to do today?", "What's new in the news?"] : ["Co mam dziś do zrobienia?", "Co nowego w wiadomościach?"]));
  else out.push(...(en ? ["Summarize my day", "What should I plan for tomorrow?"] : ["Podsumuj mój dzień", "Co zaplanować na jutro?"]));
  out.push(opts.desktop ? (en ? "What's on my screen?" : "Co mam na ekranie?") : (en ? "What's the weather?" : "Jaka jest pogoda?"));
  // Unikaj duplikatów (gdy zadania pokryły się z porą dnia) i ogranicz do 5.
  return [...new Set(out)].slice(0, 5);
}
