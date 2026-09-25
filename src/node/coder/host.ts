// Main-process side of the coder IPC (M12): a pure dispatcher from JSON requests to the
// CoderExecutor and the WorkspaceRegistry. Requests come from a renderer, so every method and
// field is checked against an allow-list first. Events leave in batches (one IPC message about
// every 100 ms, at once when a task ends), never one message per agent line.

import { join } from "node:path";
import type { CoderRequest, CoderResponse } from "../../lib/runtime/coder/port";
import type { BackendChoice, CoderEvent, CoderTaskSpec } from "../../lib/runtime/coder/types";
import { ClaudeBackend, CodexBackend, LocalBackend, type CoderBackend } from "./backends";
import { CoderExecutor } from "./executor";
import { WorkspaceRegistry } from "./workspace";

export interface CoderHost {
  handle(req: unknown): Promise<CoderResponse>;
  onEvents(listener: (batch: CoderEvent[]) => void): () => void;
  /** Stop every agent process; running tasks stay resumable after the next start. */
  close(): Promise<void>;
  readonly executor: CoderExecutor;
  readonly registry: WorkspaceRegistry;
}

export interface CoderHostOptions {
  userDataPath?: string;
  registry?: WorkspaceRegistry;
  backends?: CoderBackend[];
  executor?: CoderExecutor;
  /** Event batching interval. */
  batchMs?: number;
  /** A batch is flushed early at this size. */
  maxBatch?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const id = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const BACKENDS: readonly BackendChoice[] = ["auto", "codex", "claude", "local"];
const ROLES = ["planner", "coder", "tester", "reviewer", "debugger"] as const;

class Invalid extends Error {}

function spec(v: unknown): CoderTaskSpec {
  if (!isObj(v)) throw new Invalid("spec");
  if (!id(v.taskId)) throw new Invalid("taskId");
  if (!str(v.goal, 8000)) throw new Invalid("goal");
  if (v.title !== undefined && !str(v.title, 2000)) throw new Invalid("title");
  if (!id(v.workspaceId)) throw new Invalid("workspaceId");
  if (typeof v.backend !== "string" || !BACKENDS.includes(v.backend as BackendChoice)) throw new Invalid("backend");
  const constraints = v.constraints === undefined ? undefined : Array.isArray(v.constraints) && v.constraints.length <= 20 && v.constraints.every((c) => str(c, 300)) ? (v.constraints as string[]) : null;
  if (constraints === null) throw new Invalid("constraints");
  if (v.access !== undefined && v.access !== "read" && v.access !== "write") throw new Invalid("access");
  if (v.branch !== undefined && typeof v.branch !== "boolean") throw new Invalid("branch");
  if (v.resumeOf !== undefined && !id(v.resumeOf)) throw new Invalid("resumeOf");
  if (v.baseOf !== undefined && !id(v.baseOf)) throw new Invalid("baseOf");
  if (v.role !== undefined && !(ROLES as readonly string[]).includes(v.role as string)) throw new Invalid("role");
  if (v.timeoutMs !== undefined && !(typeof v.timeoutMs === "number" && Number.isFinite(v.timeoutMs))) throw new Invalid("timeoutMs");
  return {
    taskId: v.taskId, goal: v.goal, title: v.title as string | undefined, workspaceId: v.workspaceId, backend: v.backend as BackendChoice, constraints,
    access: v.access as CoderTaskSpec["access"], branch: v.branch as boolean | undefined, resumeOf: v.resumeOf as string | undefined, baseOf: v.baseOf as string | undefined,
    role: v.role as CoderTaskSpec["role"],
    // Between one minute and four hours: a renderer cannot make an agent run forever.
    timeoutMs: v.timeoutMs === undefined ? undefined : Math.min(4 * 3600_000, Math.max(60_000, v.timeoutMs as number)),
  };
}

export function createCoderHost(o: CoderHostOptions = {}): CoderHost {
  const registry = o.registry ?? new WorkspaceRegistry(o.userDataPath ? join(o.userDataPath, "jarvis-workspaces.json") : undefined);
  const backends = o.backends ?? [new CodexBackend(), new ClaudeBackend(), new LocalBackend()];
  const executor = o.executor ?? new CoderExecutor({ registry, backends, recordsFile: o.userDataPath ? join(o.userDataPath, "jarvis-coder-tasks.json") : undefined });
  const batchMs = o.batchMs ?? 100;
  const maxBatch = o.maxBatch ?? 200;
  const listeners = new Set<(batch: CoderEvent[]) => void>();
  let buffer: CoderEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    for (const l of [...listeners]) { try { l(batch); } catch { /* a renderer gone away */ } }
  };
  const unsubscribe = executor.onEvent((e) => {
    buffer.push(e);
    if (e.kind === "TASK_COMPLETED" || e.kind === "TASK_CANCELLED" || e.kind === "POLICY_VIOLATION" || buffer.length >= maxBatch) flush();
    else if (!timer) timer = setTimeout(flush, batchMs);
  });

