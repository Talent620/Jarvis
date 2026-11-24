// === JARVIS OMNI-PILOT · Warstwa 4: Orkiestrator, Pętla Autonomiczna i Telemetria HUD ===
// Łączy natychmiastowy Refleks Głosowy (<30 ms), Wizyjne Namierzanie [0..1000] (AutoCore Vision),
// twardy Desktop RiskGuard, awaryjny Kill-Switch (Ctrl+Alt+X) i wielokrokową pętlę
// Obserwuj → Zaplanuj → Zweryfikuj Ryzyko → Wykonaj → Zweryfikuj.

import {
  abortDesktopPilot,
  captureScreenDetailed,
  diagnoseDesktopOnPc,
  dragOnPc,
  findUiNodeOnPc,
  focusWindowOnPc,
  isDesktop,
  launchApp,
  listWindowsOnPc,
  mediaPc,
  mouseActionOnPc,
  moveCursorOnPc,
  pilotHotkeyOnPc,
  queryUiTreeOnPc,
  scrollOnPc,
  typeUnicodeOnPc,
  volumePc,
} from "./desktop";
import { parseOmniVoiceCommand, type OmniIntent } from "./omniReflex";
import {
  computeFrameFingerprint,
  startOmniSentinel,
  stopOmniSentinel,
  tryHandleSentinelVoiceReply,
} from "./omniSentinel";
import {
  assessDesktopActionRisk,
  locateVisualTarget,
  planNextOmniStep,
  type GroundedTarget,
  type OmniPlanStep,
} from "./omniVision";
import { recordSystemActionEvent } from "./permissions";
import { stopAllGoals } from "./goalControl";
import { verifyResult, type VerifyStep } from "./resultVerifier";
import { draft as outcomeDraft, confirmed as outcomeConfirmed, failed as outcomeFailed } from "./actionOutcome";
import { store } from "./store";

export type OmniPhase =
  | "idle"
  | "reflex"
  | "observing"
  | "grounding"
  | "moving"
  | "acting"
  | "confirm"
  | "verifying"
  | "done"
  | "need_human"
  | "blocked"
  | "aborted"
  | "error";

export interface OmniReticle {
  xNorm: number;
  yNorm: number;
  x: number;
  y: number;
  label: string;
  confidence: number;
  action: string;
  source?: "os-tree" | "vision";
}

export interface OmniConfirmRequest {
  reason: string;
  target: string;
  action: string;
}

export interface OmniStepLog {
  ts: number;
  phase: OmniPhase;
  summary: string;
  ok: boolean;
}

export interface OmniHudState {
  visible: boolean;
  active: boolean;
  phase: OmniPhase;
  goal: string;
  step: number;
  maxSteps: number;
  screenshotDataUrl: string | null;
  reticle: OmniReticle | null;
  confirmRequest: OmniConfirmRequest | null;
  steps: OmniStepLog[];
  statusMessage: string;
  updatedAt: number;
}

export interface OmniActuator {
  isDesktop: () => boolean;
  captureScreenDetailed: typeof captureScreenDetailed;
  findUiNode: typeof findUiNodeOnPc;
  queryUiTree?: typeof queryUiTreeOnPc;
  diagnose: typeof diagnoseDesktopOnPc;
  moveCursor: typeof moveCursorOnPc;
  mouseAction: typeof mouseActionOnPc;
  scroll: typeof scrollOnPc;
  drag: typeof dragOnPc;
  listWindows: typeof listWindowsOnPc;
  focusWindow: typeof focusWindowOnPc;
  typeUnicode: typeof typeUnicodeOnPc;
  hotkey: typeof pilotHotkeyOnPc;
  launchApp: typeof launchApp;
  volume: typeof volumePc;
  media: typeof mediaPc;
  abortHardware: typeof abortDesktopPilot;
  sleep: (ms: number) => Promise<void>;
}

export interface OmniExecOptions {
  actuator?: Partial<OmniActuator>;
  askVision?: (system: string, prompt: string, img: { data: string; mediaType: string }) => Promise<string>;
  onConfirm?: (req: OmniConfirmRequest) => Promise<boolean>;
  maxSteps?: number;
}

export interface VisualActResult {
  ok: boolean;
  found: boolean;
  source?: "os-tree" | "vision";
  blocked?: boolean;
  denied?: boolean;
  aborted?: boolean;
  target?: GroundedTarget;
  text: string;
  spokenText: string;
}

export interface OmniTaskResult {
  ok: boolean;
  completed: boolean;
  verified?: boolean;
  verificationSummary?: string;
  needHuman?: boolean;
  blocked?: boolean;
  aborted?: boolean;
  stepsExecuted: number;
  history: string[];
  text: string;
  spokenText: string;
}

export interface OmniVoiceResult {
  handled: boolean;
  ok?: boolean;
  kind?: OmniIntent["kind"] | "sentinel_decision";
  text?: string;
  spokenText?: string;
}

