// Skill Compiler (mission M10): a sequence of commands that just ran and was confirmed step by
// step becomes a named skill ("zapamiętaj to jako komentarz na mail"). Replaying it goes through
// the same runtime, so every step is verified again; a step that fails for real invalidates the
// skill, a missing precondition does not. An external effect inside a skill still stops at the
// consent question: a skill never answers "tak" for the user.

import { parseCommand, type Command } from "./commands";
import { isPrecondition, type Truth } from "./truth";
import type { RuntimeTurn } from "./lanes/runtime";
import type { TurnResult } from "./session";

export interface Skill {
  name: string;
  scope: string;
  steps: string[];
  /** Contains an external effect (mail): replay stops at the consent question. */
  external: boolean;
  /** The browser the steps ran in; replay switches there first (never into the user's tab by accident). */
  browser?: "managed" | "user";
  compiledAt: number;
  runs: number;
  lastOkAt?: number;
  invalidated?: { at: number; reason: string };
}

export interface SkillStore {
  load(): Skill[];
  save(skills: Skill[]): void;
}

/** What replay needs from the runtime. */
export interface SkillRunner {
  /** Queue one step as an action; resolves when it has finished or was dropped by "stop". */
  run(text: string): Promise<{ result?: TurnResult; stopped: boolean }>;
  /** Queue a step and return at once (the send step: its consent question is the user's). */
  submit(text: string): void;
  /** The browser browser actions go to right now. */
  browser?(): "managed" | "user";
}

/** The spoken switch a replay runs first when the skill was recorded in the other browser. */
export const BROWSER_SWITCH_STEP: Record<"managed" | "user", string> = {
  managed: "Pracuj w swojej przeglądarce.",
  user: "Użyj mojej przeglądarki.",
};

export interface ReplayResult {
  truth: Truth | "WAITING_CONSENT" | "STOPPED";
  steps: { text: string; truth: string }[];
  reason?: string;
}

const COMPILABLE = new Set<Command["type"]>(["browser.use", "browser.launch", "browser.gotoSite", "browser.openItem", "scroll", "findCollection", "focusItem", "selectText", "copy", "send"]);
const MAX_STEPS = 12;
/** A pause longer than this ends the sequence being remembered (it was another errand). */
const MAX_GAP_MS = 15 * 60_000;
const normName = (s: string) => s.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");

export class SkillLibrary {
  private skills = new Map<string, Skill>();
  constructor(private readonly store?: SkillStore, private readonly now: () => number = () => Date.now()) {
    let saved: unknown = [];
    try { saved = store?.load() ?? []; } catch { saved = []; }
    for (const s of Array.isArray(saved) ? saved : []) {
      if (s && typeof s.name === "string" && Array.isArray(s.steps) && s.steps.length && s.steps.every((x: unknown) => typeof x === "string")) {
        const k = s as Skill;
        if (k.browser !== undefined && k.browser !== "managed" && k.browser !== "user") delete k.browser;
        this.skills.set(normName(k.name), k);
      }
    }
  }

  private persist(): void {
    try { this.store?.save([...this.skills.values()]); } catch { /* storage full or unavailable: the skill still works this session */ }
  }

  /**
   * The confirmed commands at the end of the conversation, back to the last one that was not
   * confirmed (side chat in between is skipped). Nothing unconfirmed is ever compiled.
   */
  compile(name: string, turns: RuntimeTurn[], scope: string, browser?: "managed" | "user"): { ok: true; skill: Skill } | { ok: false; reason: string } {
    const steps: string[] = [];
    let later: number | undefined;
    for (let i = turns.length - 1; i >= 0 && steps.length < MAX_STEPS; i--) {
      const t = turns[i];
      if (t.route !== "action" && t.route !== "amend") continue;
      if (t.result?.truth !== "CONFIRMED") break;
      if (later !== undefined && later - t.at > MAX_GAP_MS) break;
      later = t.at;
      steps.unshift(t.text);
    }
    if (!steps.length) return { ok: false, reason: "no confirmed steps to remember" };
    const types = steps.map((s) => parseCommand(s).type);
    if (types.some((t) => !COMPILABLE.has(t))) return { ok: false, reason: "a step cannot be replayed" };
    const skill: Skill = { name: name.trim(), scope, steps, external: types.includes("send"), compiledAt: this.now(), runs: 0, browser };
    this.skills.set(normName(name), skill);
    this.persist();
    return { ok: true, skill };
  }

  get(name: string): Skill | null {
    const s = this.skills.get(normName(name));
    return s && !s.invalidated ? s : null;
  }

  has(name: string): boolean {
    return !!this.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()].map((s) => ({ ...s }));
  }

  /** Forget a skill for good (the user removed it). */
  remove(name: string): boolean {
    const ok = this.skills.delete(normName(name));
    if (ok) this.persist();
    return ok;
  }

  invalidate(name: string, reason: string): void {
    const s = this.skills.get(normName(name));
    if (!s) return;
    s.invalidated = { at: this.now(), reason };
    this.persist();
  }

  async replay(runner: SkillRunner, name: string): Promise<ReplayResult> {
    const skill = this.skills.get(normName(name));
    if (!skill || skill.invalidated) return { truth: "BLOCKED", steps: [], reason: "no such skill (or it was invalidated)" };
    skill.runs++;
    const done: ReplayResult["steps"] = [];
    const finish = (r: ReplayResult): ReplayResult => { this.persist(); return r; };
    const pin = skill.browser && runner.browser && runner.browser() !== skill.browser ? [BROWSER_SWITCH_STEP[skill.browser]] : [];
    for (const text of [...pin, ...skill.steps]) {
      if (parseCommand(text).type === "send") {
        // The runtime now asks for consent; the user answers, never the skill.
        runner.submit(text);
        done.push({ text, truth: "WAITING_CONSENT" });
        return finish({ truth: "WAITING_CONSENT", steps: done });
      }
      const { result, stopped } = await runner.run(text);
      if (stopped) {
        done.push({ text, truth: "STOPPED" });
        return finish({ truth: "STOPPED", steps: done, reason: "stopped by the user" });
      }
      const truth: Truth = result?.truth ?? "FAILED";
      done.push({ text, truth });
      if (truth === "CONFIRMED") continue;
      // Something missing (no browser, no permission) says nothing about the skill itself.
      if (isPrecondition(truth)) return finish({ truth, steps: done, reason: result?.say });
      this.invalidate(skill.name, `step "${text}" ended ${truth}`);
      return { truth: "FAILED", steps: done, reason: `the skill no longer works here: "${text}" ended ${truth}` };
    }
    skill.lastOkAt = this.now();
    return finish({ truth: "CONFIRMED", steps: done });
  }
}

/** "zapamiętaj to jako X" -> X */
export function parseRememberSkill(normalized: string): string | null {
  const m = /^(?:jarvis )?zapamietaj (?:to |te kroki |ten ciag )?jako (.{2,60})$/.exec(normalized);
  return m ? m[1].trim() : null;
}

/** "powtórz X" / "wykonaj X" / "zrób X" -> X (only meaningful when X is a known skill). */
export function parseRunSkill(normalized: string): string | null {
  const m = /^(?:jarvis )?(?:powtorz|wykonaj|zrob|uruchom umiejetnosc) (.{2,60})$/.exec(normalized);
  return m ? m[1].trim() : null;
}