  const answer = async (req: CoderRequest): Promise<unknown> => {
    switch (req.method) {
      case "probe": return executor.probeAll();
      case "workspaces": return registry.all();
      case "addWorkspace": return registry.add(req.root, req.name);
      case "removeWorkspace": return registry.remove(req.id);
      case "profile": return registry.profile(req.id);
      case "findWorkspace": return registry.find(req.words) ?? null;
      case "start": return executor.start(req.spec);
      case "cancel": return executor.cancel(req.taskId);
      case "pause": return executor.pause(req.taskId);
      case "resume": return executor.resume(req.taskId);
      case "amend": return executor.amend(req.taskId, { instruction: req.instruction, constraint: req.constraint });
      case "live": return executor.liveAll();
      case "log": return executor.log(req.taskId, req.limit);
      case "history": return executor.history();
      case "result": return executor.result(req.taskId) ?? null;
      case "diff": return executor.diff(req.taskId);
      case "validate": return (await executor.revalidate(req.taskId)) ?? null;
      default: throw new Invalid("desktop-only method");
    }
  };

  /** Shape check of everything a renderer may send. */
  const check = (r: unknown): CoderRequest => {
    if (!isObj(r) || typeof r.method !== "string") throw new Invalid("request");
    switch (r.method) {
      case "probe": case "workspaces": case "live": case "history":
        return { method: r.method };
      case "addWorkspace":
        if (!str(r.root, 4096) || (r.name !== undefined && !str(r.name, 120))) throw new Invalid("workspace");
        return { method: "addWorkspace", root: r.root, name: r.name as string | undefined };
      case "removeWorkspace": case "profile":
        if (!id(r.id)) throw new Invalid("id");
        return { method: r.method, id: r.id };
      case "findWorkspace":
        if (!str(r.words, 2000)) throw new Invalid("words");
        return { method: "findWorkspace", words: r.words };
      case "start":
        return { method: "start", spec: spec(r.spec) };
      case "cancel": case "pause": case "resume": case "result": case "diff": case "validate":
        if (!id(r.taskId)) throw new Invalid("taskId");
        return { method: r.method, taskId: r.taskId };
      case "log":
        if (!id(r.taskId) || (r.limit !== undefined && !(Number.isInteger(r.limit) && (r.limit as number) > 0 && (r.limit as number) <= 2000))) throw new Invalid("log");
        return { method: "log", taskId: r.taskId, limit: r.limit as number | undefined };
      case "amend":
        if (!id(r.taskId) || (r.instruction !== undefined && !str(r.instruction, 2000)) || (r.constraint !== undefined && !str(r.constraint, 300))) throw new Invalid("amend");
        return { method: "amend", taskId: r.taskId, instruction: r.instruction as string | undefined, constraint: r.constraint as string | undefined };
      default:
        throw new Invalid("unknown method");
    }
  };

  return {
    executor,
    registry,
    async handle(raw) {
      let req: CoderRequest;
      try { req = check(raw); } catch (e) { return { ok: false, error: `invalid coder request: ${(e as Error).message}` }; }
      try {
        return { ok: true, value: (await answer(req)) as never };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onEvents(l) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    async close() {
      await executor.shutdown();
      flush();
      unsubscribe();
      listeners.clear();
    },
  };
}
