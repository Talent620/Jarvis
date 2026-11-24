// === JARVIS OMNI-PILOT · Warstwa 4: Orkiestrator, Pętla Autonomiczna i Telemetria HUD ===
// Łączy natychmiastowy Refleks Głosowy (<30 ms), Wizyjne Namierzanie [0..1000] (AutoCore Vision),
// twardy Desktop RiskGuard, awaryjny Kill-Switch (Ctrl+Alt+X) i wielokrokową pętlę
// Obserwuj → Zaplanuj → Zweryfikuj Ryzyko → Wykonaj → Zweryfikuj.

import {
  abortDesktopPilot,
  captureScreenDetailed,
  dragOnPc,
  focusWindowOnPc,
  isDesktop,
  launchApp,
  listWindowsOnPc,
  mediaPc,
  mouseActionOnPc,
  moveCursorOnPc,
  pilotHotkeyOnPc,
  scrollOnPc,
  typeUnicodeOnPc,
  volumePc,
} from "./desktop";
import { parseOmniVoiceCommand, type OmniIntent } from "./omniReflex";
import {
  assessDesktopActionRisk,
  locateVisualTarget,
  planNextOmniStep,
  type GroundedTarget,
  type OmniPlanStep,
} from "./omniVision";

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
  kind?: OmniIntent["kind"];
  text?: string;
  spokenText?: string;
}

