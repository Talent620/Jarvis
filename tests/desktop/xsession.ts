// A throwaway X11 desktop for the Linux adapter tests: Xvfb, a D-Bus session with the AT-SPI
// accessibility bus, openbox as window manager, and a small GTK app with a text field.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const has = (bin: string) => { try { execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }); return true; } catch { return false; } };
export const PYTHON_GTK = ["/usr/bin/python3.12", "/usr/bin/python3", "python3"].find((p) => {
  try { execFileSync(p, ["-c", "import gi; gi.require_version('Gtk','3.0'); gi.require_version('Atspi','2.0'); from gi.repository import Gtk, Atspi"], { stdio: "ignore" }); return true; } catch { return false; }
});
export const DESKTOP_TOOLS_READY = ["Xvfb", "dbus-launch", "openbox", "xdotool", "xclip", "wmctrl"].every(has) && !!PYTHON_GTK && existsSync("/usr/libexec/at-spi-bus-launcher");

const APP = String.raw`
import gi, sys
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib
w1 = Gtk.Window(title="JARVIS test editor")
e = Gtk.Entry(); e.set_text("Łódź nocą"); w1.add(e); w1.set_default_size(400, 80)
w2 = Gtk.Window(title="Second window"); w2.add(Gtk.Label(label="drugie okno")); w2.set_default_size(300, 60)
for w in (w2, w1): w.connect("destroy", Gtk.main_quit); w.show_all()
w1.present(); e.grab_focus()
print("ready", flush=True)
Gtk.main()
`;

export interface XSession {
  env: Record<string, string>;
  stop(): Promise<void>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` passes: fixed sleeps raced a slow CI runner (Xvfb not up yet). */
async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`${what} not ready after ${ms} ms`);
    await wait(100);
  }
}

const displayUp = (env: Record<string, string>) => () => {
  try { execFileSync("xdotool", ["getdisplaygeometry"], { env, stdio: "ignore", timeout: 2000 }); return true; } catch { return false; }
};

/** Start the GTK app; resolves on its "ready" line, rejects with its stderr if it exits first. */
function startApp(env: Record<string, string>, procs: ChildProcess[], ms: number): Promise<void> {
  const app = spawn(PYTHON_GTK!, ["-c", APP], { env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(app);
  let err = "";
  app.stderr!.on("data", (d) => { err += String(d); });
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`GTK app did not start in ${ms} ms: ${err.trim().split("\n").pop() ?? ""}`)), ms);
    app.stdout!.on("data", (d) => { if (String(d).includes("ready")) { clearTimeout(t); resolve(); } });
    app.on("exit", (code) => { clearTimeout(t); reject(new Error(`GTK app exited (${code}) before ready: ${err.trim().split("\n").pop() ?? ""}`)); });
  });
}

export async function startXSession(display = ":87"): Promise<XSession> {
  const procs: ChildProcess[] = [];
  const env: Record<string, string> = { ...process.env as Record<string, string>, DISPLAY: display, NO_AT_BRIDGE: "0", GTK_MODULES: "gail:atk-bridge" };
  delete env.WAYLAND_DISPLAY;
  procs.push(spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" }));
  await until(displayUp(env), 15_000, `X display ${display}`);
  const dbus = execFileSync("dbus-launch", ["--sh-syntax"], { env, encoding: "utf8" });
  const addr = /DBUS_SESSION_BUS_ADDRESS='([^']+)'/.exec(dbus)?.[1];
  const pid = /DBUS_SESSION_BUS_PID=(\d+)/.exec(dbus)?.[1];
  if (!addr) throw new Error("dbus-launch gave no address");
  env.DBUS_SESSION_BUS_ADDRESS = addr;
  procs.push(spawn("/usr/libexec/at-spi-bus-launcher", ["--launch-immediately"], { env, stdio: "ignore" }));
  procs.push(spawn("openbox", [], { env, stdio: "ignore" }));
  await wait(600);
  // A cold python + gi import on a busy runner can take long; one more start if it died early.
  try {
    await startApp(env, procs, 30_000);
  } catch (e) {
    if (!/exited/.test(String(e))) throw e;
    await wait(1000);
    await startApp(env, procs, 30_000);
  }
  await wait(800);
  return {
    env,
    stop: async () => {
      for (const p of procs.reverse()) { try { p.kill("SIGTERM"); } catch { /* gone */ } }
      if (pid) { try { process.kill(Number(pid)); } catch { /* gone */ } }
      await wait(200);
    },
  };
}