const DEFAULT_ACTUATOR: OmniActuator = {
  isDesktop,
  captureScreenDetailed,
  findUiNode: findUiNodeOnPc,
  queryUiTree: queryUiTreeOnPc,
  diagnose: diagnoseDesktopOnPc,
  moveCursor: moveCursorOnPc,
  mouseAction: mouseActionOnPc,
  scroll: scrollOnPc,
  drag: dragOnPc,
  listWindows: listWindowsOnPc,
  focusWindow: focusWindowOnPc,
  typeUnicode: typeUnicodeOnPc,
  hotkey: pilotHotkeyOnPc,
  launchApp,
  volume: volumePc,
  media: mediaPc,
  abortHardware: abortDesktopPilot,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function makeInitialState(): OmniHudState {
  return {
    visible: false,
    active: false,
    phase: "idle",
    goal: "",
    step: 0,
    maxSteps: 0,
    screenshotDataUrl: null,
    reticle: null,
    confirmRequest: null,
    steps: [],
    statusMessage: "",
    updatedAt: Date.now(),
  };
}

let hudState: OmniHudState = makeInitialState();
const listeners = new Set<(state: OmniHudState) => void>();
let runToken = 0;
let activeAbortController: AbortController = new AbortController();
let pendingConfirmResolver: ((allow: boolean) => void) | null = null;

/** Aktywny sygnał przerwania (AbortController) dla trwających operacji OMNI-PILOT. */
export function getOmniAbortSignal(): AbortSignal {
  return activeAbortController.signal;
}

function emitState(patch: Partial<OmniHudState>): void {
  hudState = {
    ...hudState,
    ...patch,
    updatedAt: Date.now(),
  };
  for (const cb of listeners) {
    try { cb(hudState); } catch { /* ignore subscriber error */ }
  }
}

function pushStepLog(phase: OmniPhase, summary: string, ok: boolean): OmniStepLog[] {
  const next = [...hudState.steps, { ts: Date.now(), phase, summary, ok }];
  return next.slice(-12);
}

/** Odczytaj bieżący stan telemetrii OMNI-PILOT HUD. */
export function getOmniHudState(): OmniHudState {
  return hudState;
}

/** Subskrybuj zmiany stanu OMNI-PILOT (dla komponentu OmniPilotHud). */
export function subscribeOmniPilot(cb: (state: OmniHudState) => void): () => void {
  listeners.add(cb);
  cb(hudState);
  return () => {
    listeners.delete(cb);
  };
}

/** Ukryj panel HUD po zakończeniu (jeśli nie trwa aktywna operacja). */
export function dismissOmniHud(): void {
  if (hudState.active) {
    abortOmniPilot();
  }
  emitState({
    visible: false,
    active: false,
    phase: "idle",
    confirmRequest: null,
  });
}

/** Zresetuj stan modułu (wyłącznie do testów jednostkowych). */
export function resetOmniPilotState(): void {
  runToken += 1;
  try { activeAbortController.abort("reset"); } catch { /* ignore */ }
  activeAbortController = new AbortController();
  if (pendingConfirmResolver) {
    const fn = pendingConfirmResolver;
    pendingConfirmResolver = null;
    fn(false);
  }
  hudState = makeInitialState();
  for (const cb of listeners) {
    try { cb(hudState); } catch { /* ignore */ }
  }
}

/** Odpowiedz na żądanie potwierdzenia RiskGuard wyświetlane w HUD. */
export function respondOmniConfirm(allow: boolean): void {
  const resolver = pendingConfirmResolver;
  pendingConfirmResolver = null;
  emitState({ confirmRequest: null });
  if (resolver) resolver(!!allow);
}

/** Natychmiastowy globalny Kill-Switch (STOP / Ctrl+Alt+X / przycisk STOP w HUD): synchronicznie zatrzymuje OMNI-PILOT, Sentinela i goalRuntime. */
export function abortOmniPilot(actuator?: Partial<OmniActuator>): void {
  runToken += 1;
  try { activeAbortController.abort("kill-switch"); } catch { /* ignore */ }
  activeAbortController = new AbortController();
  if (pendingConfirmResolver) {
    const fn = pendingConfirmResolver;
    pendingConfirmResolver = null;
    fn(false);
  }
  stopOmniSentinel("Zatrzymano awaryjnie (STOP / Ctrl+Alt+X).");
  const stoppedGoals = stopAllGoals();
  const abortHw = actuator?.abortHardware || DEFAULT_ACTUATOR.abortHardware;
  try {
    void abortHw();
  } catch { /* ignore */ }
  recordSystemActionEvent({
    tool: "omni_kill_switch",
    risk: "outbound",
    input: { stoppedGoals },
    output: "Zatrzymano awaryjnie OMNI-PILOT / Strażnik Ekranu / Cele (STOP / Ctrl+Alt+X).",
    ok: true,
    security: true,
  });
  if (hudState.visible || hudState.active || stoppedGoals > 0) {
    emitState({
      visible: true,
      active: false,
      phase: "aborted",
      confirmRequest: null,
      statusMessage: "Zatrzymano awaryjnie (STOP / Ctrl+Alt+X).",
      steps: pushStepLog("aborted", "Przerwano sterowanie pulpitem", false),
    });
  }
}

function resolveActuator(opts?: OmniExecOptions): OmniActuator {
  return { ...DEFAULT_ACTUATOR, ...(opts?.actuator || {}) };
}

async function requestConfirmation(
  req: OmniConfirmRequest,
  token: number,
  customConfirm?: (req: OmniConfirmRequest) => Promise<boolean>,
): Promise<boolean> {
  if (token !== runToken) return false;
  emitState({
    phase: "confirm",
    confirmRequest: req,
    statusMessage: req.reason,
  });
  if (customConfirm) {
    const ok = await customConfirm(req).catch(() => false);
    if (token !== runToken) return false;
    emitState({ confirmRequest: null });
    return ok;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (val: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingConfirmResolver === finish) pendingConfirmResolver = null;
      resolve(val);
    };
    const timer = setTimeout(() => {
      emitState({ confirmRequest: null });
      finish(false);
    }, 45000);
    pendingConfirmResolver = finish;
  });
}

