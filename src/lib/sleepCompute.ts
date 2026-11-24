// === Sprint 2 / Moduł 2: Nocny Sen (Sleep-Time Compute) + Budżet Ciszy ===
// Lekkie struktury pamięci: open_loops, user_lessons, proactive_budget.
// Czysta logika konsolidacji + bezpieczne helpery trwałości w store.data.
import type { CalendarEvent, Lead, OpenLoop, ProactiveBudgetState, Reminder, Task, UserLesson } from "../types";
import { store, uid } from "./store";

export const DEFAULT_PROACTIVE_BUDGET: ProactiveBudgetState = {
  date: "",
  usedToday: 0,
  dailyLimit: 3,
  quietStartHour: 22,
  quietEndHour: 7,
};

export interface SleepMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
}

export interface SleepConsolidateInput {
  messages?: SleepMessage[];
  existingOpenLoops?: OpenLoop[];
  existingLessons?: UserLesson[];
  budget?: ProactiveBudgetState;
  tasks?: Task[];
  calendar?: CalendarEvent[];
  reminders?: Reminder[];
  leads?: Lead[];
  now?: number;
}

export interface SleepConsolidateResult {
  date: string;
  open_loops: OpenLoop[];
  user_lessons: UserLesson[];
  proactive_budget: ProactiveBudgetState;
  daySummary: string;
  urgent: boolean;
  urgentReasons: string[];
  /** Krótki (<=30 s TTS) poranny briefing mówiony — NIEPustY wyłącznie gdy `urgent === true`. */
  spokenBriefing: string | null;
}

/** Pure: lokalny klucz dnia YYYY-MM-DD. */
export function localDayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Pure: czy dany timestamp wypada w godzinach ciszy nocnej (domyślnie 22:00–07:00). */
export function isQuietHours(now = Date.now(), startHour = 22, endHour = 7): boolean {
  const h = new Date(now).getHours();
  if (startHour === endHour) return false;
  if (startHour > endHour) {
    // Zakres przechodzący przez północ (np. 22:00 -> 07:00)
    return h >= startHour || h < endHour;
  }
  return h >= startHour && h < endHour;
}

/** Pure: znormalizuj Budżet Ciszy na bieżący dzień (reset licznika o północy). */
export function normalizeProactiveBudget(
  budget?: Partial<ProactiveBudgetState> | null,
  now = Date.now(),
): ProactiveBudgetState {
  const today = localDayKey(now);
  const dailyLimit =
    typeof budget?.dailyLimit === "number" && Number.isFinite(budget.dailyLimit) && budget.dailyLimit >= 0
      ? Math.floor(budget.dailyLimit)
      : DEFAULT_PROACTIVE_BUDGET.dailyLimit;
  const quietStartHour =
    typeof budget?.quietStartHour === "number" && budget.quietStartHour >= 0 && budget.quietStartHour <= 23
      ? Math.floor(budget.quietStartHour)
      : DEFAULT_PROACTIVE_BUDGET.quietStartHour;
  const quietEndHour =
    typeof budget?.quietEndHour === "number" && budget.quietEndHour >= 0 && budget.quietEndHour <= 23
      ? Math.floor(budget.quietEndHour)
      : DEFAULT_PROACTIVE_BUDGET.quietEndHour;
  const sameDay = budget?.date === today;
  const usedToday = sameDay && typeof budget?.usedToday === "number" && budget.usedToday >= 0
    ? Math.floor(budget.usedToday)
    : 0;
  return { date: today, usedToday, dailyLimit, quietStartHour, quietEndHour };
}

/** Pure: sprawdź, czy Budżet Ciszy pozwala na proaktywną zaczepkę teraz. */
export function canSendProactiveNudge(
  budget?: Partial<ProactiveBudgetState> | null,
  now = Date.now(),
): { allowed: boolean; reason: "ok" | "quiet_hours" | "budget_exhausted"; remaining: number } {
  const norm = normalizeProactiveBudget(budget, now);
  const remaining = Math.max(0, norm.dailyLimit - norm.usedToday);
  if (isQuietHours(now, norm.quietStartHour, norm.quietEndHour)) {
    return { allowed: false, reason: "quiet_hours", remaining };
  }
  if (remaining <= 0) {
    return { allowed: false, reason: "budget_exhausted", remaining: 0 };
  }
  return { allowed: true, reason: "ok", remaining };
}

