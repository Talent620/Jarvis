// === Living Pulse — „nigdy identyczne otwarcie" (warstwa żywej inteligencji) ===
// CZYSTY, klient-side. Z REALNYCH danych użytkownika (zadania, leady, wysłane maile, rytm dnia)
// składa krótki, trafny „puls" przy każdym otwarciu — przewiduje, co warto zrobić TERAZ, i NIE
// powtarza poprzedniego (rotacja). To nie chatbot: aplikacja ma za każdym razem wnosić nową wartość.
// Nieinwazyjne: tylko czyta dane, niczego nie zmienia. S9-safe.

import type { AppData } from "../types";

export interface Pulse {
  key: string; // identyfikator kąta (do anty-powtórki)
  text: string; // gotowa linia do pokazania
  tone: "uwaga" | "okazja" | "sukces" | "rytm"; // do kolorowania/ikon w UI
}

const DAY = 86_400_000;

function sameDay(at: number, now: number): boolean {
  const a = new Date(at), b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Pure: pora dnia (rytm) — bazowy puls zawsze dostępny. */
export function partOfDay(now: number): "rano" | "południe" | "popołudnie" | "wieczór" | "noc" {
  const h = new Date(now).getHours();
  if (h < 6) return "noc";
  if (h < 11) return "rano";
  if (h < 14) return "południe";
  if (h < 18) return "popołudnie";
  return "wieczór";
}

/** Pure: zbuduj listę kandydatów-pulsów z realnych danych (najpierw to, co pilne/wartościowe). */
export function pulseCandidates(d: AppData, now: number): Pulse[] {
  const out: Pulse[] = [];
  const tasks = d.tasks || [];
  const leads = d.leads || [];

  const overdue = tasks.filter((t) => !t.done && t.due && new Date(t.due).getTime() < now && !sameDay(new Date(t.due).getTime(), now));
  const dueToday = tasks.filter((t) => !t.done && t.due && sameDay(new Date(t.due).getTime(), now));
  const focus = tasks.filter((t) => !t.done && t.priority);
  const staleLeads = leads.filter((l) => {
    const s = l.status;
    const last = l.lastContactedAt || 0;
    return (s === "contacted" || s === "offer") && last > 0 && now - last > 3 * DAY;
  });
  const sentToday = (d.sentMail || []).filter((m) => sameDay(m.at, now)).length;
  const openLeads = leads.filter((l) => l.status === "new").length;

  if (overdue.length) out.push({ key: "overdue", tone: "uwaga", text: `⏰ Masz ${overdue.length} ${overdue.length === 1 ? "zadanie" : "zadań"} po terminie. Przełożyć je mądrze na dziś?` });
  if (dueToday.length) out.push({ key: "today", tone: "uwaga", text: `📌 Na dziś zaplanowane ${dueToday.length} ${dueToday.length === 1 ? "zadanie" : "zadań"} z terminem — zacząć od najważniejszego?` });
  if (focus.length) out.push({ key: "focus", tone: "rytm", text: `🎯 ${focus.length} ${focus.length === 1 ? "rzecz" : "rzeczy"} na priorytecie. Mam ułożyć z tego plan na teraz?` });
  if (staleLeads.length) out.push({ key: "leadsStale", tone: "okazja", text: `📈 ${staleLeads.length} ${staleLeads.length === 1 ? "lead czeka" : "leadów czeka"} na follow-up ponad 3 dni — napisać im teraz?` });
  if (openLeads) out.push({ key: "leadsNew", tone: "okazja", text: `🆕 ${openLeads} ${openLeads === 1 ? "nowy lead" : "nowych leadów"} bez pierwszego kontaktu. Przygotować oferty?` });
  if (sentToday) out.push({ key: "win", tone: "sukces", text: `✅ Dziś poszło ${sentToday} ${sentToday === 1 ? "mail" : "maili"} — dobre tempo. Dorzucić kolejne, póki jest rozpęd?` });

  // Bazowy puls rytmu — zawsze dostępny, żeby nigdy nie było pusto.
  const pod = partOfDay(now);
  const rhythm: Record<string, string> = {
    rano: "☀️ Świeży początek dnia. Zrobić odprawę i wybrać 3 rzeczy, które dziś realnie ruszą do przodu?",
    południe: "🕛 Środek dnia — dobry moment na szybki przegląd: co już zrobione, co zostało?",
    popołudnie: "🌤️ Popołudnie. Domknąć jedną ważną rzecz, zanim energia spadnie?",
    wieczór: "🌙 Wieczór. Podsumować dzień i przygotować jutro, żeby ranek był łatwy?",
    noc: "🌌 Późno. Zrzucić myśli z głowy (notatka/zadanie), żeby spokojnie odpocząć?",
  };
  out.push({ key: `rhythm-${pod}`, tone: "rytm", text: rhythm[pod] });
  return out;
}

/**
 * Pure: wybierz JEDEN puls na to otwarcie. Pomija ostatnio pokazany (anty-powtórka),
 * a wśród reszty rotuje wg czasu — dzięki temu kolejne otwarcia są różne i świeże.
 */
export function livingPulse(d: AppData, now = Date.now(), lastKey?: string): Pulse | null {
  const cands = pulseCandidates(d, now);
  if (!cands.length) return null;
  const pool = cands.filter((c) => c.key !== lastKey);
  const list = pool.length ? pool : cands;
  // Rotacja: indeks zmienny w czasie (co kilka minut inny kąt), deterministyczny dla testów.
  const idx = Math.floor(now / 300_000) % list.length;
  return list[idx];
}
