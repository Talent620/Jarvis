// === ✨ Wartość, którą dał Ci JARVIS — etyczny haczyk „niezbędności" ===
// Liczy realne, wykonane przez JARVISA akcje (z audytu) i szacuje zaoszczędzony czas.
// To NIE dark pattern — pokazuje prawdę: ile faktycznie zrobił za Ciebie. Widok tej wartości
// (i jej narastania) sprawia, że trudno z niego zrezygnować — bo widać, co byś stracił.
import type { AuditEntry } from "../types";

// Zgrubny czas oszczędzony na akcję (min) — różne akcje ważą inaczej.
const MIN: Record<string, number> = {
  gmail_send: 6, send_test_email: 5, send_offers_all: 12, salesos_email: 6,
  make_call: 4, send_sms: 3, add_calendar_event: 3, gcal_add: 3,
  add_task: 2, add_reminder: 2, add_note: 1, add_shopping_item: 1, remember_fact: 1,
  create_flashcards: 8, web_research: 5, find_leads: 10, save_lead: 2,
  navigate_to: 2, open_service: 1, android_type: 2, android_open_app: 1,
};
const DEFAULT_MIN = 3;

export interface ValueStat { actions: number; minutes: number }

const day = (at: number) => {
  try { return new Date(at).toISOString().slice(0, 10); } catch { return ""; }
};
const minutesFor = (tool: string) => MIN[tool] ?? DEFAULT_MIN;

/** Pure: wartość z dziś (akcje + szacowany zaoszczędzony czas). */
export function valueToday(audit: AuditEntry[], now = Date.now()): ValueStat {
  const today = day(now);
  let actions = 0, minutes = 0;
  for (const a of audit || []) {
    if (a.status !== "ok") continue;
    if (day(a.at) !== today) continue;
    actions++;
    minutes += minutesFor(a.tool);
  }
  return { actions, minutes };
}

/** Pure: wartość łączna (od zawsze). */
export function valueAllTime(audit: AuditEntry[]): ValueStat {
  let actions = 0, minutes = 0;
  for (const a of audit || []) {
    if (a.status !== "ok") continue;
    actions++;
    minutes += minutesFor(a.tool);
  }
  return { actions, minutes };
}

/** Pure: ładny, krótki opis czasu (min → „~1 h 5 min" / „~25 min"). */
export function prettyMinutes(min: number): string {
  if (min < 1) return "chwilę";
  if (min < 60) return `~${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `~${h} h ${m} min` : `~${h} h`;
}
