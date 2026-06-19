// Szósty Zmysł (Context Fusion Engine) — daje JARVIS-owi ŚWIADOMOŚĆ SYTUACYJNĄ.
// Z istniejących danych (zadania, przypomnienia, projekty, leady, kalendarz) i pamięci
// epizodycznej (porzucone tematy) składa „otwarte wątki", rankuje je względem BIEŻĄCEJ
// prośby i podaje modelowi do wplecenia — najwyżej jeden, naturalnie. Zero UI, zero
// konfiguracji, zero dodatkowych kliknięć. Czysta logika → w pełni testowalna.

import type { Task, Reminder, Project, Lead, CalendarEvent } from "../types";
import type { Episode } from "./episodicMemory";
import { staleRecurringTopics } from "./episodicMemory";

export type SignalKind =
  | "event_soon"
  | "reminder_overdue"
  | "lead_stale"
  | "task_overdue"
  | "project_attention"
  | "lead_ready"
  | "topic_recurring";

export interface Signal {
  id: string;
  kind: SignalKind;
  /** Gotowa fraza do promptu („Lead „X" — kontakt 4 dni temu, brak ruchu."). */
  text: string;
  /** Kluczowy rzeczownik (firma/tytuł/temat) — do dopasowania do zapytania. */
  entity: string;
  /** Bazowa waga pilności 0..1. */
  urgency: number;
}

export interface FusionInput {
  tasks: Task[];
  reminders: Reminder[];
  projects: Project[];
  leads: Lead[];
  events: CalendarEvent[];
  episodes: Episode[];
}

const DAY = 86_400_000;

function daysAgo(ts: number, now: number): number {
  return Math.floor((now - ts) / DAY);
}

/** Zbierz „otwarte wątki" z całego stanu. Czysta — wszystko wstrzykiwane. */
export function gatherSignals(input: FusionInput, now = Date.now()): Signal[] {
  const out: Signal[] = [];
  const today = new Date(now).toISOString().slice(0, 10);
  const nowIso = new Date(now).toISOString();

  // Najbliższe wydarzenie (≤ 2 h) — najwyższa pilność.
  for (const e of input.events || []) {
    const t = Date.parse(e.start);
    if (Number.isFinite(t) && t >= now && t - now <= 2 * 3600_000) {
      const hhmm = new Date(t).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
      out.push({ id: "event:" + e.id, kind: "event_soon", entity: e.title, urgency: 0.9, text: `Za chwilę (${hhmm}): „${e.title}".` });
    }
  }

  // Zaległe przypomnienia.
  for (const r of input.reminders || []) {
    if (!r.fired && r.at < nowIso) {
      out.push({ id: "rem:" + r.id, kind: "reminder_overdue", entity: r.text, urgency: 0.82, text: `Zaległe przypomnienie: „${r.text}".` });
    }
  }

  // Leady „w toku" bez ruchu (kontakt/oferta) — klasyczny otwarty wątek sprzedażowy.
  for (const l of input.leads || []) {
    if ((l.status === "contacted" || l.status === "offer") && l.lastContactedAt) {
      const d = daysAgo(l.lastContactedAt, now);
      if (d >= 3) {
        const worth = l.value ? ` (wart ~${l.value} zł)` : "";
        const fu = l.followUpCount ? ` po ${l.followUpCount} ponagleniach` : "";
        out.push({
          id: "lead:" + l.id,
          kind: "lead_stale",
          entity: l.company,
          urgency: Math.min(0.95, 0.7 + (l.value ? 0.15 : 0) + Math.min(0.1, d / 100)),
          text: `Lead „${l.company}" — kontakt ${d} dni temu, brak ruchu${fu}${worth}.`,
        });
      }
    }
    // Lead z gotową ofertą, ale jeszcze bez kontaktu — „gorący", czeka na ruch.
    if (l.status === "new" && (l.offer || l.value)) {
      out.push({ id: "leadready:" + l.id, kind: "lead_ready", entity: l.company, urgency: 0.55, text: `Lead „${l.company}" jest gotowy do kontaktu${l.offer ? " (oferta napisana)" : ""}.` });
    }
  }

  // Zaległe zadania (termin minął), priorytet podbija wagę.
  const activeTasks = (input.tasks || []).filter((t) => !t.done);
  for (const t of activeTasks) {
    if (t.due && t.due.slice(0, 10) < today) {
      out.push({ id: "task:" + t.id, kind: "task_overdue", entity: t.title, urgency: t.priority ? 0.8 : 0.65, text: `Zaległe zadanie: „${t.title}" (termin minął).` });
    }
  }

  // Projekty z zaległościami.
  for (const p of input.projects || []) {
    const stale = activeTasks.filter((t) => t.projectId === p.id && t.due && t.due.slice(0, 10) < today).length;
    if (stale > 0) {
      out.push({ id: "proj:" + p.id, kind: "project_attention", entity: p.name, urgency: 0.6, text: `Projekt „${p.name}" ma ${stale} zaległych ${stale === 1 ? "zadanie" : "zadań"}.` });
    }
  }

  // Powracający, ostatnio porzucony temat (pamięć epizodyczna).
  for (const topic of staleRecurringTopics(input.episodes || [], now)) {
    out.push({ id: "topic:" + topic, kind: "topic_recurring", entity: topic, urgency: 0.5, text: `Wracałeś do tematu „${topic}", ale nie ostatnio.` });
  }

  return out;
}