const DEFAULT_ACTUATOR: OmniActuator = {
  isDesktop,
  captureScreenDetailed,
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
let pendingConfirmResolver: ((allow: boolean) => void) | null = null;

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

/** Natychmiastowy globalny Kill-Switch (Ctrl+Alt+X lub przycisk STOP w HUD). */
export function abortOmniPilot(actuator?: Partial<OmniActuator>): void {
  runToken += 1;
  if (pendingConfirmResolver) {
    const fn = pendingConfirmResolver;
    pendingConfirmResolver = null;
    fn(false);
  }
  const abortHw = actuator?.abortHardware || DEFAULT_ACTUATOR.abortHardware;
  try {
    void abortHw();
  } catch { /* ignore */ }
  if (hudState.visible || hudState.active) {
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
 * Namierz element wizyjnie na ekranie (0..1000) i opcjonalnie najedź lub kliknij po weryfikacji RiskGuard.
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
    steps: [{ ts: Date.now(), phase: "observing", summary: "Przechwytywanie zrzutu ekranu", ok: true }],
    statusMessage: "Przechwytuję obraz ekranu…",
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

  let located: GroundedTarget;
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
      target: located,
      text: `Nie znalazłem na ekranie „${target}”. ${why}`,
      spokenText: `Nie widzę elementu ${target} na ekranie.`,
    };
  }

  const displayLabel = located.label || target;
  emitState({
    reticle: {
      xNorm: located.xNorm,
      yNorm: located.yNorm,
      x: located.x,
      y: located.y,
      label: displayLabel,
      confidence: located.confidence,
      action,
    },
    statusMessage: `Namierzono „${displayLabel}” (${located.x}, ${located.y} · pewność ${pct(located.confidence)})`,
    steps: pushStepLog("grounding", `Cel: ${displayLabel} (${located.x}, ${located.y})`, true),
  });

  // Twardy Desktop RiskGuard przed ruchem / kliknięciem
  const riskVerdict = assessDesktopActionRisk(`${target} ${displayLabel}`, action, located.risk);
  if (riskVerdict.blocked) {
    const reason = riskVerdict.reason || "Zablokowano przez Desktop RiskGuard.";
    emitState({
      active: false,
      phase: "blocked",
      statusMessage: reason,
      steps: pushStepLog("blocked", reason, false),
    });
    return {
      ok: false,
      found: true,
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
    emitState({
      active: false,
      phase: "done",
      statusMessage: `Wskazano „${displayLabel}” w punkcie (${located.x}, ${located.y}).`,
      steps: pushStepLog("done", `Zlokalizowano: ${displayLabel}`, true),
    });
    return {
      ok: true,
      found: true,
      target: located,
      text: `🎯 Namierzono **${displayLabel}** w punkcie \`(${located.x}, ${located.y})\` (pewność ${pct(located.confidence)})${located.reason ? ` — ${located.reason}` : ""}.`,
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
    return { ok: false, found: true, aborted: true, target: located, text: "⏹ Przerwano w trakcie ruchu.", spokenText: "Przerwano." };
  }

  if (!execRes.ok) {
    emitState({
      active: false,
      phase: "error",
      statusMessage: execRes.message,
      steps: pushStepLog("error", execRes.message, false),
    });
    return {
      ok: false,
      found: true,
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
  emitState({
    active: false,
    phase: "done",
    statusMessage: summary,
    steps: pushStepLog("done", summary, true),
  });

  return {
    ok: true,
    found: true,
    target: located,
    text: `🎯 ${summary} (pewność wizji: ${pct(located.confidence)})`,
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
  let prevSig = "";
  let repeatCount = 0;

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

    // 1) OBSERWUJ
    emitState({
      phase: "observing",
      step,
      maxSteps,
      statusMessage: `Krok ${step}/${maxSteps}: obserwuję ekran i okna…`,
    });

    const [shot, winRes] = await Promise.all([
      act.captureScreenDetailed(),
      act.listWindows().catch(() => ({ ok: false, windows: [] as { id: string; title: string }[], message: "" })),
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

    const dataUrl = `data:${shot.mediaType};base64,${shot.data}`;
    const windowTitles = winRes.ok ? winRes.windows.map((w) => w.title) : [];
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
        { windows: windowTitles, history, step, maxSteps },
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

    // Zakończenie lub przekazanie człowiekowi
    if (plan.action === "done") {
      const doneMsg = plan.summary || "Zadanie wykonane na pulpicie.";
      emitState({
        active: false,
        phase: "done",
        reticle: null,
        statusMessage: doneMsg,
        steps: pushStepLog("done", doneMsg, true),
      });
      return {
        ok: true,
        completed: true,
        stepsExecuted: history.length,
        history,
        text: `✅ **OMNI-PILOT ukończył zadanie** (${history.length} kroków): ${doneMsg}`,
        spokenText: doneMsg,
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
    emitState({
      phase: "verifying",
      steps: pushStepLog(stepOk ? "verifying" : "error", logLine, stepOk),
      statusMessage: `Krok ${step}/${maxSteps}: ${logLine}`,
    });

    if (step < maxSteps) {
      await act.sleep(320);
    }
  }

  const limitMsg = `Osiągnięto limit ${maxSteps} kroków — sprawdź stan na ekranie i powiedz, jeśli mam kontynuować.`;
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
  const intent = parseOmniVoiceCommand(transcript);
  if (!intent) return { handled: false };

  const act = resolveActuator(opts);

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

  // Natychmiastowy Refleks (<30 ms, offline, 0 USD)
  const recordReflex = (goal: string, ok: boolean, message: string) => {
    emitState({
      visible: true,
      active: false,
      phase: ok ? "done" : "error",
      goal,
      step: 1,
      maxSteps: 1,
      reticle: null,
      confirmRequest: null,
      statusMessage: message,
      steps: pushStepLog(ok ? "reflex" : "error", message, ok),
    });
  };

  switch (intent.kind) {
    case "cursor_relative": {
      const r = await act.moveCursor({ mode: "relative", dx: intent.dx, dy: intent.dy, smooth: true });
      const text = r.ok ? `⚡ Przesunięto kursor ${intent.label} → (${r.x ?? 0}, ${r.y ?? 0}).` : r.message;
      recordReflex(`Kursor ${intent.label}`, r.ok, text);
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Przesunięto kursor ${intent.label.split("(")[0].trim()}.` : r.message };
    }
    case "cursor_named": {
      const r = await act.moveCursor({ mode: "named", preset: intent.preset, smooth: true });
      const text = r.ok ? `⚡ Kursor ustawiony na: ${intent.label} (${r.x ?? 0}, ${r.y ?? 0}).` : r.message;
      recordReflex(`Kursor: ${intent.label}`, r.ok, text);
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Kursor na ${intent.label}.` : r.message };
    }
    case "mouse": {
      const r = await act.mouseAction({ action: intent.action });
      const text = r.ok ? `⚡ Wykonano: ${intent.label}.` : r.message;
      recordReflex(intent.label, r.ok, text);
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `${intent.label}.` : r.message };
    }
    case "scroll": {
      const r = await act.scroll(intent.direction, intent.amount);
      const text = r.ok ? `⚡ Przewinięto ${intent.label}.` : r.message;
      recordReflex(`Przewijanie ${intent.label}`, r.ok, text);
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? `Przewinięto ${intent.label}.` : r.message };
    }
    case "windows_list": {
      const r = await act.listWindows();
      recordReflex("Lista okien", r.ok, r.message);
      return { handled: true, ok: r.ok, kind: intent.kind, text: `🪟 ${r.message}`, spokenText: r.message };
    }
    case "window_focus": {
      const r = await act.focusWindow(intent.query);
      recordReflex(`Okno: ${intent.query}`, r.ok, r.message);
      return { handled: true, ok: r.ok, kind: intent.kind, text: `🪟 ${r.message}`, spokenText: r.message };
    }
    case "launch": {
      const msg = await act.launchApp(intent.app);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Ta akcja");
      recordReflex(`Uruchom: ${intent.app}`, ok, msg);
      return { handled: true, ok, kind: intent.kind, text: `🚀 ${msg}`, spokenText: msg };
    }
    case "volume": {
      const msg = await act.volume(intent.action);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Brak") && !msg.startsWith("Sterowanie");
      recordReflex(`Głośność: ${intent.action}`, ok, msg);
      return { handled: true, ok, kind: intent.kind, text: `🔊 ${msg}`, spokenText: msg };
    }
    case "media": {
      const msg = await act.media(intent.action);
      const ok = !msg.startsWith("Nie udało") && !msg.startsWith("Brak") && !msg.startsWith("Sterowanie");
      recordReflex(`Media: ${intent.action}`, ok, msg);
      return { handled: true, ok, kind: intent.kind, text: `🎵 ${msg}`, spokenText: msg };
    }
    case "hotkey": {
      const r = await act.hotkey(intent.combo);
      const text = r.ok ? `⌨️ ${intent.label}.` : r.message;
      recordReflex(intent.label, r.ok, text);
      return { handled: true, ok: r.ok, kind: intent.kind, text, spokenText: r.ok ? intent.label : r.message };
    }
    case "type_text": {
      const risk = assessDesktopActionRisk(intent.text, "type");
      if (risk.blocked) {
        const msg = `🛡️ ${risk.reason || "RiskGuard zablokował wpisywanie wrażliwego tekstu."}`;
        recordReflex("RiskGuard blokada", false, msg);
        return { handled: true, ok: false, kind: intent.kind, text: msg, spokenText: "Zablokowano ze względów bezpieczeństwa." };
      }
      const r = await act.typeUnicode(intent.text);
      const text = r.ok ? `⌨️ Wpisano na ekranie (${intent.text.length} znaków).` : r.message;
      recordReflex("Dyktowanie UTF-8", r.ok, text);
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
  }
}
