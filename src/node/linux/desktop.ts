// Linux desktop primitives behind small classes (mission 5.6, M7): system clipboard and primary
// selection (wl-clipboard or xclip/xsel), the active window and window list (xdotool/wmctrl on
// X11, swaymsg or hyprctl on Wayland), and synthetic input (xdotool on X11, ydotool on Wayland).
// Wayland input through the RemoteDesktop portal needs the user's consent and a libei helper,
// so it is reported, not faked.

import type { ClipboardRead, WindowInfo, WindowListRead, WindowRead } from "../../lib/runtime/env/types";
import type { Run } from "./runner";
import type { LinuxSession } from "./session";

export type Selection = "clipboard" | "primary";

/** Tool output is data: invalid JSON is an error value, never an exception. */
function parseJson<T>(text: string): T | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

export class LinuxClipboard {
  constructor(private readonly run: Run, private readonly s: LinuxSession) {}

  get available(): boolean {
    return this.s.display === "wayland" ? this.s.tools.has("wl-paste") && this.s.tools.has("wl-copy") : this.s.display === "x11" && (this.s.tools.has("xclip") || this.s.tools.has("xsel"));
  }

  async read(sel: Selection = "clipboard"): Promise<ClipboardRead> {
    if (!this.available) return { ok: false, error: "no clipboard tool for this session (wl-clipboard or xclip)" };
    const r = this.s.display === "wayland"
      ? await this.run("wl-paste", ["--no-newline", ...(sel === "primary" ? ["--primary"] : [])])
      : this.s.tools.has("xclip")
        ? await this.run("xclip", ["-o", "-selection", sel])
        : await this.run("xsel", ["-o", sel === "primary" ? "-p" : "-b"]);
    if (r.code === 0) return { ok: true, text: r.stdout };
    // An empty selection is an answer, not an error.
    if (/no selection|not available|nothing is copied|no suitable type/i.test(r.stderr)) return { ok: true, text: "" };
    return { ok: false, error: r.stderr.trim().split("\n")[0] || `exit ${r.code}` };
  }

  async write(text: string, sel: Selection = "clipboard"): Promise<{ ok: boolean; error?: string }> {
    if (!this.available) return { ok: false, error: "no clipboard tool for this session" };
    const r = this.s.display === "wayland"
      ? await this.run("wl-copy", sel === "primary" ? ["--primary"] : [], { input: text, background: true })
      : this.s.tools.has("xclip")
        ? await this.run("xclip", ["-i", "-selection", sel], { input: text, background: true })
        : await this.run("xsel", ["-i", sel === "primary" ? "-p" : "-b"], { input: text, background: true });
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `exit ${r.code}` };
  }
}

/** X11 window ids in one canonical form: 0x + 8 hex digits. */
export const hexId = (id: string | number): string => {
  const n = typeof id === "number" ? id : id.startsWith("0x") ? parseInt(id, 16) : parseInt(id, 10);
  return `0x${n.toString(16).padStart(8, "0")}`;
};

interface SwayNode { id: number; type?: string; name?: string | null; focused?: boolean; pid?: number; app_id?: string | null; window_properties?: { class?: string }; nodes?: SwayNode[]; floating_nodes?: SwayNode[] }

function swayWindows(root: SwayNode): (WindowInfo & { focused: boolean })[] {
  const out: (WindowInfo & { focused: boolean })[] = [];
  const walk = (n: SwayNode) => {
    if ((n.type === "con" || n.type === "floating_con") && n.pid) {
      out.push({ id: String(n.id), title: n.name ?? "", app: n.app_id ?? n.window_properties?.class, pid: n.pid, focused: !!n.focused });
    }
    for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) walk(c);
  };
  walk(root);
  return out;
}

export class LinuxWindows {
  constructor(private readonly run: Run, private readonly s: LinuxSession) {}

  get activeAvailable(): boolean {
    const t = this.s.tools;
    return this.s.display === "x11" ? t.has("xdotool") : t.has("swaymsg") || t.has("hyprctl");
  }

  get listAvailable(): boolean {
    const t = this.s.tools;
    return this.s.display === "x11" ? t.has("wmctrl") : t.has("swaymsg") || t.has("hyprctl");
  }