// Tokenizacja PL do dopasowania trafności (bez interpunkcji, krótkie słowa odpadają).
function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[„"".,!?:;()\-—]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/** Trafność sygnału do zapytania (0..1): pokrycie tokenów encji z tokenami pytania. */
export function relevance(signal: Signal, query: string): number {
  const q = new Set(tokens(query));
  if (!q.size) return 0;
  const ent = tokens(signal.entity);
  if (!ent.length) return 0;
  let hit = 0;
  for (const w of ent) {
    if (q.has(w)) hit += 1;
    else if ([...q].some((x) => x.includes(w) || w.includes(x))) hit += 0.5;
  }
  return Math.min(1, hit / ent.length);
}

export interface RankedSignal extends Signal {
  score: number;
  rel: number;
}

/** Posortuj sygnały: trafność do zapytania waży najwięcej, pilność dopełnia. */
export function rankSignals(signals: Signal[], query: string): RankedSignal[] {
  return signals
    .map((s) => {
      const rel = relevance(s, query);
      return { ...s, rel, score: rel * 1.5 + s.urgency };
    })
    .sort((a, b) => b.score - a.score);
}

export interface Fusion {
  /** Blok świadomości sytuacyjnej do systemPrompt (pusty, gdy brak sygnałów). */
  awareness: string;
  /** Najtrafniejsze „połączenie" do wplecenia (lub null — wtedy nie naciskamy). */
  connection: RankedSignal | null;
}

const MAX_AWARENESS = 5;
// Próg pewności: pokażemy „połączenie" tylko, gdy realnie pasuje do prośby
// (rel > 0) ALBO gdy to bardzo pilny otwarty wątek przy „otwierającym" pytaniu.
const CONNECT_REL = 0.34;

/** Zbuduj fuzję kontekstu dla bieżącego zapytania. Czysta. */
export function fuseContext(input: FusionInput, query: string, now = Date.now()): Fusion {
  const ranked = rankSignals(gatherSignals(input, now), query);
  if (!ranked.length) return { awareness: "", connection: null };

  const top = ranked.slice(0, MAX_AWARENESS);
  const lines = top.map((s) => `- ${s.text}`).join("\n");

  const best = ranked[0];
  const opening = tokens(query).length <= 2; // krótka/otwierająca prośba → wolno zaproponować
  const connection = best.rel >= CONNECT_REL || (opening && best.urgency >= 0.8) ? best : null;

  let awareness =
    "\n\n🧭 Świadomość sytuacyjna (Twoje otwarte wątki). Wykorzystaj je TYLKO jeśli pasują do bieżącej " +
    "prośby; wpleć najwyżej JEDNĄ rzecz naturalnie (jak troskliwy szef sztabu), nie wypisuj listy:\n" +
    lines;
  if (connection) {
    awareness += `\n\nNajtrafniejsze teraz: ${connection.text} Jeśli to pasuje do prośby, delikatnie o tym wspomnij na końcu.`;
  }

  return { awareness, connection };
}

/** Gotowy blok do promptu (skrót). */
export function buildFusionBlock(input: FusionInput, query: string, now = Date.now()): string {
  return fuseContext(input, query, now).awareness;
}
