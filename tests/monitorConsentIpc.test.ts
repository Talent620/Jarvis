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
  const watchCreate = vi.fn(async () => ({ ok: true, verified: true, paused: true, watchId: 'b8266333-03c2-4231-9c03-9870f2303c8b' }));
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
    "./monitor-connectors.cjs": { createMonitorConnectors: () => ({ list: async () => [{ id: 'fixture-connector', kind: 'changedetection', label: 'QA', baseUrl: 'http://127.0.0.1:5000/' }], createWatch: watchCreate }), watchSpec: require('../electron/monitor-connectors.cjs').watchSpec },
    "./skill-isolation.cjs": { createSkillIsolation: () => ({ cancelAll: vi.fn() }) },
    "./skill-manager.cjs": { createSkillManager: () => ({ command: skillCommand, stopAll: vi.fn() }), validateMcpQuery: require('../electron/skill-manager.cjs').validateMcpQuery },
  };
  const filename = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
  runInNewContext(readFileSync(filename, "utf8") + "\nmainWindow = testWindow; registerDesktopControl();", {
    require: (name: string) => dependencies[name] ?? (name.startsWith("./") ? {} : require(name)),
    __dirname: fileURLToPath(new URL("../electron", import.meta.url)),
    process: { platform: "linux", env: {}, pid: 99 }, Buffer, AbortController, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    testWindow: window,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  return { invoke: (name: string, payload?: unknown) => handlers.get(`jarvis:${name}`)!(event, payload), keyboard, command, skillCommand, watchCreate, showMessageBox, accept: () => resolve({ response: 1 }), fail: () => reject(new Error("dialog failed")) };
}

describe("monitor source consent cannot be accepted by JARVIS desktop input tools", () => {
  it("requires exact native approval before creating a paused watch and fences STOP during the dialog", async () => {
    const h = harness();
    const envelope = { request: { action: 'watch_create', connectorId: 'fixture-connector', url: 'https://example.org/offers', title: 'Offers', intervalMs: 60000, trustedUserAction: true }, taskId: 'watch-task', executionId: 'attempt-one', allowNetwork: true };
    const pending = h.invoke('skill-command', envelope);
    await vi.waitFor(() => expect(h.showMessageBox).toHaveBeenCalled());
    expect(h.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: expect.stringContaining('https://example.org/offers'), defaultId: 0 }));
    expect(await h.invoke('hotkey', { combo: 'enter' })).toBe('err:owner-confirmation-pending');
    await h.invoke('skill-cancel', { taskId: 'watch-task', executionId: 'attempt-one' });
    h.accept(); expect(await pending).toMatchObject({ ok: false }); expect(h.watchCreate).not.toHaveBeenCalled();
    const accepted = h.invoke('skill-command', { ...envelope, executionId: 'attempt-two' });
    await vi.waitFor(() => expect(h.showMessageBox).toHaveBeenCalledTimes(2)); h.accept();
    expect(await accepted).toMatchObject({ ok: true, verified: true, paused: true });
    expect(h.watchCreate).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.org/offers', intervalMs: 60000 }), expect.objectContaining({ trustedUserAction: true, taskId: 'watch-task' }));
  });
  it("requires native approval for an exact MCP registry query and rejects late approval after STOP", async () => {
    const h = harness();
    const envelope = { request: { action: 'search_mcp', query: 'filesystem', registryApproved: true }, taskId: 'registry-task', executionId: 'attempt-one', allowNetwork: true };
    const offline = await h.invoke('skill-command', { ...envelope, allowNetwork: false });
    expect(offline).toMatchObject({ ok: false }); expect(h.showMessageBox).not.toHaveBeenCalled();
    const pending = h.invoke('skill-command', envelope);
    expect(h.showMessageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: expect.stringContaining('filesystem'), defaultId: 0 }));
    expect(await h.invoke('hotkey', { combo: 'enter' })).toBe('err:owner-confirmation-pending');
    await h.invoke('skill-cancel', { taskId: 'registry-task', executionId: 'attempt-one' });
    h.accept(); expect(await pending).toMatchObject({ ok: false }); expect(h.skillCommand).not.toHaveBeenCalled();
    const accepted = h.invoke('skill-command', { ...envelope, executionId: 'attempt-two' }); h.accept();
    expect(await accepted).toMatchObject({ ok: true });
    expect(h.skillCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'search_mcp', query: 'filesystem' }), expect.objectContaining({ registryApproved: true }));
  });
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
