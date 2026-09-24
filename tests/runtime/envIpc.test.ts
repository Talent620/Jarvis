import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { IpcEnvironment, type EnvBridge } from "../../src/lib/runtime/env/ipc";
import { createEnvHost } from "../../src/node/envHost";
import type { ActResult, ComputerEnvironment, EnvAction, EnvEvent, ReadQuery, ReadResult } from "../../src/lib/runtime/env/types";

class SlowEnv implements ComputerEnvironment {
  readonly id = "slow";
  listeners = new Set<(e: EnvEvent) => void>();
  sawAbort = false;
  async capabilities() { return [{ id: "browser.managed.semantic", status: "available" as const, checkedAt: 1 }]; }
  act(a: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (a.kind !== "browser.findCollection") return Promise.resolve({ status: "done", undo: { scrollY: 3 } });
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ status: "done" }), 5000);
      signal?.addEventListener("abort", () => { clearTimeout(t); this.sawAbort = true; resolve({ status: "failed", error: "aborted" }); });
    });
  }
  async read(q: ReadQuery): Promise<ReadResult> { return q.kind === "page" ? { open: true, url: "http://x/", scrollY: 10 } : { text: "Łódź", visible: true }; }
  onEvent(l: (e: EnvEvent) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  async close() {}
}

function pair() {
  const env = new SlowEnv();
  const host = createEnvHost(env);
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const bridge: EnvBridge = { call: async (req) => clone(await host.handle(clone(req))), onEvent: (cb) => env.onEvent((e) => cb(clone(e))) };
  return { env, host, proxy: new IpcEnvironment("slow", bridge) };
}

describe("environment over IPC", () => {
  it("round-trips capabilities, act results with undo, reads and events as plain JSON", async () => {
    const { env, proxy } = pair();
    expect(await proxy.capabilities()).toEqual([{ id: "browser.managed.semantic", status: "available", checkedAt: 1 }]);
    expect(await proxy.act({ kind: "browser.scroll", direction: "down", amount: "little" })).toEqual({ status: "done", undo: { scrollY: 3 } });
    expect(await proxy.read({ kind: "selection" })).toEqual({ text: "Łódź", visible: true });
    const got: EnvEvent[] = [];
    const off = proxy.onEvent((e) => got.push(e));
    for (const l of env.listeners) l({ type: "scroll", pageId: "p1", scrollY: 42 });
    off();
    for (const l of env.listeners) l({ type: "scroll", pageId: "p1", scrollY: 43 });
    expect(got).toEqual([{ type: "scroll", pageId: "p1", scrollY: 42 }]);
  });

  it("an abort in the renderer cancels the running call in the main process", async () => {
    const { env, host, proxy } = pair();
    const ctrl = new AbortController();
    const p = proxy.act({ kind: "browser.findCollection", itemKind: "comment" }, ctrl.signal);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.pending()).toBe(1);
    ctrl.abort();
    expect(await p).toEqual({ status: "failed", error: "aborted" });
    expect(env.sawAbort).toBe(true);
    expect(host.pending()).toBe(0);
  });

  it("an already aborted signal never reaches the main process", async () => {
    const { host, proxy } = pair();
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await proxy.act({ kind: "browser.launch" }, ctrl.signal)).toEqual({ status: "failed", error: "aborted" });
    expect(host.pending()).toBe(0);
  });

  it("a bridge failure becomes a failed act, never a success", async () => {
    const proxy = new IpcEnvironment("x", { call: async () => { throw new Error("ipc down"); }, onEvent: () => () => {} });
    expect(await proxy.act({ kind: "browser.launch" })).toEqual({ status: "failed", error: "ipc down" });
  });

  it("main.cjs only serves the env channel to the app's own file:// frame and preload exposes it", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const handler = main.slice(main.indexOf('ipcMain.handle("jarvis:env"'), main.indexOf('ipcMain.handle("jarvis:hardware-info"'));
    expect(handler).toContain("if (!isTrustedIpc(event)) return { status: \"failed\", error: \"forbidden\" };");
    expect(main).toContain('require("./gen/runtime.cjs")');
    const preload = readFileSync("electron/preload.cjs", "utf8");
    expect(preload).toContain('ipcRenderer.invoke("jarvis:env", req)');
    expect(preload).toContain('ipcRenderer.removeListener("jarvis:env-event", handler)');
  });
});
