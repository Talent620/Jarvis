// What kind of Linux desktop session this is and which tools it has (mission 5.6, M7).

import { presentTools, type LinuxTool, type Run } from "./runner";

export interface LinuxSession {
  display: "x11" | "wayland" | null;
  desktop: string;
  tools: Set<LinuxTool>;
  /** A Python interpreter that can import gi Atspi 2.0, if any. */
  atspiPython: string | null;
  /** The RemoteDesktop portal is on the session bus (input needs the user's consent there). */
  portal: boolean;
}

const PYTHONS = ["python3", "/usr/bin/python3", "/usr/bin/python3.12", "/usr/bin/python3.13", "/usr/bin/python3.11", "/usr/bin/python3.10"];
const ATSPI_IMPORT = "import gi; gi.require_version('Atspi', '2.0'); from gi.repository import Atspi; print('ok')";

export async function detectLinuxSession(run: Run, env: Record<string, string | undefined>): Promise<LinuxSession> {
  const display = env.WAYLAND_DISPLAY ? "wayland" : env.DISPLAY ? "x11" : null;
  const tools = await presentTools(run);
  let atspiPython: string | null = null;
  for (const py of PYTHONS) {
    const r = await run(py, ["-c", ATSPI_IMPORT], { timeoutMs: 4000 });
    if (r.code === 0 && r.stdout.trim() === "ok") { atspiPython = py; break; }
  }
  let portal = false;
  if (tools.has("busctl")) {
    const r = await run("busctl", ["--user", "introspect", "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop"], { timeoutMs: 3000 });
    portal = r.code === 0 && r.stdout.includes("org.freedesktop.portal.RemoteDesktop");
  }
  return { display, desktop: env.XDG_CURRENT_DESKTOP ?? "", tools, atspiPython, portal };
}
