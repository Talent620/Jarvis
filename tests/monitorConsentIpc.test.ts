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
    "./mcp-stdio.cjs": { createStdioMcpManager: () => ({}) },
    "./goal-service.cjs": { createGoalService: () => ({ command }) },
  };
  const filename = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
  runInNewContext(readFileSync(filename, "utf8") + "\nmainWindow = testWindow; registerDesktopControl();", {
    require: (name: string) => dependencies[name] ?? (name.startsWith("./") ? {} : require(name)),
    __dirname: fileURLToPath(new URL("../electron", import.meta.url)),
    process: { platform: "linux", env: {}, pid: 99 }, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    testWindow: window,
  });
  const event = { sender: window.webContents, senderFrame: frame };
  return { invoke: (name: string, payload?: unknown) => handlers.get(`jarvis:${name}`)!(event, payload), keyboard, command, showMessageBox, accept: () => resolve({ response: 1 }), fail: () => reject(new Error("dialog failed")) };
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
});
