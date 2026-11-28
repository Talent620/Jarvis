// === JARVIS FLOW — Silnik Reżysera Skupienia, Parkingu Myśli i Momentum ===
// Czysty, w 100% lokalny, ES2019/S9-safe (zero zewnętrznych zależności).
// Chroni uwagę podczas sprintów głębokiej pracy, łapie rozpraszające myśli do Parkingu Myśli
// bez wybijania z rytmu i po zakończeniu zamienia je jednym kliknięciem w zadania lub notatki.

export type FlowPresetId = "spark" | "deep" | "flow" | "break";

export interface FlowPreset {
  id: FlowPresetId;
  label: string;
  minutes: number;
  tagline: string;
  isBreak?: boolean;
}

export const FLOW_PRESETS: FlowPreset[] = [
  { id: "spark", label: "Rozruch 15 min", minutes: 15, tagline: "Przełamanie oporu i szybki start" },
  { id: "deep", label: "Deep Focus 25 min", minutes: 25, tagline: "Klasyczny blok pełnej koncentracji" },
  { id: "flow", label: "Strefa Flow 45 min", minutes: 45, tagline: "Głęboka praca projektowa i kodowanie" },
  { id: "break", label: "Regeneracja 5 min", minutes: 5, tagline: "Krótki reset oczu i głowy", isBreak: true },
];

export interface ParkedThought {
  id: string;
  text: string;
  createdAt: number;
  convertedTo?: "task" | "note";
}

export interface FlowSession {
  id: string;
  goal: string;
  presetId: FlowPresetId;
  plannedMinutes: number;
  actualMinutes: number;
  completed: boolean;
  linkedTaskId?: string;
  parkedCount: number;
  finishedAt: number;
}

export interface FlowStats {
  todayMinutes: number;
  todaySessions: number;
  totalSessions: number;
  totalMinutes: number;
  streakDays: number;
  completionRatePct: number;
  momentumLabel: string;
  momentumScore: number; // 0-100
}

const STORAGE_KEY = "jarvis.flow.sessions.v1";
const PARKING_KEY = "jarvis.flow.parking.v1";

function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadFlowSessions(): FlowSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.id === "string" && typeof s.finishedAt === "number") : [];
  } catch {
    return [];
  }
}

export function saveFlowSession(session: FlowSession): FlowSession[] {
  const list = [session, ...loadFlowSessions()].slice(0, 120);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function loadParkedThoughts(): ParkedThought[] {
  try {
    const raw = localStorage.getItem(PARKING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === "string" && typeof x.text === "string") : [];
  } catch {
    return [];
  }
}

export function saveParkedThoughts(items: ParkedThought[]): void {
  try { localStorage.setItem(PARKING_KEY, JSON.stringify(items.slice(0, 40))); } catch { /* ignore */ }
}

/** Pure: policz rzeczywisty wynik Momentum i statystyki głębokiej pracy z historii sesji. */
export function computeFlowStats(sessions: FlowSession[], now = Date.now()): FlowStats {
  const workSessions = sessions.filter((s) => s.presetId !== "break");
  const today = dayKey(now);
  const todayList = workSessions.filter((s) => dayKey(s.finishedAt) === today);
  const todayMinutes = todayList.reduce((sum, s) => sum + Math.max(0, s.actualMinutes), 0);
  const totalMinutes = workSessions.reduce((sum, s) => sum + Math.max(0, s.actualMinutes), 0);
  const completedCount = workSessions.filter((s) => s.completed).length;
  const completionRatePct = workSessions.length > 0 ? Math.round((completedCount / workSessions.length) * 100) : 0;

  // Seria kolejnych dni z przynajmniej jedną sesją skupienia (dziś lub od wczoraj).
  const activeDays = new Set<string>(workSessions.map((s) => dayKey(s.finishedAt)));
  let streakDays = 0;
  const DAY_MS = 86_400_000;
  let cursor = activeDays.has(today) ? now : now - DAY_MS;
  while (activeDays.has(dayKey(cursor)) && streakDays < 365) {
    streakDays += 1;
    cursor -= DAY_MS;
  }

  // Momentum (0–100): bazuje na dzisiejszych minutach (max 90 min = 65 pkt), serii dni (max 20 pkt) i domknięciach (max 15 pkt).
  const minScore = Math.min(65, Math.round((todayMinutes / 90) * 65));
  const streakScore = Math.min(20, streakDays * 4);
  const rateScore = workSessions.length > 0 ? Math.round((completionRatePct / 100) * 15) : 0;
  const momentumScore = Math.min(100, minScore + streakScore + rateScore);

  const momentumLabel = momentumScore >= 80
    ? "Hiper-Fokus"
    : momentumScore >= 50
      ? "Strefa Flow"
      : momentumScore >= 20
        ? "W rytmie"
        : "Gotowy do startu";

  return {
    todayMinutes,
    todaySessions: todayList.length,
    totalSessions: workSessions.length,
    totalMinutes,
    streakDays,
    completionRatePct,
    momentumLabel,
    momentumScore,
  };
}

/** Pure: sformatuj sekundy jako MM:SS. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Pure: podsumowanie sesji gotowe do czatu/dziennika (krótkie, motywujące, z faktów). */
export function buildFlowDebriefPrompt(session: FlowSession, thoughts: ParkedThought[]): string {
  const openThoughts = thoughts.filter((t) => !t.convertedTo).map((t) => t.text);
  const lines = [
    `Zakończyłem blok skupienia (${session.actualMinutes} min / plan ${session.plannedMinutes} min, status: ${session.completed ? "domknięte" : "zatrzymane wcześniej"}).`,
    `Cel sprintu: ${session.goal}.`,
  ];
  if (openThoughts.length > 0) {
    lines.push(`Złapane myśli w Parkingu Myśli: ${openThoughts.join("; ")}.`);
  }
  lines.push("Podsumuj krótko postęp i zasugeruj 1 konkretny następny ruch na kolejną sesję.");
  return lines.join(" ");
}