  async active(): Promise<WindowRead> {
    const t = this.s.tools;
    if (this.s.display === "x11" && t.has("xdotool")) {
      const id = await this.run("xdotool", ["getactivewindow"]);
      if (id.code !== 0 || !id.stdout.trim()) return { found: false, error: id.stderr.trim() || "no active window" };
      const win = id.stdout.trim();
      const [name, pid] = await Promise.all([this.run("xdotool", ["getwindowname", win]), this.run("xdotool", ["getwindowpid", win])]);
      const app = t.has("wmctrl") ? (await this.list()).windows.find((w) => w.id === hexId(win))?.app : undefined;
      return { found: true, window: { id: hexId(win), title: name.stdout.trim(), pid: pid.code === 0 ? Number(pid.stdout.trim()) : undefined, app } };
    }
    if (t.has("swaymsg")) {
      const r = await this.run("swaymsg", ["-t", "get_tree", "-r"]);
      if (r.code !== 0) return { found: false, error: r.stderr.trim() };
      const tree = parseJson<SwayNode>(r.stdout);
      if (!tree) return { found: false, error: "swaymsg returned invalid JSON" };
      const w = swayWindows(tree).find((x) => x.focused);
      return w ? { found: true, window: { id: w.id, title: w.title, app: w.app, pid: w.pid } } : { found: false, error: "no focused window" };
    }
    if (t.has("hyprctl")) {
      const r = await this.run("hyprctl", ["activewindow", "-j"]);
      if (r.code !== 0) return { found: false, error: r.stderr.trim() };
      const w = parseJson<{ address?: string; title?: string; class?: string; pid?: number }>(r.stdout);
      if (!w) return { found: false, error: "hyprctl returned invalid JSON" };
      return w.address ? { found: true, window: { id: w.address, title: w.title ?? "", app: w.class, pid: w.pid } } : { found: false, error: "no active window" };
    }
    return { found: false, error: "no window tool for this session" };
  }

  async list(): Promise<WindowListRead> {
    const t = this.s.tools;
    if (this.s.display === "x11" && t.has("wmctrl")) {
      const r = await this.run("wmctrl", ["-lpx"]);
      if (r.code !== 0) return { windows: [], error: r.stderr.trim() || "wmctrl failed (is a window manager running?)" };
      // 0x01e00003  0 1234   xterm.XTerm      host Title with spaces
      const windows = r.stdout.split("\n").filter(Boolean).map((line) => {
        const m = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(\S+)\s+\S+\s?(.*)$/i.exec(line);
        return m ? { id: hexId(m[1]), pid: Number(m[3]) || undefined, app: m[4].split(".").pop(), title: m[5] } : null;
      }).filter((w): w is NonNullable<typeof w> => !!w);
      return { windows };
    }
    if (t.has("swaymsg")) {
      const r = await this.run("swaymsg", ["-t", "get_tree", "-r"]);
      if (r.code !== 0) return { windows: [], error: r.stderr.trim() };
      const tree = parseJson<SwayNode>(r.stdout);
      if (!tree) return { windows: [], error: "swaymsg returned invalid JSON" };
      return { windows: swayWindows(tree).map(({ focused: _f, ...w }) => w) };
    }
    if (t.has("hyprctl")) {
      const r = await this.run("hyprctl", ["clients", "-j"]);
      if (r.code !== 0) return { windows: [], error: r.stderr.trim() };
      const list = parseJson<{ address: string; title?: string; class?: string; pid?: number }[]>(r.stdout);
      if (!Array.isArray(list)) return { windows: [], error: "hyprctl returned invalid JSON" };
      return { windows: list.filter((w) => w && typeof w.address === "string").map((w) => ({ id: w.address, title: w.title ?? "", app: w.class, pid: w.pid })) };
    }
    return { windows: [], error: "no window list tool for this session" };
  }

  async activate(id: string): Promise<{ ok: boolean; error?: string }> {
    const t = this.s.tools;
    let r;
    if (this.s.display === "x11" && t.has("wmctrl")) r = await this.run("wmctrl", ["-ia", hexId(id)]);
    else if (this.s.display === "x11" && t.has("xdotool")) r = await this.run("xdotool", ["windowactivate", "--sync", String(parseInt(hexId(id), 16))]);
    else if (t.has("swaymsg") && /^\d+$/.test(id)) r = await this.run("swaymsg", [`[con_id=${id}]`, "focus"]);
    else if (t.has("hyprctl") && /^0x[0-9a-f]+$/i.test(id)) r = await this.run("hyprctl", ["dispatch", "focuswindow", `address:${id}`]);
    else return { ok: false, error: "no tool to activate windows in this session" };
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `exit ${r.code}` };
  }
}

