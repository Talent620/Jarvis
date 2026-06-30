// === Zbieranie kandydatów do kuratora kontekstu ===
// Pure: z DANYCH systemu (pamięć, leady, finanse, projekty, kalendarz, zadania, przypomnienia,
// cele) buduje listę ContextItem — każdy z ŹRÓDŁEM, CZASEM i WAŻNOŚCIĄ. Kurator (contextCurator)
// dopiero potem ocenia trafność do pytania, dedupuje i przycina do budżetu. Tu NIE oceniamy
// trafności ani nie wysyłamy nic do modelu — tylko zbieramy. S9-safe (bez /u, \p, lookbehind).

import type { ContextItem } from "./contextCurator";
import type { Lead, Project, FinanceProject, CalendarEvent, Task, Reminder, MemoryFact } from "../types";

export interface GatherInput {
  now: number;
  /** Curated fakty profilu Marcina (np. „zajmuje się stronami WWW"). */
  profileFacts?: { text: string; at?: number; key?: string; importance?: number }[];
  memory?: MemoryFact[];
  leads?: Lead[];
  projects?: Project[];
  finance?: FinanceProject[];
  calendar?: CalendarEvent[];
  tasks?: Task[];
  reminders?: Reminder[];
  /** Aktywne cele (Cognitive OS Task 4+) — najwyższa ważność. */
  goals?: { text: string; at?: number; key?: string; importance?: number }[];
  /** Ile pozycji maksymalnie z każdego źródła (bound pracy; kurator i tak wybiera najlepsze). */
  perSource?: number;
}

const tparse = (iso?: string): number => {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
};
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

// Najświeższe N z listy (po znaczniku czasu malejąco) — bounduje pracę zbierania.
function topByRecency<T>(arr: T[] | undefined, atOf: (x: T) => number, n: number): T[] {
  return [...(arr || [])].sort((a, b) => atOf(b) - atOf(a)).slice(0, n);
}

/**
 * Pure: zbierz kandydatów kontekstu z danych systemu. Każdy fakt dostaje źródło, czas i ważność.
 * Nic nie filtrujemy po trafności (to robi kurator) — tylko mapujemy struktury na ContextItem.
 */
export function gatherContextCandidates(input: GatherInput): ContextItem[] {
  const now = input.now;
  const N = input.perSource ?? 10;
  const out: ContextItem[] = [];

  for (const g of input.goals || []) {
    if (!g.text?.trim()) continue;
    out.push({ text: g.text.trim(), source: "cel", at: g.at ?? now, importance: g.importance ?? 0.95, key: g.key });
  }

  for (const p of input.profileFacts || []) {
    if (!p.text?.trim()) continue;
    out.push({ text: p.text.trim(), source: "profil", at: p.at ?? now, importance: p.importance ?? 0.9, key: p.key });
  }

  for (const m of topByRecency(input.memory, (x) => x.lastUsedAt || x.createdAt || 0, N)) {
    const value = (m.value || "").trim();
    if (!value) continue;
    out.push({
      text: clip(`${m.key ? `${m.key}: ` : ""}${value}`, 240),
      source: "pamięć",
      at: m.lastUsedAt || m.createdAt || now,
      importance: m.pinned ? 0.9 : 0.6,
      key: m.key ? `mem:${m.key.toLowerCase()}` : undefined,
    });
  }

  for (const l of topByRecency(input.leads, (x) => x.updatedAt || x.createdAt || 0, N)) {
    const company = (l.company || "").trim();
    if (!company) continue;
    const bits = [company];
    if (l.status) bits.push(`status: ${l.status}`);
    if (typeof l.value === "number" && l.value > 0) bits.push(`~${l.value} zł`);
    const lastNote = l.notes && l.notes.length ? l.notes[l.notes.length - 1]?.text : l.note;
    if (lastNote) bits.push(clip(lastNote, 120));
    // Aktywne leady (w kontakcie / z ofertą / ponaglane) ważniejsze niż „nowy"/odrzucony.
    const hot = l.status === "contacted" || l.status === "offer" || (l.followUpCount || 0) > 0;
    out.push({ text: clip(bits.join(" — "), 240), source: `lead:${company}`, at: l.updatedAt || l.createdAt || now, importance: hot ? 0.85 : 0.6 });
  }

  for (const p of topByRecency(input.projects, (x) => x.updatedAt || x.createdAt || 0, N)) {
    const name = (p.name || "").trim();
    if (!name) continue;
    const text = p.instructions?.trim() ? `Projekt: ${name} — ${clip(p.instructions.trim(), 160)}` : `Projekt: ${name}`;
    out.push({ text, source: `projekt:${name}`, at: p.updatedAt || p.createdAt || now, importance: 0.7 });
  }

  for (const f of topByRecency(input.finance, (x) => x.updatedAt || x.paidAt || x.createdAt || 0, N)) {
    const name = (f.name || "").trim();
    if (!name) continue;
    const bits = [`Zlecenie: ${name}`];
    if (f.client) bits.push(`klient: ${f.client}`);
    bits.push(`${f.amount} zł`, `status: ${f.status}`);
    if (typeof f.paidAmount === "number" && f.paidAmount > 0) bits.push(`wpłacono ${f.paidAmount} zł`);
    out.push({ text: clip(bits.join(", "), 240), source: "finanse", at: f.updatedAt || f.paidAt || f.createdAt || now, importance: 0.8 });
  }

  for (const e of topByRecency(input.calendar, (x) => tparse(x.start) || x.createdAt || 0, N)) {
    const title = (e.title || "").trim();
    if (!title) continue;
    out.push({ text: clip(`Wydarzenie: ${title}${e.start ? ` (${e.start})` : ""}`, 200), source: "kalendarz", at: tparse(e.start) || e.createdAt || now, importance: 0.7 });
  }

  for (const t of topByRecency((input.tasks || []).filter((x) => !x.done), (x) => x.createdAt || 0, N)) {
    const title = (t.title || "").trim();
    if (!title) continue;
    out.push({ text: clip(`Zadanie: ${title}${t.due ? ` (termin ${t.due})` : ""}`, 200), source: "zadania", at: t.createdAt || now, importance: t.priority ? 0.75 : 0.55 });
  }

  for (const r of topByRecency((input.reminders || []).filter((x) => !x.fired), (x) => tparse(x.at) || x.createdAt || 0, N)) {
    const text = (r.text || "").trim();
    if (!text) continue;
    out.push({ text: clip(`Przypomnienie: ${text}${r.at ? ` (${r.at})` : ""}`, 200), source: "przypomnienia", at: tparse(r.at) || r.createdAt || now, importance: 0.65 });
  }

  return out;
}