/** Pure: zużyj `count` pozycji z dzisiejszego Budżetu Ciszy. */
export function consumeProactiveBudget(
  budget?: Partial<ProactiveBudgetState> | null,
  now = Date.now(),
  count = 1,
): ProactiveBudgetState {
  const norm = normalizeProactiveBudget(budget, now);
  const delta = Math.max(0, Math.floor(count));
  return { ...norm, usedToday: Math.min(norm.dailyLimit, norm.usedToday + delta) };
}

// --- user_lessons: automatyczne reguły stylu z korekt użytkownika i barge-in ---

const CORRECTION_RULES: Array<{ re: RegExp; rule: string; trigger: string }> = [
  {
    re: /(za d[łl]ug|za du[żz]o gadasz|kr[óo]cej|skr[óo][ćc]|streszczaj|mniej tekstu|do rzeczy)/i,
    rule: "Odpowiadaj maksymalnie zwięźle (1–2 zdania), bez zbędnego gadania.",
    trigger: "za długo / krócej",
  },
  {
    re: /(konkretniej|sam konkret|bez wst[ęe]p[óo]w|nie owijaj|bez lania wody|wprost)/i,
    rule: "Zero wstępów i uprzejmości — zacznij od razu od sedna lub gotowej komendy.",
    trigger: "konkretniej / bez wstępów",
  },
  {
    re: /(bez list|nie r[óo]b list|bez punktor|nie wypunktuj|normalnymi zdaniami)/i,
    rule: "Nie używaj list punktowanych — pisz naturalnymi, płynnymi zdaniami.",
    trigger: "bez list",
  },
  {
    re: /(nie s[łl][óo]d[źz]|nie chwal|bez lizus|szczerze|krytycznie)/i,
    rule: "Unikaj pochwał i przytakiwania — mów krytycznie, rzeczowo i wprost.",
    trigger: "bez lizusostwa",
  },
  {
    re: /(po polsku|m[óo]w po polsku|bez angielsk)/i,
    rule: "Trzymaj się czystej polszczyzny, unikaj zbędnych anglicyzmów.",
    trigger: "po polsku",
  },
];

