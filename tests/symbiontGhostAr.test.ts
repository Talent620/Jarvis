// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRequire } from "module";
import {
  parseDeicticCommand,
  isConfidentialContext,
  executeFoveatedCommand,
  type FoveatedActuator,
} from "../src/lib/foveatedPerception";
import {
  visualLocateAndAct,
  executeOmniVoiceCommand,
  abortOmniPilot,
  resetOmniPilotState,
  type OmniActuator,
} from "../src/lib/omniPilot";
import { validateAndApplyJarvisSettings, rollbackJarvisSettings, clearSettingsRollbackHistory } from "../src/lib/selfManifest";
import { getGuardianHistory, clearGuardianHistory } from "../src/lib/guardianHistory";
import { store } from "../src/lib/store";

const require = createRequire(import.meta.url);
const {
  createGhostOverlayManager,
  resolveGhostBackend,
  computeOverlayGeometry,
  isConfidentialSurface,
} = require("../electron/ghost-overlay.cjs");
const {
  computeFoveatedCropRect,
  createFoveatedCropper,
} = require("../electron/foveated-crop.cjs");
const { findNodeAtPoint } = require("../electron/ui-tree.cjs");

interface FakeWindowInstance {
  opts: Record<string, unknown>;
  destroyed: boolean;
  shownInactive: number;
  hidden: number;
  ignoreMouseArgs: Array<[boolean, Record<string, unknown>]>;
  alwaysOnTopArgs: Array<[boolean, string]>;
  bounds: { x: number; y: number; width: number; height: number } | null;
  sentMessages: Array<{ channel: string; payload?: unknown }>;
  webContents: {
    on: (ev: string, cb: (...args: unknown[]) => void) => void;
    send: (channel: string, payload?: unknown) => void;
    setWindowOpenHandler: (fn: () => { action: string }) => void;
  };
  on: (ev: string, cb: () => void) => void;
  loadFile: (p: string) => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean, opts?: Record<string, unknown>) => void;
  setAlwaysOnTop: (flag: boolean, level: string) => void;
  setVisibleOnAllWorkspaces: (flag: boolean, opts?: Record<string, unknown>) => void;
  setBounds: (b: { x: number; y: number; width: number; height: number }) => void;
  showInactive: () => void;
  show: () => void;
  hide: () => void;
  destroy: () => void;
  isDestroyed: () => boolean;
}

function makeFakeBrowserWindowCtor(created: FakeWindowInstance[]) {
  return class FakeBrowserWindow {
    opts: Record<string, unknown>;
    destroyed = false;
    shownInactive = 0;
    hidden = 0;
    ignoreMouseArgs: Array<[boolean, Record<string, unknown>]> = [];
    alwaysOnTopArgs: Array<[boolean, string]> = [];
    bounds: { x: number; y: number; width: number; height: number } | null = null;
    sentMessages: Array<{ channel: string; payload?: unknown }> = [];
    private wcListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    webContents = {
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        this.wcListeners[ev] = this.wcListeners[ev] || [];
        this.wcListeners[ev].push(cb);
      },
      send: (channel: string, payload?: unknown) => {
        this.sentMessages.push({ channel, payload });
      },
      setWindowOpenHandler: () => {},
    };

    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      created.push(this as unknown as FakeWindowInstance);
    }

    on() {}

    async loadFile() {
      for (const cb of this.wcListeners["did-finish-load"] || []) cb();
    }

    setIgnoreMouseEvents(ignore: boolean, opts: Record<string, unknown> = {}) {
      this.ignoreMouseArgs.push([ignore, opts]);
    }

    setAlwaysOnTop(flag: boolean, level: string) {
      this.alwaysOnTopArgs.push([flag, level]);
    }

    setVisibleOnAllWorkspaces() {}

    setBounds(b: { x: number; y: number; width: number; height: number }) {
      this.bounds = b;
    }

    showInactive() {
      this.shownInactive += 1;
    }

    show() {}

    hide() {
      this.hidden += 1;
    }

    destroy() {
      this.destroyed = true;
    }

    isDestroyed() {
      return this.destroyed;
    }
  };
}

