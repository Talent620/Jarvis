// Faza 7 — proaktywność.
// Generuje propozycje „z własnej inicjatywy" na podstawie kontekstu (pora dnia, zadania,
// kalendarz) i wzorców z pamięci epizodycznej (powracające, porzucone tematy). Czysta
// logika (czyta store + przekazane epizody) — w pełni testowalna. UI tylko wyświetla wynik.

import type { Task, CalendarEvent } from "../types";
import { staleRecurringTopics, loadEpisodes, type Episode } from "./episodicMemory";
import { store } from "./store";

export interface Suggestion {
  id: string;
  icon: string;
  text: string;
}

const DAY = 86_400_000;
const isToday = (iso: string, now: number) => iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10);

/** Zadania zaległe o ponad `days` dni (kandydaci do przełożenia/odpuszczenia). */
export function staleTasks(tasks: Task[], now: number, days = 3): Task[] {
  const cutoff = now - days * DAY;
  return tasks.filter((t) => !t.done && t.due && new Date(t.due).getTime() < cutoff);
}

/** Wydarzenia z kalendarza w najbliższych `hours` godzinach. */
export function upcomingEvents(events: CalendarEvent[], now: number, hours = 2): CalendarEvent[] {
  const end = now + hours * 3_600_000;
  return events
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= now && t <= end;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export interface ProactiveContext {
  tasks: Task[];
  events: CalendarEvent[];
  episodes: Episode[];
  hasTasksOrEventsToday: boolean;
}

/**
 * Złóż propozycje proaktywne (najwyżej `max`, posortowane wg pilności).
 * Czysta — dostaje cały kontekst, więc łatwo testować.
 */
export function buildSuggestions(ctx: ProactiveContext, now = Date.now(), max = 4): Suggestion[] {
  const out: Suggestion[] = [];
  const hour = new Date(now).getHours();

  // 1) Najbliższe wydarzenie — najwyższy priorytet.
  const soon = upcomingEvents(ctx.events, now);
  if (soon.length) {
    const e = soon[0];
    const t = new Date(e.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    out.push({ id: "event:" + e.id, icon: "📅", text: `Za chwilę (${t}): „${e.title}". Przygotować coś?` });
  }

  // 2) Poranny briefing — gdy jest co podsumować.
  if (hour >= 6 && hour <= 11 && ctx.hasTasksOrEventsToday) {
    out.push({ id: "briefing", icon: "☀️", text: "Dzień dobry. Zacząć od briefingu na dziś?" });
  }

  // 3) Zaległe zadania > 3 dni.
  const stale = staleTasks(ctx.tasks, now);
  if (stale.length) {
    out.push({
      id: "stale-tasks",
      icon: "⏳",
      text:
        stale.length === 1
          ? `„${stale[0].title}" zalega od kilku dni — przełożyć czy odpuścić?`
          : `${stale.length} zadań zalega ponad 3 dni — zrobić przegląd i przełożyć?`,
    });
  }

  // 4) Powracający, ostatnio porzucony temat (pamięć epizodyczna).
  const topics = staleRecurringTopics(ctx.episodes, now);
  if (topics.length) {
    out.push({ id: "topic:" + topics[0], icon: "💡", text: `Wracałeś do tematu „${topics[0]}", ale nie ostatnio — domknąć?` });
  }

  return out.slice(0, max);
}

export { isToday };

/** Propozycje proaktywne na podstawie bieżącego store + pamięci epizodycznej. */
export function proactiveSuggestions(now = Date.now()): Suggestion[] {
  const tasks = store.data.tasks || [];
  const events = store.data.calendar || [];
  const hasTasksOrEventsToday =
    tasks.some((t) => !t.done && t.due && isToday(t.due, now)) ||
    events.some((e) => isToday(e.start, now));
  return buildSuggestions({ tasks, events, episodes: loadEpisodes(), hasTasksOrEventsToday }, now);
}
