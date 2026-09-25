// Contract tests for the Linux adapters with a scripted command runner: the commands each
// session type uses and how their outputs are read (X11, Wayland sway/Hyprland, ydotool,
// portal, no display). The real X11 path is exercised on Xvfb in tests/desktop.
import { describe, it, expect } from "vitest";
import type { Run, RunOptions, RunResult } from "../../src/node/linux/runner";
import { detectLinuxSession, type LinuxSession } from "../../src/node/linux/session";
import { LinuxClipboard, LinuxInput, LinuxWindows, hexId, xdotoolKeys, ydotoolKeys } from "../../src/node/linux/desktop";
import { LinuxDesktopEnvironment } from "../../src/node/linux/environment";
import { AtspiBridge } from "../../src/node/linux/atspi";
import { Kernel } from "../../src/lib/runtime/kernel";
import { performAction } from "../../src/lib/runtime/actions";
import { CompositeEnvironment } from "../../src/node/compositeEnvironment";
import { MemoryBrowser } from "../helpers/memoryBrowser";

type Call = { cmd: string; args: string[]; opts?: RunOptions };
function scripted(answers: (c: Call) => Partial<RunResult> | undefined) {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, opts) => {
    const c = { cmd, args, opts };
    calls.push(c);
    const a = answers(c) ?? { code: 127, stderr: `${cmd}: not found` };
    return { code: a.code ?? 0, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
  };
  return { run, calls };
}
const session = (over: Partial<LinuxSession>): LinuxSession => ({ display: "x11", desktop: "", tools: new Set(), atspiPython: null, portal: false, ...over });

describe("session detection", () => {
  it("finds the display type, tools from the fixed list, a Python with Atspi, and the portal", async () => {
    const { run, calls } = scripted((c) => {
      if (c.cmd === "sh") return { stdout: "wl-copy\nwl-paste\nbusctl\nevil; rm -rf /\n" };
      if (c.cmd === "python3") return { code: 1, stderr: "ImportError" };
      if (c.cmd === "/usr/bin/python3") return { stdout: "ok\n" };
      if (c.cmd === "busctl") return { stdout: "org.freedesktop.portal.RemoteDesktop interface" };
      return undefined;
    });
    const s = await detectLinuxSession(run, { WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "GNOME" });
    expect(s.display).toBe("wayland");
    expect([...s.tools].sort()).toEqual(["busctl", "wl-copy", "wl-paste"]);
    expect(s.atspiPython).toBe("/usr/bin/python3");
    expect(s.portal).toBe(true);
    expect(calls[0].args[1]).toMatch(/^for t in xclip xsel wl-copy wl-paste xdotool wmctrl ydotool swaymsg hyprctl busctl;/);
  });
});

describe("clipboard", () => {
  it("Wayland: wl-paste/wl-copy with --primary; empty selection is an empty answer", async () => {
    const { run, calls } = scripted((c) => {
      if (c.cmd === "wl-paste" && c.args.includes("--primary")) return { code: 1, stderr: "No selection\n" };
      if (c.cmd === "wl-paste") return { stdout: "Łódź" };
      if (c.cmd === "wl-copy") return {};
      return undefined;
    });
    const cb = new LinuxClipboard(run, session({ display: "wayland", tools: new Set(["wl-copy", "wl-paste"]) }));
    expect(await cb.read()).toEqual({ ok: true, text: "Łódź" });
    expect(await cb.read("primary")).toEqual({ ok: true, text: "" });
    expect(await cb.write("żółw", "primary")).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ cmd: "wl-copy", args: ["--primary"], opts: { input: "żółw", background: true } });
  });

  it("X11: xclip selections, the writer is left running in the background", async () => {
    const { run, calls } = scripted((c) => (c.cmd === "xclip" ? { stdout: c.args[0] === "-o" ? "abc" : "" } : undefined));
    const cb = new LinuxClipboard(run, session({ tools: new Set(["xclip"]) }));
    expect(await cb.read("primary")).toEqual({ ok: true, text: "abc" });
    expect(calls[0].args).toEqual(["-o", "-selection", "primary"]);
    await cb.write("x");
    expect(calls[1]).toMatchObject({ args: ["-i", "-selection", "clipboard"], opts: { background: true } });
  });

  it("no tool: an honest error, not an empty clipboard", async () => {
    const cb = new LinuxClipboard(scripted(() => undefined).run, session({ tools: new Set() }));
    expect(await cb.read()).toMatchObject({ ok: false });
  });
});

