import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { foldPolish, parseOmniVoiceCommand } from "../src/lib/omniReflex";
import {
  assessDesktopActionRisk,
  parseGroundedTarget,
  parseOmniPlanStep,
} from "../src/lib/omniVision";
import {
  abortOmniPilot,
  executeOmniVoiceCommand,
  getOmniHudState,
  resetOmniPilotState,
  respondOmniConfirm,
  runOmniAutonomousTask,
  visualLocateAndAct,
  type OmniActuator,
} from "../src/lib/omniPilot";

function makeMockActuator(overrides: Partial<OmniActuator> = {}) {
  const calls: Array<{ op: string; arg?: unknown }> = [];
  const actuator: OmniActuator = {
    isDesktop: () => true,
    captureScreenDetailed: async () => {
      calls.push({ op: "screenshot" });
      return {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        mediaType: "image/png",
        width: 1440,
        height: 810,
        screenWidth: 1920,
        screenHeight: 1080,
        cursorX: 100,
        cursorY: 100,
      };
    },
    moveCursor: async (payload) => {
      calls.push({ op: "moveCursor", arg: payload });
      const x = payload.mode === "absolute" ? (payload.x ?? 0) : 500 + (payload.dx ?? 0);
      const y = payload.mode === "absolute" ? (payload.y ?? 0) : 500 + (payload.dy ?? 0);
      return { ok: true, x, y, message: `Przesunięto kursor (${x}, ${y}).` };
    },
    mouseAction: async (payload) => {
      calls.push({ op: "mouseAction", arg: payload });
      return { ok: true, message: `Wykonano ${payload.action || "click"}.` };
    },
    scroll: async (direction, amount) => {
      calls.push({ op: "scroll", arg: { direction, amount } });
      return { ok: true, message: `Przewinięto ${direction}.` };
    },
    drag: async (x1, y1, x2, y2) => {
      calls.push({ op: "drag", arg: { x1, y1, x2, y2 } });
      return { ok: true, message: "Przeciągnięto." };
    },
    listWindows: async () => {
      calls.push({ op: "listWindows" });
      return {
        ok: true,
        windows: [
          { id: "0x1", title: "Mozilla Firefox" },
          { id: "0x2", title: "Visual Studio Code" },
        ],
        message: "Otwarte okna (2): Mozilla Firefox, Visual Studio Code.",
      };
    },
    focusWindow: async (query) => {
      calls.push({ op: "focusWindow", arg: query });
      return { ok: true, title: "Mozilla Firefox", message: "Przełączono na okno: Mozilla Firefox." };
    },
    typeUnicode: async (text) => {
      calls.push({ op: "typeUnicode", arg: text });
      return { ok: true, message: `Wpisano tekst (${text.length} znaków).` };
    },
    hotkey: async (combo) => {
      calls.push({ op: "hotkey", arg: combo });
      return { ok: true, message: `Wysłano skrót ${combo}.` };
    },
    launchApp: async (app) => {
      calls.push({ op: "launchApp", arg: app });
      return `Uruchamiam: ${app}.`;
    },
    volume: async (action) => {
      calls.push({ op: "volume", arg: action });
      return "Głośniej.";
    },
    media: async (action) => {
      calls.push({ op: "media", arg: action });
      return "Odtwarzam/pauzuję.";
    },
    abortHardware: async () => {
      calls.push({ op: "abortHardware" });
    },
    sleep: async () => {},
    ...overrides,
  };
  return { actuator, calls };
}

