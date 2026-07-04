// === Nawyk: streak + tygodniowy recap (zmienna nagroda + WIDOCZNA inwestycja) ===
// Research: ludzie zostają, gdy widzą, że inwestycja procentuje, i gdy mają „serię". Rdzeń czysty
// i testowalny; cienkie wrappery czytają store i zapisują dni aktywności.
import { store } from "./store";
import { loadJson, saveJson } from "./lsJson";

const DAY = 86_400_000;

/** Pure: lokalny klucz dnia YYYY-MM-DD. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pure: długość SERII kolejnych dni aktywności, kończącej się DZIŚ lub WCZORAJ (żeby seria nie
 * zerowała się przed dzisiejszym wejściem). `days` = zbiór kluczy "YYYY-MM-DD".
 */
export function computeStreak(days: Set<string> | string[], now: number): number {
  const set = days instanceof Set ? days : new Set(days);
  if (!set.size) return 0;
  let cursor = set.has(dayKey(now)) ? now : now - DAY; // start od dziś, inaczej od wczoraj
  let streak = 0;
  while (set.has(dayKey(cursor))) { streak++; cursor -= DAY; }
  return streak;
}

export interface RecapInput {
  now: number;
  facts: { createdAt: number }[];
  tasks: { createdAt: number; done: boolean }[];
  journal: { createdAt: number }[];
  leads: { createdAt: number }[];
}
export interface Recap {
  newFacts: number; totalFacts: number;
  newTasks: number; newJournal: number; newLeads: number;
  line: string;
}

/** Pure: podsumowanie ostatnich 7 dni + ile JARVIS wie o Tobie łącznie (moat: rosnąca inwestycja). */
export function weeklyRecap(input: RecapInput): Recap {
  const since = input.now - 7 * DAY;
  const inWeek = (arr: { createdAt: number }[]) => arr.filter((x) => x.createdAt >= since).length;
  const newFacts = inWeek(input.facts);
  const newJournal = inWeek(input.journal);
  const newLeads = inWeek(input.leads);
  const newTasks = inWeek(input.tasks);
  const totalFacts = input.facts.length;

  const bits: string[] = [];
  if (newFacts) bits.push(`${newFacts} ${newFacts === 1 ? "nowa rzecz o Tobie" : "nowych rzeczy o Tobie"}`);
  if (newTasks) bits.push(`${newTasks} ${newTasks === 1 ? "zadanie" : "zadań"}`);
  if (newJournal) bits.push(`${newJournal} ${newJournal === 1 ? "wpis w dzienniku" : "wpisów w dzienniku"}`);
  if (newLeads) bits.push(`${newLeads} ${newLeads === 1 ? "lead" : "leadów"}`);
  const head = bits.length ? `📈 Ten tydzień: ${bits.slice(0, 3).join(" · ")}.` : "";
  const tail = totalFacts ? ` Wiem o Tobie już ${totalFacts} ${totalFacts === 1 ? "rzecz" : totalFacts < 5 ? "rzeczy" : "rzeczy"}.` : "";
  return { newFacts, totalFacts, newTasks, newJournal, newLeads, line: (head + tail).trim() };
}

// --- Wrappery (store + trwała lista dni aktywności) ---
const DAYS_KEY = "jarvis.habit.days.v1";
function loadDays(): string[] {
  return loadJson<string[]>(DAYS_KEY, []);
}

/** Zapisz dzisiejszy dzień jako aktywny (wywołać przy starcie). Trzyma ostatnie ~90 dni. */
export function recordActiveDay(now = Date.now()): void {
  const set = new Set(loadDays());
  const k = dayKey(now);
  if (set.has(k)) return;
  set.add(k);
  saveJson(DAYS_KEY, [...set].slice(-90));
}

/** Aktualna seria dni (do plakietki „🔥 N dni z rzędu"). */
export function currentStreak(now = Date.now()): number {
  return computeStreak(loadDays(), now);
}

/** Recap z bieżących danych store. */
export function currentRecap(now = Date.now()): Recap {
  const d = store.data;
  return weeklyRecap({
    now,
    facts: d.memory || [],
    tasks: d.tasks || [],
    journal: d.journal || [],
    leads: d.leads || [],
  });
}
