// Linux desktop behind the ComputerEnvironment contract (mission 5.6, M7). Same actions and raw
// read-backs as the managed browser, so the runtime verifies them the same way: copy is proven
// by reading the clipboard, a selection by AT-SPI or the primary selection, a window switch by
// reading the active window. Anything this session cannot do is reported as a capability.

import type {
  ActResult, ComputerEnvironment, EnvAction, EnvEvent, ReadQuery, ReadResult, SelectionRead,
} from "../../lib/runtime/env/types";
import type { CapabilityState, CapabilityStatus } from "../../lib/runtime/types";
import { AtspiBridge } from "./atspi";
import { LinuxClipboard, LinuxInput, LinuxWindows } from "./desktop";
import { execRunner, type Run } from "./runner";
import { detectLinuxSession, type LinuxSession } from "./session";

export interface LinuxEnvironmentOptions {
  run?: Run;
  env?: Record<string, string | undefined>;
  /** Active window polling for perception events (ms); 0 disables. */
  pollMs?: number;
  now?: () => number;
  /** Pause after keys so the target application handles them before the read-back. */
  settleMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LinuxDesktopEnvironment implements ComputerEnvironment {
  readonly id = "linux-desktop";
  private readonly run: Run;
  private session: Promise<LinuxSession> | null = null;
  private listeners = new Set<(e: EnvEvent) => void>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private lastWindow = "";
  private readonly now: () => number;

  constructor(private readonly o: LinuxEnvironmentOptions = {}) {
    this.run = o.run ?? execRunner;
    this.now = o.now ?? (() => Date.now());
  }

  private async parts() {
    this.session ??= detectLinuxSession(this.run, this.o.env ?? process.env);
    const s = await this.session;
    return { s, clipboard: new LinuxClipboard(this.run, s), windows: new LinuxWindows(this.run, s), input: new LinuxInput(this.run, s), atspi: new AtspiBridge(this.run, s.atspiPython) };
  }

  async capabilities(): Promise<CapabilityState[]> {
    const { s, clipboard, windows, input, atspi } = await this.parts();
    const at = this.now();
    const cap = (id: string, status: CapabilityStatus, detail?: string): CapabilityState => ({ id, status, detail, provider: this.id, checkedAt: at });
    const noDisplay = !s.display;
    const atspiOk = atspi.available ? (await atspi.ping()).ok : false;
    return [
      cap("desktop.clipboard", clipboard.available ? "available" : noDisplay ? "needs_hardware" : "missing", clipboard.available ? (s.display === "wayland" ? "wl-clipboard" : "xclip/xsel") : "install wl-clipboard (Wayland) or xclip (X11)"),
      cap("desktop.primary_selection", clipboard.available ? "available" : noDisplay ? "needs_hardware" : "missing"),
      cap("desktop.active_window", windows.activeAvailable ? "available" : noDisplay ? "needs_hardware" : "missing", s.display === "wayland" ? "swaymsg or hyprctl (GNOME/KDE need a shell extension)" : "xdotool"),
      cap("desktop.window_list", windows.listAvailable ? "available" : noDisplay ? "needs_hardware" : "missing", s.display === "wayland" ? "swaymsg or hyprctl" : "wmctrl"),
      cap("linux.input.xdotool", input.backend === "xdotool" ? "available" : "missing"),
      cap("linux.input.ydotool", s.tools.has("ydotool") ? "degraded" : "missing", "needs ydotoold with access to /dev/uinput"),
      cap("linux.input.portal", s.portal ? "needs_permission" : noDisplay ? "needs_hardware" : "missing", "RemoteDesktop portal: user consent and a libei helper"),
      cap("linux.atspi", atspiOk ? "available" : atspi.available ? "needs_permission" : noDisplay ? "needs_hardware" : "missing", atspiOk ? `python ${s.atspiPython}` : "gi Atspi 2.0 and an accessibility bus (enable screen reader support)"),
    ];
  }

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (signal?.aborted) return { status: "failed", error: "aborted" };
    const { clipboard, windows, input, atspi } = await this.parts();
    const settle = () => sleep(this.o.settleMs ?? 80);
    switch (action.kind) {
      case "clipboard.write": {
        const r = await clipboard.write(action.text);
        return r.ok ? { status: "done" } : { status: clipboard.available ? "failed" : "needs_capability", error: r.error };
      }
      case "clipboard.copy":
      case "desktop.keys": {
        const combo = action.kind === "clipboard.copy" ? "ctrl+c" : action.keys;
        const r = await input.keys(combo);
        if (!r.ok) return { status: r.status ?? "failed", error: r.error };
        await settle();
        return { status: "done" };
      }
      case "desktop.type": {
        const r = await input.type(action.text);
        if (!r.ok) return { status: r.status ?? "failed", error: r.error };
        await settle();
        return { status: "done" };
      }
      case "window.activate": {
        const r = await windows.activate(action.windowId);
        if (!r.ok) return { status: windows.activeAvailable ? "failed" : "needs_capability", error: r.error };
        await settle();
        return { status: "done" };
      }
      case "text.select": {
        if (action.target.ref !== "atspi:focused") return { status: "not_found", error: "desktop selection works on the focused text element (atspi:focused)" };
        if (!atspi.available) return { status: "needs_capability", error: "AT-SPI is not available" };
        const r = await atspi.select(action.start, action.end);
        return r.ok ? { status: "done" } : { status: "failed", error: r.error ?? "selection refused" };
      }
      default:
        return { status: "needs_capability", error: `${action.kind} is a browser action` };
    }
  }

  async read(q: ReadQuery): Promise<ReadResult> {
    const { clipboard, windows, atspi } = await this.parts();
    switch (q.kind) {
      case "clipboard":
        return clipboard.read("clipboard");
      case "selection": {
        // The focused element's own selection first (AT-SPI), else the X/Wayland primary selection.
        if (atspi.available) {
          const f = await atspi.focused();
          if (f.found && f.selection) return { text: f.selection, visible: true, ref: "atspi:focused" } satisfies SelectionRead;
        }
        const p = await clipboard.read("primary");
        return { text: p.ok ? p.text ?? "" : "", visible: p.ok && !!p.text } satisfies SelectionRead;
      }
      case "window":
        return windows.active();
      case "windows":
        return windows.list();
      case "focused":
        return atspi.available ? atspi.focused() : { found: false, error: "AT-SPI is not available" };
      case "page":
        return { open: false };
      case "element":
        return { found: false };
      case "collection":
        return { count: 0, items: [] };
    }
  }

  async snapshot(maxChars = 1200): Promise<string> {
    const { atspi } = await this.parts();
    if (!atspi.available) return "";
    return (await atspi.dump(120)).slice(0, maxChars);
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    this.listeners.add(listener);
    const every = this.o.pollMs ?? 0;
    if (every > 0 && !this.poll) {
      this.poll = setInterval(() => { void this.pollWindow(); }, every);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.poll) { clearInterval(this.poll); this.poll = null; }
    };
  }

  private async pollWindow(): Promise<void> {
    const { windows } = await this.parts();
    if (!windows.activeAvailable) return;
    const w = await windows.active();
    if (!w.found || !w.window) return;
    const key = `${w.window.id}|${w.window.title}`;
    if (key === this.lastWindow) return;
    this.lastWindow = key;
    for (const l of this.listeners) l({ type: "window", windowId: w.window.id, title: w.window.title, app: w.window.app });
  }

  async close(): Promise<void> {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.listeners.clear();
  }
}
