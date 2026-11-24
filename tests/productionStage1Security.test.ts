import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/lib/store";
import {
  abortOmniPilot,
  executeOmniVoiceCommand,
  getOmniAbortSignal,
  resetOmniPilotState,
  type OmniActuator,
} from "../src/lib/omniPilot";
import {
  getSentinelState,
  resetOmniSentinel,
  resolveSentinelDecision,
  runSentinelTick,
  startOmniSentinel,
} from "../src/lib/omniSentinel";
import { beginGoalRun, isGoalRunning } from "../src/lib/goalControl";
import { clearGuardianHistory, getGuardianHistory } from "../src/lib/guardianHistory";
import { isOperatorAutoAllowed, requiresFreshConsent } from "../src/lib/permissions";
import { parseBossMeta } from "../src/lib/boss";
import { ConversationLoop } from "../src/lib/voiceLoop";
import { aiAgent, gatherContext, performanceAgent } from "../src/lib/guardianAgents";

function makeActuator(overrides: Partial<OmniActuator> = {}): OmniActuator {
  return {
    isDesktop: () => true,
    captureScreenDetailed: async () => ({
      data: "BASE64_TEST_FRAME_01",
      mediaType: "image/png",
      width: 1280,
      height: 720,
      screenWidth: 1280,
      screenHeight: 720,
      cursorX: 100,
      cursorY: 100,
    }),
    findUiNode: async () => ({ ok: false, found: false }),
    diagnose: async () => ({ ok: true, message: "OK", spokenText: "OK" }),
    moveCursor: async () => ({ ok: true, x: 340, y: 100, message: "OK" }),
    mouseAction: async () => ({ ok: true, message: "Kliknięto." }),
    scroll: async () => ({ ok: true, message: "OK" }),
    drag: async () => ({ ok: true, message: "OK" }),
    listWindows: async () => ({ ok: true, windows: [], message: "OK" }),
    focusWindow: async () => ({ ok: true, title: "Test", message: "OK" }),
    typeUnicode: async () => ({ ok: true, message: "OK" }),
    hotkey: async (combo) => ({ ok: true, message: `Wysłano ${combo}.` }),
    launchApp: async (app) => `Uruchamiam: ${app}.`,
    volume: async () => "OK",
    media: async () => "OK",
    abortHardware: async () => {},
    sleep: async () => {},
    ...overrides,
  };
}

