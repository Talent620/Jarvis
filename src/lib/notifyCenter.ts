import { store } from "./store";
import { dueCount } from "./cards";
import { followUpsDue } from "./salesEngine";

// Centrum powiadomień — agreguje wszystko, co wymaga uwagi: przypomnienia,
// zadania na dziś/zaległe, follow-upy w sprzedaży i fiszki do powtórki.
// Czyste funkcje (czytają tylko store) — w pełni testowalne.

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Przypomnienia, których termin już minął, a jeszcze nie „odhaczone". */
export function dueReminders(now = Date.now()) {
  return (store.data.reminders || [])
    .filter((r) => !r.fired && new Date(r.at).getTime() <= now)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Przypomnienia zaplanowane na dziś (jeszcze przed czasem). */
export function soonReminders(now = Date.now()) {
  const end = startOfDay(now) + 86400000;
  return (store.data.reminders || [])
    .filter((r) => { const t = new Date(r.at).getTime(); return !r.fired && t > now && t < end; })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export interface NotifSummary {
  remindersDue: number;
  remindersSoon: number;
  tasksToday: number;
  followUps: number;
  cards: number;
  /** Suma „pilnych" (do plakietki) — przypomnienia po czasie + zadania + follow-upy. */
  total: number;
}

/** Zbiorcze liczniki do plakietek i Centrum powiadomień. */
export function notifySummary(now = Date.now()): NotifSummary {
  const today = new Date(now).toISOString().slice(0, 10);
  const tasks = store.data.tasks || [];
  const tasksToday = tasks.filter((t) => !t.done && t.due && t.due.slice(0, 10) <= today).length;
  const followUps = followUpsDue(store.data.leads || [], now).length;
  const cards = dueCount(now);
  const remindersDue = dueReminders(now).length;
  const remindersSoon = soonReminders(now).length;
  return {
    remindersDue,
    remindersSoon,
    tasksToday,
    followUps,
    cards,
    total: remindersDue + tasksToday + followUps,
  };
}

/** Oznacz przypomnienie jako odhaczone (zniknie z powiadomień). */
export function dismissReminder(id: string): void {
  store.setData((d) => { const r = d.reminders.find((x) => x.id === id); if (r) r.fired = true; });
}