describe("OMNI-PILOT · Warstwa 2: Refleks Głosowy (omniReflex.ts)", () => {
  it("normalizuje polskie znaki i rozpoznaje komendy kursora z modyfikatorami i bez diakrytyków", () => {
    expect(foldPolish("Przesuń kursor w PRAWO!")).toBe("przesun kursor w prawo");

    expect(parseOmniVoiceCommand("przesuń kursor w prawo")).toEqual({
      kind: "cursor_relative",
      dx: 240,
      dy: 0,
      label: "w prawo (240 px)",
    });
    expect(parseOmniVoiceCommand("Hej Jarvis, przesun kursor lekko w gore")).toEqual({
      kind: "cursor_relative",
      dx: 0,
      dy: -95,
      label: "w górę (95 px)",
    });
    expect(parseOmniVoiceCommand("przesuń kursor o 350 pikseli w lewo")).toEqual({
      kind: "cursor_relative",
      dx: -350,
      dy: 0,
      label: "w lewo (350 px)",
    });
    expect(parseOmniVoiceCommand("przesuń kursor na środek ekranu")).toEqual({
      kind: "cursor_named",
      preset: "center",
      label: "środek ekranu",
    });
    expect(parseOmniVoiceCommand("kursor na prawy gorny rog")).toEqual({
      kind: "cursor_named",
      preset: "top-right",
      label: "prawy górny róg",
    });
  });

  it("rozpoznaje komendy wizyjne, mysz, przewijanie, okna, skróty, dyktowanie i autopilota", () => {
    expect(parseOmniVoiceCommand("przesuń kursor na ikonę Firefox")).toEqual({
      kind: "visual",
      action: "move",
      target: "ikonę Firefox",
    });
    expect(parseOmniVoiceCommand("kliknij przycisk Zapisz")).toEqual({
      kind: "visual",
      action: "click",
      target: "przycisk Zapisz",
    });
    expect(parseOmniVoiceCommand("kliknij dwukrotnie na dokument raport.pdf")).toEqual({
      kind: "visual",
      action: "double",
      target: "dokument raport.pdf",
    });
    expect(parseOmniVoiceCommand("kliknij prawym na folder Pobrane")).toEqual({
      kind: "visual",
      action: "right",
      target: "folder Pobrane",
    });
    expect(parseOmniVoiceCommand("znajdź na ekranie przycisk ustawień")).toEqual({
      kind: "visual",
      action: "locate",
      target: "przycisk ustawień",
    });
    expect(parseOmniVoiceCommand("prawy klik")).toEqual({
      kind: "mouse",
      action: "right",
      label: "prawy klik",
    });
    expect(parseOmniVoiceCommand("przewiń mocno w dół")).toEqual({
      kind: "scroll",
      direction: "down",
      amount: 11,
      label: "w dół",
    });
    expect(parseOmniVoiceCommand("przełącz na VS Code")).toEqual({
      kind: "window_focus",
      query: "VS Code",
    });
    expect(parseOmniVoiceCommand("wpisz: Cześć świecie!")).toEqual({
      kind: "type_text",
      text: "Cześć świecie!",
    });
    expect(parseOmniVoiceCommand("zrób na komputerze: otwórz ustawienia sieci i sprawdź Wi-Fi")).toEqual({
      kind: "omni_goal",
      goal: "otwórz ustawienia sieci i sprawdź Wi-Fi",
    });
    expect(parseOmniVoiceCommand("stop")).toEqual({ kind: "abort" });
  });

  it("NIE przechwytuje zwykłych pytań konwersacyjnych (zwraca null)", () => {
    expect(parseOmniVoiceCommand("Jak działa protokół HTTP/3?")).toBeNull();
    expect(parseOmniVoiceCommand("Zrób analizę architektury tego projektu")).toBeNull();
    expect(parseOmniVoiceCommand("Wytłumacz czym jest Wayland vs X11")).toBeNull();
    expect(parseOmniVoiceCommand("Napisz funkcję w TypeScript do sortowania")).toBeNull();
  });
});

