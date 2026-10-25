// AT-SPI bridge (mission 5.6, M7): the accessibility tree of the Linux desktop through a small
// Python helper on gi Atspi 2.0 (present on GNOME/KDE installs). One process per query, JSON
// out, bounded walks. Text offsets are Unicode code points, as AT-SPI counts them.

import type { FocusedRead } from "../../lib/runtime/env/types";
import type { Run } from "./runner";

export const ATSPI_HELPER = String.raw`
import sys, json, warnings
warnings.filterwarnings("ignore")
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

MAX_NODES = 4000

def has(acc, st):
    try:
        s = acc.get_state_set()
        return bool(s and s.contains(st))
    except Exception:
        return False

# Atspi.Text methods are called on the class: on the object, get_text() is the deprecated
# Accessible.get_text() that returns the interface.
def is_text(acc):
    try:
        return acc.get_text_iface() is not None
    except Exception:
        return False

def text_of(acc, limit=2000):
    if not is_text(acc):
        return None
    try:
        n = Atspi.Text.get_character_count(acc)
        return Atspi.Text.get_text(acc, 0, min(n, limit))
    except Exception:
        return None

def selection_of(acc):
    if not is_text(acc):
        return ""
    try:
        if Atspi.Text.get_n_selections(acc) < 1:
            return ""
        r = Atspi.Text.get_selection(acc, 0)
        return Atspi.Text.get_text(acc, r.start_offset, r.end_offset)
    except Exception:
        return ""

def app_of(acc):
    try:
        return acc.get_application().get_name() or ""
    except Exception:
        return ""

def walk(root, pred, budget):
    stack = [root]
    while stack and budget[0] > 0:
        a = stack.pop()
        budget[0] -= 1
        try:
            if pred(a):
                return a
            n = a.get_child_count()
            for i in range(min(n, 500) - 1, -1, -1):
                c = a.get_child_at_index(i)
                if c is not None:
                    stack.append(c)
        except Exception:
            pass
    return None

def windows():
    desk = Atspi.get_desktop(0)
    for i in range(desk.get_child_count()):
        app = desk.get_child_at_index(i)
        if app is None:
            continue
        for j in range(app.get_child_count()):
            w = app.get_child_at_index(j)
            if w is not None:
                yield w

def active_frame():
    for w in windows():
        if has(w, Atspi.StateType.ACTIVE):
            return w
    return None

def focused():
    frame = active_frame()
    roots = [frame] if frame is not None else list(windows())
    budget = [MAX_NODES]
    for r in roots:
        f = walk(r, lambda a: has(a, Atspi.StateType.FOCUSED), budget)
        if f is not None:
            return f
    return None

def dump(root, max_lines):
    lines = []
    stack = [(root, 0)]
    while stack and len(lines) < max_lines:
        a, depth = stack.pop()
        try:
            name = (a.get_name() or "").replace("\n", " ")[:60]
            lines.append("  " * depth + a.get_role_name() + (" " + json.dumps(name, ensure_ascii=False) if name else ""))
            n = a.get_child_count()
            for i in range(min(n, 200) - 1, -1, -1):
                c = a.get_child_at_index(i)
                if c is not None:
                    stack.append((c, depth + 1))
        except Exception:
            pass
    return lines

cmd = sys.argv[1]
arg = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
try:
    if cmd == "ping":
        out = {"ok": True, "apps": Atspi.get_desktop(0).get_child_count()}
    elif cmd == "focused":
        f = focused()
        out = {"found": False} if f is None else {"found": True, "app": app_of(f), "role": f.get_role_name(), "name": f.get_name() or "", "text": text_of(f), "selection": selection_of(f)}
    elif cmd == "window":
        w = active_frame()
        out = {"found": w is not None, "app": app_of(w) if w is not None else "", "title": (w.get_name() or "") if w is not None else ""}
    elif cmd == "select":
        f = focused()
        if f is None or not is_text(f):
            out = {"ok": False, "error": "no focused text element"}
        else:
            start, end = int(arg["start"]), int(arg["end"])
            if Atspi.Text.get_n_selections(f) > 0:
                ok = Atspi.Text.set_selection(f, 0, start, end)
            else:
                ok = Atspi.Text.add_selection(f, start, end)
            out = {"ok": bool(ok), "selection": selection_of(f)}
    elif cmd == "dump":
        w = active_frame()
        out = {"lines": dump(w, int(arg.get("max", 120))) if w is not None else []}
    else:
        out = {"error": "unknown command"}
except Exception as e:
    out = {"error": str(e)}
print(json.dumps(out, ensure_ascii=False))
`;

export class AtspiBridge {
  constructor(private readonly run: Run, private readonly python: string | null) {}

  get available(): boolean {
    return !!this.python;
  }

  private async call<T>(cmd: string, arg: Record<string, unknown> = {}): Promise<T & { error?: string }> {
    if (!this.python) return { error: "no Python with gi Atspi 2.0" } as T & { error?: string };
    const r = await this.run(this.python, ["-c", ATSPI_HELPER, cmd, JSON.stringify(arg)], { timeoutMs: 8000 });
    try {
      return JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as T & { error?: string };
    } catch {
      return { error: r.stderr.trim().split("\n").pop() || `exit ${r.code}` } as T & { error?: string };
    }
  }

  async ping(): Promise<{ ok: boolean; apps?: number; error?: string }> {
    const r = await this.call<{ ok?: boolean; apps?: number }>("ping");
    return { ok: !!r.ok, apps: r.apps, error: r.error };
  }

  async focused(): Promise<FocusedRead & { selection?: string }> {
    const r = await this.call<{ found?: boolean; app?: string; role?: string; name?: string; text?: string | null; selection?: string }>("focused");
    if (r.error) return { found: false, error: r.error };
    return { found: !!r.found, app: r.app, role: r.role, name: r.name, text: r.text ?? undefined, selection: r.selection };
  }

  async window(): Promise<{ found: boolean; app?: string; title?: string; error?: string }> {
    return this.call<{ found: boolean; app?: string; title?: string }>("window");
  }

  /** Select [start, end) code points in the focused text element; returns what is selected. */
  async select(start: number, end: number): Promise<{ ok: boolean; selection?: string; error?: string }> {
    const r = await this.call<{ ok?: boolean; selection?: string }>("select", { start, end });
    return { ok: !!r.ok, selection: r.selection, error: r.error };
  }

  async dump(max = 120): Promise<string> {
    const r = await this.call<{ lines?: string[] }>("dump", { max });
    return (r.lines ?? []).join("\n");
  }
}
