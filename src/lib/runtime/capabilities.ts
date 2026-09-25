// Capability registry (mission 5.5). JARVIS knows at runtime what it can really do. Planning
// checks requirements first; a missing capability yields NEEDS_CAPABILITY / NEEDS_PERMISSION /
// NEEDS_HARDWARE instead of an invented success.

import type { EventInput } from "./events";
import type { Truth } from "./truth";
import type { CapabilityState, CapabilityStatus } from "./types";

export const KNOWN_CAPABILITIES = [
  "browser.managed.semantic",
  "browser.bridge",
  "linux.atspi",
  "linux.input.portal",
  "linux.input.authorized",
  "linux.input.ydotool",
  "linux.input.xdotool",
  "desktop.clipboard",
  "desktop.primary_selection",
  "desktop.active_window",
  "desktop.window_list",
  "windows.uia",
  "android.accessibility.tree",
  "voice.mic",
  "voice.streaming_stt",
  "voice.batch_stt",
  "voice.streaming_tts",
  "vision",
  "mail.send",
  "mail.sent_readback",
  "contacts",
] as const;

export type CapabilityId = (typeof KNOWN_CAPABILITIES)[number] | (string & {});

export interface CapabilityProbe {
  id: CapabilityId;
  probe(): Promise<{ status: CapabilityStatus; detail?: string; provider?: string }>;
}

/** Requirement = every group must be satisfied by at least one capability in it (AND of ORs). */
export type Requirement = CapabilityId[][];

/** What each action kind needs. Unknown kinds need nothing extra (pure reasoning steps). */
const BROWSER: CapabilityId[] = ["browser.managed.semantic", "browser.bridge"];
const DESKTOP_INPUT: CapabilityId[] = ["linux.input.portal", "linux.input.authorized", "linux.input.ydotool", "linux.input.xdotool", "windows.uia", "android.accessibility.tree"];
const TEXT_ENVS: CapabilityId[] = ["browser.managed.semantic", "browser.bridge", "linux.atspi", "windows.uia", "android.accessibility.tree"];

export const ACTION_REQUIREMENTS: Record<string, Requirement> = {
  "browser.launch": [BROWSER],
  "browser.navigate": [BROWSER],
  "browser.consent": [BROWSER],
  "browser.open": [BROWSER],
  "browser.scroll": [[...BROWSER, "linux.atspi", "windows.uia", "android.accessibility.tree"]],
  "browser.scrollTo": [[...BROWSER, "linux.atspi", "windows.uia"]],
  "browser.findCollection": [BROWSER],
  "browser.focus": [BROWSER],
  "text.select": [TEXT_ENVS],
  "clipboard.copy": [["browser.managed.semantic", "desktop.clipboard"]],
  "mail.send": [["mail.send"], ["mail.sent_readback"]],
  "desktop.type": [DESKTOP_INPUT],
  "desktop.keys": [DESKTOP_INPUT],
  "window.activate": [["desktop.active_window"]],
  "clipboard.write": [["desktop.clipboard", "browser.managed.semantic"]],
  "voice.listen": [["voice.mic"], ["voice.streaming_stt", "voice.batch_stt"]],
};

const USABLE: ReadonlySet<CapabilityStatus> = new Set<CapabilityStatus>(["available", "degraded"]);

export type RequirementCheck =
  | { ok: true; degraded: string[] }
  | { ok: false; truth: Extract<Truth, "NEEDS_PERMISSION" | "NEEDS_HARDWARE" | "NEEDS_CAPABILITY">; missing: { group: CapabilityId[]; best?: CapabilityState }[] };

/** Rank of a missing capability: the most actionable blocker decides the truth state. */
function blockerTruth(states: (CapabilityState | undefined)[]): "NEEDS_PERMISSION" | "NEEDS_HARDWARE" | "NEEDS_CAPABILITY" {
  if (states.some((s) => s?.status === "needs_permission")) return "NEEDS_PERMISSION";
  if (states.some((s) => s?.status === "needs_hardware")) return "NEEDS_HARDWARE";
  return "NEEDS_CAPABILITY";
}

export function checkRequirement(caps: Record<string, CapabilityState>, req: Requirement): RequirementCheck {
  const missing: { group: CapabilityId[]; best?: CapabilityState }[] = [];
  const degraded: string[] = [];
  const blockers: (CapabilityState | undefined)[] = [];
  for (const group of req) {
    const hit = group.map((id) => caps[id]).find((c) => c && USABLE.has(c.status));
    if (hit) {
      if (hit.status === "degraded") degraded.push(hit.id);
      continue;
    }
    const states = group.map((id) => caps[id]);
    blockers.push(...states);
    const best = states.find((s) => s?.status === "needs_permission") ?? states.find((s) => s?.status === "needs_hardware") ?? states.find(Boolean);
    missing.push({ group, best });
  }
  if (!missing.length) return { ok: true, degraded };
  return { ok: false, truth: blockerTruth(blockers), missing };
}

export function checkAction(caps: Record<string, CapabilityState>, kind: string): RequirementCheck {
  return checkRequirement(caps, ACTION_REQUIREMENTS[kind] ?? []);
}

export interface MatrixRow {
  id: string;
  status: CapabilityStatus;
  detail: string;
  provider: string;
  checkedAt: number | null;
}

/** Diagnostic matrix: every known capability plus any extra probed ones, unknown when never probed. */
export function capabilityMatrix(caps: Record<string, CapabilityState>): MatrixRow[] {
  const ids = [...new Set<string>([...KNOWN_CAPABILITIES, ...Object.keys(caps)])];
  return ids.map((id) => {
    const c = caps[id];
    return { id, status: c?.status ?? "unknown", detail: c?.detail ?? "", provider: c?.provider ?? "", checkedAt: c?.checkedAt ?? null };
  });
}

export class CapabilityRegistry {
  private probes = new Map<string, CapabilityProbe>();

  register(p: CapabilityProbe): () => void {
    this.probes.set(p.id, p);
    return () => { this.probes.delete(p.id); };
  }

  /** Run every probe; a throwing probe reports "unknown" with its error, never "available". */
  async probeAll(now: () => number, timeoutMs = 3000): Promise<CapabilityState[]> {
    const out: CapabilityState[] = [];
    await Promise.all([...this.probes.values()].map(async (p) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          p.probe(),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("probe timeout")), timeoutMs); }),
        ]);
        out.push({ id: p.id, status: r.status, detail: r.detail, provider: r.provider, checkedAt: now() });
      } catch (e) {
        out.push({ id: p.id, status: "unknown", detail: e instanceof Error ? e.message : "probe failed", checkedAt: now() });
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Probe and produce the kernel event that records the result. */
  async update(now: () => number): Promise<EventInput> {
    return { type: "CapabilitiesUpdated", capabilities: await this.probeAll(now) };
  }
}
