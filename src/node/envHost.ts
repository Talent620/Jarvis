// Main-process side of the environment IPC: a pure dispatcher from JSON requests to one
// ComputerEnvironment, with per-call AbortControllers. Electron wires it to ipcMain in a few
// lines (electron/main.cjs); tests call it directly. Requests come from a renderer, so every
// method, action kind and field is checked against an allow-list before it reaches the browser.

import type { EnvRequest } from "../lib/runtime/env/ipc";
import type { ComputerEnvironment, EnvAction, ReadQuery } from "../lib/runtime/env/types";

export interface EnvHost {
  handle(req: EnvRequest): Promise<unknown>;
  /** Number of calls still running (diagnostics, leak tests). */
  pending(): number;
}

class InvalidRequest extends Error {
  constructor(what: string) {
    super(`invalid env request: ${what}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): boolean => typeof v === "string" && v.length <= max;
const optStr = (v: unknown, max: number): boolean => v === undefined || str(v, max);
const int = (v: unknown, min: number, max: number): boolean => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const oneOf = (v: unknown, values: readonly string[]): boolean => typeof v === "string" && values.includes(v);

function target(v: unknown): boolean {
  return isObj(v) && str(v.ref, 500) && (v.ref as string).length > 0 && optStr(v.semanticKey, 4000) && optStr(v.kind, 40);
}

const SCROLL_AMOUNTS = ["little", "page", "more", "end", "start"] as const;
const MAX_TEXT = 20_000;
const MAX_OFFSET = 1_000_000;

/** Allowed action kinds and the shape each one must have. */
const ACTIONS: Record<EnvAction["kind"], (a: Record<string, unknown>) => boolean> = {
  "browser.launch": () => true,
  "browser.navigate": (a) => str(a.url, 2048) && /^https?:\/\//i.test(a.url as string),
  "browser.consent": (a) => oneOf(a.choice, ["reject", "accept"]),
  "browser.open": (a) => target(a.target),
  "browser.scroll": (a) => oneOf(a.direction, ["down", "up"]) && oneOf(a.amount, SCROLL_AMOUNTS),
  "browser.findCollection": (a) => str(a.itemKind, 40) && (a.minItems === undefined || int(a.minItems, 0, 10_000)) && (a.more === undefined || typeof a.more === "boolean"),
  "browser.focus": (a) => target(a.target),
  "text.select": (a) => target(a.target) && int(a.start, 0, MAX_OFFSET) && int(a.end, 0, MAX_OFFSET) && (a.end as number) >= (a.start as number) && str(a.expected, MAX_TEXT),
  "clipboard.copy": (a) => str(a.expected, MAX_TEXT) && (a.reselect === undefined || (isObj(a.reselect) && target(a.reselect.target) && int(a.reselect.start, 0, MAX_OFFSET) && int(a.reselect.end, 0, MAX_OFFSET))),
  "browser.scrollTo": (a) => typeof a.y === "number" && Number.isFinite(a.y) && a.y >= 0 && a.y <= 10_000_000,
  "desktop.keys": (a) => str(a.keys, 40) && /^[a-z0-9]+(\+[a-z0-9]+)*$/i.test(a.keys as string) && optStr(a.expectClipboard, MAX_TEXT),
  "desktop.type": (a) => str(a.text, 2000) && (a.text as string).length > 0,
  "window.activate": (a) => str(a.windowId, 100) && (a.windowId as string).length > 0,
  "clipboard.write": (a) => str(a.text, MAX_TEXT),
};

const READS: Record<ReadQuery["kind"], (q: Record<string, unknown>) => boolean> = {
  page: () => true,
  selection: () => true,
  clipboard: () => true,
  element: (q) => target(q.target),
  collection: (q) => str(q.itemKind, 40),
  window: () => true,
  windows: () => true,
  focused: () => true,
};

export function validateEnvRequest(req: unknown): EnvRequest {
  if (!isObj(req)) throw new InvalidRequest("not an object");
  if (!str(req.callId, 100)) throw new InvalidRequest("callId");
  switch (req.method) {
    case "capabilities":
    case "close":
      return req as unknown as EnvRequest;
    case "snapshot":
      if (req.maxChars !== undefined && !int(req.maxChars, 1, 100_000)) throw new InvalidRequest("maxChars");
      return req as unknown as EnvRequest;
    case "abort":
      if (!str(req.target, 100)) throw new InvalidRequest("abort target");
      return req as unknown as EnvRequest;
    case "read": {
      const q = req.query;
      if (!isObj(q) || typeof q.kind !== "string" || !Object.prototype.hasOwnProperty.call(READS, q.kind)) throw new InvalidRequest("read kind");
      if (!READS[q.kind as ReadQuery["kind"]](q)) throw new InvalidRequest(`read ${q.kind}`);
      return req as unknown as EnvRequest;
    }
    case "act": {
      const a = req.action;
      if (!isObj(a) || typeof a.kind !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, a.kind)) throw new InvalidRequest("action kind");
      if (!ACTIONS[a.kind as EnvAction["kind"]](a)) throw new InvalidRequest(`action ${a.kind}`);
      return req as unknown as EnvRequest;
    }
    default:
      throw new InvalidRequest("method");
  }
}

export function createEnvHost(env: ComputerEnvironment): EnvHost {
  const running = new Map<string, AbortController>();
  return {
    pending: () => running.size,
    async handle(raw: EnvRequest): Promise<unknown> {
      const req = validateEnvRequest(raw);
      switch (req.method) {
        case "capabilities": return env.capabilities();
        case "read": return env.read(req.query);
        case "snapshot": return env.snapshot ? env.snapshot(req.maxChars) : "";
        case "close": return env.close();
        case "abort": running.get(req.target)?.abort(); return true;
        case "act": {
          if (running.has(req.callId)) throw new InvalidRequest("callId already running");
          const ctrl = new AbortController();
          running.set(req.callId, ctrl);
          try {
            return await env.act(req.action, ctrl.signal);
          } finally {
            running.delete(req.callId);
          }
        }
      }
    },
  };
}
