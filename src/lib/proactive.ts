import { store } from "./store";
import { loadJson, saveJson } from "./lsJson";
import { dueReminders } from "./notifyCenter";
import { followUpsDue } from "./salesEngine";
import { dueCount } from "./cards";

// === Proaktywny Agent ===
// JARVIS sam odzywa się we właściwym momencie — nie czeka na polecenie. Czysta,
// testowalna logika: na podstawie stanu (przypomnienia po terminie, wydarzenia za
// chwilę, follow-upy, zadania na dziś, fiszki) wybiera JEDEN najważniejszy „szturchaniec".
// Anty-spam: każdy rodzaj pokazujemy najwyżej raz na swój „cooldown".

export type NudgeKind = "reminders" | "event" | "followups" | "tasks" | "cards" | "predictions";
export type NudgeScreen = "panels" | "sales" | "cards" | "tasks";

export interface Nudge {
  kind: NudgeKind;
  text: string;
  /** Ekran do otwarcia po kliknięciu akcji w powiadomieniu. */
  screen?: NudgeScreen;
  /** Czy wypowiedzieć na głos (tylko najpilniejsze). */
  speak?: boolean;
}

// Jak często wolno powtórzyć dany rodzaj (ms). Pilne — częściej, „miłe" — rzadziej.
const COOLDOWN: Record<NudgeKind, number> = {
  reminders: 30 * 60_000,       // 30 min
  event: 10 * 60_000,           // 10 min
  followups: 4 * 60 * 60_000,   // 4 h
  tasks: 3 * 60 * 60_000,       // 3 h
  cards: 6 * 60 * 60_000,       // 6 h
  predictions: 6 * 60 * 60_000, // 6 h — prognozy nie mogą stać się spamem
};

// TRWAŁY stan „kiedy pokazano dany szturchaniec" — kluczowe: wcześniej był w PAMIĘCI, więc po
// każdym otwarciu aplikacji cooldown się zerował i ten sam nudge („Masz 35 zadań") dosypywał się
// do zapisanej rozmowy raz za razem. Teraz trzymamy go w localStorage → cooldown przeżywa restart.
const SHOWN_KEY = "jarvis.proactive.shown.v1";
const lastShown = new Map<NudgeKind, number>(loadJson<[NudgeKind, number][]>(SHOWN_KEY, []));
function persistShown(): void { saveJson(SHOWN_KEY, [...lastShown.entries()]); }

export function recentlyShown(kind: NudgeKind, now = Date.now()): boolean {
  const t = lastShown.get(kind);
  return !!t && now - t < COOLDOWN[kind];
}
export function markShown(kind: NudgeKind, now = Date.now()): void {
  lastShown.set(kind, now);
  persistShown();
}
/** Wyłącz dany rodzaj na jego pełny cooldown (np. po „Później"). */
export function snooze(kind: NudgeKind, now = Date.now()): void {
  markShown(kind, now);
}
/** Reset (do testów i po wyczyszczeniu sesji). */
export function resetProactive(): void {
  lastShown.clear();
  persistShown();
}

const todayISO = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Najbliższe wydarzenie z kalendarza w oknie [now, now + okno]. */
function upcomingEvent(now: number, windowMs = 60 * 60_000): { title: string; minutes: number } | null {
  const soon = (store.data.calendar || [])
    .map((e) => ({ title: e.title, t: new Date(e.start).getTime() }))
    .filter((e) => !isNaN(e.t) && e.t > now && e.t - now <= windowMs)
    .sort((a, b) => a.t - b.t)[0];
  return soon ? { title: soon.title, minutes: Math.max(1, Math.round((soon.t - now) / 60_000)) } : null;
}

/**
 * Wybierz JEDEN proaktywny szturchaniec na teraz (albo null). Kolejność = priorytet:
 * przypomnienia po terminie → wydarzenie za chwilę → follow-upy → zadania na dziś → fiszki.
 * Pomija rodzaje pokazane niedawno (anty-spam).
 */
export function nextNudge(now = Date.now()): Nudge | null {
  const s = store.settings;
  if (s.proactiveAgent === false) return null;
  const d = store.data;

  // 1) Przypomnienia po terminie — najpilniejsze.
  const rem = dueReminders(now);
  if (rem.length && !recentlyShown("reminders", now)) {
    const sample = rem.slice(0, 2).map((r) => r.text).join("; ");
    return { kind: "reminders", screen: "panels", speak: true,
      text: `⏰ Masz ${rem.length} ${rem.length === 1 ? "przypomnienie" : "przypomnienia"} po terminie: ${sample}${rem.length > 2 ? "…" : "."}` };
  }

  // 2) Wydarzenie w ciągu godziny.
  const ev = upcomingEvent(now);
  if (ev && !recentlyShown("event", now)) {
    return { kind: "event", screen: "panels", speak: true,
      text: `🗓 Za ${ev.minutes} min: „${ev.title}". Przygotować Cię?` };
  }

  // 3) Follow-upy w sprzedaży.
  const fups = followUpsDue(d.leads || [], now);
  if (fups.length && !recentlyShown("followups", now)) {
    return { kind: "followups", screen: "sales",
      text: `🔁 ${fups.length} ${fups.length === 1 ? "klient czeka" : "klientów czeka"} na follow-up. Przygotować wiadomości?` };
  }

  // 3.5) Dziennik Predykcji: świeżo SPRAWDZONE ostrzeżenie (przerwa faktycznie się pogłębiła)
  // albo świeża prognoza — użytkownik widzi je bez otwierania teczki klienta. Jedno naraz,
  // twardy cooldown; jasno nazwane prognozą (nie faktem).
  const DAY_MS = 86_400_000;
  const preds = d.predictionLedger || [];
  const freshCorrect = preds.find((r) => r.evidence && r.evidence.verdict === "correct" && r.evidence.disputedAt == null && now - r.evidence.observedAt <= DAY_MS);
  const freshPending = preds.find((r) => !r.evidence && now - r.madeAt <= DAY_MS);
  if ((freshCorrect || freshPending) && !recentlyShown("predictions", now)) {
    if (freshCorrect) {
      return { kind: "predictions", screen: "sales",
        text: `🔮 Moje ostrzeżenie o „${freshCorrect.entityLabel}” się sprawdziło: ${freshCorrect.evidence!.outcome} Chcesz, żebym przygotował wiadomość?` };
    }
    const p = freshPending!;
    return { kind: "predictions", screen: "sales",
      text: `🔮 Nowa prognoza (pewność ${Math.round(p.confidence * 100)}%): ${p.claim} Sprawdzę ją ${new Date(p.checkAt).toLocaleDateString("pl-PL")} — to prognoza, nie fakt.` };
  }

  // 4) Zadania na dziś / zaległe.
  const today = todayISO(now);
  const tasksToday = (d.tasks || []).filter((t) => !t.done && t.due && t.due.slice(0, 10) <= today);
  if (tasksToday.length && !recentlyShown("tasks", now)) {
    const sample = tasksToday.length <= 2 ? `: ${tasksToday.map((t) => t.title).join(", ")}` : "";
    return { kind: "tasks", screen: "tasks",
      text: `✅ Masz ${tasksToday.length} ${tasksToday.length === 1 ? "zadanie" : "zadań"} na dziś${sample}.` };
  }

  // 5) Fiszki do powtórki.
  const cards = dueCount(now);
  if (cards && !recentlyShown("cards", now)) {
    return { kind: "cards", screen: "cards",
      text: `🧠 ${cards} ${cards === 1 ? "fiszka" : "fiszek"} do powtórki — 2 minuty teraz dużo dają.` };
  }

  return null;
}