/** Pure: wyciągnij krótką regułę stylu z korekty użytkownika lub przerwania (barge-in). */
export function extractUserLessonFromCorrection(
  text: string,
  opts: { wasBargeIn?: boolean; now?: number } = {},
): Omit<UserLesson, "id" | "hits"> | null {
  const now = opts.now ?? Date.now();
  const clean = (text || "").trim();
  for (const item of CORRECTION_RULES) {
    if (clean && item.re.test(clean)) {
      return {
        rule: item.rule,
        trigger: item.trigger,
        source: "correction",
        createdAt: now,
        updatedAt: now,
      };
    }
  }
  if (opts.wasBargeIn) {
    return {
      rule: "Mów krótszymi turami — użytkownik przerwał wypowiedź (barge-in).",
      trigger: "barge-in",
      source: "barge_in",
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

/** Pure: scal nowe lekcje stylu z istniejącymi (deduplikacja po treści reguły, licznik hits). */
export function mergeUserLessons(
  existing: UserLesson[],
  incoming: Array<Omit<UserLesson, "id" | "hits">>,
  now = Date.now(),
): UserLesson[] {
  const map = new Map<string, UserLesson>();
  for (const l of existing || []) {
    if (!l?.rule) continue;
    map.set(l.rule.toLowerCase().trim(), { ...l });
  }
  for (const inc of incoming || []) {
    const key = (inc?.rule || "").toLowerCase().trim();
    if (!key) continue;
    const prev = map.get(key);
    if (prev) {
      map.set(key, { ...prev, hits: prev.hits + 1, updatedAt: inc.updatedAt || now });
    } else {
      map.set(key, {
        id: uid(),
        rule: inc.rule,
        trigger: inc.trigger,
        source: inc.source,
        hits: 1,
        createdAt: inc.createdAt || now,
        updatedAt: inc.updatedAt || now,
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.hits - a.hits || b.updatedAt - a.updatedAt)
    .slice(0, 30);
}

// --- open_loops: niedomknięte sprawy i obietnice z rozmów ---

const OPEN_LOOP_RE =
  /(musz[ęe]|obieca[łl]em|obieca[łl]am|pami[ęe]taj[, ]+[żz]eby|przypomnij mi[, ]+[żz]eby|wy[śs]l[ęe]|oddzwoni[ęe]|odezw[ęe] si[ęe]|wr[óo][ćc]my do|doko[ńn]cz[ęe]|sprawdz[ęe] jutro|do za[łl]atwienia)\s+(.{6,140})/i;

const CLOSE_LOOP_RE = /(za[łl]atwione|zrobione|wys[łl]a[łl]em|wys[łl]ane|oddzwoni[łl]em|zamknij temat|ogarni[ęe]te)/i;
const HIGH_PRIO_RE = /(pilne|natychmiast|dzisiaj|dzi[śs]|jutro|faktur|umow|klient|termin|przelew|awari)/i;

function normalizeTopicKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż ]+/gi, "").replace(/\s+/g, " ").trim().slice(0, 64);
}

function topicKeywords(s: string): string[] {
  return normalizeTopicKey(s)
    .split(" ")
    .filter((w) => w.length >= 4);
}

/** Pure: wydobądź potencjalne niedomknięte sprawy z wiadomości rozmowy. */
export function extractOpenLoopsFromMessages(messages: SleepMessage[], now = Date.now()): OpenLoop[] {
  const out: OpenLoop[] = [];
  for (const m of messages || []) {
    if (!m || m.role !== "user" || !m.content) continue;
    const match = OPEN_LOOP_RE.exec(m.content);
    if (!match) continue;
    const rawClause = (match[2] || "").split(/[.!?\n]/)[0].trim().slice(0, 120);
    if (rawClause.length < 5) continue;
    const ts = typeof m.createdAt === "number" ? m.createdAt : now;
    out.push({
      id: uid(),
      topic: rawClause.slice(0, 60),
      promise: `${match[1].trim()} ${rawClause}`.trim(),
      priority: HIGH_PRIO_RE.test(m.content) ? "high" : "medium",
      status: "open",
      createdAt: ts,
      updatedAt: ts,
      source: "chat",
    });
  }
  return out;
}

/** Pure: skonsoliduj istniejące `open_loops` z nowymi rozmowami (dedup, domykanie załatwionych, eskalacja po 48h). */
export function consolidateOpenLoops(
  existing: OpenLoop[],
  messages: SleepMessage[],
  now = Date.now(),
): OpenLoop[] {
  const loops: OpenLoop[] = (existing || []).map((l) => ({ ...l }));
  const byKey = new Map<string, OpenLoop>();
  for (const l of loops) {
    byKey.set(normalizeTopicKey(l.topic), l);
  }

  // 1) Domknij sprawy, o których użytkownik napisał „załatwione / wysłałem / zrobione”
  for (const m of messages || []) {
    if (!m || m.role !== "user" || !CLOSE_LOOP_RE.test(m.content || "")) continue;
    const msgWords = new Set(topicKeywords(m.content));
    for (const l of byKey.values()) {
      if (l.status !== "open") continue;
      const kws = topicKeywords(l.topic);
      if (kws.length > 0 && kws.some((w) => msgWords.has(w))) {
        l.status = "closed";
        l.updatedAt = now;
      }
    }
  }

  // 2) Dodaj nowe niedomknięte sprawy (deduplikacja po znormalizowanym temacie)
  const extracted = extractOpenLoopsFromMessages(messages, now);
  for (const item of extracted) {
    const key = normalizeTopicKey(item.topic);
    const prev = byKey.get(key);
    if (prev) {
      if (prev.status === "open") {
        prev.updatedAt = now;
        if (item.priority === "high") prev.priority = "high";
      }
    } else {
      byKey.set(key, item);
    }
  }

  // 3) Eskalacja priorytetu po 48h bez domknięcia
  const TWO_DAYS_MS = 48 * 3600_000;
  for (const l of byKey.values()) {
    if (l.status === "open" && l.priority === "medium" && now - l.createdAt >= TWO_DAYS_MS) {
      l.priority = "high";
      l.updatedAt = now;
    }
  }

  const prioRank = { high: 0, medium: 1, low: 2 };
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      if (prioRank[a.priority] !== prioRank[b.priority]) return prioRank[a.priority] - prioRank[b.priority];
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 40);
}

/**
 * Pure: Nocny Sen (`sleep_consolidate`) — konsolidacja dnia:
 * - aktualizuje `open_loops` i `user_lessons`,
 * - normalizuje `proactive_budget`,
 * - przygotowuje krótki 30-sekundowy briefing głosowy TYLKO jeśli istnieje realnie pilny powód.
 */
export function sleepConsolidate(input: SleepConsolidateInput): SleepConsolidateResult {
  const now = input.now ?? Date.now();
  const messages = input.messages || [];
  const open_loops = consolidateOpenLoops(input.existingOpenLoops || [], messages, now);

  const newLessons: Array<Omit<UserLesson, "id" | "hits">> = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const lesson = extractUserLessonFromCorrection(m.content, { now: m.createdAt ?? now });
    if (lesson) newLessons.push(lesson);
  }
  const user_lessons = mergeUserLessons(input.existingLessons || [], newLessons, now);
  const proactive_budget = normalizeProactiveBudget(input.budget, now);

  // Zbierz WYŁĄCZNIE realnie pilne powody na poranny briefing
  const urgentReasons: string[] = [];
  const horizon12h = now + 12 * 3600_000;

  for (const t of input.tasks || []) {
    if (!t || t.done) continue;
    const due = t.due ? Date.parse(t.due) : NaN;
    if (t.priority || (Number.isFinite(due) && due <= horizon12h)) {
      urgentReasons.push(`pilne zadanie: ${t.title}`);
    }
  }
  for (const ev of input.calendar || []) {
    const start = Date.parse(ev?.start || "");
    if (Number.isFinite(start) && start >= now - 3600_000 && start <= horizon12h) {
      urgentReasons.push(`spotkanie: ${ev.title}`);
    }
  }
  for (const rem of input.reminders || []) {
    if (!rem || rem.fired) continue;
    const at = Date.parse(rem.at || "");
    if (Number.isFinite(at) && at <= horizon12h) {
      urgentReasons.push(`przypomnienie: ${rem.text}`);
    }
  }
  for (const loop of open_loops) {
    if (loop.status === "open" && loop.priority === "high") {
      urgentReasons.push(`niedomknięta sprawa: ${loop.topic}`);
    }
  }
  for (const lead of input.leads || []) {
    if (!lead || lead.doNotContact || lead.optOut || lead.status === "won" || lead.status === "lost") continue;
    if (typeof lead.nextFollowUpAt === "number" && lead.nextFollowUpAt <= horizon12h) {
      urgentReasons.push(`kontakt z klientem: ${lead.company}`);
    }
  }

  const urgent = urgentReasons.length > 0;
  const openCount = open_loops.filter((l) => l.status === "open").length;
  const date = localDayKey(now);
  const daySummary = `Konsolidacja (${date}): otwarte wątki ${openCount}, lekcje stylu ${user_lessons.length}, pilne sygnały ${urgentReasons.length}.`;

  // Briefing głosowy max ~30 s (max 3 krótkie zdania, zero markdownu), TYLKO gdy jest pilny powód.
  const top3 = urgentReasons.slice(0, 3);
  const spokenBriefing = urgent
    ? `Dzień dobry, masz ${urgentReasons.length} pilne sprawy na dziś. Najważniejsze to ${top3.join(", ")}. Od czego zaczynamy?`
    : null;

  return {
    date,
    open_loops,
    user_lessons,
    proactive_budget,
    daySummary,
    urgent,
    urgentReasons: urgentReasons.slice(0, 10),
    spokenBriefing,
  };
}

/** Pure: zwięzły blok z `user_lessons` i otwartymi `open_loops` do promptu systemowego. */
export function buildSleepMemoryPromptBlock(
  openLoops?: OpenLoop[],
  userLessons?: UserLesson[],
): string {
  const parts: string[] = [];
  const lessons = (userLessons || []).slice(0, 6);
  if (lessons.length) {
    parts.push(
      "Reguły stylu użytkownika (wyciągnięte z jego korekt — stosuj zawsze):\n" +
        lessons.map((l) => `- ${l.rule}`).join("\n"),
    );
  }
  const opens = (openLoops || []).filter((l) => l.status === "open").slice(0, 5);
  if (opens.length) {
    parts.push(
      "Niedomknięte sprawy użytkownika (open_loops — nawiąż tylko gdy trafne):\n" +
        opens.map((l) => `- [${l.priority}] ${l.promise}`).join("\n"),
    );
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

/** Runtime helper: utrwal lekcję stylu z korekty lub barge-in w `store.data.user_lessons`. */
export function recordCorrectionLesson(text: string, wasBargeIn = false, now = Date.now()): UserLesson | null {
  const inc = extractUserLessonFromCorrection(text, { wasBargeIn, now });
  if (!inc) return null;
  const merged = mergeUserLessons(store.data.user_lessons || [], [inc], now);
  store.setData((d) => {
    d.user_lessons = merged;
  });
  return merged.find((l) => l.rule === inc.rule) || null;
}
