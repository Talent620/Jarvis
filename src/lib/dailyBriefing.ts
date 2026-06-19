// Daily Briefing Engine („Chief of Staff") — codzienny przegląd składany z ISTNIEJĄCYCH
// danych projektu (zadania, przypomnienia, projekty, kalendarz). Zero konfiguracji.
// Czysta logika → w pełni testowalna; warstwa tekstowa osobno (do narracji/TTS).

import type { Task, Reminder, Project, CalendarEvent } from "../types";
import { staleTasks } from "./proactivity";

export interface BriefingData {
  tasks: Task[];
  reminders: Reminder[];
  projects: Project[];
  events: CalendarEvent[];
}

export interface ProjectAttention {
  project: Project;
  pending: number; // ile aktywnych zadań w projekcie
  stale: number; // ile z nich zaległych/przeterminowanych
}

export interface DailyBriefing {
  greeting: string;
  todayEvents: CalendarEvent[];
  topTasks: Task[]; // priorytety + terminy na dziś
  overdueTasks: Task[]; // termin minął
  overdueReminders: Reminder[]; // przypomnienia po czasie, niewykonane
  projectsNeedingAttention: ProjectAttention[];
  recommendations: string[]; // rekomendowane działania
  empty: boolean; // nic pilnego
}

// Polska odmiana liczebników (1 / 2–4 / 5+).
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (n === 1) return one;
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
  return many;
}

function greetingFor(now: number): string {
  const h = new Date(now).getHours();
  return h < 12 ? "Dzień dobry" : h < 18 ? "Dobre popołudnie" : "Dobry wieczór";
}

/** Złóż przegląd dnia z danych. Czysta funkcja — `now`/`userName` wstrzykiwane (testy). */
export function buildDailyBriefing(data: BriefingData, now = Date.now(), userName = ""): DailyBriefing {
  const today = new Date(now).toISOString().slice(0, 10);
  const nowIso = new Date(now).toISOString();
  const active = (data.tasks || []).filter((t) => !t.done);

  const topTasks = active
    .filter((t) => t.priority || (t.due && t.due.slice(0, 10) === today))
    .sort((a, b) => Number(b.priority || false) - Number(a.priority || false) || (a.due || "").localeCompare(b.due || ""))
    .slice(0, 5);

  const overdueTasks = active.filter((t) => t.due && t.due.slice(0, 10) < today);
  const overdueReminders = (data.reminders || []).filter((r) => !r.fired && r.at < nowIso);
  const stale = staleTasks(active, now); // zalegające > 3 dni

  const projectsNeedingAttention = (data.projects || [])
    .map((project) => {
      const ptasks = active.filter((t) => t.projectId === project.id);
      const staleCount = ptasks.filter(
        (t) => stale.some((s) => s.id === t.id) || (t.due && t.due.slice(0, 10) < today),
      ).length;
      return { project, pending: ptasks.length, stale: staleCount };
    })
    .filter((x) => x.stale > 0)
    .sort((a, b) => b.stale - a.stale)
    .slice(0, 3);

  const todayEvents = (data.events || [])
    .filter((e) => e.start.slice(0, 10) === today)
    .sort((a, b) => a.start.localeCompare(b.start));

  const recommendations: string[] = [];
  if (topTasks[0]) recommendations.push(`Zacznij od: „${topTasks[0].title}".`);
  if (overdueTasks.length)
    recommendations.push(
      `Przejrzyj ${overdueTasks.length} ${plural(overdueTasks.length, "zaległe zadanie", "zaległe zadania", "zaległych zadań")} — przełóż albo odpuść.`,
    );
  if (projectsNeedingAttention[0])
    recommendations.push(`Projekt „${projectsNeedingAttention[0].project.name}" wymaga uwagi (${projectsNeedingAttention[0].stale} zaległych).`);
  if (overdueReminders.length)
    recommendations.push(
      `Masz ${overdueReminders.length} ${plural(overdueReminders.length, "zaległe przypomnienie", "zaległe przypomnienia", "zaległych przypomnień")}.`,
    );
  if (!recommendations.length && !active.length)
    recommendations.push("Wszystko ogarnięte — zaplanuj coś nowego albo odpocznij.");

  const empty =
    !topTasks.length &&
    !overdueTasks.length &&
    !overdueReminders.length &&
    !todayEvents.length &&
    !projectsNeedingAttention.length;

  return {
    greeting: greetingFor(now) + (userName ? `, ${userName}` : ""),
    todayEvents,
    topTasks,
    overdueTasks,
    overdueReminders,
    projectsNeedingAttention,
    recommendations,
    empty,
  };
}

/** Narracja przeglądu (do czatu/TTS). Czysta. */
export function briefingToText(b: DailyBriefing): string {
  if (b.empty) return `${b.greeting}. Nic pilnego na dziś — czysto. Miłego dnia.`;
  const lines: string[] = [`${b.greeting}. Oto Twój przegląd dnia.`];
  if (b.todayEvents.length) lines.push(`📅 Dziś w kalendarzu: ${b.todayEvents.map((e) => e.title).slice(0, 6).join(", ")}.`);
  if (b.topTasks.length) lines.push(`⭐ Priorytety: ${b.topTasks.map((t) => t.title).join(", ")}.`);
  if (b.overdueTasks.length)
    lines.push(`⏳ Zaległe zadania (${b.overdueTasks.length}): ${b.overdueTasks.map((t) => t.title).slice(0, 5).join(", ")}.`);
  if (b.overdueReminders.length) lines.push(`🔔 Zaległe przypomnienia: ${b.overdueReminders.length}.`);
  if (b.projectsNeedingAttention.length)
    lines.push(`📂 Projekty wymagające uwagi: ${b.projectsNeedingAttention.map((p) => `${p.project.name} (${p.stale})`).join(", ")}.`);
  if (b.recommendations.length) lines.push(`✅ Rekomendacje: ${b.recommendations.join(" ")}`);
  return lines.join("\n");
}
