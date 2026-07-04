// === Proaktywne POWIADOMIENIA systemowe — trigger nawyku (research: bez wyzwalacza nie ma DAU) ===
// Rdzeń DECYZYJNY jest czysty i testowalny: co i KIEDY wysłać, z twardą deduplikacją (anty-spam).
// Dostarczenie idzie przez notifications.notify() (Capacitor LocalNotifications / desktop).
import type { Prediction } from "./predict";
import { predict } from "./predict";
import { buildChiefBriefing, briefingOneLiner } from "./chiefOfStaff";
import { notify } from "./notifications";
import { store } from "./store";
import { currentRecap } from "./habit";

export interface NotifyDecision { key: string; title: string; body: string }

export interface NotifyInput {
  enabled: boolean;       // proaktywny agent włączony (settings.proactiveAgent !== false)
  dailyBriefing: boolean; // poranna odprawa włączona
  briefingTime: string;   // "HH:MM"
  briefingLine: string;   // briefingOneLiner(...) — może być "" (nic pilnego)
  predictions: Prediction[];
  weeklyRecapLine?: string; // podsumowanie tygodnia (habit) — push re-engage w niedzielę wieczór
}

/** Pure: minuty od północy z "HH:MM" (null gdy format zły lub poza zakresem). */
export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Pure: lokalny klucz dnia YYYY-MM-DD (dedup „raz dziennie"). */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pure: które proaktywne powiadomienia są należne TERAZ — z deduplikacją po zbiorze `sent` (klucze
 * już wysłane). Anty-spam: poranny briefing RAZ dziennie po godzinie i tylko gdy jest co powiedzieć;
 * pilne predykcje (zaległe/termin/przypomnienie „high") RAZ na dobę każda; twardy limit liczby.
 * Caller wysyła decyzje i dopisuje ich `key` do `sent`.
 */
export function dueNotifications(input: NotifyInput, now: number, sent: Set<string>): NotifyDecision[] {
  if (!input.enabled) return [];
  const out: NotifyDecision[] = [];
  const today = dayKey(now);
  const mins = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  // 1) Poranna odprawa — po ustalonej godzinie, raz dziennie, tylko gdy jest realny sygnał.
  if (input.dailyBriefing && input.briefingLine) {
    const at = parseHM(input.briefingTime);
    const key = `briefing:${today}`;
    if (at != null && mins >= at && !sent.has(key)) {
      out.push({ key, title: "🧭 JARVIS — odprawa dnia", body: input.briefingLine });
    }
  }

  // 2) Pilne predykcje — zaległe/terminy/przypomnienia o wysokim priorytecie, raz na dobę każda.
  const URGENT = new Set(["overdue", "deadline", "reminder"]);
  for (const p of input.predictions) {
    if (p.urgency !== "high" || !URGENT.has(p.kind)) continue;
    const key = `pred:${p.id}:${today}`;
    if (sent.has(key)) continue;
    out.push({ key, title: "🔔 JARVIS", body: `${p.title}${p.detail ? ` — ${p.detail}` : ""}` });
    if (out.length >= 4) break; // nie zalewaj powiadomieniami
  }

  // 3) Tygodniowy recap — re-engage RAZ na tydzień, od niedzieli 18:00 (dowód, że inwestycja procentuje).
  if (input.weeklyRecapLine) {
    const sunday = new Date(now);
    sunday.setHours(0, 0, 0, 0);
    sunday.setDate(sunday.getDate() - sunday.getDay()); // cofnij do niedzieli tego tygodnia
    const release = sunday.getTime() + 18 * 60 * 60 * 1000; // niedziela 18:00
    const wkey = `recap:${dayKey(sunday.getTime())}`;
    if (now >= release && !sent.has(wkey)) {
      out.push({ key: wkey, title: "📈 Twój tydzień z JARVISEM", body: input.weeklyRecapLine });
    }
  }
  return out;
}

// --- Uruchamiacz (warstwa nieczysta: dane + wysyłka + trwała deduplikacja) ---
const SENT_KEY = "jarvis.notif.sent.v1";
function loadSent(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || "[]") as string[]); } catch { return new Set(); }
}
function saveSent(s: Set<string>): void {
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...s].slice(-200))); } catch { /* quota — pomiń */ }
}

/**
 * Sprawdź i wyślij należne powiadomienia systemowe. Wywoływane przy starcie i co jakiś czas.
 * Zwraca liczbę wysłanych (0 = nic należnego). Bezpieczne do odpalania często — dedup pilnuje spamu.
 */
export async function runProactiveNotifications(now = Date.now()): Promise<number> {
  const s = store.settings;
  const d = store.data;
  const input = { tasks: d.tasks, reminders: d.reminders, calendar: d.calendar, leads: d.leads, people: d.world?.entities || [] };
  const sent = loadSent();
  const decisions = dueNotifications(
    {
      enabled: s.proactiveAgent !== false,
      dailyBriefing: !!s.dailyBriefing,
      briefingTime: s.briefingTime || "08:00",
      briefingLine: briefingOneLiner(buildChiefBriefing(input, now)),
      predictions: predict(input, now),
      weeklyRecapLine: currentRecap(now).line,
    },
    now,
    sent,
  );
  if (!decisions.length) return 0;
  for (const dec of decisions) {
    try { await notify(dec.title, dec.body); sent.add(dec.key); } catch { /* dostarczenie best-effort */ }
  }
  saveSent(sent);
  return decisions.length;
}
