// Controlled native-dialog boundary test: executes the real main-process IPC registrations.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
function harness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = { url: "file:///fixture/index.html" };
  const window = { webContents: { mainFrame: frame }, isDestroyed: () => false };
  const keyboard = { hotkey: vi.fn(async () => "ok"), type: vi.fn(async () => "ok"), click: vi.fn(async () => "ok"), focusWindow: vi.fn(async () => ({ ok: true })) };
  const command = vi.fn(async () => ({}));
  const skillCommand = vi.fn(async () => ({}));
  let resolve!: (result: { response: number }) => void;
  let reject!: (error: Error) => void;
  const showMessageBox = vi.fn(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const electron = {
    app: { getPath: () => "/tmp/jarvis-no-profile-in-ipc-test", requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: () => {}, once: () => {} },
    ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => handlers.set(name, callback) },
    dialog: { showMessageBox },
  };
  const dependencies: Record<string, unknown> = {
    electron,
    "./linux-keyboard.cjs": { createLinuxKeyboard: () => keyboard },
    "./local-ollama.cjs": { createConfiguredLocalOllamaManager: () => ({}) },
    "./workspace-tools.cjs": { createWorkspaceTools: () => ({ root: "/tmp/fixture", cancelAll: vi.fn() }) },
    "./mcp-stdio.cjs": { createStdioMcpManager: () => ({ abortAll: vi.fn() }) },
    "./goal-service.cjs": { createGoalService: () => ({ command }) },
    "./monitor-connectors.cjs": { createMonitorConnectors: () => ({ list: async () => [] }) },
    "./skill-isolation.cjs": { createSkillIsolation: () => ({ cancelAll: vi.fn() }) },
    "./skill-manager.cjs": { createSkillManager: () => ({ command: skillCommand, stopAll: vi.fn() }) },
  };
  const filename = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
  runInNewContext(readFileSync(filename, "utf8") + "\nmainWindow = testWindow; registerDesktopControl();", {
    require: (name: string) => dependencies[name] ?? (name.startsWith("./") ? {} : require(name)),
    __dirname: fileURLToPath(new URL("../electron", import.meta.url)),
    process: { platform: "linux", env: {}, pid: 99 }, Buffer, AbortController, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    testWindow: window,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  return { invoke: (name: string, payload?: unknown) => handlers.get(`jarvis:${name}`)!(event, payload), keyboard, command, skillCommand, showMessageBox, accept: () => resolve({ response: 1 }), fail: () => reject(new Error("dialog failed")) };
}

describe("monitor source consent cannot be accepted by JARVIS desktop input tools", () => {
  it("blocks click/type/hotkey/focus while source dialog is pending and STOP rejects late acceptance", async () => {
    const h = harness();
    const pending = h.invoke("monitor-grant", { source: { kind: "json", url: "https://example.org/feed" } });
    for (const name of ["click", "type", "hotkey"]) expect(await h.invoke(name, {})).toBe("err:owner-confirmation-pending");
    expect(await h.invoke("focus-window", {})).toEqual({ ok: false, error: "err:owner-confirmation-pending" });
    for (const call of Object.values(h.keyboard)) expect(call).not.toHaveBeenCalled();
    await h.invoke("monitor-command", { action: "stop_all" });
    h.accept();
    expect(await pending).toMatchObject({ ok: false });
    expect(h.command).not.toHaveBeenCalledWith(expect.objectContaining({ action: "grant" }), expect.anything());
    expect(await h.invoke("hotkey", { combo: "ctrl+c", window: "fixture" })).toBe("ok");
  });

  it("releases the input guard on a dialog error and fences late background opt-in", async () => {
    const h = harness();
    const failed = h.invoke("monitor-grant", { source: { kind: "directory", path: "/tmp/fixture" } });
    const errorCheck = expect(failed).rejects.toThrow("dialog failed");
    h.fail(); await errorCheck;
    expect(await h.invoke("type", { text: "ok", window: "fixture" })).toBe("ok");
    const background = h.invoke("monitor-settings", { backgroundEnabled: true });
    expect(await h.invoke("hotkey", {})).toBe("err:owner-confirmation-pending");
    await h.invoke("monitor-command", { action: "stop_all" });
    h.accept();
    expect(await background).toMatchObject({ ok: false, backgroundEnabled: false });
    expect(await h.invoke("monitor-settings")).toMatchObject({ ok: true, backgroundEnabled: false });
  });

  it("skill policy requires native owner consent, blocks synthetic input and rejects late STOP approval", async () => {
    const h = harness();
    expect(await h.invoke("skill-command", { request: { action: "policy", trustedUserAction: true }, taskId: "task1" })).toMatchObject({ ok: false });
    expect(h.skillCommand).not.toHaveBeenCalled();
    const policy = { source: "owner/repo", codeKinds: ["instructions"], permissions: ["files.read"], licenses: ["MIT"], enabled: true };
    const pending = h.invoke("skill-policy", policy);
    expect(h.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultId: 0, detail: expect.stringContaining("owner/repo") }));
    expect(await h.invoke("hotkey", { combo: "enter" })).toBe("err:owner-confirmation-pending");
    await h.invoke("stop-workspace-processes");
    h.accept(); expect(await pending).toMatchObject({ ok: false });
    expect(h.skillCommand).not.toHaveBeenCalled();
    const accepted = h.invoke("skill-policy", policy); h.accept();
    expect(await accepted).toMatchObject({ ok: true });
    expect(h.skillCommand).toHaveBeenCalledWith({ ...policy, action: "policy" }, { trustedUserAction: true });
  });

  it("uses envelope task identity and rejects cancelled old task without poisoning a new one", async () => {
    const h = harness();
    await h.invoke("skill-cancel", "old-task");
    expect(await h.invoke("skill-command", { request: { action: "run", id: "p/x@v" }, taskId: "old-task" })).toMatchObject({ ok: false });
    expect(h.skillCommand).not.toHaveBeenCalled();
    expect(await h.invoke("skill-command", { request: { action: "list", taskId: "stolen", trustedUserAction: true }, taskId: "new-task", allowNetwork: false })).toMatchObject({ ok: true });
    expect(h.skillCommand).toHaveBeenCalledWith({ action: "list" }, expect.objectContaining({ taskId: "new-task", allowNetwork: false }));
  });
  it("attempt cancellation fences late work while a new provider attempt retains logical task pins", async () => {
    const h = harness();
    let resolve!: (value: object) => void;
    h.skillCommand.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = h.invoke("skill-command", { request: { action: "run", id: "p/x@v" }, taskId: "goal-one", executionId: "attempt-one" });
    await h.invoke("skill-cancel", { taskId: "goal-one", executionId: "attempt-one" });
    resolve({ result: "late" }); expect(await first).toMatchObject({ ok: false });
    expect(await h.invoke("skill-command", { request: { action: "list" }, taskId: "goal-one", executionId: "attempt-one" })).toMatchObject({ ok: false });
    expect(await h.invoke("skill-command", { request: { action: "list" }, taskId: "goal-one", executionId: "attempt-two" })).toMatchObject({ ok: true });
    await h.invoke("skill-cancel", { taskId: "goal-one" });
    expect(await h.invoke("skill-command", { request: { action: "list" }, taskId: "goal-one", executionId: "attempt-three" })).toMatchObject({ ok: false });
  });
});
