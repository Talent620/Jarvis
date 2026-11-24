// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { store } from "../src/lib/store";
import { handleVoiceOrChatGoalCommand } from "../src/lib/goalVoiceBridge";
import type { GoalRecord, GoalStorage } from "../src/lib/goalState";
import {
  resetOmniPilotState,
  runOmniAutonomousTask,
  type OmniActuator,
} from "../src/lib/omniPilot";
import {
  getSentinelState,
  resetOmniSentinel,
  runSentinelTick,
  startOmniSentinel,
} from "../src/lib/omniSentinel";
import { checkForUpdate } from "../src/lib/updater";
import { matchedGroups, selectToolsForIntent } from "../src/lib/toolSelector";
import { toolDefs } from "../src/lib/tools";
import { JARVIS_MODULES, JARVIS_VERSION } from "../src/lib/selfManifest";
import { clearGuardianHistory } from "../src/lib/guardianHistory";

const require = createRequire(import.meta.url);
const { createLinuxKeyboard } = require("../electron/linux-keyboard.cjs");
const { createDesktopPilot } = require("../electron/desktop-pilot.cjs");

function makeMemoryGoalStorage(): GoalStorage & { items: () => GoalRecord[] } {
  const map = new Map<string, unknown>();
  return {
    items: () => {
      for (const v of map.values()) if (Array.isArray(v)) return v as GoalRecord[];
      return [];
    },
    get: async <T>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    set: async <T>(key: string, val: T) => {
      map.set(key, val);
      return true;
    },
  };
}

