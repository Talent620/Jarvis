import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { parseOmniVoiceCommand } from "../src/lib/omniReflex";
import {
  abortOmniPilot,
  executeOmniVoiceCommand,
  resetOmniPilotState,
  visualLocateAndAct,
  type OmniActuator,
} from "../src/lib/omniPilot";
import {
  computeFrameFingerprint,
  getSentinelState,
  resetOmniSentinel,
  resolveSentinelDecision,
  runSentinelTick,
  startOmniSentinel,
  subscribeSentinelAlerts,
  tryHandleSentinelVoiceReply,
} from "../src/lib/omniSentinel";

const require = createRequire(import.meta.url);
const { createUiTreeInspector, matchUiNode } = require("../electron/ui-tree.cjs");
const { createDesktopDoctor } = require("../electron/desktop-doctor.cjs");

describe("OMNI-FRONTIER 1 · Semantyczne Drzewo UI (AT-SPI2 / Windows UIA) & Hybrydowe Namierzanie", () => {
  beforeEach(() => {
    resetOmniPilotState();
    resetOmniSentinel();
  });

  it("matchUiNode dopasowuje polskie polecenia do angielskich etykiet UI (synonimy + rola)", () => {
    const nodes = [
      { name: "Cancel", role: "push button", x: 100, y: 500, width: 80, height: 30, centerX: 140, centerY: 515, isPassword: false },
      { name: "Save", role: "push button", x: 200, y: 500, width: 80, height: 30, centerX: 240, centerY: 515, isPassword: false },
      { name: "Settings", role: "menu item", x: 10, y: 40, width: 90, height: 24, centerX: 55, centerY: 52, isPassword: false },
    ];
    const hitSave = matchUiNode(nodes, "przycisk Zapisz");
    expect(hitSave).not.toBeNull();
    expect(hitSave.node.name).toBe("Save");
    expect(hitSave.score).toBeGreaterThanOrEqual(0.9);

    const hitSettings = matchUiNode(nodes, "Ustawienia");
    expect(hitSettings?.node.name).toBe("Settings");
  });

  it("createUiTreeInspector parsuje wyjście Linux AT-SPI2 oraz Windows UIA i wykrywa isPassword", async () => {
    const linuxInspector = createUiTreeInspector({
      platform: "linux",
      run: async () => ({
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          backend: "at-spi2",
          windowTitle: "Visual Studio Code",
          nodes: [
            { name: "Save", role: "push button", x: 400, y: 70, width: 40, height: 36, centerX: 420, centerY: 88, isPassword: false },
            { name: "Token", role: "password text", x: 400, y: 120, width: 140, height: 30, centerX: 470, centerY: 135, isPassword: true },
          ],
        }),
        stderr: "",
      }),
    });
    const found = await linuxInspector.findNode("przycisk zapisz");
    expect(found).toMatchObject({ ok: true, found: true, backend: "at-spi2", node: { name: "Save", centerX: 420, centerY: 88 } });

    const winInspector = createUiTreeInspector({
      platform: "win32",
      run: async () => ({
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          backend: "win-uia",
          windowTitle: "Notatnik",
          nodes: { name: "Zamknij", role: "button", x: 900, y: 0, width: 40, height: 30, centerX: 920, centerY: 15, isPassword: false },
        }),
        stderr: "",
      }),
    });
    const winFound = await winInspector.findNode("zamknij");
    expect(winFound).toMatchObject({ ok: true, found: true, backend: "win-uia", node: { centerX: 920, centerY: 15 } });
  });

  it("visualLocateAndAct używa Drzewa OS (<80ms, 0 USD, 0 zrzutów), blokuje isPassword i spada na Wizję AI przy braku węzła", async () => {
    let screenshots = 0;
    let visionCalls = 0;
    const clicks: unknown[] = [];
    const baseActuator: Partial<OmniActuator> = {
      isDesktop: () => true,
      captureScreenDetailed: async () => {
        screenshots += 1;
        return { data: "AAAA", mediaType: "image/png", width: 1440, height: 810, screenWidth: 1920, screenHeight: 1080, cursorX: 0, cursorY: 0 };
      },
      mouseAction: async (p) => {
        clicks.push(p);
        return { ok: true, message: "Kliknięto." };
      },
      moveCursor: async () => ({ ok: true, x: 420, y: 88, message: "OK" }),
      abortHardware: async () => {},
      sleep: async () => {},
    };

    // 1) Trafienie w Drzewie OS → ZERO zrzutów i ZERO wywołań Vision AI!
    const fast = await visualLocateAndAct("przycisk Zapisz", "click", {
      actuator: {
        ...baseActuator,
        findUiNode: async () => ({
          ok: true,
          found: true,
          backend: "at-spi2",
          windowTitle: "VS Code",
          score: 0.98,
          node: { name: "Save", role: "push button", x: 400, y: 70, width: 40, height: 36, centerX: 420, centerY: 88, isPassword: false },
        }),
      },
      askVision: async () => {
        visionCalls += 1;
        return '{"found":false}';
      },
    });
    expect(fast.ok).toBe(true);
    expect(fast.source).toBe("os-tree");
    expect(screenshots).toBe(0);
    expect(visionCalls).toBe(0);
    expect(clicks[0]).toMatchObject({ action: "click", x: 420, y: 88 });

    // 2) Pole hasła z Drzewa OS (isPassword: true) → twarda blokada RiskGuard bez zrzutu ekranu!
    const blocked = await visualLocateAndAct("pole sekret", "click", {
      actuator: {
        ...baseActuator,
        findUiNode: async () => ({
          ok: true,
          found: true,
          backend: "at-spi2",
          score: 0.95,
          node: { name: "Sekret", role: "password text", x: 100, y: 100, width: 120, height: 30, centerX: 160, centerY: 115, isPassword: true },
        }),
      },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.source).toBe("os-tree");
    expect(screenshots).toBe(0);

    // 3) Brak trafienia w Drzewie OS → automatyczny fallback na Wizję AI [0..1000]!
    const fb = await visualLocateAndAct("ikona w canvasie", "move", {
      actuator: {
        ...baseActuator,
        findUiNode: async () => ({ ok: true, found: false }),
      },
      askVision: async () => {
        visionCalls += 1;
        return '{"found":true,"x":500,"y":500,"label":"Ikona Canvas","confidence":0.9,"risk":"none"}';
      },
    });
    expect(fb.ok).toBe(true);
    expect(fb.source).toBe("vision");
    expect(screenshots).toBe(1);
    expect(visionCalls).toBe(1);
  });
});