describe("SYMBIONT Phase 1 — Ghost AR Overlay & Platform Matrix", () => {
  it("rozpoznaje uczciwie możliwości platformy: X11 native vs Wayland fallback vs Windows DWM", () => {
    const x11 = resolveGhostBackend({
      platform: "linux",
      env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" },
    });
    expect(x11.supported).toBe(true);
    expect(x11.mode).toBe("native-overlay");
    expect(x11.backend).toBe("x11-compositor");
    expect(x11.alwaysOnTopLevel).toBe("floating");

    const wayland = resolveGhostBackend({
      platform: "linux",
      env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
    });
    expect(wayland.supported).toBe(false);
    expect(wayland.mode).toBe("wayland-fallback");
    expect(wayland.portalScreenCastRequired).toBe(true);
    expect(wayland.alwaysOnTopLevel).toBeNull();

    const win = resolveGhostBackend({ platform: "win32", env: {} });
    expect(win.supported).toBe(true);
    expect(win.mode).toBe("native-overlay");
    expect(win.backend).toBe("win32-dwm");
    expect(win.alwaysOnTopLevel).toBe("floating");
  });

  it("tworzy okno GhostOverlay z pełnym click-through, bez kradzieży fokusu i na poziomie floating (nigdy screen-saver)", async () => {
    const created: FakeWindowInstance[] = [];
    const mgr = createGhostOverlayManager({
      platform: "linux",
      env: { DISPLAY: ":99", XDG_SESSION_TYPE: "x11" },
      BrowserWindow: makeFakeBrowserWindowCtor(created),
      screen: {
        getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
        getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }],
      },
    });

    const res = await mgr.showTarget({
      x: 640,
      y: 420,
      width: 140,
      height: 38,
      boxX: 570,
      boxY: 401,
      label: "Zapisz ofertę",
      source: "at-spi2",
      confidence: 0.96,
      plannedAction: "Kliknięcie",
      approvalStatus: "confirmed",
      ttlMs: 2500,
    });

    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(false);
    expect(created).toHaveLength(1);

    const w = created[0];
    expect(w.opts.transparent).toBe(true);
    expect(w.opts.frame).toBe(false);
    expect(w.opts.focusable).toBe(false);
    expect(w.opts.skipTaskbar).toBe(true);
    expect(w.opts.type).toBe("toolbar");
    const wp = w.opts.webPreferences as Record<string, unknown>;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);

    // Click-through + alwaysOnTop floating (bez zasłaniania Polkit/UAC) + showInactive
    expect(w.ignoreMouseArgs.some(([ignore, o]) => ignore === true && o.forward === true)).toBe(true);
    expect(w.alwaysOnTopArgs).toEqual([[true, "floating"]]);
    expect(w.shownInactive).toBe(1);
    expect(w.sentMessages.some((m) => m.channel === "jarvis:ghost-render")).toBe(true);

    mgr.destroy();
  });

  it("na Waylandzie NIE tworzy zepsutego okna alwaysOnTop, lecz zwraca uczciwy wayland-fallback z geometrią", async () => {
    const created: FakeWindowInstance[] = [];
    const mgr = createGhostOverlayManager({
      platform: "linux",
      env: { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
      BrowserWindow: makeFakeBrowserWindowCtor(created),
      screen: {
        getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }],
      },
    });

    const res = await mgr.showTarget({ x: 500, y: 300, label: "Wyślij" });
    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(true);
    expect(res.mode).toBe("wayland-fallback");
    expect(created).toHaveLength(0);
  });

  it("przelicza poprawnie wielomonitorowość (w tym ujemne offsety) oraz skalowanie HiDPI (scaleFactor=2)", () => {
    const displays = [
      { id: 10, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { id: 20, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 }, // 3840x2160 fizycznych px
      { id: 30, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25 },
    ];

    // Punkt na lewym monitorze o ujemnym X (-500, 300)
    const leftGeom = computeOverlayGeometry({ x: -500, y: 300, width: 100, height: 40 }, displays);
    expect(leftGeom.displayId).toBe(10);
    expect(leftGeom.localX).toBe(1420);
    expect(leftGeom.localY).toBe(300);

    // Punkt fizyczny (2400, 1200) na głównym ekranie 4K HiDPI (scaleFactor=2 -> DIP 1200, 600)
    const hidpiGeom = computeOverlayGeometry(
      { x: 2400, y: 1200, width: 200, height: 80, boxX: 2300, boxY: 1160, coordSpace: "physical" },
      displays,
    );
    expect(hidpiGeom.displayId).toBe(20);
    expect(hidpiGeom.scaleFactor).toBe(2);
    expect(hidpiGeom.localX).toBe(1200);
    expect(hidpiGeom.localY).toBe(600);
    expect(hidpiGeom.localWidth).toBe(100);
    expect(hidpiGeom.localHeight).toBe(40);
    expect(hidpiGeom.boxLocalX).toBe(1150);
    expect(hidpiGeom.boxLocalY).toBe(580);

    // Wycinek Foveated 384x384 przy prawej dolnej krawędzi ekranu 4K zostaje bezpiecznie przycięty do krawędzi
    const edgeCrop = computeFoveatedCropRect({
      cursorX: 3820,
      cursorY: 2140,
      cropSize: 384,
      coordSpace: "physical",
      displays,
    });
    expect(edgeCrop.displayId).toBe(20);
    expect(edgeCrop.cropWidth).toBe(384);
    expect(edgeCrop.cropHeight).toBe(384);
    expect(edgeCrop.cropX).toBe(3840 - 384);
    expect(edgeCrop.cropY).toBe(2160 - 384);
    expect(edgeCrop.cursorRelX).toBe(3820 - edgeCrop.cropX);
    expect(edgeCrop.cursorRelY).toBe(2140 - edgeCrop.cropY);
  });

  it("twardo blokuje nakładkę Ghost AR i wycinek 384x384 nad oknami Polkit, 1Password, 2FA i polami isPassword", async () => {
    expect(isConfidentialSurface({ windowTitle: "Polkit Authentication Agent" })).toBe(true);
    expect(isConfidentialSurface({ windowTitle: "1Password — Odblokuj sejf" })).toBe(true);
    expect(isConfidentialSurface({ targetLabel: "Kod jednorazowy 2FA" })).toBe(true);
    expect(isConfidentialSurface({ isPassword: true, targetLabel: "Pole tekstowe" })).toBe(true);
    expect(isConfidentialSurface({ windowTitle: "LibreOffice Calc", targetLabel: "Zapisz" })).toBe(false);

    const created: FakeWindowInstance[] = [];
    const mgr = createGhostOverlayManager({
      platform: "linux",
      env: { DISPLAY: ":99", XDG_SESSION_TYPE: "x11" },
      BrowserWindow: makeFakeBrowserWindowCtor(created),
      getActiveWindowTitle: async () => "pinentry-gnome3 — Wpisz hasło klucza GPG",
    });

    const ghostBlocked = await mgr.showTarget({ x: 400, y: 400, label: "OK" });
    expect(ghostBlocked.ok).toBe(false);
    expect(ghostBlocked.blocked).toBe(true);
    expect(created).toHaveLength(0);

    const getSourcesSpy = vi.fn();
    const cropper = createFoveatedCropper({
      desktopCapturer: { getSources: getSourcesSpy },
      uiTree: {
        nodeAtPoint: async () => ({
          ok: true,
          found: true,
          windowTitle: "Logowanie do konta",
          node: { name: "Wpisz tajny kod", role: "password text", isPassword: true, x: 100, y: 100, width: 200, height: 32 },
        }),
      },
    });

    const cropBlocked = await cropper.captureCrop({ x: 150, y: 115, cropSize: 384 });
    expect(cropBlocked.ok).toBe(false);
    expect(cropBlocked.blocked).toBe(true);
    // Przechwycenie pikseli NIE MOŻE zostać wywołane nad polem hasła!
    expect(getSourcesSpy).not.toHaveBeenCalled();
  });
});

