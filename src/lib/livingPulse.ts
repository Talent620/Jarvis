// === Living Pulse — „nigdy identyczne otwarcie" (warstwa żywej inteligencji) ===
// CZYSTY, klient-side. Z REALNYCH danych użytkownika (zadania, leady, wysłane maile, rytm dnia)
// składa krótki, trafny „puls" przy każdym otwarciu — przewiduje, co warto zrobić TERAZ, i NIE
// powtarza poprzedniego (rotacja). To nie chatbot: aplikacja ma za każdym razem wnosić nową wartość.
// Nieinwazyjne: tylko czyta dane, niczego nie zmienia. S9-safe.

import type { AppData } from "../types";

/** Jedna najlepsza czynność „Teraz" — co, dlaczego, dokąd przejść, jak pilne/wartościowe. */
export interface ActionCard {
  id: string;
  what: string; // co zrobić (krótko)
  why: string; // dlaczego teraz
  screen: string; // id ekranu (navIntent) do otwarcia
  urgency: number; // 0–100
  value: number; // 0–100 (wartość biznesowa)
}

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
 * Pure: kandydaci na „jedną najlepszą czynność teraz" — z realnych danych, z oceną
 * pilności i wartości biznesowej. Rdzeń karty „Teraz" (#18). Reużywa sygnałów pulsu.
 */
export function actionCandidates(d: AppData, now: number): ActionCard[] {
  const out: ActionCard[] = [];
  const tasks = d.tasks || [];
  const leads = d.leads || [];
  const finance = d.financeProjects || [];

  const overdue = tasks.filter((t) => !t.done && t.due && new Date(t.due).getTime() < now && !sameDay(new Date(t.due).getTime(), now));
  const dueToday = tasks.filter((t) => !t.done && t.due && sameDay(new Date(t.due).getTime(), now));
  const staleLeads = leads.filter((l) => (l.status === "contacted" || l.status === "offer") && (l.lastContactedAt || 0) > 0 && now - (l.lastContactedAt || 0) > 3 * DAY);
  const newLeads = leads.filter((l) => l.status === "new");
  const awaitingPay = finance.filter((p) => p.status === "oczekuje_platnosci" && (p.amount || 0) > (p.paidAmount || 0));

  if (awaitingPay.length) {
    const sum = awaitingPay.reduce((s, p) => s + ((p.amount || 0) - (p.paidAmount || 0)), 0);
    out.push({ id: "pay", what: `Dopilnuj płatności (${awaitingPay.length})`, why: `Czeka ${Math.round(sum).toLocaleString("pl-PL")} zł do zapłaty — przypomnij klientom.`, screen: "finance", urgency: 70, value: 95 });
  }
  if (staleLeads.length) {
    out.push({ id: "leadsStale", what: `Odśwież ${staleLeads.length} ${staleLeads.length === 1 ? "leada" : "leadów"}`, why: "Czekają na follow-up ponad 3 dni — to one domykają sprzedaż.", screen: "sales", urgency: 65, value: 85 });
  }
  if (overdue.length) {
    out.push({ id: "overdue", what: `Rozprawić się z ${overdue.length} zaległ${overdue.length === 1 ? "ym zadaniem" : "ymi zadaniami"}`, why: "Po terminie — przełóż mądrze albo domknij teraz.", screen: "tasks", urgency: 90, value: 50 });
  }
  if (dueToday.length) {
    out.push({ id: "today", what: `Zacznij od ${dueToday.length} zada${dueToday.length === 1 ? "nia" : "ń"} na dziś`, why: "Mają dziś termin — zrób najważniejsze, póki jest energia.", screen: "tasks", urgency: 75, value: 55 });
  }
  if (newLeads.length) {
    out.push({ id: "leadsNew", what: `Zaczep ${newLeads.length} now${newLeads.length === 1 ? "y lead" : "ych leadów"}`, why: "Bez pierwszego kontaktu — przygotuj teczki i oferty.", screen: "sales", urgency: 45, value: 80 });
  }
  return out;
}

/**
 * Pure: JEDNA najlepsza czynność na teraz (ranking pilność+wartość). Pomija ostatnio
 * pokazaną (anty-powtórka), gdy są alternatywy. Zwraca null, gdy brak danych do działania
 * (UI pokazuje wtedy spokojny onboarding zamiast losowej aktywności).
 */
export function nextBestAction(d: AppData, now = Date.now(), lastId?: string): ActionCard | null {
  const cands = actionCandidates(d, now);
  if (!cands.length) return null;
  const score = (a: ActionCard) => a.urgency * 0.5 + a.value * 0.5;
  const ranked = [...cands].sort((a, b) => score(b) - score(a));
  const pool = ranked.filter((c) => c.id !== lastId);
  return (pool.length ? pool : ranked)[0];
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