describe("OMNI-PILOT · Warstwa 3: Visual Grounding 0..1000 & RiskGuard (omniVision.ts)", () => {
  it("przelicza współrzędne [0..1000] z modelu wizyjnego na dokładne piksele dla różnych rozdzielczości", () => {
    const raw = '```json\n{"found":true,"x":250,"y":500,"label":"Ikona Firefox","confidence":0.94,"risk":"none","reason":"na pasku bocznym"}\n```';
    const hd = parseGroundedTarget(raw, 1920, 1080);
    expect(hd.found).toBe(true);
    expect(hd.xNorm).toBe(250);
    expect(hd.yNorm).toBe(500);
    expect(hd.x).toBe(480);
    expect(hd.y).toBe(540);
    expect(hd.confidence).toBe(0.94);

    const qhd = parseGroundedTarget(raw, 2560, 1440);
    expect(qhd.x).toBe(640);
    expect(qhd.y).toBe(720);

    const missing = parseGroundedTarget('{"found":false,"reason":"Brak przycisku"}', 1920, 1080);
    expect(missing.found).toBe(false);
    expect(missing.reason).toBe("Brak przycisku");
  });

  it("Desktop RiskGuard twardo blokuje hasła/2FA i wymaga potwierdzenia dla płatności/destrukcji/wysyłki", () => {
    expect(assessDesktopActionRisk("Pole hasło", "click", "none").blocked).toBe(true);
    expect(assessDesktopActionRisk("Kod 2FA", "move", "password").blocked).toBe(true);
    expect(assessDesktopActionRisk("Przycisk Zapłać teraz", "click", "payment")).toMatchObject({
      blocked: false,
      requiresConfirmation: true,
    });
    expect(assessDesktopActionRisk("Usuń trwale konto", "click", "destructive")).toMatchObject({
      blocked: false,
      requiresConfirmation: true,
    });
    expect(assessDesktopActionRisk("Wyślij teraz e-mail", "click", "send")).toMatchObject({
      blocked: false,
      requiresConfirmation: true,
    });
    // Samo przesunięcie kursora na przycisk bez kliknięcia nie wymaga potwierdzenia (chyba że hasło)
    expect(assessDesktopActionRisk("Przycisk Zapłać teraz", "move", "payment")).toEqual({
      blocked: false,
      requiresConfirmation: false,
    });
  });

  it("parseOmniPlanStep parsuje poprawny JSON i bezpiecznie spada do need_human przy błędnej odpowiedzi", () => {
    const ok = parseOmniPlanStep('{"action":"visual_click","target":"Zapisz","xNorm":800,"yNorm":100,"risk":"none","summary":"Klikam Zapisz"}');
    expect(ok).toMatchObject({ action: "visual_click", target: "Zapisz", xNorm: 800, yNorm: 100 });

    const broken = parseOmniPlanStep("Nie wiem co zrobić");
    expect(broken.action).toBe("need_human");
  });
});

