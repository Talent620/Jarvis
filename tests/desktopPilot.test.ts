import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDesktopPilot,
  computeSmoothPath,
  resolveNamedPoint,
  clampPoint,
} = require("../electron/desktop-pilot.cjs");

describe("OMNI-PILOT OS Actuator (electron/desktop-pilot.cjs)", () => {
  it("computeSmoothPath generuje płynną, nieliniową trajektorię kończącą się dokładnie w celu", () => {
    const pts = computeSmoothPath(100, 100, 500, 300, 12);
    expect(pts.length).toBe(12);
    expect(pts[pts.length - 1]).toEqual({ x: 500, y: 300 });
    // Pierwszy krok jest mały (ease-in), środkowe szybsze
    expect(pts[0].x - 100).toBeLessThan(pts[5].x - pts[4].x);
  });

  it("resolveNamedPoint i clampPoint obsługują nazwane punkty ekranu i bezpieczne granice", () => {
    expect(resolveNamedPoint("center", 1920, 1080)).toEqual({ x: 960, y: 540 });
    expect(resolveNamedPoint("top-right", 1000, 1000)).toEqual({ x: 940, y: 60 });
    expect(resolveNamedPoint("nieznany", 1920, 1080)).toBeNull();
    expect(clampPoint(-50, 9999, 1920, 1080)).toEqual({ x: 0, y: 1079 });
  });

  it("moveCursor płynnie przesuwa kursor na Linux X11 (relative + named) i respektuje abort() w połowie ruchu", async () => {
    const calls: string[] = [];
    const pilotRef: { current?: { abort: () => void } } = {};
    const run = async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (calls.length === 4 && pilotRef.current) pilotRef.current.abort();
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const pilot = createDesktopPilot({
      platform: "linux",
      env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
      run,
      sleep: async () => {},
      getScreenSize: () => ({ width: 1920, height: 1080 }),
      getCursorPoint: () => ({ x: 500, y: 500 }),
    });
    // Zwykły ruch względny w prawo o 240 px (bez abort)
    const okRes = await pilot.moveCursor({ mode: "relative", dx: 240, dy: 0, steps: 5, stepDelayMs: 0 });
    expect(okRes).toEqual({ ok: true, x: 740, y: 500 });
    expect(calls[calls.length - 1]).toBe("xdotool mousemove --sync 740 500");

    // Przerwanie kill-switchem w trakcie płynnego ruchu
    calls.length = 0;
    pilotRef.current = pilot;
    const aborted = await pilot.moveCursor({ mode: "named", preset: "center", steps: 10, stepDelayMs: 0 });
    expect(aborted).toEqual({ ok: false, error: "err:aborted" });
    expect(calls.length).toBeLessThan(10);
  });

  it("wspiera kliknięcia (double/right), scroll, listWindows/focusWindow (wmctrl) i polskie UTF-8 z przywróceniem schowka", async () => {
    const calls: string[] = [];
    let clip = "WAŻNA_TREŚĆ_UŻYTKOWNIKA";
    const clipboard = {
      readText: () => clip,
      writeText: (t: string) => { clip = t; },
    };
    const run = async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "wmctrl" && args[0] === "-l") {
        return { ok: true, code: 0, stdout: "0x01a 0 host Mozilla Firefox\n0x02b 0 host Visual Studio Code\n", stderr: "" };
      }
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const pilot = createDesktopPilot({
      platform: "linux",
      env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
      run,
      sleep: async () => {},
      clipboard,
    });

    expect((await pilot.mouseAction({ action: "double" })).ok).toBe(true);
    expect(calls).toContain("xdotool click --repeat 2 --delay 70 1");

    expect((await pilot.scroll({ direction: "down", amount: 6 })).ok).toBe(true);
    expect(calls).toContain("xdotool click --repeat 6 --delay 25 5");

    const wins = await pilot.listWindows();
    expect(wins.windows.map((w: { title: string }) => w.title)).toEqual(["Mozilla Firefox", "Visual Studio Code"]);
    const focused = await pilot.focusWindow("firefox");
    expect(focused).toEqual({ ok: true, window: { id: "0x01a", title: "Mozilla Firefox" } });

    const typed = await pilot.typeUnicode("Zażółć gęślą jaźń!");
    expect(typed).toEqual({ ok: true, chars: 18 });
    expect(calls).toContain("xdotool key --clearmodifiers ctrl+v");
    expect(clip).toBe("WAŻNA_TREŚĆ_UŻYTKOWNIKA"); // schowek użytkownika nienaruszony!
  });

  it("na Waylandzie używa ydotool i uczciwie zwraca err:wayland-ydotool-missing, gdy go brak", async () => {
    const run = async () => ({ ok: false, code: "ENOENT", stdout: "", stderr: "" });
    const pilot = createDesktopPilot({
      platform: "linux",
      env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
      run,
      sleep: async () => {},
    });
    const res = await pilot.moveCursor({ mode: "absolute", x: 100, y: 100, smooth: false });
    expect(res).toEqual({ ok: false, error: "err:wayland-ydotool-missing" });
  });

  it("na Windowsie (win32) generuje poprawny PowerShell [J.M]::mouse_event, scroll pionowy/poziomy i SendKeys", async () => {
    const scripts: string[] = [];
    const run = async (_cmd: string, args: string[]) => {
      scripts.push(args[args.length - 1]);
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const pilot = createDesktopPilot({
      platform: "win32",
      env: {},
      run,
      sleep: async () => {},
    });

    expect((await pilot.mouseAction({ action: "double" })).ok).toBe(true);
    expect(scripts[0]).toContain("[J.M]::mouse_event(0x02,0,0,0,0)");
    expect(scripts[0]).not.toContain("[M]::mouse_event");

    expect((await pilot.scroll({ direction: "right", amount: 3 })).ok).toBe(true);
    expect(scripts[1]).toContain("[J.M]::mouse_event(0x01000,0,0,360,0)");

    expect((await pilot.globalHotkey("alt+left")).ok).toBe(true);
    expect(scripts[2]).toContain("SendWait('%{LEFT}')");
  });
});