function pct(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

/**
 * Namierz element hybrydowo: najpierw lokalne Drzewo UI systemu (AT-SPI2 / Windows UIA, <80 ms, 0 USD),
 * a gdy element nie jest w drzewie dostępności — automatyczny fallback na Wizję AI [0..1000] przez AutoCore.
 */
export async function visualLocateAndAct(
  target: string,
  action: "move" | "click" | "double" | "right" | "locate",
  opts: OmniExecOptions = {},
): Promise<VisualActResult> {
  const act = resolveActuator(opts);
  if (!act.isDesktop()) {
    return {
      ok: false,
      found: false,
      text: "Wizyjna kontrola pulpitu wymaga aplikacji desktopowej JARVIS (Linux / Windows).",
      spokenText: "Sterowanie pulpitem wymaga wersji komputerowej Jarvisa.",
    };
  }

  const myToken = ++runToken;
  const actionLabel: Record<typeof action, string> = {
    locate: "Namierzam na ekranie",
    move: "Przesuwam kursor na",
    click: "Klikam",
    double: "Klikam dwukrotnie",
    right: "Klikam prawym",
  };
  const goalTitle = `${actionLabel[action]}: ${target}`;

  emitState({
    visible: true,
    active: true,
    phase: "observing",
    goal: goalTitle,
    step: 1,
    maxSteps: 1,
    screenshotDataUrl: null,
    reticle: null,
    confirmRequest: null,
    steps: [{ ts: Date.now(), phase: "observing", summary: "Hybrydowe namierzanie (Drzewo OS → Wizja AI)", ok: true }],
    statusMessage: `Szukam w drzewie UI systemu: „${target}”…`,
  });

  // FAZA 0 (Frontier 1): Błyskawiczne, lokalne Drzewo Dostępności OS (AT-SPI2 / Windows UIA, <80 ms, 0 USD)
  let located: GroundedTarget | null = null;
  let source: "os-tree" | "vision" = "vision";

  try {
    const uiHit = await act.findUiNode(target);
    if (myToken !== runToken) {
      return { ok: false, found: false, aborted: true, text: "⏹ Przerwano operację.", spokenText: "Przerwano." };
    }
    if (uiHit.ok && uiHit.found && uiHit.node) {
      const n = uiHit.node;
      const sw = typeof window !== "undefined" && window.screen?.width ? window.screen.width : 1920;
      const sh = typeof window !== "undefined" && window.screen?.height ? window.screen.height : 1080;
      located = {
        found: true,
        xNorm: Math.max(0, Math.min(1000, Math.round((n.centerX / Math.max(320, sw)) * 1000))),
        yNorm: Math.max(0, Math.min(1000, Math.round((n.centerY / Math.max(240, sh)) * 1000))),
        x: n.centerX,
        y: n.centerY,
        label: n.name || target,
        confidence: uiHit.score ?? 0.95,
        risk: n.isPassword ? "password" : "none",
        reason: `Drzewo OS (${uiHit.backend || "a11y"} · rola: ${n.role}${uiHit.windowTitle ? ` · okno: ${uiHit.windowTitle}` : ""})`,
      };
      source = "os-tree";
    }
  } catch {
    /* fallback do Wizji AI poniżej */
  }

  // FAZA 1 (Fallback): Zrzut ekranu + AutoCore Visual Grounding [0..1000]
  if (!located) {
    emitState({
      phase: "observing",
      statusMessage: "Przechwytuję obraz ekranu do analizy wizyjnej…",
    });

    const shot = await act.captureScreenDetailed();
    if (myToken !== runToken) {
      return { ok: false, found: false, aborted: true, text: "⏹ Przerwano operację.", spokenText: "Przerwano." };
    }
    if (!shot) {
      emitState({
        active: false,
        phase: "error",
        statusMessage: "Nie udało się przechwycić ekranu.",
        steps: pushStepLog("error", "Brak zrzutu ekranu", false),
      });
      return {
        ok: false,
        found: false,
        text: "Nie udało się zrobić zrzutu ekranu (sprawdź uprawnienia przechwytywania pulpitu).",
        spokenText: "Nie mogę zobaczyć ekranu — brak zrzutu.",
      };
    }

    const dataUrl = `data:${shot.mediaType};base64,${shot.data}`;
    emitState({
      phase: "grounding",
      screenshotDataUrl: dataUrl,
      statusMessage: `Szukam wizyjnie: „${target}” (${shot.screenWidth}×${shot.screenHeight})…`,
      steps: pushStepLog("grounding", `Analiza wizyjna: ${target}`, true),
    });

    try {
      located = await locateVisualTarget(target, shot, { askVision: opts.askVision });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitState({
        active: false,
        phase: "error",
        statusMessage: `Błąd modelu wizyjnego: ${msg}`,
        steps: pushStepLog("error", `Błąd Vision: ${msg.slice(0, 80)}`, false),
      });
      return {
        ok: false,
        found: false,
        text: `Nie udało się przeanalizować ekranu modelem wizyjnym (${msg}).`,
        spokenText: "Brak połączenia z modelem wizyjnym.",
      };
    }

    if (myToken !== runToken) {
      return { ok: false, found: false, aborted: true, text: "⏹ Przerwano operację.", spokenText: "Przerwano." };
    }
  }

  if (!located.found) {
    const why = located.reason || "Nie widać tego elementu na bieżącym ekranie.";
    emitState({
      active: false,
      phase: "need_human",
      statusMessage: `Nie znaleziono „${target}”: ${why}`,
      steps: pushStepLog("need_human", `Nie znaleziono: ${target}`, false),
    });
    return {
      ok: false,
      found: false,
      source,
      target: located,
      text: `Nie znalazłem na ekranie „${target}”. ${why}`,
      spokenText: `Nie widzę elementu ${target} na ekranie.`,
    };
  }

  const displayLabel = located.label || target;
  const sourceBadge = source === "os-tree" ? "⚡ Drzewo OS (0 USD)" : "👁 Wizja AI";
  emitState({
    reticle: {
      xNorm: located.xNorm,
      yNorm: located.yNorm,
      x: located.x,
      y: located.y,
      label: displayLabel,
      confidence: located.confidence,
      action,
      source,
    },
    statusMessage: `${sourceBadge}: „${displayLabel}” (${located.x}, ${located.y} · pewność ${pct(located.confidence)})`,
    steps: pushStepLog("grounding", `${sourceBadge}: ${displayLabel} (${located.x}, ${located.y})`, true),
  });

  // Twardy Desktop RiskGuard przed ruchem / kliknięciem
  const riskVerdict = assessDesktopActionRisk(`${target} ${displayLabel}`, action, located.risk);
  if (riskVerdict.blocked) {
    const reason = riskVerdict.reason || "Zablokowano przez Desktop RiskGuard.";
    recordSystemActionEvent({
      tool: "omni_visual_act",
      risk: "outbound",
      input: { target, action, source },
      output: reason,
      ok: false,
      security: true,
    });
    emitState({
      active: false,
      phase: "blocked",
      statusMessage: reason,
      steps: pushStepLog("blocked", reason, false),
    });
    return {
      ok: false,
      found: true,
      source,
      blocked: true,
      target: located,
      text: `🛡️ ${reason}`,
      spokenText: "Zablokowano ze względów bezpieczeństwa. Pole hasła lub kodu wpisz ręcznie.",
    };
  }

  if (riskVerdict.requiresConfirmation) {
    const approved = await requestConfirmation(
      { reason: riskVerdict.reason || `Potwierdź akcję: ${displayLabel}`, target: displayLabel, action },
      myToken,
      opts.onConfirm,
    );
    if (myToken !== runToken) {
      return { ok: false, found: true, aborted: true, target: located, text: "⏹ Przerwano.", spokenText: "Przerwano." };
    }
    if (!approved) {
      recordSystemActionEvent({
        tool: "omni_visual_act",
        risk: "outbound",
        input: { target: displayLabel, action, source },
        output: `Użytkownik odrzucił wrażliwą akcję RiskGuard: ${displayLabel}`,
        ok: false,
        security: true,
      });
      emitState({
        active: false,
        phase: "blocked",
        statusMessage: `Anulowano akcję: ${displayLabel}.`,
        steps: pushStepLog("blocked", `Użytkownik odrzucił: ${displayLabel}`, false),
      });
      return {
        ok: false,
        found: true,
        denied: true,
        target: located,
        text: `🛡️ Anulowano wrażliwą akcję na „${displayLabel}”.`,
        spokenText: "Anulowano.",
      };
    }
  }

  if (action === "locate") {
    recordSystemActionEvent({
      tool: "omni_visual_locate",
      risk: "read",
      input: { target: displayLabel, source },
      output: `Namierzono ${displayLabel} (${located.x}, ${located.y})`,
      ok: true,
    });
    emitState({
      active: false,
      phase: "done",
      statusMessage: `Wskazano „${displayLabel}” w punkcie (${located.x}, ${located.y}).`,
      steps: pushStepLog("done", `Zlokalizowano: ${displayLabel}`, true),
    });
    return {
      ok: true,
      found: true,
      source,
      target: located,
      text: `🎯 ${sourceBadge}: namierzono **${displayLabel}** w punkcie \`(${located.x}, ${located.y})\` (pewność ${pct(located.confidence)})${located.reason ? ` — ${located.reason}` : ""}.`,
      spokenText: `Widzę ${displayLabel}, oznaczyłem punkt na podglądzie.`,
    };
  }

  emitState({
    phase: action === "move" ? "moving" : "acting",
    statusMessage: `${actionLabel[action]} „${displayLabel}” (${located.x}, ${located.y})…`,
  });

  const execRes =
    action === "move"
      ? await act.moveCursor({ mode: "absolute", x: located.x, y: located.y, smooth: true })
      : await act.mouseAction({ action, x: located.x, y: located.y, smooth: true });

  if (myToken !== runToken) {
    return { ok: false, found: true, source, aborted: true, target: located, text: "⏹ Przerwano w trakcie ruchu.", spokenText: "Przerwano." };
  }

  if (!execRes.ok) {
    recordSystemActionEvent({
      tool: "omni_visual_act",
      risk: action === "move" ? "read" : "outbound",
      input: { target: displayLabel, action, x: located.x, y: located.y, source },
      output: execRes.message,
      ok: false,
    });
    emitState({
      active: false,
      phase: "error",
      statusMessage: execRes.message,
      steps: pushStepLog("error", execRes.message, false),
    });
    return {
      ok: false,
      found: true,
      source,
      target: located,
      text: execRes.message,
      spokenText: "Nie udało się wykonać ruchu na pulpicie.",
    };
  }

  const doneVerb: Record<Exclude<typeof action, "locate">, string> = {
    move: "Przesunięto kursor na",
    click: "Kliknięto",
    double: "Kliknięto dwukrotnie",
    right: "Kliknięto prawym na",
  };
  const summary = `${doneVerb[action]} „${displayLabel}” (${located.x}, ${located.y}).`;
  recordSystemActionEvent({
    tool: "omni_visual_act",
    risk: action === "move" ? "read" : "outbound",
    input: { target: displayLabel, action, x: located.x, y: located.y, source },
    output: summary,
    ok: true,
  });
  emitState({
    active: false,
    phase: "done",
    statusMessage: summary,
    steps: pushStepLog("done", summary, true),
  });

  return {
    ok: true,
    found: true,
    source,
    target: located,
    text: `🎯 ${summary} (${sourceBadge} · pewność ${pct(located.confidence)})`,
    spokenText: `${doneVerb[action]} ${displayLabel}.`,
  };
}

function stepSignature(step: OmniPlanStep): string {
  return [
    step.action,
    step.target || "",
    step.xNorm ?? "",
    step.yNorm ?? "",
    step.text || "",
    step.combo || "",
    step.direction || "",
    step.app || "",
    step.window || "",
  ].join("|");
}

/**
 * Wielokrokowa pętla Computer Use: Obserwuj → Zaplanuj → RiskGuard → Wykonaj → Zweryfikuj.
 * Posiada limit kroków, detekcję stagnacji (brak nieskończonych pętli) i natychmiastowy Ctrl+Alt+X kill-switch.
 */
export async function runOmniAutonomousTask(goal: string, opts: OmniExecOptions = {}): Promise<OmniTaskResult> {
  const act = resolveActuator(opts);
  if (!act.isDesktop()) {
    return {
      ok: false,
      completed: false,
      stepsExecuted: 0,
      history: [],
      text: "Autopilot pulpitu działa tylko w aplikacji desktopowej JARVIS (Linux / Windows).",
      spokenText: "Autopilot pulpitu działa tylko na komputerze.",
    };
  }

  const cleanGoal = String(goal || "").trim();
  if (!cleanGoal) {
    return {
      ok: false,
      completed: false,
      stepsExecuted: 0,
      history: [],
      text: "Podaj cel zadania do wykonania na komputerze.",
      spokenText: "Podaj cel zadania.",
    };
  }

  const maxSteps = Math.max(1, Math.min(12, opts.maxSteps ?? 6));
  const myToken = ++runToken;
  const history: string[] = [];
  const verifySteps: VerifyStep[] = [];
  let prevSig = "";
  let repeatCount = 0;
  let lastFrameFp = "";
  let unchangedFrameStreak = 0;

  emitState({
    visible: true,
    active: true,
    phase: "observing",
    goal: cleanGoal,
    step: 0,
    maxSteps,
    screenshotDataUrl: null,
    reticle: null,
    confirmRequest: null,
    steps: [{ ts: Date.now(), phase: "observing", summary: `Start autopilota: ${cleanGoal}`, ok: true }],
    statusMessage: `Uruchamiam autopilota: ${cleanGoal}`,
  });

  for (let step = 1; step <= maxSteps; step++) {
    if (myToken !== runToken) {
      return {
        ok: false,
        completed: false,
        aborted: true,
        stepsExecuted: history.length,
        history,
        text: "⏹ Autopilot został zatrzymany awaryjnie.",
        spokenText: "Zatrzymano autopilota.",
      };
    }

    // 1) OBSERWUJ (Hybryda: semantyczne Drzewo OS AT-SPI2/UIA + zrzut + okna równolegle)
    emitState({
      phase: "observing",
      step,
      maxSteps,
      statusMessage: `Krok ${step}/${maxSteps}: obserwuję Drzewo OS, ekran i okna…`,
    });

    const [shot, winRes, treeRes] = await Promise.all([
      act.captureScreenDetailed(),
      act.listWindows().catch(() => ({ ok: false, windows: [] as { id: string; title: string }[], message: "" })),
      act.queryUiTree
        ? act.queryUiTree(60).catch(() => ({ ok: false, nodes: [] as { name: string; role: string; centerX: number; centerY: number; isPassword?: boolean }[], message: "" }))
        : Promise.resolve({ ok: false, nodes: [] as { name: string; role: string; centerX: number; centerY: number; isPassword?: boolean }[], message: "" }),
    ]);

    if (myToken !== runToken) {
      return { ok: false, completed: false, aborted: true, stepsExecuted: history.length, history, text: "⏹ Przerwano.", spokenText: "Przerwano." };
    }
    if (!shot) {
      emitState({ active: false, phase: "error", statusMessage: "Brak możliwości zrzutu ekranu." });
      return {
        ok: false,
        completed: false,
        stepsExecuted: history.length,
        history,
        text: "Nie udało się przechwycić ekranu w trakcie autopilota.",
        spokenText: "Nie mogę przechwycić ekranu.",
      };
    }

    // Weryfikacja zmiany klatki ekranu po poprzedniej akcji (detekcja braku realnego efektu)
    const curFp = computeFrameFingerprint(shot.data);
    if (step > 1 && lastFrameFp && curFp === lastFrameFp) {
      unchangedFrameStreak += 1;
    } else {
      unchangedFrameStreak = 0;
    }
    lastFrameFp = curFp;

    const dataUrl = `data:${shot.mediaType};base64,${shot.data}`;
    const windowTitles = winRes.ok ? winRes.windows.map((w) => w.title) : [];
    const uiTreeSummary =
      treeRes.ok && Array.isArray(treeRes.nodes)
        ? treeRes.nodes
            .filter((n) => n.name && !n.isPassword)
            .slice(0, 25)
            .map((n) => `[${n.role}] ${n.name} (${n.centerX},${n.centerY})`)
        : [];
    emitState({
      phase: "grounding",
      screenshotDataUrl: dataUrl,
      statusMessage: `Krok ${step}/${maxSteps}: planuję następny ruch…`,
    });

    // 2) ZAPLANUJ
    let plan: OmniPlanStep;
    try {
      plan = await planNextOmniStep(
        cleanGoal,
        shot,
        { windows: windowTitles, history, step, maxSteps, uiTreeSummary },
        { askVision: opts.askVision },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitState({
        active: false,
        phase: "error",
        statusMessage: `Błąd planera: ${msg}`,
        steps: pushStepLog("error", `Błąd planera: ${msg.slice(0, 80)}`, false),
      });
      return {
        ok: false,
        completed: false,
        stepsExecuted: history.length,
        history,
        text: `Błąd modelu wizyjnego w kroku ${step}: ${msg}`,
        spokenText: "Wystąpił błąd połączenia z modelem wizyjnym.",
      };
    }

    if (myToken !== runToken) {
      return { ok: false, completed: false, aborted: true, stepsExecuted: history.length, history, text: "⏹ Przerwano.", spokenText: "Przerwano." };
    }

    // Zakończenie lub przekazanie człowiekowi (z uczciwą weryfikacją ActionOutcome przez verifyResult)
    if (plan.action === "done") {
      const doneMsg = plan.summary || "Zadanie wykonane na pulpicie.";
      const verdict = verifySteps.length
        ? verifyResult({
            goal: cleanGoal,
            steps: verifySteps,
            contradictions: unchangedFrameStreak >= 2 ? ["ekran nie zmienił się po ostatnich akcjach"] : [],
          })
        : { complete: true, safeFinalSummary: "Zadanie zakończone bez wymaganych kroków wykonawczych." };
      const allConfirmed = verdict.complete;
      const finalText = allConfirmed
        ? `✅ **OMNI-PILOT ukończył zadanie** (${history.length} kroków): ${doneMsg}`
        : `⚠️ **OMNI-PILOT zakończył z uwagą weryfikacji** (${history.length} kroków): ${doneMsg} — ${verdict.safeFinalSummary}`;
      emitState({
        active: false,
        phase: allConfirmed ? "done" : "need_human",
        reticle: null,
        statusMessage: allConfirmed ? doneMsg : verdict.safeFinalSummary,
        steps: pushStepLog(allConfirmed ? "done" : "need_human", allConfirmed ? doneMsg : verdict.safeFinalSummary, allConfirmed),
      });
      return {
        ok: allConfirmed,
        completed: allConfirmed,
        verified: allConfirmed,
        verificationSummary: verdict.safeFinalSummary,
        stepsExecuted: history.length,
        history,
        text: finalText,
        spokenText: allConfirmed ? doneMsg : `Zakończyłem kroki, ale sprawdź ekran: ${verdict.safeFinalSummary}`,
      };
    }

    if (plan.action === "need_human") {
      const humanMsg = plan.summary || "Wymagana interwencja użytkownika na ekranie.";
      emitState({
        active: false,
        phase: "need_human",
        statusMessage: humanMsg,
        steps: pushStepLog("need_human", humanMsg, false),
      });
      return {
        ok: false,
        completed: false,
        needHuman: true,
        stepsExecuted: history.length,
        history,
        text: `✋ **OMNI-PILOT przekazuje sterowanie Tobie:** ${humanMsg}`,
        spokenText: `Potrzebuję Twojej pomocy na ekranie: ${humanMsg}`,
      };
    }

    // 3) DETEKCJA STAGNACJI (ochrona przed pętlą bez efektu)
    const sig = stepSignature(plan);
    if (sig === prevSig) {
      repeatCount += 1;
      const limit = plan.action === "scroll" || plan.action === "wait" ? 2 : 1;
      if (repeatCount >= limit) {
        const stagMsg = `Zatrzymano po powtórzeniu tego samego kroku bez postępu (${plan.summary}).`;
        emitState({
          active: false,
          phase: "need_human",
          statusMessage: stagMsg,
          steps: pushStepLog("need_human", stagMsg, false),
        });
        return {
          ok: false,
          completed: false,
          needHuman: true,
          stepsExecuted: history.length,
          history,
          text: `⚠️ ${stagMsg}`,
          spokenText: "Zatrzymuję autopilota — ten sam krok nie zmienił ekranu.",
        };
      }
    } else {
      prevSig = sig;
      repeatCount = 0;
    }

    // 4) TWARDY DESKTOP RISKGUARD
    const riskSubject = `${plan.target || ""} ${plan.text || ""} ${plan.summary || ""}`.trim();
    const riskVerdict = assessDesktopActionRisk(riskSubject, plan.action, plan.risk || "none");
    if (riskVerdict.blocked) {
      const reason = riskVerdict.reason || "Zablokowano przez Desktop RiskGuard.";
      verifySteps.push({ id: `s${step}`, successCriteria: plan.summary, outcome: outcomeDraft(reason) });
      emitState({
        active: false,
        phase: "blocked",
        statusMessage: reason,
        steps: pushStepLog("blocked", reason, false),
      });
      return {
        ok: false,
        completed: false,
        blocked: true,
        stepsExecuted: history.length,
        history,
        text: `🛡️ ${reason}`,
        spokenText: "Zatrzymano ze względów bezpieczeństwa — pole hasła lub 2FA wpisz ręcznie.",
      };
    }

    if (riskVerdict.requiresConfirmation) {
      const approved = await requestConfirmation(
        {
          reason: riskVerdict.reason || `Potwierdź krok ${step}: ${plan.summary}`,
          target: plan.target || plan.summary,
          action: plan.action,
        },
        myToken,
        opts.onConfirm,
      );
      if (myToken !== runToken) {
        return { ok: false, completed: false, aborted: true, stepsExecuted: history.length, history, text: "⏹ Przerwano.", spokenText: "Przerwano." };
      }
      if (!approved) {
        const denyMsg = `Anulowano wrażliwy krok: ${plan.summary}`;
        verifySteps.push({ id: `s${step}`, successCriteria: plan.summary, outcome: outcomeDraft(denyMsg) });
        emitState({
          active: false,
          phase: "blocked",
          statusMessage: denyMsg,
          steps: pushStepLog("blocked", denyMsg, false),
        });
        return {
          ok: false,
          completed: false,
          blocked: true,
          stepsExecuted: history.length,
          history,
          text: `🛡️ ${denyMsg}`,
          spokenText: "Anulowano wrażliwy krok.",
        };
      }
    }

    // 5) WYKONAJ KROK
    emitState({
      phase: "acting",
      statusMessage: `Krok ${step}/${maxSteps}: ${plan.summary}`,
    });

    let stepOk = false;
    let stepOutcome = "";

    if (
      plan.action === "visual_click" ||
      plan.action === "visual_double" ||
      plan.action === "visual_right" ||
      plan.action === "move_cursor"
    ) {
      let px: number | null = null;
      let py: number | null = null;
      let xNorm = plan.xNorm;
      let yNorm = plan.yNorm;
      let label = plan.target || plan.summary;
      let confidence = 0.85;
      let source: "os-tree" | "vision" = "vision";

      // 5a) HYBRYDA: Jeśli planer podał nazwę targetu, sprawdź NAJPIERW Semantyczne Drzewo OS (0 USD, dokładne px + wykrywanie isPassword)
      if (plan.target) {
        try {
          const treeHit = await act.findUiNode(plan.target);
          if (treeHit?.ok && treeHit.found && treeHit.node && (treeHit.score ?? 1) >= 0.78) {
            if (treeHit.node.isPassword) {
              const reason = "RiskGuard (Drzewo OS): wykryto pole hasła — zablokowano kliknięcie.";
              emitState({ active: false, phase: "blocked", statusMessage: reason });
              return {
                ok: false,
                completed: false,
                blocked: true,
                stepsExecuted: history.length,
                history,
                text: `🛡️ ${reason}`,
                spokenText: "Zablokowano kliknięcie pola hasła.",
              };
            }
            px = treeHit.node.centerX;
            py = treeHit.node.centerY;
            xNorm = Math.round((px / Math.max(320, shot.screenWidth)) * 1000);
            yNorm = Math.round((py / Math.max(240, shot.screenHeight)) * 1000);
            label = treeHit.node.name || label;
            confidence = treeHit.score ?? 0.94;
            source = "os-tree";
          }
        } catch {
          /* fallback na współrzędne z planera / Vision AI poniżej */
        }
      }

      if (px === null || py === null) {
        if (xNorm !== undefined && yNorm !== undefined) {
          px = Math.max(0, Math.min(shot.screenWidth - 1, Math.round((xNorm / 1000) * shot.screenWidth)));
          py = Math.max(0, Math.min(shot.screenHeight - 1, Math.round((yNorm / 1000) * shot.screenHeight)));
        } else if (plan.target) {
          const located = await locateVisualTarget(plan.target, shot, { askVision: opts.askVision });
          if (located.found) {
            const extraRisk = assessDesktopActionRisk(`${plan.target} ${located.label}`, plan.action, located.risk);
            if (extraRisk.blocked) {
              emitState({ active: false, phase: "blocked", statusMessage: extraRisk.reason || "RiskGuard block." });
              return {
                ok: false,
                completed: false,
                blocked: true,
                stepsExecuted: history.length,
                history,
                text: `🛡️ ${extraRisk.reason || "Zablokowano przez RiskGuard."}`,
                spokenText: "Zablokowano ze względów bezpieczeństwa.",
              };
            }
            px = located.x;
            py = located.y;
            xNorm = located.xNorm;
            yNorm = located.yNorm;
            label = located.label || label;
            confidence = located.confidence;
          }
        }
      }

      if (px === null || py === null) {
        stepOk = false;
        stepOutcome = `Nie udało się wyznaczyć współrzędnych dla „${label}”.`;
      } else {
        emitState({
          phase: "moving",
          reticle: {
            xNorm: xNorm ?? Math.round((px / shot.screenWidth) * 1000),
            yNorm: yNorm ?? Math.round((py / shot.screenHeight) * 1000),
            x: px,
            y: py,
            label,
            confidence,
            action: plan.action,
            source,
          },
        });
        if (plan.action === "move_cursor") {
          const r = await act.moveCursor({ mode: "absolute", x: px, y: py, smooth: true });
          stepOk = r.ok;
          stepOutcome = r.message;
        } else {
          const mouseKind =
            plan.action === "visual_double" ? "double" : plan.action === "visual_right" ? "right" : "click";
          const r = await act.mouseAction({ action: mouseKind, x: px, y: py, smooth: true });
          stepOk = r.ok;
          stepOutcome = r.message;
        }
      }
    } else if (plan.action === "type") {
      const r = await act.typeUnicode(plan.text || "");
      stepOk = r.ok;
      stepOutcome = r.message;
    } else if (plan.action === "hotkey") {
      const r = await act.hotkey(plan.combo || "");
      stepOk = r.ok;
      stepOutcome = r.message;
    } else if (plan.action === "scroll") {
      const r = await act.scroll(plan.direction || "down", plan.amount || 5);
      stepOk = r.ok;
      stepOutcome = r.message;
    } else if (plan.action === "focus_window") {
      const r = await act.focusWindow(plan.window || plan.target || "");
      stepOk = r.ok;
      stepOutcome = r.message;
    } else if (plan.action === "launch_app") {
      const msg = await act.launchApp(plan.app || plan.target || "");
      stepOk = !msg.startsWith("Nie udało") && !msg.startsWith("Ta akcja");
      stepOutcome = msg;
    } else if (plan.action === "wait") {
      await act.sleep(500);
      stepOk = true;
      stepOutcome = "Krótka pauza na reakcję interfejsu.";
    }

    const logLine = `${plan.summary} → ${stepOk ? "OK" : `BŁĄD (${stepOutcome})`}`;
    history.push(logLine);
    verifySteps.push({
      id: `s${step}`,
      successCriteria: plan.summary,
      outcome: stepOk ? outcomeConfirmed({ source: plan.action, message: stepOutcome }) : outcomeFailed(stepOutcome, plan.action),
      claimedSuccess: false,
    });
    recordSystemActionEvent({
      tool: `omni_step_${plan.action}`,
      risk: plan.action === "wait" ? "read" : "outbound",
      input: { goal, step, action: plan.action, target: plan.target || plan.app || plan.combo || plan.window },
      output: logLine,
      ok: stepOk,
    });
    emitState({
      phase: "verifying",
      steps: pushStepLog(stepOk ? "verifying" : "error", logLine, stepOk),
      statusMessage: `Krok ${step}/${maxSteps}: ${logLine}`,
    });

    if (step < maxSteps) {
      await act.sleep(320);
    }
  }

  const limitVerdict = verifySteps.length
    ? verifyResult({ goal: cleanGoal, steps: verifySteps })
    : { complete: false, safeFinalSummary: "Osiągnięto limit kroków." };
  const limitMsg = `Osiągnięto limit ${maxSteps} kroków — ${limitVerdict.safeFinalSummary}`;
  emitState({
    active: false,
    phase: "need_human",
    statusMessage: limitMsg,
    steps: pushStepLog("need_human", limitMsg, false),
  });
  return {
    ok: false,
    completed: false,
    needHuman: true,
    stepsExecuted: history.length,
    history,
    text: `🧭 **OMNI-PILOT:** ${limitMsg}\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`,
    spokenText: `Wykonałem ${maxSteps} kroków. Sprawdź ekran i daj znać, czy kontynuować.`,
  };
}

/**
 * Główny punkt wejścia głosowo-tekstowy:
 * rozpoznaje polską komendę pulpitu (<30 ms refleks / wizyjne namierzanie / autopilot).
 * Zwraca `{ handled: false }`, jeśli wiadomość nie dotyczy sterowania pulpitem lub nie jesteśmy na desktopie.
 */
export async function executeOmniVoiceCommand(
  transcript: string,
  opts: OmniExecOptions = {},
): Promise<OmniVoiceResult> {
  const act = resolveActuator(opts);

  // Dual-Track: gdy Strażnik Ekranu czeka na Twoją decyzję („kliknij to / szukaj dalej / stop”),
  // przechwyć TYLKO wyraźną decyzję — zwykła rozmowa jak z kumplem leci dalej bez przeszkód!
  if (act.isDesktop()) {
    const sentinelDecision = await tryHandleSentinelVoiceReply(transcript);
    if (sentinelDecision.handled) {
      return {
        handled: true,
        ok: sentinelDecision.ok,
        kind: "sentinel_decision",
        text: sentinelDecision.text,
        spokenText: sentinelDecision.spokenText,
      };
    }
  }

  const intent = parseOmniVoiceCommand(transcript);
  if (!intent) return { handled: false };

  if (intent.kind === "abort") {
    if (!hudState.active && !act.isDesktop()) return { handled: false };
    abortOmniPilot(act);
    return {
      handled: true,
      ok: true,
      kind: "abort",
      text: "⏹ Zatrzymano sterowanie pulpitem (OMNI-PILOT).",
      spokenText: "Zatrzymuję.",
    };
  }

  if (!act.isDesktop()) return { handled: false };

  // Natychmiastowy Refleks (<30 ms, offline, 0 USD) + obowiązkowy wspólny zapis AuditLog i Guardian
  const recordReflex = (
    goal: string,
    ok: boolean,
    message: string,
    meta?: { tool?: string; risk?: "read" | "write" | "outbound"; input?: unknown; security?: boolean },
  ) => {
    emitState({
      visible: true,
      active: false,
      phase: ok ? "done" : meta?.security ? "blocked" : "error",
      goal,
      step: 1,
      maxSteps: 1,
      reticle: null,
      confirmRequest: null,
      statusMessage: message,
      steps: pushStepLog(ok ? "reflex" : meta?.security ? "blocked" : "error", message, ok),
    });
    recordSystemActionEvent({
      tool: meta?.tool || `omni_${intent.kind}`,
      risk: meta?.risk || "outbound",
      input: meta?.input ?? { transcript },
      output: message,
      ok,
      security: meta?.security,
    });
  };

  switch (intent.kind) {
    case "cursor_relative": {
      const r = await act.moveCursor({ mode: "relative", dx: intent.dx, dy: intent.dy, smooth: true });
      const text = r.ok ? `⚡ Przesunięto kursor ${intent.label} → (${r.x ?? 0}, ${r.y ?? 0}).` : r.message;
      recordReflex(`Kursor ${intent.label}`, r.ok, text, { tool: "omni_cursor_move", input: { dx: intent.dx, dy: intent.dy } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Przesunięto kursor ${intent.label.split("(")[0].trim()}.` : r.message };
    }
    case "cursor_named": {
      const r = await act.moveCursor({ mode: "named", preset: intent.preset, smooth: true });
      const text = r.ok ? `⚡ Kursor ustawiony na: ${intent.label} (${r.x ?? 0}, ${r.y ?? 0}).` : r.message;
      recordReflex(`Kursor: ${intent.label}`, r.ok, text, { tool: "omni_cursor_move", input: { preset: intent.preset } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Kursor na ${intent.label}.` : r.message };
    }
    case "mouse": {
      const r = await act.mouseAction({ action: intent.action });
      const text = r.ok ? `⚡ Wykonano: ${intent.label}.` : r.message;
      recordReflex(intent.label, r.ok, text, { tool: "omni_mouse_action", input: { action: intent.action } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `${intent.label}.` : r.message };
    }
    case "scroll": {
      const r = await act.scroll(intent.direction, intent.amount);
      const text = r.ok ? `⚡ Przewinięto ${intent.label}.` : r.message;
      recordReflex(`Przewijanie ${intent.label}`, r.ok, text, { tool: "omni_scroll", input: { direction: intent.direction, amount: intent.amount } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Przewinięto ${intent.label}.` : r.message };
    }
    case "windows_list": {
      const r = await act.listWindows();
      recordReflex("Lista okien", r.ok, r.message, { tool: "omni_windows_list", risk: "read" });
      return { handled: true, ok: r.ok, kind: intent.kind, text: `🪟 ${r.message}`, spokenText: r.message };
    }
    case "window_focus": {
      const r = await act.focusWindow(intent.query);
      recordReflex(`Okno: ${intent.query}`, r.ok, r.message, { tool: "omni_window_focus", input: { query: intent.query } });
      return { handled: true, ok: r.ok, kind: intent.kind, text: `🪟 ${r.message}`, spokenText: r.message };
    }
    case "launch": {
      const risk = assessDesktopActionRisk(intent.app, "launch");
      if (risk.blocked) {
        const msg = `🛡️ ${risk.reason || "RiskGuard zablokował uruchomienie tej aplikacji."}`;
        recordReflex("RiskGuard blokada", false, msg, { tool: "omni_launch", input: { app: intent.app }, security: true });
        return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Zablokowano ze względów bezpieczeństwa." };
      }
      if (risk.requiresConfirmation || store.settings.requireConsentAlways === true) {
        const myToken = ++runToken;
        emitState({ visible: true, active: true, goal: `Uruchom: ${intent.app}`, step: 1, maxSteps: 1 });
        const reason = risk.reason || `Potwierdź uruchomienie aplikacji: „${intent.app}”`;
        const approved = await requestConfirmation({ reason, target: intent.app, action: "launch" }, myToken, opts.onConfirm);
        if (!approved) {
          const msg = `🛡️ RiskGuard: wstrzymano uruchomienie „${intent.app}” (brak potwierdzenia).`;
          recordReflex(`RiskGuard: ${intent.app}`, false, msg, { tool: "omni_launch", input: { app: intent.app }, security: true });
          return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Wstrzymano uruchomienie aplikacji." };
        }
      }
      const msg = await act.launchApp(intent.app);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Ta akcja");
      recordReflex(`Uruchom: ${intent.app}`, ok, msg, { tool: "omni_launch", input: { app: intent.app } });
      return { handled: true, ok, kind: intent.kind, text: `🚀 ${msg}`, spokenText: msg };
    }
    case "volume": {
      const msg = await act.volume(intent.action);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Brak") && !msg.startsWith("Sterowanie");
      recordReflex(`Głośność: ${intent.action}`, ok, msg, { tool: "omni_volume", input: { action: intent.action } });
      return { handled: true, ok, kind: intent.kind, text: `🔊 ${msg}`, spokenText: msg };
    }
    case "media": {
      const msg = await act.media(intent.action);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Brak") && !msg.startsWith("Sterowanie");
      recordReflex(`Media: ${intent.action}`, ok, msg, { tool: "omni_media", input: { action: intent.action } });
      return { handled: true, ok, kind: intent.kind, text: `🎵 ${msg}`, spokenText: msg };
    }
    case "hotkey": {
      const risk = assessDesktopActionRisk(intent.combo, "hotkey");
      if (risk.blocked) {
        const msg = `🛡️ ${risk.reason || "RiskGuard zablokował ten skrót klawiszowy."}`;
        recordReflex("RiskGuard blokada", false, msg, { tool: "omni_hotkey", input: { combo: intent.combo }, security: true });
        return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Zablokowano ryzykowny skrót ze względów bezpieczeństwa." };
      }
      if (risk.requiresConfirmation || store.settings.requireConsentAlways === true) {
        const myToken = ++runToken;
        emitState({ visible: true, active: true, goal: `Skrót: ${intent.combo}`, step: 1, maxSteps: 1 });
        const reason = risk.reason || `Potwierdź wysłanie skrótu: „${intent.combo}”`;
        const approved = await requestConfirmation({ reason, target: intent.combo, action: "hotkey" }, myToken, opts.onConfirm);
        if (!approved) {
          const msg = `🛡️ RiskGuard: wstrzymano skrót „${intent.combo}” (brak potwierdzenia).`;
          recordReflex(`RiskGuard: ${intent.combo}`, false, msg, { tool: "omni_hotkey", input: { combo: intent.combo }, security: true });
          return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Wstrzymano wysłanie skrótu." };
        }
      }
      const r = await act.hotkey(intent.combo);
      const text = r.ok ? `⌨️ ${intent.label}.` : r.message;
      recordReflex(intent.label, r.ok, text, { tool: "omni_hotkey", input: { combo: intent.combo } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? intent.label : r.message };
    }
    case "type_text": {
      const risk = assessDesktopActionRisk(intent.text, "type");
      if (risk.blocked) {
        const msg = `🛡️ ${risk.reason || "RiskGuard zablokował wpisywanie wrażliwego tekstu."}`;
        recordReflex("RiskGuard blokada", false, msg, { tool: "omni_type", input: { chars: intent.text.length }, security: true });
        return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Zablokowano ze względów bezpieczeństwa." };
      }
      const r = await act.typeUnicode(intent.text);
      const text = r.ok ? `⌨️ Wpisano na ekranie (${intent.text.length} znaków).` : r.message;
      recordReflex("Dyktowanie UTF-8", r.ok, text, { tool: "omni_type", input: { chars: intent.text.length } });
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? "Wpisano." : r.message };
    }
    case "visual": {
      const res = await visualLocateAndAct(intent.target, intent.action, opts);
      return { handled: true, ok: res.ok, kind: intent.kind, text: res.text, spokenText: res.spokenText };
    }
    case "omni_goal": {
      const res = await runOmniAutonomousTask(intent.goal, opts);
      return { handled: true, ok: res.ok, kind: intent.kind, text: res.text, spokenText: res.spokenText };
    }
    case "sentinel_start": {
      const res = startOmniSentinel({
        condition: intent.condition,
        actuator: act,
        askVision: opts.askVision,
        onConfirm: opts.onConfirm,
      });
      if (res.ok && !hudState.active) {
        emitState({
          visible: false,
          phase: "idle",
          goal: "",
          statusMessage: "",
          reticle: null,
          screenshotDataUrl: null,
          confirmRequest: null,
        });
      }
      recordSystemActionEvent({
        tool: "sentinel_start",
        risk: "outbound",
        input: { condition: intent.condition },
        output: res.text,
        ok: res.ok,
      });
      return { handled: true, ok: res.ok, kind: intent.kind, text: res.text, spokenText: res.spokenText };
    }
    case "sentinel_stop": {
      stopOmniSentinel("Zatrzymano Strażnika Ekranu komendą głosową.");
      recordSystemActionEvent({
        tool: "sentinel_stop",
        risk: "read",
        input: { source: "voice" },
        output: "Zatrzymano Strażnika Ekranu komendą głosową.",
        ok: true,
      });
      return {
        handled: true,
        ok: true,
        kind: intent.kind,
        text: "⏹ Zatrzymano Strażnika Ekranu.",
        spokenText: "Wyłączam Strażnika Ekranu.",
      };
    }
    case "diagnose": {
      const res = await act.diagnose();
      recordReflex("Diagnostyka systemu", res.ok, res.spokenText, { tool: "omni_diagnose", risk: "read" });
      return { handled: true, ok: res.ok, kind: intent.kind, text: res.message, spokenText: res.spokenText };
    }
  }
}