describe("OMNI-FRONTIER 2 · Dual-Track Strażnik Ekranu (omniSentinel.ts)", () => {
  beforeEach(() => {
    resetOmniPilotState();
    resetOmniSentinel();
  });

  it("pomija statyczne klatki (0 USD), zgłasza alert po zmianie, obsługuje decyzję głosową i NIE blokuje rozmowy KUMPEL", async () => {
    let frameData = "STATIC_FRAME_BASE64_PAYLOAD_0001";
    let visionCalls = 0;
    const clicks: unknown[] = [];
    const alerts: string[] = [];
    const off = subscribeSentinelAlerts((hit) => alerts.push(hit.label));

    const actuator = {
      isDesktop: () => true,
      captureScreenDetailed: async () => ({
        data: frameData,
        mediaType: "image/png",
        width: 1440,
        height: 810,
        screenWidth: 1920,
        screenHeight: 1080,
        cursorX: 0,
        cursorY: 0,
      }),
      moveCursor: async () => ({ ok: true, x: 960, y: 540, message: "OK" }),
      mouseAction: async (p: unknown) => {
        clicks.push(p);
        return { ok: true, message: "Kliknięto." };
      },
    };

    const started = startOmniSentinel({
      condition: "zielony przycisk Gotowe",
      intervalMs: 30000,
      maxChecks: 10,
      actuator,
      askVision: async () => {
        visionCalls += 1;
        if (visionCalls === 1) return '{"matched":false}';
        return '{"matched":true,"xNorm":500,"yNorm":500,"label":"Przycisk Gotowe","confidence":0.95,"risk":"none","summary":"Widzę zielony przycisk Gotowe","question":"Hej, pojawił się przycisk Gotowe — kliknąć go?"}';
      },
    });
    expect(started.ok).toBe(true);

    // Klatka 1: nie pasuje (1 wywołanie Vision)
    await runSentinelTick();
    expect(visionCalls).toBe(1);
    expect(getSentinelState().skippedStaticFrames).toBe(0);

    // Klatka 2: IDENTYCZNA klatka → pominięta za 0 USD!
    await runSentinelTick();
    expect(visionCalls).toBe(1);
    expect(getSentinelState().skippedStaticFrames).toBe(1);

    // Klatka 3: ekran się zmienia → wykryto cel!
    frameData = "NEW_CHANGED_FRAME_BASE64_PAYLOAD_9999";
    await runSentinelTick();
    expect(visionCalls).toBe(2);
    expect(getSentinelState().status).toBe("awaiting_decision");
    expect(alerts).toEqual(["Przycisk Gotowe"]);

    // DUAL-TRACK: normalna rozmowa „jak z kumplem” NIE jest przechwytywana!
    const buddyChat = await tryHandleSentinelVoiceReply("Ej stary, co myślisz o dzisiejszym meczu?");
    expect(buddyChat.handled).toBe(false);
    expect(getSentinelState().status).toBe("awaiting_decision");

    // Głosowa decyzja użytkownika → klika wykryty cel i wraca do obserwacji!
    const decide = await tryHandleSentinelVoiceReply("kliknij to");
    expect(decide.handled).toBe(true);
    expect(decide.ok).toBe(true);
    expect(clicks[0]).toMatchObject({ action: "click", x: 960, y: 540 });
    expect(getSentinelState().status).toBe("watching");

    // Kill-Switch zatrzymuje także Strażnika
    abortOmniPilot();
    expect(getSentinelState().status).toBe("stopped");
    off();
  });

  it("twardo blokuje kliknięcie pola hasła wykrytego przez Strażnika i respektuje limit maxChecks", async () => {
    expect(computeFrameFingerprint("abc")).not.toBe(computeFrameFingerprint("xyz"));

    const actuator = {
      isDesktop: () => true,
      captureScreenDetailed: async () => ({
        data: `FRAME_${Math.random()}`,
        mediaType: "image/png",
        width: 1280,
        height: 720,
        screenWidth: 1920,
        screenHeight: 1080,
        cursorX: 0,
        cursorY: 0,
      }),
      moveCursor: async () => ({ ok: true, x: 0, y: 0, message: "OK" }),
      mouseAction: async () => ({ ok: true, message: "OK" }),
    };

    startOmniSentinel({
      condition: "okno logowania",
      intervalMs: 30000,
      maxChecks: 2,
      actuator,
      askVision: async () => '{"matched":true,"xNorm":500,"yNorm":500,"label":"Pole hasła","confidence":0.95,"risk":"password","question":"Okno hasła"}',
    });
    await runSentinelTick();
    expect(getSentinelState().status).toBe("awaiting_decision");

    const blocked = await resolveSentinelDecision("click");
    expect(blocked.ok).toBe(false);
    expect(blocked.text).toContain("RiskGuard");
  });

  it("rozpoznaje polskie komendy głosowe dla Strażnika Ekranu i Diagnostyki Systemu", async () => {
    expect(parseOmniVoiceCommand("pilnuj ekranu i daj znać jak pojawi się błąd w terminalu")).toEqual({
      kind: "sentinel_start",
      condition: "błąd w terminalu",
    });
    expect(parseOmniVoiceCommand("zatrzymaj strażnika")).toEqual({ kind: "sentinel_stop" });
    expect(parseOmniVoiceCommand("zdiagnozuj komputer")).toEqual({ kind: "diagnose" });

    const diagRes = await executeOmniVoiceCommand("zdiagnozuj komputer", {
      actuator: {
        isDesktop: () => true,
        diagnose: async () => ({ ok: true, message: "🩺 OK", spokenText: "System zdrowy." }),
      },
    });
    expect(diagRes).toMatchObject({ handled: true, ok: true, kind: "diagnose", text: "🩺 OK" });
  });
});

