// === Chief of Staff — cyfrowy szef sztabu ===
// Spina world model + predykcje + zadania/kalendarz/leady w JEDNĄ odprawę: priorytety, terminy,
// blokery, follow-upy, szanse i rekomendowane akcje. Czysta, deterministyczna, w pełni testowalna.
import type { Task, Reminder, CalendarEvent, Lead, WorldEntity } from "../types";
import { predict, type Prediction } from "./predict";

export interface ChiefInput {
  tasks: Task[];
  reminders: Reminder[];
  calendar: CalendarEvent[];
  leads: Lead[];
  people: WorldEntity[];
}

export interface BriefSection { title: string; items: string[] }
export interface Briefing {
  heading: string;
  sections: BriefSection[];
  actions: string[]; // rekomendowane następne kroki
}

const ms = (iso?: string): number | null => { const t = iso ? Date.parse(iso) : NaN; return isFinite(t) ? t : null; };
const sameDay = (a: number, b: number) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
const timeOfDay = (now: number) => { const h = new Date(now).getHours(); return h < 12 ? "Ranek" : h < 18 ? "Popołudnie" : "Wieczór"; };

/** Pure: zbuduj odprawę szefa sztabu z bieżącego kontekstu (+ opcjonalna pogoda). */
export function buildChiefBriefing(input: ChiefInput, now = Date.now(), weather?: string): Briefing {
  const preds = predict(input, now);
  const byKind = (k: Prediction["kind"]) => preds.filter((p) => p.kind === k);
  const sections: BriefSection[] = [];
  const actions: string[] = [];

  const dateStr = new Date(now).toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const heading = `${timeOfDay(now)} · ${dateStr}${weather ? ` · ${weather}` : ""}`;

  // PRIORYTETY / DZIŚ: zadania-priorytet + dzisiejsze wydarzenia.
  const priority = input.tasks.filter((t) => !t.done && t.priority).slice(0, 5).map((t) => `⭐ ${t.title}`);
  const todayEvents = input.calendar
    .map((e) => ({ e, s: ms(e.start) }))
    .filter((x) => x.s != null && sameDay(x.s!, now))
    .sort((a, b) => a.s! - b.s!)
    .map((x) => `📅 ${new Date(x.s!).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} ${x.e.title}${x.e.location ? ` · ${x.e.location}` : ""}`);
  const dzis = [...priority, ...todayEvents];
  if (dzis.length) { sections.push({ title: "🎯 Priorytety / Dziś", items: dzis }); if (priority.length) actions.push(`Zacznij od priorytetu: ${input.tasks.find((t) => !t.done && t.priority)!.title}.`); }

  // TERMINY: nadchodzące deadline'y + przypomnienia.
  const deadlines = [...byKind("deadline"), ...byKind("reminder")].map((p) => `${p.title}${p.detail ? ` — ${p.detail}` : ""}`);
  if (deadlines.length) sections.push({ title: "⏳ Terminy", items: deadlines });

  // BLOKERY: zaległe zadania + leady do follow-upu.
  const blockers = [...byKind("overdue"), ...byKind("lead_followup")].map((p) => `${p.title}${p.detail ? ` — ${p.detail}` : ""}`);
  if (blockers.length) {
    sections.push({ title: "⚠ Blokery / Uwaga", items: blockers });
    if (byKind("overdue").length) actions.push("Domknij lub przesuń zaległe zadania.");
    if (byKind("lead_followup").length) actions.push("Wyślij follow-up do leadów bez ruchu od tygodnia.");
  }

  // SZANSE: leady gotowe do oferty.
  const opps = byKind("lead_opportunity").map((p) => `${p.title}${p.detail ? ` — ${p.detail}` : ""}`);
  if (opps.length) { sections.push({ title: "💡 Szanse", items: opps }); actions.push("Wyślij oferty do leadów z e-mailem (jednym kliknięciem)."); }

  // RELACJE: zaniedbane kontakty.
  const rel = byKind("relationship").map((p) => `${p.title}${p.detail ? ` — ${p.detail}` : ""}`);
  if (rel.length) { sections.push({ title: "👤 Relacje", items: rel }); actions.push(`Odezwij się do: ${byKind("relationship").map((p) => p.title.replace(/^👤 Dawno o:\s*/, "")).slice(0, 3).join(", ")}.`); }

  if (todayEvents.length) actions.push(`Przygotuj się do: ${todayEvents[0].replace(/^📅 \d{1,2}:\d{2}\s*/, "")}.`);

  return { heading, sections, actions: [...new Set(actions)].slice(0, 5) };
}

/** Pure: odprawa jako gotowy tekst (do referowania / toastu / kopiowania). */
export function formatBriefing(b: Briefing): string {
  const parts = [`🧭 Odprawa — ${b.heading}`, ""];
  if (!b.sections.length) parts.push("Spokojnie — nic pilnego na horyzoncie. Dobry moment na pracę głęboką.");
  for (const s of b.sections) { parts.push(s.title); for (const it of s.items) parts.push(`  • ${it}`); parts.push(""); }
  if (b.actions.length) { parts.push("✅ Rekomendowane następne kroki:"); for (const a of b.actions) parts.push(`  → ${a}`); }
  return parts.join("\n").trim();
}
