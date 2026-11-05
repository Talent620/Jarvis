// Kontrola klawiatury w natywnej sesji X11. Wayland wymaga osobnego portalu i zgody systemu.
const { spawn } = require("node:child_process");

function runXdotool(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("xdotool", args, { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let out = "";
    let done = false;
    const finish = (error) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(out); };
    const timeoutMs = Math.min(35000, 5000 + (typeof input === "string" ? input.length * 16 : 0));
    const timer = setTimeout(() => { child.kill(); finish(new Error("timeout")); }, timeoutMs);
    child.once("error", finish);
    child.once("close", (code) => finish(code === 0 ? null : new Error("xdotool failed")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; if (out.length > 8192) { child.kill(); finish(new Error("output too long")); } });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}

const named = {
  enter: "Return", tab: "Tab", esc: "Escape", escape: "Escape", space: "space",
  up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End",
  delete: "Delete", del: "Delete", backspace: "BackSpace", pageup: "Page_Up", pagedown: "Page_Down",
};
function parseShortcut(value) {
  if (typeof value !== "string" || value.length > 80) return null;
  const parts = value.toLowerCase().split("+").map((p) => p.trim());
  const mods = [];
  let key = "";
  for (const part of parts) {
    const mod = { ctrl: "ctrl", control: "ctrl", alt: "alt", shift: "shift" }[part];
    if (mod) { if (mods.includes(mod)) return null; mods.push(mod); continue; }
    if (key) return null;
    key = named[part] || (/^[a-z0-9]$/.test(part) ? part : /^f([1-9]|1[0-2])$/.test(part) ? part.toUpperCase() : "");
    if (!key) return null;
  }
  return key ? [...mods, key].join("+") : null;
}

function createLinuxKeyboard({ env = process.env, run = (args, input) => runXdotool(args, input, env), consentWindowId = () => null } = {}) {
  // Only a previously explicit, verified focus operation can establish this target.
  // Consent may focus JARVIS; an unrelated window means the user took control.
  let approvedFocus = null;
  async function target(title) {
    if (env.XDG_SESSION_TYPE !== "x11" || !env.DISPLAY) return { error: "err:linux-session" };
    if (typeof title !== "string" || !title.trim() || title.length > 512) return { error: "err:linux-window-required" };
    let id = String(await run(["getactivewindow"])).trim();
    if (!/^\d+$/.test(id)) return { error: "err:linux-no-window" };
    const consentId = consentWindowId();
    if (id === consentId && approvedFocus && approvedFocus.id !== consentId && approvedFocus.title.toLocaleLowerCase().includes(title.trim().toLocaleLowerCase())) {
      const remembered = approvedFocus;
      const currentTitle = String(await run(["getwindowname", remembered.id])).trim();
      if (currentTitle !== remembered.title || String(await run(["getactivewindow"])).trim() !== consentId) {
        approvedFocus = null; return { error: "err:linux-window-mismatch" };
      }
      await run(["windowactivate", "--sync", remembered.id]);
      id = String(await run(["getactivewindow"])).trim();
      if (id !== remembered.id) { approvedFocus = null; return { error: "err:linux-window-mismatch" }; }
    } else if (approvedFocus && id !== approvedFocus.id && id !== consentId) {
      approvedFocus = null;
      return { error: "err:linux-window-mismatch" };
    }
    const actual = String(await run(["getwindowname", id])).trim();
    if (!actual.toLocaleLowerCase().includes(title.trim().toLocaleLowerCase())) { approvedFocus = null; return { error: "err:linux-window-mismatch" }; }
    // Focus may have changed between observation and action.
    if (String(await run(["getactivewindow"])).trim() !== id) return { error: "err:linux-window-mismatch" };
    return { id };
  }
  async function act(kind, value, title) {
    if (kind === "type" && (typeof value !== "string" || !/^[\x20-\x7e]{1,2000}$/.test(value))) return "err:linux-text-unsupported";
    const key = kind === "key" ? parseShortcut(value) : null;
    if (kind === "key" && !key) return "err:unknown";
    try {
      const t = await target(title);
      if (t.error) return t.error;
      // Arguments are passed directly, without a shell. Specify a window so focus changes
      // cannot redirect input to a different one. xdotool reports event delivery, not app state.
      if (kind === "type") await run(["type", "--clearmodifiers", "--window", t.id, "--file", "-"], value);
      else await run(["key", "--clearmodifiers", "--window", t.id, key]);
      return "ok";
    } catch (error) {
      if (error?.code === "ENOENT") return "err:linux-xdotool-missing";
      return "err:linux-input-failed";
    }
  }
  async function activeWindow() {
    if (env.XDG_SESSION_TYPE !== "x11" || !env.DISPLAY) return { ok: false, error: "err:linux-session" };
    try {
      const id = String(await run(["getactivewindow"])).trim();
      if (!/^\d+$/.test(id)) return { ok: false, error: "err:linux-no-window" };
      const title = String(await run(["getwindowname", id])).trim();
      if (String(await run(["getactivewindow"])).trim() !== id) return { ok: false, error: "err:linux-window-mismatch" };
      if (!title || title.length > 512) return { ok: false, error: "err:linux-no-window" };
      return { ok: true, title };
    } catch (error) {
      return { ok: false, error: error?.code === "ENOENT" ? "err:linux-xdotool-missing" : "err:linux-input-failed" };
    }
  }
  async function listWindows() {
    if (env.XDG_SESSION_TYPE !== "x11" || !env.DISPLAY) return { ok: false, error: "err:linux-session" };
    try {
      const ids = [...new Set(String(await run(["search", "--onlyvisible", "--name", "."])).trim().split(/\s+/).filter(id => /^\d+$/.test(id)))];
      const windows = [];
      for (const id of ids.slice(0, 64)) {
        try {
          const title = String(await run(["getwindowname", id])).trim();
          if (title && title.length <= 512) windows.push({ id, title });
        } catch { /* A window may close between enumeration and title lookup. */ }
      }
      return { ok: true, windows, truncated: ids.length > 64 };
    } catch (error) {
      return { ok: false, error: error?.code === "ENOENT" ? "err:linux-xdotool-missing" : "err:linux-input-failed" };
    }
  }
  async function focusWindow(id, title) {
    if (env.XDG_SESSION_TYPE !== "x11" || !env.DISPLAY) return { ok: false, error: "err:linux-session" };
    if (typeof id !== "string" || !/^[1-9]\d{0,12}$/.test(id)) return { ok: false, error: "err:linux-no-window" };
    if (typeof title !== "string" || !title.trim() || title.length > 512) return { ok: false, error: "err:linux-window-required" };
    try {
      const before = String(await run(["getwindowname", id])).trim();
      if (!before.toLocaleLowerCase().includes(title.trim().toLocaleLowerCase())) { approvedFocus = null; return { ok: false, error: "err:linux-window-mismatch" }; }
      await run(["windowactivate", "--sync", id]);
      const active = String(await run(["getactivewindow"])).trim();
      const after = String(await run(["getwindowname", id])).trim();
      if (active !== id || before !== after) { approvedFocus = null; return { ok: false, error: "err:linux-window-mismatch" }; }
      approvedFocus = { id, title: after };
      return { ok: true, id, title: after };
    } catch (error) {
      return { ok: false, error: error?.code === "ENOENT" ? "err:linux-xdotool-missing" : "err:linux-input-failed" };
    }
  }
  async function click(x, y, title) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x > 32767 || y > 32767) return "err:linux-coordinates";
    try {
      const t = await target(title);
      if (t.error) return t.error;
      const geometry = String(await run(["getwindowgeometry", "--shell", t.id]));
      const values = {};
      for (const line of geometry.split("\n")) {
        const m = /^(X|Y|WIDTH|HEIGHT)=(-?\d+)$/.exec(line.trim());
        if (m) values[m[1]] = Number(m[2]);
      }
      if (![values.X, values.Y, values.WIDTH, values.HEIGHT].every(Number.isSafeInteger) || values.WIDTH <= 0 || values.HEIGHT <= 0 || x < values.X || y < values.Y || x >= values.X + values.WIDTH || y >= values.Y + values.HEIGHT) return "err:linux-coordinates";
      await run(["mousemove", "--sync", String(x), String(y)]);
      const pointer = String(await run(["getmouselocation", "--shell"]));
      const match = /^WINDOW=(\d+|0x[\da-f]+)$/im.exec(pointer);
      if (!match || Number(match[1]) !== Number(t.id) || String(await run(["getactivewindow"])).trim() !== t.id) return "err:linux-pointer-mismatch";
      await run(["click", "1"]);
      return "ok";
    } catch (error) {
      if (error?.code === "ENOENT") return "err:linux-xdotool-missing";
      return "err:linux-input-failed";
    }
  }
  return { type: (text, title) => act("type", text, title), hotkey: (combo, title) => act("key", combo, title), activeWindow, listWindows, focusWindow, click };
}
module.exports = { createLinuxKeyboard, parseShortcut };
