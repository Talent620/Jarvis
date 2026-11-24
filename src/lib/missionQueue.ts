// === Sprint 2 / Moduł 4b: Kolejka Misji w Tle (mission_queue) ===
// Dla ciężkich zapytań (research, analiza dokumentu, Narada) warstwa Refleks natychmiast
// potwierdza przyjęcie zadania głosem, a ciężka praca leci asynchronicznie w tle.
// Po zakończeniu wysyła powiadomienie systemowe i wystawia kartę akcji w UI.
import { notify } from "./notifications";
import { formatForSpokenPolish } from "./soulModes";
import type { ChatMessage } from "../types";

export type MissionKind = "research" | "document" | "narada" | "general";
export type MissionStatus = "queued" | "running" | "done" | "error";

export interface QueuedMission {
  id: string;
  kind: MissionKind;
  title: string;
  prompt: string;
  status: MissionStatus;
  /** Natychmiastowe potwierdzenie z warstwy Refleks do odczytania głosem. */
  reflexAck: string;
  resultText?: string;
  spokenSummary?: string;
  council?: ChatMessage["council"];
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface MissionExecutionOutput {
  text: string;
  spokenSummary?: string;
  council?: ChatMessage["council"];
}

const STORAGE_KEY = "jarvis.mission_queue.v1";
const MAX_MISSIONS = 20;

const BG_CMD_RE =
  /^(?:jarvis[, ]+)?(?:w tle|zle[ćc] w tle|uruchom w tle|zbadaj w tle|przeanalizuj w tle|narada w tle)(?:\s*[:—-]\s*|\s+)(.+)$/i;

const HEAVY_RESEARCH_RE = /(g[łl][ęe]boki research|zbadaj rynek|por[óo]wnaj oferty|raport rynkowy|przeanalizuj konkurencj)/i;
const HEAVY_DOC_RE = /(przeanalizuj dokument|przeanalizuj umow[ęe]|audyt umowy|przeczytaj pdf|streszczenie dokumentu)/i;
const HEAVY_NARADA_RE = /(narada|rada ekspert[óo]w)/i;

/** Pure: wykryj czy zapytanie to ciężka misja kwalifikująca się do kolejki w tle. */
export function isHeavyMission(text: string): { heavy: boolean; kind: MissionKind } {
  const t = (text || "").trim();
  if (!t) return { heavy: false, kind: "general" };
  if (HEAVY_NARADA_RE.test(t)) return { heavy: true, kind: "narada" };
  if (HEAVY_DOC_RE.test(t)) return { heavy: true, kind: "document" };
  if (HEAVY_RESEARCH_RE.test(t)) return { heavy: true, kind: "research" };
  return { heavy: false, kind: "general" };
}

/** Pure: wykryj jawną komendę zlecenia zadania w tle (np. „w tle: zbadaj rynek…”). */
export function parseBackgroundMissionCommand(text: string): { kind: MissionKind; prompt: string } | null {
  const raw = (text || "").trim();
  const m = BG_CMD_RE.exec(raw);
  if (!m) return null;
  const prompt = (m[1] || "").trim();
  if (prompt.length < 3) return null;
  if (/^narada w tle/i.test(raw) || HEAVY_NARADA_RE.test(prompt)) {
    return { kind: "narada", prompt };
  }
  if (/^przeanalizuj w tle/i.test(raw) || HEAVY_DOC_RE.test(prompt)) {
    return { kind: "document", prompt };
  }
  if (/^zbadaj w tle/i.test(raw) || HEAVY_RESEARCH_RE.test(prompt)) {
    return { kind: "research", prompt };
  }
  return { kind: "general", prompt };
}

/** Pure: natychmiastowe potwierdzenie warstwy Refleks do odsłuchu głosowego. */
export function reflexConfirmationFor(kind: MissionKind, title: string): string {
  const shortTitle = title.trim().slice(0, 60);
  const label =
    kind === "narada"
      ? "Radę Ekspertów"
      : kind === "document"
        ? "analizę dokumentu"
        : kind === "research"
          ? "research"
          : "zadanie";
  return `Przyjąłem ${label} w tle: ${shortTitle}. Dam znać powiadomieniem, jak skończę.`;
}

function makeId(): string {
  return `mq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

type QueueListener = (items: QueuedMission[]) => void;

export class MissionQueue {
  private items: QueuedMission[] = [];
  private listeners = new Set<QueueListener>();
  private notifier: (title: string, body: string) => Promise<void>;

  constructor(opts: { persist?: boolean; notifier?: (title: string, body: string) => Promise<void> } = {}) {
    this.notifier = opts.notifier || notify;
    if (opts.persist !== false) this.load();
  }

  private load(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.items = parsed.slice(0, MAX_MISSIONS);
      }
    } catch {
      /* ignore corrupted snapshot */
    }
  }

  private save(): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items.slice(0, MAX_MISSIONS)));
    } catch {
      /* quota */
    }
  }

  private emit(): void {
    this.save();
    const snap = this.list();
    for (const fn of this.listeners) {
      try { fn(snap); } catch { /* listener error isolated */ }
    }
  }

  list(): QueuedMission[] {
    return this.items.map((m) => ({ ...m }));
  }

  subscribe(fn: QueueListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  dismiss(id: string): void {
    this.items = this.items.filter((m) => m.id !== id);
    this.emit();
  }

  /**
   * Przyjmij misję natychmiast (zwraca `QueuedMission` z `reflexAck` synchronicznie)
   * i uruchom ciężkiego runnera w tle. Po zakończeniu wysyła powiadomienie + odświeża kartę akcji.
   */
  enqueue(params: {
    kind?: MissionKind;
    title?: string;
    prompt: string;
    runner: () => Promise<MissionExecutionOutput>;
    onDone?: (mission: QueuedMission) => void;
  }): QueuedMission {
    const detected = isHeavyMission(params.prompt);
    const kind = params.kind || detected.kind;
    const title = (params.title || params.prompt).trim().slice(0, 70);
    const mission: QueuedMission = {
      id: makeId(),
      kind,
      title,
      prompt: params.prompt,
      status: "queued",
      reflexAck: reflexConfirmationFor(kind, title),
      createdAt: Date.now(),
    };
    this.items = [mission, ...this.items].slice(0, MAX_MISSIONS);
    this.emit();

    // Uruchom asynchronicznie (następny microtask), aby Refleks mógł natychmiast odpowiedzieć.
    void Promise.resolve().then(async () => {
      this.patch(mission.id, { status: "running" });
      try {
        const res = await params.runner();
        const spokenSummary =
          res.spokenSummary || formatForSpokenPolish(res.text, 2) || `Zadanie „${title}” gotowe.`;
        const finished = this.patch(mission.id, {
          status: "done",
          resultText: res.text,
          spokenSummary,
          council: res.council,
          completedAt: Date.now(),
        });
        if (finished) {
          try {
            await this.notifier(`✅ JARVIS zakończył: ${finished.title}`, spokenSummary);
          } catch {
            /* best-effort notification */
          }
          params.onDone?.(finished);
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const failed = this.patch(mission.id, {
          status: "error",
          error: err,
          completedAt: Date.now(),
        });
        if (failed) {
          try {
            await this.notifier(`⚠ Misja w tle przerwana: ${failed.title}`, err.slice(0, 140));
          } catch {
            /* best-effort */
          }
          params.onDone?.(failed);
        }
      }
    });

    return { ...mission };
  }

  private patch(id: string, delta: Partial<QueuedMission>): QueuedMission | null {
    const idx = this.items.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    this.items[idx] = { ...this.items[idx], ...delta };
    this.emit();
    return { ...this.items[idx] };
  }
}

export const missionQueue = new MissionQueue();