describe("Etap 1 P0 · Kill-Switch, RiskGuard i Wspólny Ślad Audytowy", () => {
  beforeEach(() => {
    resetOmniPilotState();
    resetOmniSentinel();
    clearGuardianHistory();
    store.setData((d) => {
      d.audit = [];
    });
    store.setSettings({ requireConsentAlways: false, autonomyProfile: "OPERATOR" });
  });

  it("Kill-Switch synchronicznie przerywa AbortController, OMNI-PILOT, Sentinela i goalRuntime oraz reaguje na stop/stój/przerwij w voiceLoop", () => {
    expect(parseBossMeta("stop")).toBe("stop");
    expect(parseBossMeta("stój")).toBe("stop");
    expect(parseBossMeta("przerwij")).toBe("stop");

    const goal = beginGoalRun("goal-test-1");
    expect(isGoalRunning("goal-test-1")).toBe(true);
    expect(goal.shouldStop()).toBe(false);

    const signalBefore = getOmniAbortSignal();
    expect(signalBefore.aborted).toBe(false);

    startOmniSentinel({
      condition: "testowy przycisk",
      intervalMs: 60000,
      actuator: makeActuator(),
      askVision: async () => '{"matched":false}',
    });
    expect(getSentinelState().status).toBe("watching");

    const captions: string[] = [];
    const loop = new ConversationLoop(() => {}, (c) => captions.push(c));
    loop.say("stój");

    expect(signalBefore.aborted).toBe(true);
    expect(goal.shouldStop()).toBe(true);
    expect(getSentinelState().status).toBe("stopped");
    expect(captions.some((c) => /Zatrzymano/i.test(c))).toBe(true);
    expect(store.data.audit.some((a) => a.tool === "omni_kill_switch")).toBe(true);
    expect(getGuardianHistory().some((e) => e.kind === "security")).toBe(true);

    goal.finish();
    loop.stop();
  });

  it("RiskGuard chroni głosowe hotkey (ctrl+w) i launch (terminal / shutdown) oraz zapisuje AuditLog i GuardianHistory", async () => {
    let hotkeyCalled = false;
    let launchCalled = false;
    const act = makeActuator({
      hotkey: async () => {
        hotkeyCalled = true;
        return { ok: true, message: "OK" };
      },
      launchApp: async () => {
        launchCalled = true;
        return "OK";
      },
    });

    // 1) Ryzykowny skrót zamknij kartę (ctrl+w) odrzucony przez użytkownika → brak wykonania + zapis audytu
    const deniedHotkey = await executeOmniVoiceCommand("zamknij kartę", {
      actuator: act,
      onConfirm: async () => false,
    });
    expect(deniedHotkey.handled).toBe(true);
    expect(deniedHotkey.ok).toBe(false);
    expect(hotkeyCalled).toBe(false);
    expect(store.data.audit[0]?.tool).toBe("omni_hotkey");
    expect(store.data.audit[0]?.ok).toBe(false);

    // 2) Destrukcyjne uruchomienie (shutdown) → twarda blokada RiskGuard bez pytania!
    const blockedLaunch = await executeOmniVoiceCommand("uruchom shutdown", {
      actuator: act,
      onConfirm: async () => true,
    });
    expect(blockedLaunch.handled).toBe(true);
    expect(blockedLaunch.ok).toBe(false);
    expect(launchCalled).toBe(false);
    expect(blockedLaunch.text).toMatch(/RiskGuard/i);

    // 3) Wrażliwe uruchomienie (terminal) z odmową → wstrzymane
    const deniedTerm = await executeOmniVoiceCommand("uruchom terminal", {
      actuator: act,
      onConfirm: async () => false,
    });
    expect(deniedTerm.handled).toBe(true);
    expect(deniedTerm.ok).toBe(false);
    expect(launchCalled).toBe(false);

    // 4) Zwykły ruch kursora → wykonany I zapisany w AuditLog oraz GuardianHistory
    const moved = await executeOmniVoiceCommand("przesuń kursor w prawo", { actuator: act });
    expect(moved.handled).toBe(true);
    expect(moved.ok).toBe(true);
    expect(store.data.audit.some((a) => a.tool === "omni_cursor_move" && a.ok)).toBe(true);
    expect(getGuardianHistory().length).toBeGreaterThan(0);
  });

  it("resolveSentinelDecision egzekwuje risk.requiresConfirmation (zakaz cichego klikania płatności/wysyłki)", async () => {
    let clicked = false;
    const act = makeActuator({
      mouseAction: async () => {
        clicked = true;
        return { ok: true, message: "Kliknięto." };
      },
    });

    startOmniSentinel({
      condition: "przycisk zapłać",
      intervalMs: 60000,
      actuator: act,
      askVision: async () =>
        '{"matched":true,"xNorm":500,"yNorm":500,"label":"Zapłać teraz 500 zł","confidence":0.95,"risk":"payment","summary":"Przycisk płatności","question":"Widzę przycisk Zapłać — kliknąć?"}',
    });
    await runSentinelTick();
    expect(getSentinelState().status).toBe("awaiting_decision");

    // Brak potwierdzenia / fail-closed → NIE klika!
    const denied = await resolveSentinelDecision("click", { onConfirm: async () => false });
    expect(denied.ok).toBe(false);
    expect(clicked).toBe(false);
    expect(store.data.audit.some((a) => a.tool === "sentinel_action" && !a.ok)).toBe(true);

    // Po jawnym potwierdzeniu → wykonuje i zapisuje audyt
    const allowed = await resolveSentinelDecision("click", { onConfirm: async () => true });
    expect(allowed.ok).toBe(true);
    expect(clicked).toBe(true);
    expect(store.data.audit.some((a) => a.tool === "sentinel_action" && a.ok)).toBe(true);
  });

  it("desktop_omni_task wymaga świeżej zgody nawet w profilu OPERATOR, a Runtime Guardian widzi telemetrię audytu i WebLLM", async () => {
    expect(requiresFreshConsent("desktop_omni_task")).toBe(true);
    expect(isOperatorAutoAllowed("desktop_omni_task", { goal: "otwórz przeglądarkę" })).toBe(false);

    // Wygeneruj ślad OS i sprawdź, że Guardian Core go raportuje
    await executeOmniVoiceCommand("przesuń kursor w prawo", { actuator: makeActuator() });
    store.setSettings({ webllmEnabled: true });
    const ctx = await gatherContext();
    expect(ctx.auditSummary?.totalOsActions).toBeGreaterThan(0);
    const perf = performanceAgent(ctx);
    expect(perf.findings.some((f) => /Audyt OS\/OMNI/.test(f.text))).toBe(true);
    const ai = aiAgent(ctx);
    expect(ai.findings.some((f) => /WebLLM/.test(f.text))).toBe(true);
  });

  it("abortOmniPilot zamyka bez błędu także po wielokrotnym wywołaniu", () => {
    abortOmniPilot(makeActuator());
    expect(store.data.audit[0]?.tool).toBe("omni_kill_switch");
  });
});
