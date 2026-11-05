import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createLinuxKeyboard, parseShortcut } = require("../electron/linux-keyboard.cjs");

describe("klawiatura Linux X11", () => {
  const env = { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" };
  it("nie wysyła zdarzeń w Waylandzie ani bez identyfikacji sesji", async () => {
    const run = vi.fn();
    expect(await createLinuxKeyboard({ env: { ...env, XDG_SESSION_TYPE: "wayland" }, run }).type("test", "Edytor")).toBe("err:linux-session");
    expect(await createLinuxKeyboard({ env: {}, run }).hotkey("ctrl+s", "Edytor")).toBe("err:linux-session");
    expect(run).not.toHaveBeenCalled();
  });
  it("sprawdza wskazany tytuł i stabilność aktywnego okna przed wpisywaniem", async () => {
    const run = vi.fn(async (args: string[]) => args[0] === "getactivewindow" ? "42\n" : "Edytor ORION\n");
    const keyboard = createLinuxKeyboard({ env, run });
    expect(await keyboard.type("test", "Przeglądarka")).toBe("err:linux-window-mismatch");
    expect(run.mock.calls.every(([args]) => args[0] !== "type")).toBe(true);
    expect(await keyboard.hotkey("ctrl+s", "")).toBe("err:linux-window-required");
    run.mockClear();
    expect(await keyboard.type("tekst; nie wykonuj shell", "ORION")).toBe("ok");
    expect(run).toHaveBeenLastCalledWith(["type", "--clearmodifiers", "--window", "42", "--file", "-"], "tekst; nie wykonuj shell");
  });
  it("blokuje akcję gdy fokus zmieni się w trakcie kontroli", async () => {
    let reads = 0;
    const run = vi.fn(async (args: string[]) => args[0] === "getactivewindow" ? (++reads === 1 ? "42" : "43") : "Edytor");
    expect(await createLinuxKeyboard({ env, run }).hotkey("ctrl+s", "Edytor")).toBe("err:linux-window-mismatch");
    expect(run.mock.calls.every(([args]) => args[0] !== "key")).toBe(true);
  });
  it("mapuje skróty i odrzuca niejednoznaczne lub niebezpieczne argumenty", async () => {
    expect(parseShortcut("CTRL+Shift+S")).toBe("ctrl+shift+s");
    for (const bad of ["ctrl+ctrl+s", "ctrl+;rm", "ctrl+a+b", "", "ctrl+super+s"]) expect(parseShortcut(bad)).toBeNull();
    const run = vi.fn();
    const keyboard = createLinuxKeyboard({ env, run });
    expect(await keyboard.type("zażółć", "okno")).toBe("err:linux-text-unsupported");
    expect(await keyboard.hotkey("ctrl+a+b", "okno")).toBe("err:unknown");
    expect(run).not.toHaveBeenCalled();
  });
  it("klika tylko w obszarze aktywnego okna po sprawdzeniu położenia wskaźnika", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "getactivewindow") return "42";
      if (args[0] === "getwindowname") return "Edytor ORION";
      if (args[0] === "getwindowgeometry") return "X=100\nY=200\nWIDTH=300\nHEIGHT=400\n";
      if (args[0] === "getmouselocation") return "X=120\nY=220\nWINDOW=42\n";
      return "";
    });
    const keyboard = createLinuxKeyboard({ env, run });
    expect(await keyboard.click(120, 220, "ORION")).toBe("ok");
    expect(run).toHaveBeenLastCalledWith(["click", "1"]);
    run.mockClear();
    expect(await keyboard.click(500, 500, "ORION")).toBe("err:linux-coordinates");
    expect(run.mock.calls.every(([args]) => args[0] !== "click" && args[0] !== "mousemove")).toBe(true);
  });
  it("nie klika, gdy wskaźnik jest nad innym oknem", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "getactivewindow") return "42";
      if (args[0] === "getwindowname") return "Edytor";
      if (args[0] === "getwindowgeometry") return "X=0\nY=0\nWIDTH=300\nHEIGHT=300";
      if (args[0] === "getmouselocation") return "WINDOW=43\n";
      return "";
    });
    expect(await createLinuxKeyboard({ env, run }).click(10, 10, "Edytor")).toBe("err:linux-pointer-mismatch");
    expect(run.mock.calls.every(([args]) => args[0] !== "click")).toBe(true);
  });
  it("odczytuje jedynie tytuł nadal aktywnego okna", async () => {
    const run = vi.fn(async (args: string[]) => args[0] === "getactivewindow" ? "42" : "Edytor ORION");
    expect(await createLinuxKeyboard({ env, run }).activeWindow()).toEqual({ ok: true, title: "Edytor ORION" });
    let count = 0;
    const changed = vi.fn(async (args: string[]) => args[0] === "getactivewindow" ? (++count === 1 ? "42" : "43") : "Edytor ORION");
    expect(await createLinuxKeyboard({ env, run: changed }).activeWindow()).toEqual({ ok: false, error: "err:linux-window-mismatch" });
  });
  it("zwraca czytelny błąd braku zależności", async () => {
    const run = vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); });
    expect(await createLinuxKeyboard({ env, run }).hotkey("ctrl+s", "Edytor")).toBe("err:linux-xdotool-missing");
  });
  it("odkrywa widoczne okna i potwierdza fokus po aktywacji konkretnego identyfikatora", async () => {
    let active = "7";
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "search") return "42\n7\n42\ninvalid";
      if (args[0] === "getwindowname") return args[1] === "42" ? "Dokument ORION" : "JARVIS";
      if (args[0] === "windowactivate") { active = args[2]; return ""; }
      if (args[0] === "getactivewindow") return active;
      return "";
    });
    const keyboard = createLinuxKeyboard({ env, run });
    expect(await keyboard.listWindows()).toEqual({ ok: true, windows: [{ id: "42", title: "Dokument ORION" }, { id: "7", title: "JARVIS" }], truncated: false });
    expect(await keyboard.focusWindow("42", "ORION")).toEqual({ ok: true, id: "42", title: "Dokument ORION" });
    expect(run).toHaveBeenCalledWith(["windowactivate", "--sync", "42"]);
    run.mockClear();
    expect(await keyboard.focusWindow("42", "inny dokument")).toEqual({ ok: false, error: "err:linux-window-mismatch" });
    expect(await keyboard.focusWindow("42; rm", "ORION")).toEqual({ ok: false, error: "err:linux-no-window" });
    expect(run.mock.calls.every(([args]) => args[0] !== "windowactivate")).toBe(true);
  });
  it("nie potwierdza fokusu kiedy system go nie przyznał lub tytuł zmienił się podczas aktywacji", async () => {
    const run = vi.fn(async (args: string[]) => args[0] === "getactivewindow" ? "7" : args[0] === "getwindowname" ? "ORION" : "");
    expect(await createLinuxKeyboard({ env, run }).focusWindow("42", "ORION")).toEqual({ ok: false, error: "err:linux-window-mismatch" });
    expect(await createLinuxKeyboard({ env: { ...env, XDG_SESSION_TYPE: "wayland" }, run }).listWindows()).toEqual({ ok: false, error: "err:linux-session" });
  });
  it("przywraca wyłącznie jawnie wybrane okno po zgodzie w JARVIS-ie, a oddaje kontrolę innej aplikacji", async () => {
    let active = "7", title = "Edytor ORION";
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "getactivewindow") return active;
      if (args[0] === "getwindowname") return args[1] === "42" ? title : "JARVIS";
      if (args[0] === "windowactivate") { active = args[2]; return ""; }
      return "";
    });
    const keyboard = createLinuxKeyboard({ env, run, consentWindowId: () => "7" });
    expect(await keyboard.hotkey("ctrl+v", "ORION")).toBe("err:linux-window-mismatch");
    expect(run.mock.calls.some(([args]) => args[0] === "windowactivate")).toBe(false);
    expect((await keyboard.focusWindow("42", "ORION")).ok).toBe(true);
    active = "7"; // The trusted consent window temporarily received OS focus.
    expect(await keyboard.hotkey("ctrl+v", "ORION")).toBe("ok");
    expect(active).toBe("42");
    active = "99"; run.mockClear(); // User works in an unrelated window.
    expect(await keyboard.hotkey("ctrl+v", "ORION")).toBe("err:linux-window-mismatch");
    expect(run.mock.calls.some(([args]) => ["windowactivate", "key"].includes(args[0]))).toBe(false);
    active = "7";
    expect(await keyboard.hotkey("ctrl+v", "ORION")).toBe("err:linux-window-mismatch");
    await keyboard.focusWindow("42", "ORION"); active = "7"; title = "Inny dokument"; run.mockClear();
    expect(await keyboard.hotkey("ctrl+v", "ORION")).toBe("err:linux-window-mismatch");
    expect(run.mock.calls.some(([args]) => ["windowactivate", "key"].includes(args[0]))).toBe(false);
  });
});
