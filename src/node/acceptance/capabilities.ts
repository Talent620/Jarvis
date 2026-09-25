// Capability probe for the acceptance run: what this machine can do, reported as a matrix.
// Only presence is checked for credentials (environment variable names), never their values.

import type { Capability, Mode } from "./core";

export interface ProbeDeps {
  mode: Mode;
  env: Record<string, string | undefined>;
  platform: string;
  nodeVersion: string;
  chromium: string | null;
  which: (bin: string) => boolean;
  /** Network reachability of a URL (only used in managed-browser mode). */
  reach?: (url: string) => Promise<boolean>;
}

export async function probeCapabilities(d: ProbeDeps): Promise<Capability[]> {
  const caps: Capability[] = [];
  const add = (id: string, status: Capability["status"], detail?: string) => caps.push({ id, status, detail });
  const desktop = d.mode === "local-desktop";

  add("node", "available", d.nodeVersion);
  add("browser.chromium", d.chromium ? "available" : "missing", d.chromium ? d.chromium.split(/[\\/]/).slice(-3).join("/") : "install Chrome/Chromium or run npx playwright install chromium");

  const display = d.env.WAYLAND_DISPLAY ? "wayland" : d.env.DISPLAY ? "x11" : null;
  add("display", display ? "available" : desktop ? "needs_hardware" : "missing", display ?? "no DISPLAY or WAYLAND_DISPLAY (headless browser only)");

  if (d.platform === "linux") {
    const clip = ["wl-paste", "xclip", "xsel"].find((b) => d.which(b));
    add("clipboard.system", clip ? "available" : "needs_hardware", clip ?? "wl-clipboard or xclip");
    const input = ["ydotool", "xdotool"].find((b) => d.which(b));
    add("input.synthetic", input ? "available" : "needs_hardware", input ?? "ydotool (Wayland) or xdotool (X11); portal/libei in M7");
    add("accessibility.atspi", d.env.AT_SPI_BUS_ADDRESS || d.which("at-spi-bus-launcher") ? "available" : "needs_hardware", "AT-SPI bus (M7 adapter)");
    add("audio.microphone", d.which("arecord") || d.which("pw-record") ? "available" : "needs_hardware", "presence of a capture tool only; the device is checked in the voice step");
  } else {
    add("desktop.adapters", "needs_hardware", `${d.platform}: Windows UIA / macOS adapters are M9`);
  }

  if (d.mode === "managed-browser" && d.reach) {
    const ok = await d.reach("https://www.youtube.com/").catch(() => false);
    add("network.youtube", ok ? "available" : "blocked", ok ? "reachable" : "not reachable from this machine (network policy or offline)");
  }

  const gmail = !!(d.env.JARVIS_SYNC_URL && d.env.JARVIS_SYNC_TOKEN);
  add("mail.gmail", gmail ? "available" : "needs_hardware", gmail ? "backend configured (JARVIS_SYNC_URL, JARVIS_SYNC_TOKEN)" : "set JARVIS_SYNC_URL and JARVIS_SYNC_TOKEN for --send");
  return caps;
}
