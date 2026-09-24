// Renderer-side proxy for an environment living in another process (Electron main). Every
// call is plain JSON; cancellation crosses the boundary as an explicit "abort" call.

import type { CapabilityState } from "../types";
import type { ActResult, ComputerEnvironment, EnvAction, EnvEvent, ReadQuery, ReadResult } from "./types";

export type EnvRequest =
  | { method: "capabilities"; callId: string }
  | { method: "act"; callId: string; action: EnvAction }
  | { method: "read"; callId: string; query: ReadQuery }
  | { method: "snapshot"; callId: string; maxChars?: number }
  | { method: "abort"; callId: string; target: string }
  | { method: "close"; callId: string };

export interface EnvBridge {
  call(req: EnvRequest): Promise<unknown>;
  onEvent(listener: (e: EnvEvent) => void): () => void;
}

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}${(++seq).toString(36)}`;

export class IpcEnvironment implements ComputerEnvironment {
  constructor(readonly id: string, private readonly bridge: EnvBridge) {}

  capabilities(): Promise<CapabilityState[]> {
    return this.bridge.call({ method: "capabilities", callId: nextId() }) as Promise<CapabilityState[]>;
  }

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (signal?.aborted) return { status: "failed", error: "aborted" };
    const callId = nextId();
    const onAbort = () => { void this.bridge.call({ method: "abort", callId: nextId(), target: callId }).catch(() => undefined); };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return (await this.bridge.call({ method: "act", callId, action })) as ActResult;
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  read(query: ReadQuery): Promise<ReadResult> {
    return this.bridge.call({ method: "read", callId: nextId(), query }) as Promise<ReadResult>;
  }

  snapshot(maxChars?: number): Promise<string> {
    return this.bridge.call({ method: "snapshot", callId: nextId(), maxChars }) as Promise<string>;
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    return this.bridge.onEvent(listener);
  }

  async close(): Promise<void> {
    await this.bridge.call({ method: "close", callId: nextId() });
  }
}

/** The bridge exposed by electron/preload.cjs, if this renderer runs inside the desktop app. */
export function desktopEnvBridge(): EnvBridge | null {
  const w = (typeof window !== "undefined" ? window : undefined) as unknown as {
    jarvisDesktop?: { env?: { call: (req: EnvRequest) => Promise<unknown>; onEvent: (cb: (e: EnvEvent) => void) => () => void } };
  } | undefined;
  const env = w?.jarvisDesktop?.env;
  return env ? { call: (r) => env.call(r), onEvent: (cb) => env.onEvent(cb) } : null;
}