// ------------------------------------------------------------------ input

const XDOTOOL_NAMES: Record<string, string> = {
  ctrl: "ctrl", control: "ctrl", shift: "shift", alt: "alt", super: "super", meta: "super", win: "super",
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", tab: "Tab", backspace: "BackSpace",
  delete: "Delete", del: "Delete", space: "space", up: "Up", down: "Down", left: "Left", right: "Right",
  home: "Home", end: "End", pageup: "Prior", pagedown: "Next",
};

/** evdev key codes for ydotool (linux/input-event-codes.h). */
const EVDEV: Record<string, number> = {
  esc: 1, escape: 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
  backspace: 14, tab: 15, q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25, enter: 28, return: 28,
  ctrl: 29, control: 29, a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38, shift: 42,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50, alt: 56, space: 57, home: 102, up: 103, pageup: 104,
  left: 105, right: 106, end: 107, down: 108, pagedown: 109, delete: 111, del: 111, super: 125, meta: 125, win: 125,
};

export function xdotoolKeys(combo: string): string {
  return combo.split("+").map((k) => XDOTOOL_NAMES[k.toLowerCase()] ?? k.toLowerCase()).join("+");
}

/** "ctrl+c" -> "29:1 46:1 46:0 29:0" (press in order, release in reverse). */
export function ydotoolKeys(combo: string): string | null {
  const codes = combo.split("+").map((k) => EVDEV[k.toLowerCase()]);
  if (codes.some((c) => c === undefined)) return null;
  return [...codes.map((c) => `${c}:1`), ...[...codes].reverse().map((c) => `${c}:0`)].join(" ");
}

export type InputBackend = "xdotool" | "ydotool" | "portal" | "none";

export class LinuxInput {
  constructor(private readonly run: Run, private readonly s: LinuxSession) {}

  get backend(): InputBackend {
    if (this.s.display === "x11" && this.s.tools.has("xdotool")) return "xdotool";
    if (this.s.tools.has("ydotool")) return "ydotool";
    if (this.s.display === "wayland" && this.s.portal) return "portal";
    return "none";
  }

  async keys(combo: string, signal?: AbortSignal): Promise<{ ok: boolean; status?: "needs_permission" | "needs_capability"; error?: string }> {
    switch (this.backend) {
      case "xdotool": {
        const r = await this.run("xdotool", ["key", "--clearmodifiers", xdotoolKeys(combo)], { signal });
        return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `exit ${r.code}` };
      }
      case "ydotool": {
        const seq = ydotoolKeys(combo);
        if (!seq) return { ok: false, status: "needs_capability", error: `no evdev code for ${combo}` };
        const r = await this.run("ydotool", ["key", ...seq.split(" ")], { signal });
        return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || "ydotool failed (is ydotoold running?)" };
      }
      case "portal":
        return { ok: false, status: "needs_permission", error: "Wayland input goes through the RemoteDesktop portal: it needs your consent in the portal dialog and a libei helper (not available in this build)" };
      default:
        return { ok: false, status: "needs_capability", error: "no input tool (xdotool on X11, ydotool or the RemoteDesktop portal on Wayland)" };
    }
  }

  async type(text: string, signal?: AbortSignal): Promise<{ ok: boolean; status?: "needs_permission" | "needs_capability"; error?: string }> {
    switch (this.backend) {
      case "xdotool": {
        const r = await this.run("xdotool", ["type", "--clearmodifiers", "--delay", "12", "--", text], { timeoutMs: 5000 + text.length * 40, signal });
        return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || `exit ${r.code}` };
      }
      case "ydotool": {
        const r = await this.run("ydotool", ["type", "--", text], { timeoutMs: 5000 + text.length * 40, signal });
        return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || "ydotool failed (is ydotoold running?)" };
      }
      case "portal":
        return { ok: false, status: "needs_permission", error: "RemoteDesktop portal consent and a libei helper are required" };
      default:
        return { ok: false, status: "needs_capability", error: "no input tool" };
    }
  }
}
