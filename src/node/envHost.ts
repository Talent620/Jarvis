// Main-process side of the environment IPC: a pure dispatcher from JSON requests to one
// ComputerEnvironment, with per-call AbortControllers. Electron wires it to ipcMain in a few
// lines (electron/main.cjs); tests call it directly.

import type { EnvRequest } from "../lib/runtime/env/ipc";
import type { ComputerEnvironment } from "../lib/runtime/env/types";

export interface EnvHost {
  handle(req: EnvRequest): Promise<unknown>;
  /** Number of calls still running (diagnostics, leak tests). */
  pending(): number;
}

export function createEnvHost(env: ComputerEnvironment): EnvHost {
  const running = new Map<string, AbortController>();
  return {
    pending: () => running.size,
    async handle(req: EnvRequest): Promise<unknown> {
      switch (req.method) {
        case "capabilities": return env.capabilities();
        case "read": return env.read(req.query);
        case "snapshot": return env.snapshot ? env.snapshot(req.maxChars) : "";
        case "close": return env.close();
        case "abort": running.get(req.target)?.abort(); return true;
        case "act": {
          const ctrl = new AbortController();
          running.set(req.callId, ctrl);
          try {
            return await env.act(req.action, ctrl.signal);
          } finally {
            running.delete(req.callId);
          }
        }
        default: throw new Error(`unknown env method ${(req as { method?: string }).method}`);
      }
    },
  };
}