describe("OMNI-FRONTIER 3 · Diagnostyka „Znajdź i Napraw” (electron/desktop-doctor.cjs) + ES2019", () => {
  it("zbiera twarde fakty Linux (wyciszony dźwięk, dysk 92%, braki narzędzi) i generuje bezpieczne fixHinty", async () => {
    const doctor = createDesktopDoctor({
      platform: "linux",
      env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
      run: async (cmd: string, args: string[]) => {
        if (cmd === "wpctl") return { ok: true, code: 0, stdout: "Volume: 0.70 [MUTED]\n", stderr: "" };
        if (cmd === "df") return { ok: true, code: 0, stdout: "Filesystem Size Used Avail Use% Mounted\n/dev/nvme 100G 92G 8G 92% /\n", stderr: "" };
        if (cmd === "ps") return { ok: true, code: 0, stdout: "node 18.2 3.1\nfirefox 9.4 6.2\n", stderr: "" };
        if (cmd === "ss") return { ok: true, code: 0, stdout: "LISTEN 0 128 127.0.0.1:5173 0.0.0.0:*\n", stderr: "" };
        if (cmd === "journalctl") return { ok: true, code: 0, stdout: "", stderr: "" };
        if (cmd === "xdotool") return { ok: false, code: "ENOENT", stdout: "", stderr: "" };
        if (cmd === "python3" && args[0] === "-c") return { ok: false, code: 1, stdout: "", stderr: "No module gi" };
        return { ok: true, code: 0, stdout: "ok", stderr: "" };
      },
    });
    const rep = await doctor.diagnose();
    expect(rep.ok).toBe(true);
    const audio = rep.checks.find((c: { id: string }) => c.id === "audio");
    expect(audio.status).toBe("warn");
    expect(audio.fixHint).toContain("wpctl set-mute");
    const disk = rep.checks.find((c: { id: string }) => c.id === "disk");
    expect(disk.status).toBe("error");
    const stack = rep.checks.find((c: { id: string }) => c.id === "omni_stack");
    expect(stack.fixHint).toContain("xdotool");
    expect(stack.fixHint).toContain("gir1.2-atspi-2.0");
  });

  it("zachowuje 100% zgodność ES2019 / Chrome 79 w nowych plikach Frontier", () => {
    const files = ["src/lib/omniSentinel.ts", "src/lib/omniReflex.ts", "src/lib/omniPilot.ts", "src/components/OmniPilotHud.tsx"];
    for (const rel of files) {
      const code = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(code, `${rel} zawiera lookbehind`).not.toMatch(/\(\?<[=!]/);
      expect(code, `${rel} zawiera Unicode property escape`).not.toMatch(/\\p\{/);
    }
  });
});