describe("SYMBIONT Phase 1 — OS-Tree Point Hit-Testing & Foveated Deictic Perception", () => {
  beforeEach(() => {
    resetOmniPilotState();
    clearGuardianHistory();
    clearSettingsRollbackHistory();
    store.setSettings({
      ghostArEnabled: true,
      onDeviceOnly: false,
      requireConsentAlways: false,
      autonomyProfile: "OPERATOR",
      ollamaUrl: "",
    });
  });

  it("findNodeAtPoint wybiera najmniejszy zagnieżdżony przycisk i nadaje priorytet bezpieczeństwa polom isPassword", () => {
    const nodes = [
      { name: "Pasek narzędzi", role: "tool bar", x: 0, y: 0, width: 1200, height: 60, centerX: 600, centerY: 30, isPassword: false },
      { name: "Eksportuj PDF", role: "push button", x: 200, y: 10, width: 110, height: 36, centerX: 255, centerY: 28, isPassword: false },
    ];
    const hit = findNodeAtPoint(nodes, 240, 25);
    expect(hit?.name).toBe("Eksportuj PDF");

    const withPass = [
      { name: "Pole hasła", role: "password text", x: 400, y: 300, width: 260, height: 40, centerX: 530, centerY: 320, isPassword: true },
      { name: "Ikona oka", role: "push button", x: 630, y: 308, width: 24, height: 24, centerX: 642, centerY: 320, isPassword: false },
    ];
    // Nawet na małej ikonie wewnątrz pola hasła wygrywa ochrona isPassword!
    const passHit = findNodeAtPoint(withPass, 640, 320);
    expect(passHit?.isPassword).toBe(true);
  });

  it("rozpoznaje polskie komendy deiktyczne i nie przechwytuje ogólnych pytań wiedzy", () => {
    expect(parseDeicticCommand("co to jest?")?.kind).toBe("inspect");
    expect(parseDeicticCommand("Jarvis wyjaśnij to pod kursorem")?.kind).toBe("explain");
    expect(parseDeicticCommand("napraw ten błąd")?.kind).toBe("fix");
    expect(parseDeicticCommand("odpisz na to że jutro o 10:00")).toEqual({
      kind: "reply",
      instruction: "że jutro o 10:00",
    });
    expect(parseDeicticCommand("kliknij tutaj")).toEqual({
      kind: "click_here",
      mouseAction: "click",
    });
    expect(parseDeicticCommand("kliknij prawym tutaj")).toEqual({
      kind: "click_here",
      mouseAction: "right",
    });
    // Ogólne pytania NIE są traktowane jako deiktyczne
    expect(parseDeicticCommand("wyjaśnij teorię względności")).toBeNull();
    expect(parseDeicticCommand("napraw pralkę w domu")).toBeNull();
    expect(isConfidentialContext({ windowTitle: "KeePassXC", label: "Kopiuj" })).toBe(true);
  });

  it("wykonuje Foveated Perception z wycinkiem wyłącznie 384x384 px (nigdy pełny ekran) i generuje bezpieczny DRAFT odpowiedzi", async () => {
    const cropSizes: number[] = [];
    const ghostPayloads: unknown[] = [];
    const modelImages: Array<{ data: string; mediaType: string } | undefined> = [];

    const act: Partial<FoveatedActuator> = {
      isDesktop: () => true,
      cursorPos: async () => ({ ok: true, x: 780, y: 520 }),
      nodeAtPoint: async () => ({ ok: true, found: false, windowTitle: "Thunderbird — Wiadomość od Anna" }),
      foveatedCrop: async (opts) => {
        cropSizes.push(opts?.cropSize ?? 0);
        return {
          ok: true,
          data: "Q1JPUF8zODRfUE5H",
          mediaType: "image/png",
          width: 384,
          height: 384,
          cursorX: 780,
          cursorY: 520,
          cursorRelX: 192,
          cursorRelY: 192,
          windowTitle: "Thunderbird — Wiadomość od Anna",
        };
      },
      ghostShow: async (p) => {
        ghostPayloads.push(p);
        return { ok: true, mode: "native-overlay" };
      },
      ghostHide: async () => {},
    };

    const replyRes = await executeFoveatedCommand("odpisz na to że potwierdzam spotkanie o 14:00", {
      actuator: act,
      askModel: async (req) => {
        modelImages.push(req.image);
        return "Dzień dobry Anno,\n\nPotwierdzam nasze spotkanie o godzinie 14:00.\n\nPozdrawiam";
      },
    });

    expect(replyRes.handled).toBe(true);
    expect(replyRes.ok).toBe(true);
    expect(replyRes.kind).toBe("reply");
    expect(cropSizes).toEqual([384]);
    expect(modelImages[0]?.data).toBe("Q1JPUF8zODRfUE5H");
    expect(replyRes.text).toContain("Szkic odpowiedzi");
    expect(replyRes.text).toContain("DRAFT — wymaga Twojej akceptacji przed wysłaniem");
    expect(ghostPayloads).toHaveLength(2); // preview -> pending_consent
  });

  it("egzekwuje tryb prywatności onDeviceOnly: blokuje wysłanie wycinka do chmury, gdy brak lokalnego modelu VL", async () => {
    store.setSettings({ onDeviceOnly: true, ollamaUrl: "", webllmEnabled: false });

    const res = await executeFoveatedCommand("napraw to", {
      actuator: {
        isDesktop: () => true,
        cursorPos: async () => ({ ok: true, x: 400, y: 300 }),
        nodeAtPoint: async () => ({ ok: true, found: false, windowTitle: "Terminal" }),
        foveatedCrop: async () => ({
          ok: true,
          data: "Q1JPUF8zODQ=",
          mediaType: "image/png",
          width: 384,
          height: 384,
        }),
        ghostShow: async () => ({ ok: true }),
        ghostHide: async () => {},
      },
    });

    expect(res.handled).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.text).toContain("Tryb on-device aktywny");
  });

  it("„kliknij tutaj” przy niskiej pewności (<0.65) pokazuje ostrzeżenie w Ghost AR i wymaga zgody użytkownika", async () => {
    const ghostCalls: Array<Record<string, unknown>> = [];
    const mouseCalls: unknown[] = [];
    const confirmSpy = vi.fn(async () => false);

    const deniedRes = await executeFoveatedCommand("kliknij tutaj", {
      actuator: {
        isDesktop: () => true,
        cursorPos: async () => ({ ok: true, x: 910, y: 615 }),
        nodeAtPoint: async () => ({ ok: true, found: false, windowTitle: "Nieznana aplikacja Canvas" }),
        foveatedCrop: async () => ({
          ok: true,
          data: "Q1JPUA==",
          mediaType: "image/png",
          width: 384,
          height: 384,
          cursorRelX: 192,
          cursorRelY: 192,
        }),
        mouseAction: async (p) => {
          mouseCalls.push(p);
          return { ok: true, message: "Kliknięto" };
        },
        ghostShow: async (p) => {
          ghostCalls.push(p as unknown as Record<string, unknown>);
          return { ok: true };
        },
        ghostHide: async () => {},
        sleep: async () => {},
      },
      askModel: async () => '{"label":"Rozmyta ikona","confidence":0.42,"risk":"none"}',
      onConfirm: confirmSpy,
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(ghostCalls[0]?.approvalStatus).toBe("pending_consent");
    expect(deniedRes.denied).toBe(true);
    expect(mouseCalls).toHaveLength(0);
  });

  it("„kliknij tutaj” na pewnym przycisku AT-SPI2 pokazuje Ghost AR PRZED kliknięciem i weryfikuje zmianę UI po akcji", async () => {
    const order: string[] = [];
    let clicked = false;

    const okRes = await executeFoveatedCommand("kliknij tutaj", {
      actuator: {
        isDesktop: () => true,
        cursorPos: async () => ({ ok: true, x: 520, y: 340 }),
        nodeAtPoint: async () =>
          clicked
            ? { ok: true, found: true, backend: "at-spi2", windowTitle: "Oferta zapisana", node: { name: "Gotowe", role: "label", x: 500, y: 325, width: 80, height: 30, centerX: 540, centerY: 340 } }
            : { ok: true, found: true, backend: "at-spi2", windowTitle: "Edytor oferty", node: { name: "Zapisz szkic", role: "push button", x: 480, y: 322, width: 110, height: 36, centerX: 535, centerY: 340 } },
        foveatedCrop: async () => ({ ok: false, error: "unused" }),
        ghostShow: async (p) => {
          order.push(`ghost:${p.approvalStatus}:${p.source}`);
          return { ok: true };
        },
        ghostHide: async () => {},
        mouseAction: async () => {
          order.push("mouse:click");
          clicked = true;
          return { ok: true, message: "Kliknięto (520, 340)" };
        },
        sleep: async () => {},
      },
    });

    expect(okRes.ok).toBe(true);
    expect(okRes.verified).toBe(true);
    expect(okRes.source).toBe("at-spi2");
    // Podgląd Ghost AR MUSI wystąpić przed fizycznym kliknięciem myszą!
    expect(order[0]).toBe("ghost:confirmed:at-spi2");
    expect(order).toContain("mouse:click");
    expect(okRes.text).toContain("wykryto reakcję interfejsu");
  });
});

describe("SYMBIONT Phase 1 — Integracja z OMNI-PILOT, Kill-Switch i Ustawieniami", () => {
  beforeEach(() => {
    resetOmniPilotState();
    clearGuardianHistory();
    clearSettingsRollbackHistory();
    store.setSettings({ ghostArEnabled: true, requireConsentAlways: false, autonomyProfile: "OPERATOR" });
  });

  it("visualLocateAndAct przekazuje dokładną ramkę z Drzewa OS do Ghost AR i ukrywa ją natychmiast na abortOmniPilot()", async () => {
    const ghostShown: Array<Record<string, unknown>> = [];
    const ghostHidden: string[] = [];

    const act: Partial<OmniActuator> = {
      isDesktop: () => true,
      findUiNode: async () => ({
        ok: true,
        found: true,
        backend: "at-spi2",
        windowTitle: "Kalkulator marży",
        score: 0.97,
        node: {
          name: "Przelicz netto",
          role: "push button",
          x: 300,
          y: 200,
          width: 140,
          height: 40,
          centerX: 370,
          centerY: 220,
          isPassword: false,
        },
        message: "OK",
      }),
      ghostShow: async (p) => {
        ghostShown.push(p as unknown as Record<string, unknown>);
        return { ok: true };
      },
      ghostHide: async (reason) => {
        ghostHidden.push(reason || "");
      },
      mouseAction: async () => ({ ok: true, message: "Kliknięto (370, 220)" }),
      abortHardware: async () => {},
    };

    const res = await visualLocateAndAct("Przelicz netto", "click", { actuator: act });
    expect(res.ok).toBe(true);
    expect(ghostShown).toHaveLength(1);
    expect(ghostShown[0]).toMatchObject({
      x: 370,
      y: 220,
      width: 140,
      height: 40,
      boxX: 300,
      boxY: 200,
      source: "at-spi2",
      label: "Przelicz netto",
      plannedAction: "Kliknięcie",
    });

    // Globalny Kill-Switch (STOP / Ctrl+Alt+X) natychmiast chowa Ghost AR i zapisuje ślad w AuditLog + GuardianHistory
    abortOmniPilot(act);
    expect(ghostHidden).toContain("kill-switch");
    expect(getGuardianHistory().some((e) => e.kind === "security" && e.message.includes("omni_kill_switch"))).toBe(true);
    expect(store.data.audit.some((a) => a.tool === "omni_kill_switch")).toBe(true);
  });

  it("visualLocateAndAct przy niskiej pewności Vision (<0.65) wymaga potwierdzenia użytkownika", async () => {
    const confirmSpy = vi.fn(async () => false);
    const mouseSpy = vi.fn(async () => ({ ok: true, message: "Klik" }));

    const res = await visualLocateAndAct("Mała ikona ustawień", "click", {
      actuator: {
        isDesktop: () => true,
        findUiNode: async () => ({ ok: true, found: false, message: "brak w drzewie" }),
        captureScreenDetailed: async () => ({
          data: "U0hPVA==",
          mediaType: "image/png",
          screenWidth: 1920,
          screenHeight: 1080,
          imageWidth: 1920,
          imageHeight: 1080,
        }),
        ghostShow: async () => ({ ok: true }),
        ghostHide: async () => {},
        mouseAction: mouseSpy,
      },
      askVision: async () =>
        '{"found":true,"x":500,"y":500,"label":"Niepewny kształt","confidence":0.52,"risk":"none","reason":"niska ostrość"}',
      onConfirm: confirmSpy,
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(res.denied).toBe(true);
    expect(mouseSpy).not.toHaveBeenCalled();
  });

  it("wyłączenie ghostArEnabled całkowicie blokuje emisję Ghost AR i wspiera 1-klikowy rollback ustawień", async () => {
    const patchRes = validateAndApplyJarvisSettings({ ghostArEnabled: false }, "user toggle");
    expect(patchRes.ok).toBe(true);
    expect(store.settings.ghostArEnabled).toBe(false);

    const ghostSpy = vi.fn(async () => ({ ok: true }));
    await executeOmniVoiceCommand("wskaż na ekranie Zapisz", {
      actuator: {
        isDesktop: () => true,
        findUiNode: async () => ({
          ok: true,
          found: true,
          backend: "at-spi2",
          score: 0.95,
          node: { name: "Zapisz", role: "push button", x: 100, y: 100, width: 80, height: 32, centerX: 140, centerY: 116 },
          message: "OK",
        }),
        ghostShow: ghostSpy,
        ghostHide: async () => {},
      },
    });
    expect(ghostSpy).not.toHaveBeenCalled();

    const rb = rollbackJarvisSettings();
    expect(rb.ok).toBe(true);
    expect(store.settings.ghostArEnabled).toBe(true);
  });
});
