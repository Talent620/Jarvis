// The one channel between the renderer runtime and the coding executor in the Electron main
// process (M12): JSON requests over IPC ("jarvis:coder") and batched event streams back
// ("jarvis:coder-events"). Tests plug the Node host in directly with the same shape.

import type { BackendProbe, CoderEvent, CoderLiveState, CoderResult, CoderTaskRecord, CoderTaskSpec, ValidationResult } from "./types";

export interface WorkspaceInfo {
  id: string;
  name: string;
  root: string;
  addedAt: number;
}

export interface WorkspaceProfileInfo {
  workspace: WorkspaceInfo;
  git: { isRepo: boolean; branch?: string; head?: string; upstream?: string; remote?: string; dirty: string[] };
  packageManager?: string;
  checks: { name: string; cmd: string; args: string[]; source: string }[];
  kind: string[];
}

export type CoderRequest =
  | { method: "probe" }
  | { method: "workspaces" }
  | { method: "addWorkspace"; root: string; name?: string }
  /** Desktop only: the system folder picker adds the chosen folder (the renderer names no path). */
  | { method: "pickWorkspace" }
  /** Desktop only: open the project folder in the system file manager. */
  | { method: "openWorkspace"; id: string }
  | { method: "removeWorkspace"; id: string }
  | { method: "profile"; id: string }
  | { method: "findWorkspace"; words: string }
  | { method: "start"; spec: CoderTaskSpec }
  | { method: "cancel"; taskId: string }
  | { method: "pause"; taskId: string }
  | { method: "resume"; taskId: string }
  | { method: "amend"; taskId: string; instruction?: string; constraint?: string }
  | { method: "live" }
  | { method: "log"; taskId: string; limit?: number }
  | { method: "history" }
  | { method: "result"; taskId: string }
  | { method: "diff"; taskId: string }
  /** The tester role: the repo's own checks again, against the task's baseline. */
  | { method: "validate"; taskId: string };

/** What each method answers with. */
export interface CoderReplies {
  probe: BackendProbe[];
  workspaces: WorkspaceInfo[];
  addWorkspace: WorkspaceInfo;
  pickWorkspace: WorkspaceInfo;
  openWorkspace: boolean;
  removeWorkspace: boolean;
  profile: WorkspaceProfileInfo;
  findWorkspace: WorkspaceInfo | null;
  start: CoderResult;
  cancel: boolean;
  pause: boolean;
  resume: boolean;
  amend: { ok: boolean; delivered: "now" | "next_turn" | "constraint" | "none" };
  live: CoderLiveState[];
  log: CoderEvent[];
  history: CoderTaskRecord[];
  result: CoderResult | null;
  diff: string;
  validate: ValidationResult | null;
}

export type CoderResponse<M extends CoderRequest["method"] = CoderRequest["method"]> =
  | { ok: true; value: CoderReplies[M] }
  | { ok: false; error: string };

export interface CoderPort {
  call<R extends CoderRequest>(req: R): Promise<CoderResponse<R["method"]>>;
  /** Events arrive in batches (the host flushes about every 100 ms, at once on a task's end). */
  onEvents(listener: (batch: CoderEvent[]) => void): () => void;
}

/** Unwrap a reply or throw its error (for callers that treat a failure as an exception). */
export async function coderCall<R extends CoderRequest>(port: CoderPort, req: R): Promise<CoderReplies[R["method"]]> {
  const r = await port.call(req);
  if (!r.ok) throw new Error(r.error);
  return r.value as CoderReplies[R["method"]];
}

interface DesktopCoderBridge {
  call(req: CoderRequest): Promise<CoderResponse>;
  onEvents(cb: (batch: CoderEvent[]) => void): () => void;
}

/** The preload's `jarvisDesktop.coder`, when this is the desktop app with the coder host. */
export function desktopCoderPort(): CoderPort | null {
  const g = globalThis as { jarvisDesktop?: { coder?: DesktopCoderBridge } };
  const b = g.jarvisDesktop?.coder;
  if (!b || typeof b.call !== "function" || typeof b.onEvents !== "function") return null;
  return {
    call: async <R extends CoderRequest>(req: R): Promise<CoderResponse<R["method"]>> => {
      try {
        const r = await b.call(req);
        return r && typeof r === "object" && "ok" in r ? (r as CoderResponse<R["method"]>) : { ok: false, error: "no reply" };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onEvents: (cb) => b.onEvents((batch) => { if (Array.isArray(batch)) cb(batch); }),
  };
}
