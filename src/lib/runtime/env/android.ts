// Android behind the ComputerEnvironment contract (mission M9): the JARVIS accessibility service
// gives the focused node, its text selection, copy, append, scroll, windows and a bounded node
// tree. Everything is read back. Android lets only the foreground app read the clipboard, so a
// copy made in another app is ATTEMPTED, not CONFIRMED, and the report says why.

import type { SystemActionsPlugin } from "../../systemActions";
import type { CapabilityState } from "../types";
import type {
  ActResult, ClipboardRead, ComputerEnvironment, EnvAction, EnvEvent, FocusedRead, ReadQuery, ReadResult, SelectionRead, WindowListRead, WindowRead,
} from "./types";

export type AndroidDevice = Pick<SystemActionsPlugin,
  "isEnabled" | "focused" | "activeWindow" | "windows" | "select" | "copy" | "appendText" | "scroll" | "tree" | "getClipboard" | "setClipboard">;

const NOT_ENABLED = "turn on JARVIS in Settings > Accessibility";

export class AndroidEnvironment implements ComputerEnvironment {
  readonly id = "android";
  constructor(private readonly device: AndroidDevice | null) {}

  private async enabled(): Promise<boolean> {
    if (!this.device) return false;
    try { return !!(await this.device.isEnabled()).enabled; } catch { return false; }
  }

  async capabilities(): Promise<CapabilityState[]> {
    const at = Date.now();
    if (!this.device) return [{ id: "android.accessibility.tree", status: "needs_hardware", checkedAt: at, provider: this.id, detail: "Android app only" }];
    const on = await this.enabled();
    return [
      { id: "android.accessibility.tree", status: on ? "available" : "needs_permission", checkedAt: at, provider: this.id, detail: on ? undefined : NOT_ENABLED },
      { id: "desktop.clipboard", status: "degraded", checkedAt: at, provider: this.id, detail: "readable only while JARVIS is in the foreground" },
    ];
  }

  async act(action: EnvAction): Promise<ActResult> {
    const d = this.device;
    if (!d) return { status: "needs_capability", error: "Android app only" };
    if (!(await this.enabled())) return { status: "needs_permission", error: NOT_ENABLED };
    const ok = (r: { ok: boolean }, what: string): ActResult => (r.ok ? { status: "done" } : { status: "failed", error: `${what} refused by the app` });
    try {
      switch (action.kind) {
        case "text.select":
          if (action.target.ref !== "android:focused") return { status: "not_found", error: "selection works on the focused node (android:focused)" };
          return ok(await d.select({ start: action.start, end: action.end }), "selection");
        case "clipboard.copy": return ok(await d.copy(), "copy");
        case "clipboard.write": return ok(await d.setClipboard({ text: action.text }), "clipboard write");
        case "desktop.type": return ok(await d.appendText({ text: action.text }), "typing");
        case "browser.scroll": return ok(await d.scroll({ forward: action.direction === "down" }), "scroll");
        default: return { status: "needs_capability", error: `${action.kind} is not available on Android yet` };
      }
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async read(q: ReadQuery): Promise<ReadResult> {
    const d = this.device;
    const off = !d || !(await this.enabled());
    switch (q.kind) {
      case "focused": {
        if (off) return { found: false, error: NOT_ENABLED } satisfies FocusedRead;
        const f = await d!.focused();
        return { found: f.found, app: f.app, role: f.role, name: f.name, text: f.text ?? undefined } satisfies FocusedRead;
      }
      case "selection": {
        if (off) return { text: "", visible: false } satisfies SelectionRead;
        const f = await d!.focused();
        return { text: f.selection ?? "", visible: !!f.selection, ref: "android:focused" } satisfies SelectionRead;
      }
      case "clipboard": {
        if (!d) return { ok: false, error: "Android app only" } satisfies ClipboardRead;
        const c = await d.getClipboard();
        return c.ok ? { ok: true, text: c.text ?? "" } : { ok: false, error: c.error ?? "clipboard not readable" };
      }
      case "window": {
        if (off) return { found: false, error: NOT_ENABLED } satisfies WindowRead;
        const w = await d!.activeWindow();
        return w.found ? { found: true, window: { id: w.id ?? "", title: w.title ?? "", app: w.app } } : { found: false };
      }
      case "windows": {
        if (off) return { windows: [], error: NOT_ENABLED } satisfies WindowListRead;
        const r = await d!.windows();
        return { windows: r.windows.map((w) => ({ id: w.id, title: w.title, app: w.app })) };
      }
      case "page": return { open: false };
      case "element": return { found: false };
      case "collection": return { count: 0, items: [] };
    }
  }

  async snapshot(maxChars = 1200): Promise<string> {
    if (!this.device || !(await this.enabled())) return "";
    const { nodes } = await this.device.tree({ max: 150 });
    return nodes
      .filter((n) => n.text || n.desc)
      .map((n) => `${n.cls.split(".").pop()} ${JSON.stringify((n.text || n.desc).slice(0, 60))}${n.id ? ` #${n.id.split("/").pop()}` : ""}`)
      .join("\n")
      .slice(0, maxChars);
  }

  onEvent(_l: (e: EnvEvent) => void): () => void {
    return () => undefined;
  }

  async close(): Promise<void> { /* the service outlives the runtime */ }
}