describe("OMNI-PILOT · Warstwa 4: Orkiestrator, HUD, RiskGuard i pętla autonomiczna (omniPilot.ts)", () => {
  beforeEach(() => {
    resetOmniPilotState();
  });

  it("wykonuje refleks głosowy na desktopie i ignoruje komendy poza desktopem", async () => {
    const { actuator, calls } = makeMockActuator();
    const res = await executeOmniVoiceCommand("przesuń kursor w prawo", { actuator });
    expect(res.handled).toBe(true);
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual({ op: "moveCursor", arg: { mode: "relative", dx: 240, dy: 0, smooth: true } });
    expect(getOmniHudState().phase).toBe("done");

    const nonDesktop = await executeOmniVoiceCommand("przesuń kursor w prawo", {
      actuator: { ...actuator, isDesktop: () => false },
    });
    expect(nonDesktop.handled).toBe(false);
  });

  it("namierza element wizyjnie [0..1000], rysuje retikulę w HUD i płynnie przesuwa kursor", async () => {
    const { actuator, calls } = makeMockActuator();
    const res = await visualLocateAndAct("ikonę Firefox", "move", {
      actuator,
      askVision: async () => '{"found":true,"x":250,"y":500,"label":"Ikona Firefox","confidence":0.95,"risk":"none","reason":"dock"}',
    });
    expect(res.ok).toBe(true);
    expect(res.found).toBe(true);
    expect(calls.find((c) => c.op === "moveCursor")?.arg).toEqual({
      mode: "absolute",
      x: 480,
      y: 540,
      smooth: true,
    });
    const hud = getOmniHudState();
    expect(hud.phase).toBe("done");
    expect(hud.reticle).toMatchObject({ xNorm: 250, yNorm: 500, x: 480, y: 540, label: "Ikona Firefox" });
  });

  it("twardo blokuje kliknięcie pola hasła i wspiera most potwierdzenia HUD dla płatności", async () => {
    const { actuator, calls } = makeMockActuator();
    const blocked = await visualLocateAndAct("pole hasła", "click", {
      actuator,
      askVision: async () => '{"found":true,"x":500,"y":400,"label":"Hasło","confidence":0.99,"risk":"password"}',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(calls.some((c) => c.op === "mouseAction")).toBe(false);

    // Most potwierdzenia przez HUD (respondOmniConfirm)
    const pending = visualLocateAndAct("przycisk Zapłać", "click", {
      actuator,
      askVision: async () => '{"found":true,"x":600,"y":700,"label":"Zapłać teraz","confidence":0.92,"risk":"payment"}',
    });
    // Poczekaj aż wejdzie w fazę confirm
    await new Promise((r) => setTimeout(r, 10));
    expect(getOmniHudState().phase).toBe("confirm");
    expect(getOmniHudState().confirmRequest?.target).toBe("Zapłać teraz");
    respondOmniConfirm(true);
    const approved = await pending;
    expect(approved.ok).toBe(true);
    expect(calls.some((c) => c.op === "mouseAction")).toBe(true);
  });

  it("wykonuje wielokrokową pętlę autonomiczną, wykrywa stagnację i respektuje abortOmniPilot()", async () => {
    const { actuator, calls } = makeMockActuator();
    const plans = [
      '{"action":"focus_window","window":"Firefox","risk":"none","summary":"Przełączam na Firefox"}',
      '{"action":"visual_click","target":"Nowa karta","xNorm":200,"yNorm":50,"risk":"none","summary":"Klikam Nowa karta"}',
      '{"action":"done","risk":"none","summary":"Otwarto nową kartę w Firefoxie."}',
    ];
    let idx = 0;
    const ok = await runOmniAutonomousTask("Otwórz nową kartę w Firefoxie", {
      actuator,
      askVision: async () => plans[idx++] || '{"action":"done","summary":"Gotowe"}',
      maxSteps: 5,
    });
    expect(ok.ok).toBe(true);
    expect(ok.completed).toBe(true);
    expect(ok.stepsExecuted).toBe(2);
    expect(calls.some((c) => c.op === "focusWindow")).toBe(true);
    expect(calls.some((c) => c.op === "mouseAction")).toBe(true);

    // Detekcja stagnacji: model 2 razy z rzędu próbuje dokładnie tego samego kliknięcia
    const stuck = await runOmniAutonomousTask("Kliknij zablokowany przycisk", {
      actuator,
      askVision: async () => '{"action":"visual_click","target":"Dalej","xNorm":500,"yNorm":500,"risk":"none","summary":"Klikam Dalej"}',
      maxSteps: 5,
    });
    expect(stuck.ok).toBe(false);
    expect(stuck.needHuman).toBe(true);
    expect(stuck.stepsExecuted).toBe(1);

    // Awaryjne zatrzymanie w połowie pętli (Kill-Switch Ctrl+Alt+X)
    let stepCalls = 0;
    const aborted = await runOmniAutonomousTask("Długie zadanie", {
      actuator,
      askVision: async () => {
        stepCalls += 1;
        if (stepCalls === 1) {
          abortOmniPilot(actuator);
        }
        return '{"action":"scroll","direction":"down","amount":4,"risk":"none","summary":"Przewijam"}';
      },
      maxSteps: 5,
    });
    expect(aborted.ok).toBe(false);
    expect(aborted.aborted).toBe(true);
    expect(calls.some((c) => c.op === "abortHardware")).toBe(true);
  });

  it("zachowuje 100% zgodność ES2019 / Chrome 79 (brak lookbehind i klas Unicode property)", () => {
    const files = ["src/lib/omniReflex.ts", "src/lib/omniVision.ts", "src/lib/omniPilot.ts"];
    for (const rel of files) {
      const code = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(code, `${rel} zawiera lookbehind`).not.toMatch(/\(\?<[=!]/);
      expect(code, `${rel} zawiera Unicode property escape`).not.toMatch(/\\p\{/);
    }
  });
});