describe("windows", () => {
  it("X11: wmctrl -lpx is parsed, ids normalized to 0x%08x", async () => {
    const { run } = scripted((c) => (c.cmd === "wmctrl" ? { stdout: "0x01e00003  0 1234   xterm.XTerm      host Title with  spaces\n0x2200007 -1 99 Navigator.firefox host YouTube\n" } : undefined));
    const w = new LinuxWindows(run, session({ tools: new Set(["wmctrl"]) }));
    expect((await w.list()).windows).toEqual([
      { id: "0x01e00003", pid: 1234, app: "XTerm", title: "Title with  spaces" },
      { id: "0x02200007", pid: 99, app: "firefox", title: "YouTube" },
    ]);
    expect(hexId("31457283")).toBe("0x01e00003");
  });

  it("sway: the focused window from the tree; activation by con_id", async () => {
    const tree = { id: 1, type: "root", nodes: [{ id: 2, type: "output", nodes: [{ id: 3, type: "workspace", nodes: [
      { id: 10, type: "con", name: "Terminal", pid: 5, app_id: "foot", focused: false },
      { id: 11, type: "con", name: "YouTube - Firefox", pid: 6, app_id: "firefox", focused: true },
    ] }] }] };
    const { run, calls } = scripted((c) => (c.cmd === "swaymsg" ? { stdout: c.args[0] === "-t" ? JSON.stringify(tree) : "" } : undefined));
    const w = new LinuxWindows(run, session({ display: "wayland", tools: new Set(["swaymsg"]) }));
    expect(await w.active()).toEqual({ found: true, window: { id: "11", title: "YouTube - Firefox", app: "firefox", pid: 6 } });
    expect((await w.list()).windows.map((x) => x.id)).toEqual(["10", "11"]);
    await w.activate("10");
    expect(calls.at(-1)).toMatchObject({ cmd: "swaymsg", args: ["[con_id=10]", "focus"] });
    expect(await w.activate("10; exec rm -rf /")).toMatchObject({ ok: false });
  });

  it("Hyprland: activewindow and clients as JSON", async () => {
    const { run } = scripted((c) => {
      if (c.cmd !== "hyprctl") return undefined;
      if (c.args[0] === "activewindow") return { stdout: JSON.stringify({ address: "0x55d0", title: "Gmail", class: "chromium", pid: 42 }) };
      return { stdout: JSON.stringify([{ address: "0x55d0", title: "Gmail", class: "chromium", pid: 42 }]) };
    });
    const w = new LinuxWindows(run, session({ display: "wayland", tools: new Set(["hyprctl"]) }));
    expect(await w.active()).toEqual({ found: true, window: { id: "0x55d0", title: "Gmail", app: "chromium", pid: 42 } });
    expect((await w.list()).windows).toHaveLength(1);
  });

  it("GNOME/KDE Wayland without sway or Hyprland: not available, said plainly", async () => {
    const w = new LinuxWindows(scripted(() => undefined).run, session({ display: "wayland", tools: new Set(["wl-paste"]) }));
    expect(w.activeAvailable).toBe(false);
    expect(await w.active()).toMatchObject({ found: false, error: "no window tool for this session" });
  });
});

describe("input", () => {
  it("key names map to xdotool and to evdev codes for ydotool", () => {
    expect(xdotoolKeys("ctrl+c")).toBe("ctrl+c");
    expect(xdotoolKeys("shift+End")).toBe("shift+End");
    expect(xdotoolKeys("enter")).toBe("Return");
    expect(ydotoolKeys("ctrl+c")).toBe("29:1 46:1 46:0 29:0");
    expect(ydotoolKeys("ctrl+shift+v")).toBe("29:1 42:1 47:1 47:0 42:0 29:0");
    expect(ydotoolKeys("ctrl+ł")).toBeNull();
  });

  it("X11 uses xdotool, Wayland with ydotool uses ydotool, Wayland with only the portal needs permission", async () => {
    const x = scripted(() => ({}));
    expect(await new LinuxInput(x.run, session({ tools: new Set(["xdotool"]) })).keys("ctrl+c")).toEqual({ ok: true });
    expect(x.calls[0]).toMatchObject({ cmd: "xdotool", args: ["key", "--clearmodifiers", "ctrl+c"] });
    const y = scripted(() => ({}));
    await new LinuxInput(y.run, session({ display: "wayland", tools: new Set(["ydotool"]) })).type("Łódź");
    expect(y.calls[0]).toMatchObject({ cmd: "ydotool", args: ["type", "--", "Łódź"] });
    const p = new LinuxInput(scripted(() => ({})).run, session({ display: "wayland", tools: new Set(), portal: true }));
    expect(p.backend).toBe("portal");
    expect(await p.keys("ctrl+c")).toMatchObject({ ok: false, status: "needs_permission" });
    expect(await new LinuxInput(scripted(() => ({})).run, session({ display: null })).keys("ctrl+c")).toMatchObject({ ok: false, status: "needs_capability" });
  });
});

