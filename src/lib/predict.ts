// === Silnik predykcyjny — JARVIS działa, zanim zapytasz ===
// Czysta funkcja skanująca cały kontekst (zadania, przypomnienia, kalendarz, leady, model świata)
// i wytwarzająca uszeregowane, PROAKTYWNE przewidywania: terminy, zaległości, follow-upy, szanse,
// zaniedbane relacje. Deterministyczna i w pełni testowalna; bez sieci i zewnętrznych zależności.
import type { Task, Reminder, CalendarEvent, Lead, WorldEntity } from "../types";

export type PredictionKind =
  | "overdue" | "deadline" | "reminder" | "event"
  | "lead_followup" | "lead_opportunity" | "relationship";
export type Urgency = "low" | "med" | "high";

export interface Prediction {
  id: string;
  kind: PredictionKind;
  urgency: Urgency;
  title: string;   // krótko, do listy/toastu
  detail?: string; // dłuższy kontekst
  at?: number;     // kiedy (do sortowania), gdy dotyczy
}

export interface PredictInput {
  tasks: Task[];
  reminders: Reminder[];
  calendar: CalendarEvent[];
  leads: Lead[];
  people: WorldEntity[]; // encje „person" z modelu świata
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ms = (iso?: string): number | null => { const t = iso ? Date.parse(iso) : NaN; return isFinite(t) ? t : null; };
const sameDay = (a: number, b: number) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
const URG: Record<Urgency, number> = { high: 3, med: 2, low: 1 };

/** Pure: wytwórz proaktywne przewidywania z bieżącego kontekstu (nieuszeregowane). */
export function predict(input: PredictInput, now = Date.now()): Prediction[] {
  const out: Prediction[] = [];

  // 1) Zadania: zaległe (overdue) i nadchodzące (≤48h).
  let overdue = 0; let overdueEx = "";
  for (const t of input.tasks) {
    if (t.done) continue;
    const due = ms(t.due);
    if (due == null) continue;
    if (due < now) { overdue++; if (!overdueEx) overdueEx = t.title; }
    else if (due - now <= 2 * DAY) {
      out.push({ id: `task:${t.id}`, kind: "deadline", urgency: due - now <= 12 * HOUR ? "high" : "med", title: `⏳ Termin: „${t.title}"`, detail: `Za ${Math.max(1, Math.round((due - now) / HOUR))} h.`, at: due });
    }
  }
  if (overdue > 0) out.push({ id: "overdue", kind: "overdue", urgency: "high", title: overdue === 1 ? `⚠ Zaległe: „${overdueEx}"` : `⚠ ${overdue} zaległych zadań`, detail: "Termin minął — zrób lub przesuń.", at: now });

  // 2) Przypomnienia ≤24h.
  for (const r of input.reminders) {
    if (r.fired) continue;
    const at = ms(r.at);
    if (at == null || at < now - HOUR || at - now > DAY) continue;
    out.push({ id: `rem:${r.id}`, kind: "reminder", urgency: at - now <= 2 * HOUR ? "high" : "med", title: `🔔 ${r.text}`, at });
  }

  // 3) Wydarzenia dziś/jutro.
  for (const e of input.calendar) {
    const start = ms(e.start);
    if (start == null || start < now - HOUR) continue;
    const today = sameDay(start, now);
    const tomorrow = sameDay(start, now + DAY);
    if (!today && !tomorrow) continue;
    out.push({ id: `evt:${e.id}`, kind: "event", urgency: today ? "med" : "low", title: `📅 ${e.title}${e.location ? ` · ${e.location}` : ""}`, detail: today ? "Dziś" : "Jutro", at: start });
  }

  // 4) Leady: follow-up po ofercie/kontakcie bez ruchu od ≥7 dni.
  let followups = 0; let fuEx = "";
  for (const l of input.leads) {
    if (l.status !== "offer" && l.status !== "contacted") continue;
    const last = l.lastContactedAt || l.updatedAt || l.createdAt;
    if (now - last >= 7 * DAY) { followups++; if (!fuEx) fuEx = l.company; }
  }
  if (followups > 0) out.push({ id: "followups", kind: "lead_followup", urgency: "med", title: followups === 1 ? `📨 Follow-up: ${fuEx}` : `📨 ${followups} leadów czeka na follow-up`, detail: "Brak kontaktu od ponad tygodnia.", at: now });

  // 5) Leady: szansa — z e-mailem, świeże, bez wysłanej oferty.
  const opp = input.leads.filter((l) => (l.email || (l.contact || "").includes("@")) && (l.status === "new" || l.status === "contacted") && !l.offer);
  if (opp.length >= 1) out.push({ id: "opps", kind: "lead_opportunity", urgency: "low", title: opp.length === 1 ? `💡 Gotowy do oferty: ${opp[0].company}` : `💡 ${opp.length} leadów z e-mailem gotowych do oferty`, detail: "Możesz wysłać oferty jednym kliknięciem.", at: now });

  // 6) Zaniedbane relacje — osoba znana (≥3 wzmianki), niewspominana od ≥30 dni.
  for (const p of input.people) {
    if (p.kind !== "person" || p.mentions < 3) continue;
    if (now - p.lastSeen >= 30 * DAY) out.push({ id: `rel:${p.id}`, kind: "relationship", urgency: "low", title: `👤 Dawno o: ${p.name}`, detail: `Ostatnio ~${Math.round((now - p.lastSeen) / DAY)} dni temu.`, at: p.lastSeen });
  }

  return out;
}

/** Pure: najważniejsze przewidywania — wg pilności, potem najbliższego czasu. */
export function topPredictions(input: PredictInput, now = Date.now(), max = 6): Prediction[] {
  return predict(input, now)
    .sort((a, b) => URG[b.urgency] - URG[a.urgency] || (a.at || Infinity) - (b.at || Infinity))
    .slice(0, max);
}
