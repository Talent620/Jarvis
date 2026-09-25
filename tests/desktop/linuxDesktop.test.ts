// Linux adapters (M7) on a real X11 session under Xvfb: clipboard, active window, window list,
// window activation, AT-SPI focused text and selection, synthetic keys and typing. Actions run
// through the same action engine as the browser, so every one is confirmed by a read-back.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import { LinuxDesktopEnvironment } from "../../src/node/linux/environment";
import type { FocusedRead, SelectionRead, WindowListRead, WindowRead } from "../../src/lib/runtime/env/types";
import { DESKTOP_TOOLS_READY, startXSession, type XSession } from "./xsession";

it("in CI the desktop tools are installed, so the suite below cannot silently skip", () => {
  if (process.env.CI) expect(DESKTOP_TOOLS_READY).toBe(true);
});

describe.skipIf(!DESKTOP_TOOLS_READY)("Linux desktop adapters on Xvfb (X11, openbox, AT-SPI, GTK)", () => {
  let x: XSession;
  let env: LinuxDesktopEnvironment;
  let kernel: Kernel;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    x = await startXSession();
    for (const k of ["DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "WAYLAND_DISPLAY"]) { saved[k] = process.env[k]; }
    process.env.DISPLAY = x.env.DISPLAY;
    process.env.DBUS_SESSION_BUS_ADDRESS = x.env.DBUS_SESSION_BUS_ADDRESS;
    delete process.env.WAYLAND_DISPLAY;
    env = new LinuxDesktopEnvironment({ env: x.env });
    kernel = new Kernel();
    kernel.dispatch({ type: "CapabilitiesUpdated", capabilities: await env.capabilities() });
    kernel.dispatch({ type: "TaskCreated", taskId: "T", goal: "desktop", kind: "desktop" });
  }, 30_000);

  afterAll(async () => {
    await env?.close();
    await x?.stop();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("capabilities reflect the session", async () => {
    const caps = Object.fromEntries((await env.capabilities()).map((c) => [c.id, c.status]));
    expect(caps).toMatchObject({
      "desktop.clipboard": "available", "desktop.primary_selection": "available", "desktop.active_window": "available",
      "desktop.window_list": "available", "linux.input.xdotool": "available", "linux.atspi": "available",
    });
  });

  it("lists both windows and switches between them, confirmed by reading the active window", async () => {
    const list = (await env.read({ kind: "windows" })) as WindowListRead;
    const second = list.windows.find((w) => w.title === "Second window");
    const editor = list.windows.find((w) => w.title === "JARVIS test editor");
    expect(second && editor).toBeTruthy();
    const r1 = await performAction({ kernel, env }, { taskId: "T", action: { kind: "window.activate", windowId: second!.id } });
    expect(r1.truth).toBe("CONFIRMED");
    expect(((await env.read({ kind: "window" })) as WindowRead).window?.title).toBe("Second window");
    const r2 = await performAction({ kernel, env }, { taskId: "T", action: { kind: "window.activate", windowId: editor!.id } });
    expect(r2).toMatchObject({ truth: "CONFIRMED" });
  });

  it("clipboard write is confirmed by reading the system clipboard", async () => {
    const r = await performAction({ kernel, env }, { taskId: "T", action: { kind: "clipboard.write", text: "żółw 🐢" } });
    expect(r).toMatchObject({ truth: "CONFIRMED" });
    expect(await env.read({ kind: "clipboard" })).toEqual({ ok: true, text: "żółw 🐢" });
  });

  it("AT-SPI reads the focused field, selects the first four letters, ctrl+c copies exactly them", async () => {
    const f = (await env.read({ kind: "focused" })) as FocusedRead;
    expect(f).toMatchObject({ found: true, role: "text", text: "Łódź nocą" });
    const sel = await performAction({ kernel, env }, { taskId: "T", action: { kind: "text.select", target: { ref: "atspi:focused" }, start: 0, end: 4, expected: "Łódź" } });
    expect(sel).toMatchObject({ truth: "CONFIRMED" });
    expect(((await env.read({ kind: "selection" })) as SelectionRead).text).toBe("Łódź");
    const copy = await performAction({ kernel, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Łódź" } });
    expect(copy).toMatchObject({ truth: "CONFIRMED" });
    expect(await env.read({ kind: "clipboard" })).toEqual({ ok: true, text: "Łódź" });
  });

  it("typing is confirmed by the focused field's text", async () => {
    await performAction({ kernel, env }, { taskId: "T", action: { kind: "desktop.keys", keys: "End" } });
    const r = await performAction({ kernel, env }, { taskId: "T", action: { kind: "desktop.type", text: " jarvis" } });
    expect(r).toMatchObject({ truth: "CONFIRMED" });
    expect(((await env.read({ kind: "focused" })) as FocusedRead).text).toContain(" jarvis");
  });

  it("a key combo without a declared read-back is only ATTEMPTED, never CONFIRMED", async () => {
    const r = await performAction({ kernel, env }, { taskId: "T", action: { kind: "desktop.keys", keys: "shift+Home" } });
    expect(r.truth).toBe("ATTEMPTED");
  });

  it("perception: switching windows emits a window event", async () => {
    const polled = new LinuxDesktopEnvironment({ env: x.env, pollMs: 100 });
    const seen: string[] = [];
    const off = polled.onEvent((e) => { if (e.type === "window") seen.push(e.title); });
    const list = (await env.read({ kind: "windows" })) as WindowListRead;
    await new Promise((r) => setTimeout(r, 300));
    await env.act({ kind: "window.activate", windowId: list.windows.find((w) => w.title === "Second window")!.id });
    await new Promise((r) => setTimeout(r, 400));
    off();
    await polled.close();
    expect(seen).toContain("Second window");
  });
});