describe("AT-SPI bridge", () => {
  it("runs the helper with the detected Python and parses its JSON; no Python means unavailable", async () => {
    const { run, calls } = scripted((c) => (c.cmd === "/usr/bin/python3.12" ? { stdout: `${JSON.stringify({ found: true, app: "gedit", role: "text", name: "", text: "Łódź nocą", selection: "Łódź" })}\n` } : undefined));
    const a = new AtspiBridge(run, "/usr/bin/python3.12");
    expect(await a.focused()).toEqual({ found: true, app: "gedit", role: "text", name: "", text: "Łódź nocą", selection: "Łódź" });
    expect(calls[0].args[0]).toBe("-c");
    expect(calls[0].args[2]).toBe("focused");
    expect(await new AtspiBridge(run, null).focused()).toMatchObject({ found: false });
  });
});

describe("LinuxDesktopEnvironment through the action engine", () => {
  it("without a display every desktop capability is NEEDS_HARDWARE and actions do not start", async () => {
    const env = new LinuxDesktopEnvironment({ run: scripted(() => undefined).run, env: {} });
    const caps = await env.capabilities();
    expect(caps.filter((c) => c.id.startsWith("desktop.")).every((c) => c.status === "needs_hardware")).toBe(true);
    const k = new Kernel();
    k.dispatch({ type: "CapabilitiesUpdated", capabilities: caps });
    k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k" });
    const r = await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "desktop.type", text: "x" } });
    expect(r.truth).toBe("NEEDS_HARDWARE"); // no display at all: hardware, not a missing tool
  });

  it("clipboard.copy is ctrl+c confirmed only by the clipboard read-back", async () => {
    let clip = "old";
    const { run } = scripted((c) => {
      if (c.cmd === "sh") return { stdout: "xclip\nxdotool\n" };
      if (c.cmd.startsWith("python") || c.cmd.startsWith("/usr/bin/python")) return { code: 1 };
      if (c.cmd === "xdotool") { clip = "Łódź"; return {}; }
      if (c.cmd === "xclip") return { stdout: clip };
      return undefined;
    });
    const env = new LinuxDesktopEnvironment({ run, env: { DISPLAY: ":0" }, settleMs: 0 });
    const k = new Kernel();
    k.dispatch({ type: "CapabilitiesUpdated", capabilities: await env.capabilities() });
    k.dispatch({ type: "TaskCreated", taskId: "T", goal: "g", kind: "k" });
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Łódź" } })).truth).toBe("CONFIRMED");
    expect((await performAction({ kernel: k, env }, { taskId: "T", action: { kind: "clipboard.copy", expected: "Kraków" } })).truth).toBe("FAILED");
  });
});

describe("composite environment (browser + desktop)", () => {
  it("routes desktop actions and reads to the desktop, the rest to the browser, one capability list", async () => {
    const browser = new MemoryBrowser();
    const seen: string[] = [];
    const desktop = {
      id: "desk", capabilities: async () => [{ id: "desktop.clipboard", status: "available" as const, checkedAt: 0 }],
      act: async (a: { kind: string }) => { seen.push(`act ${a.kind}`); return { status: "done" as const }; },
      read: async (q: { kind: string }) => { seen.push(`read ${q.kind}`); return { found: true }; },
      onEvent: () => () => undefined, close: async () => undefined,
    };
    const env = new CompositeEnvironment(browser, desktop as never);
    expect(env.id).toBe(`${browser.id}+desk`);
    expect((await env.capabilities()).map((c) => c.id)).toContain("desktop.clipboard");
    await env.act({ kind: "desktop.keys", keys: "ctrl+c" });
    await env.act({ kind: "text.select", target: { ref: "atspi:focused" }, start: 0, end: 4, expected: "Łódź" });
    await env.read({ kind: "window" });
    expect(seen).toEqual(["act desktop.keys", "act text.select", "read window"]);
    expect((await env.act({ kind: "browser.launch" })).status).toBe("done");
    expect(await env.read({ kind: "page" })).toMatchObject({ open: true });
    const none = new CompositeEnvironment(browser, null);
    expect(await none.act({ kind: "desktop.type", text: "x" })).toMatchObject({ status: "needs_capability" });
    expect(await none.read({ kind: "windows" })).toMatchObject({ windows: [] });
  });
});