describe("Etap 3 · Podpięcie martwych mózgów, hybryda OS-Tree -> Vision, X11/Xvfb i higiena", () => {
  beforeEach(() => {
    localStorage.clear();
    resetOmniPilotState();
    resetOmniSentinel();
    clearGuardianHistory();
    store.setData((d) => {
      d.tasks = [];
      d.notes = [];
      d.shopping = [];
      d.audit = [];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop;
  });

  it("voiceCognition + agentPlanner + goalRuntime działają spójnie przez goalVoiceBridge i odrzucają halucynowane narzędzia", async () => {
    const storage = makeMemoryGoalStorage();

    // Zwykła rozmowa bez zapisanych celów NIE jest przechwytywana
    expect((await handleVoiceOrChatGoalCommand("hej, jak idzie?", { storage })).handled).toBe(false);

    // 1) Start celu: tworzy plan, waliduje go przez agentPlanner, wykonuje oba kroki (odczyt CONFIRMED + zapis ATTEMPTED) i zapisuje w goalStorage
    const started = await handleVoiceOrChatGoalCommand("rozpocznij cel: przygotować raport kwartalny", { storage, now: 1000 });
    expect(started.handled).toBe(true);
    expect(started.ok).toBe(true);
    expect(storage.items().length).toBe(1);
    expect(storage.items()[0].status).toBe("waiting_user"); // honest resultVerifier: zapis wymaga sprawdzenia, odczyt potwierdzony
    expect(store.data.tasks.some((t) => t.title.includes("raport kwartalny"))).toBe(true);
    expect(started.spokenText && started.spokenText.length <= 245).toBe(true);

    // 2) Pytanie o postęp, następny krok i wstrzymanie planu
    const prog = await handleVoiceOrChatGoalCommand("jaki postęp celu?", { storage });
    expect(prog.handled).toBe(true);
    expect(prog.text).toMatch(/1\/2 kroków potwierdzonych/);

    const nextStep = await handleVoiceOrChatGoalCommand("co dalej?", { storage });
    expect(nextStep.handled).toBe(true);
    expect(nextStep.text).toMatch(/add_task/);

    const resumed = await handleVoiceOrChatGoalCommand("wznów cel", { storage, now: 2000 });
    expect(resumed.handled).toBe(true);
    expect(resumed.text).toMatch(/Wznowiono cel/);

    const paused = await handleVoiceOrChatGoalCommand("wstrzymaj plan", { storage });
    expect(paused.handled).toBe(true);
    expect(paused.text).toMatch(/Wstrzymałem plan/);

    // 3) Plan z nieistniejącym narzędziem → twardo odrzucony przez validatePlan
    const bad = await handleVoiceOrChatGoalCommand("rozpocznij cel: test walidatora", {
      storage,
      planBuilder: (g) => ({
        goal: g,
        steps: [{ id: "s1", intent: "wykonaj nieistniejące", tool: "wymyslone_narzedzie_xyz" }],
      }),
    });
    expect(bad.handled).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/odrzucony przez walidator/i);
  });

  it("omniSentinel używa Drzewa OS (AT-SPI2/UIA) jako 1. warstwy za 0 USD (0 zrzutów, 0 Vision AI) i oznacza pole hasła", async () => {
    let screenshots = 0;
    let visionCalls = 0;
    const act = {
      isDesktop: () => true,
      captureScreenDetailed: async () => {
        screenshots += 1;
        return { data: "FRAME", mediaType: "image/png", width: 1280, height: 720, screenWidth: 1280, screenHeight: 720, cursorX: 0, cursorY: 0 };
      },
      findUiNode: async () => ({
        ok: true,
        found: true,
        backend: "at-spi2",
        windowTitle: "Sklep",
        score: 0.95,
        node: { name: "Gotowe", role: "push button", x: 300, y: 200, width: 100, height: 40, centerX: 350, centerY: 220, isPassword: false },
      }),
      moveCursor: async () => ({ ok: true, x: 350, y: 220, message: "OK" }),
      mouseAction: async () => ({ ok: true, message: "OK" }),
    };

    startOmniSentinel({
      condition: "przycisk Gotowe",
      intervalMs: 60000,
      actuator: act,
      askVision: async () => {
        visionCalls += 1;
        return '{"matched":false}';
      },
    });
    await runSentinelTick();

    const st = getSentinelState();
    expect(st.status).toBe("awaiting_decision");
    expect(st.hit?.source).toBe("os-tree");
    expect(st.hit?.x).toBe(350);
    expect(st.hit?.y).toBe(220);
    expect(screenshots).toBe(0);
    expect(visionCalls).toBe(0);
    expect(st.visionCalls).toBe(0);
  });

  it("runOmniAutonomousTask zasila planer Drzewem OS, uziemia cel z AT-SPI2 przed Vision i weryfikuje wynik przez verifyResult", async () => {
    const prompts: string[] = [];
    const clicks: Array<{ x?: number; y?: number }> = [];
    let stepCalls = 0;
    const actuator: Partial<OmniActuator> = {
      isDesktop: () => true,
      captureScreenDetailed: async () => ({
        data: `FRAME_${stepCalls}`,
        mediaType: "image/png",
        width: 1280,
        height: 720,
        screenWidth: 1280,
        screenHeight: 720,
        cursorX: 10,
        cursorY: 10,
      }),
      listWindows: async () => ({ ok: true, windows: [{ id: "1", title: "Edytor" }], message: "OK" }),
      queryUiTree: async () => ({
        ok: true,
        backend: "at-spi2",
        windowTitle: "Edytor",
        nodes: [{ name: "Save", role: "push button", x: 500, y: 80, width: 60, height: 30, centerX: 530, centerY: 95, isPassword: false }],
        message: "OK",
      }),
      findUiNode: async (q) =>
        /save|zapisz/i.test(q)
          ? {
              ok: true,
              found: true,
              backend: "at-spi2",
              score: 0.96,
              node: { name: "Save", role: "push button", x: 500, y: 80, width: 60, height: 30, centerX: 530, centerY: 95, isPassword: false },
            }
          : { ok: true, found: false },
      mouseAction: async (p) => {
        clicks.push({ x: p.x, y: p.y });
        return { ok: true, message: "Kliknięto." };
      },
      abortHardware: async () => {},
      sleep: async () => {},
    };

    const res = await runOmniAutonomousTask("zapisz dokument", {
      actuator,
      maxSteps: 3,
      askVision: async (_sys, prompt) => {
        prompts.push(prompt);
        stepCalls += 1;
        if (stepCalls === 1) return '{"action":"visual_click","target":"przycisk Zapisz","summary":"Klikam Zapisz"}';
        return '{"action":"done","summary":"Dokument zapisany"}';
      },
    });

    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(prompts[0]).toContain("[push button] Save (530,95)");
    expect(clicks[0]).toEqual({ x: 530, y: 95 });
  });

  it("spójna detekcja X11 w linux-keyboard.cjs (działa na Xvfb :99), EWMH fallback w desktop-pilot.cjs, brak CORS w updater.ts oraz desktop_drag/selfManifest", async () => {
    // 1) linux-keyboard akceptuje Xvfb DISPLAY=:99 bez XDG_SESSION_TYPE, nadal blokuje Wayland i puste env
    const runXdo = vi.fn(async (args: string[]) => (args[0] === "getactivewindow" ? "77" : "Chrome"));
    expect(await createLinuxKeyboard({ env: { DISPLAY: ":99" }, run: runXdo }).activeWindow()).toEqual({ ok: true, title: "Chrome" });
    expect(await createLinuxKeyboard({ env: { DISPLAY: ":99", WAYLAND_DISPLAY: "wayland-0" }, run: runXdo }).activeWindow()).toEqual({
      ok: false,
      error: "err:linux-session",
    });

    // 2) desktop-pilot focusWindow zwraca czytelny err:no-window-manager na czystym Xvfb bez EWMH WM
    const pilot = createDesktopPilot({
      platform: "linux",
      env: { DISPLAY: ":99" },
      run: async (cmd: string, args: string[]) => {
        if (cmd === "xdotool" && args[0] === "search") return { ok: true, code: 0, stdout: "12345\n", stderr: "" };
        if (cmd === "xdotool" && args[0] === "getwindowname") return { ok: true, code: 0, stdout: "Google Chrome\n", stderr: "" };
        return { ok: false, code: 1, stdout: "", stderr: "no wm" };
      },
    });
    expect(await pilot.focusWindow("chrome")).toEqual({ ok: false, error: "err:no-window-manager" });

    // 3) updater.ts NIE wykonuje cross-origin fetch na github.com/.../releases/download/linux.json w przeglądarce http(s)
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { platform: "linux" };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          published_at: "2026-11-20T12:00:00Z",
          assets: [
            { name: "JARVIS.AppImage", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/JARVIS.AppImage", updated_at: "2026-11-20T12:00:00Z", size: 42 },
            { name: "linux.json", browser_download_url: "https://github.com/Talent620/Jarvis/releases/download/latest/linux.json" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const upd = await checkForUpdate();
    expect("error" in upd).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // tylko api.github.com — ZERO CORS na github.com/releases/download!

    // 4) toolSelector + desktop_drag + selfManifest
    expect(matchedGroups("otwórz aplikację na pulpicie Linux")).toContain("desktop");
    const selectedNames = selectToolsForIntent("przeciągnij okno na pulpicie", toolDefs).map((t) => t.name);
    expect(selectedNames).toContain("desktop_drag");
    expect(JARVIS_VERSION).toBe("5.0.0-production-rc");
    expect(JARVIS_MODULES.some((m) => /AUTOCORE/i.test(m))).toBe(true);
  });
});
