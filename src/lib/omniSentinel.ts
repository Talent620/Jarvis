// === JARVIS OMNI-FRONTIER · Dual-Track Screen Sentinel (Strażnik Ekranu w Tle + Decyzje Głosowe) ===
// Obserwuje ekran w tle BEZ blokowania normalnej rozmowy w trybie KUMPEL.
// - Pre-filtr klatek O(1) (computeFrameFingerprint): statyczny ekran = 0 wywołań Vision AI (0 USD).
// - Twardy limit sprawdzeń (maxChecks ≤ 60): nigdy nie uruchamia nieograniczonej płatnej pętli.
// - Po wykryciu warunku zatrzymuje skan, podświetla cel retikulą na HUD i pyta głosem: „Co robimy?”.
// - Rozpoznaje naturalną polską decyzję głosową, a każdą inną wypowiedź przepuszcza do zwykłej rozmowy!

import { aiRequest } from "./autocore/gateway";
import {
  captureScreenDetailed,
  isDesktop,
  mouseActionOnPc,
  moveCursorOnPc,
  type DetailedScreenshot,
} from "./desktop";
import { foldPolish } from "./omniReflex";
import { assessDesktopActionRisk, type DesktopRiskKind } from "./omniVision";

export type SentinelStatus = "idle" | "watching" | "awaiting_decision" | "stopped" | "error";

export interface SentinelHit {
  xNorm: number;
  yNorm: number;
  x: number;
  y: number;
  label: string;
  confidence: number;
  risk: DesktopRiskKind;
  summary: string;
  question: string;
  screenshotDataUrl: string;
  spottedAt: number;
}

export interface SentinelState {
  status: SentinelStatus;
  condition: string;
  intervalMs: number;
  checksDone: number;
  maxChecks: number;
  visionCalls: number;
  skippedStaticFrames: number;
  hit: SentinelHit | null;
  lastNote: string;
  updatedAt: number;
}

export interface SentinelActuator {
  isDesktop: () => boolean;
  captureScreenDetailed: typeof captureScreenDetailed;
  moveCursor: typeof moveCursorOnPc;
  mouseAction: typeof mouseActionOnPc;
}

export interface StartSentinelOptions {
  condition: string;
  intervalMs?: number;
  maxChecks?: number;
  actuator?: Partial<SentinelActuator>;
  askVision?: (system: string, prompt: string, img: { data: string; mediaType: string }) => Promise<string>;
}

export interface SentinelDecisionResult {
  handled: boolean;
  ok?: boolean;
  text?: string;
  spokenText?: string;
}

export const SENTINEL_WATCH_SYSTEM = [
  "Jesteś Strażnikiem Ekranu (Screen Sentinel) w systemie JARVIS OMNI-FRONTIER.",
  "Sprawdzasz, czy na bieżącym zrzucie ekranu pojawił się warunek/element opisany przez użytkownika.",
  "Zwróć WYŁĄCZNIE czysty obiekt JSON (bez markdown):",
  '{"matched":true,"xNorm":500,"yNorm":500,"label":"co dokładnie widzisz","confidence":0.9,"risk":"none|password|payment|destructive|send","summary":"krótko co widać","question":"krótkie pytanie po polsku jak kumpel, np. Widzę X — kliknąć to czy zostawić?"}',
  'Jeśli warunek NIE jest spełniony, zwróć: {"matched":false,"xNorm":0,"yNorm":0,"label":"","confidence":0,"risk":"none","summary":"jeszcze brak","question":""}.',
  "NIGDY nie namawiaj do omijania CAPTCHA, logowania ani podawania haseł (w takich przypadkach risk:'password').",
].join("\n");

const DEFAULT_ACTUATOR: SentinelActuator = {
  isDesktop,
  captureScreenDetailed,
  moveCursor: moveCursorOnPc,
  mouseAction: mouseActionOnPc,
};

/** Pure: szybki skrót O(1) klatki base64 (32 próbki) — wykrywa statyczny ekran bez wywołań LLM (0 USD). */
export function computeFrameFingerprint(base64: string): string {
  const s = String(base64 || "");
  if (!s) return "empty";
  const len = s.length;
  const samples = 32;
  const step = Math.max(1, Math.floor(len / samples));
  let hash = len >>> 0;
  for (let i = 0; i < len && i < step * samples; i += step) {
    hash = ((hash * 31) ^ s.charCodeAt(i)) >>> 0;
  }
  return `${len}:${hash.toString(16)}`;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseSentinelVerdict(raw: string, shot: DetailedScreenshot): SentinelHit | null {
  const obj = extractJson(raw);
  if (!obj || obj.matched !== true) return null;
  const conf = Number(obj.confidence);
  const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.8;
  if (confidence < 0.65) return null;

  const xNorm = Math.max(0, Math.min(1000, Number(obj.xNorm ?? obj.x ?? 500)));
  const yNorm = Math.max(0, Math.min(1000, Number(obj.yNorm ?? obj.y ?? 500)));
  const sw = Math.max(320, shot.screenWidth || 1920);
  const sh = Math.max(240, shot.screenHeight || 1080);
  const x = Math.max(0, Math.min(sw - 1, Math.round((xNorm / 1000) * sw)));
  const y = Math.max(0, Math.min(sh - 1, Math.round((yNorm / 1000) * sh)));
  const riskRaw = String(obj.risk || "none");
  const risk: DesktopRiskKind = ["none", "password", "payment", "destructive", "send"].includes(riskRaw)
    ? (riskRaw as DesktopRiskKind)
    : "none";
  const label = String(obj.label || "wykryty element");
  const summary = String(obj.summary || label);
  const question = String(obj.question || `Widzę „${label}” na ekranie — co robimy?`);

  return {
    xNorm,
    yNorm,
    x,
    y,
    label,
    confidence,
    risk,
    summary,
    question,
    screenshotDataUrl: `data:${shot.mediaType};base64,${shot.data}`,
    spottedAt: Date.now(),
  };
}

function initialState(): SentinelState {
  return {
    status: "idle",
    condition: "",
    intervalMs: 5000,
    checksDone: 0,
    maxChecks: 24,
    visionCalls: 0,
    skippedStaticFrames: 0,
    hit: null,
    lastNote: "",
    updatedAt: Date.now(),
  };
}

let state: SentinelState = initialState();
const stateListeners = new Set<(s: SentinelState) => void>();
const alertListeners = new Set<(hit: SentinelHit, condition: string) => void>();

let timerId: ReturnType<typeof setTimeout> | null = null;
let sentinelRunId = 0;
let lastFingerprint = "";
let activeOpts: { actuator: SentinelActuator; askVision?: StartSentinelOptions["askVision"] } | null = null;

function emit(patch: Partial<SentinelState>): void {
  state = { ...state, ...patch, updatedAt: Date.now() };
  for (const cb of stateListeners) {
    try { cb(state); } catch { /* ignore */ }
  }
}

function clearTimer(): void {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

export function getSentinelState(): SentinelState {
  return state;
}

export function subscribeSentinel(cb: (s: SentinelState) => void): () => void {
  stateListeners.add(cb);
  cb(state);
  return () => { stateListeners.delete(cb); };
}

export function subscribeSentinelAlerts(cb: (hit: SentinelHit, condition: string) => void): () => void {
  alertListeners.add(cb);
  return () => { alertListeners.delete(cb); };
}

/** Zatrzymaj Strażnika Ekranu w tle i zwolnij timer. */
export function stopOmniSentinel(note = "Zatrzymano Strażnika Ekranu."): void {
  sentinelRunId += 1;
  clearTimer();
  lastFingerprint = "";
  activeOpts = null;
  if (state.status !== "idle") {
    emit({ status: "stopped", hit: null, lastNote: note });
  }
}

/** Zresetuj całkowicie stan Strażnika (wyłącznie do testów jednostkowych). */
export function resetOmniSentinel(): void {
  sentinelRunId += 1;
  clearTimer();
  lastFingerprint = "";
  activeOpts = null;
  state = initialState();
  for (const cb of stateListeners) {
    try { cb(state); } catch { /* ignore */ }
  }
}

/** Wykonaj pojedynczy cykl obserwacji Strażnika (wywoływany cyklicznie lub ręcznie w testach). */
export async function runSentinelTick(expectedRunId = sentinelRunId): Promise<void> {
  if (expectedRunId !== sentinelRunId || state.status !== "watching" || !activeOpts) return;

  if (state.checksDone >= state.maxChecks) {
    stopOmniSentinel(`Osiągnięto limit ${state.maxChecks} sprawdzeń (ochrona budżetu). Powiedz, jeśli mam obserwować dalej.`);
    return;
  }

  const { actuator, askVision } = activeOpts;
  const shot = await actuator.captureScreenDetailed();
  if (expectedRunId !== sentinelRunId) return;

  if (!shot) {
    emit({
      checksDone: state.checksDone + 1,
      lastNote: "Brak zrzutu ekranu w tym cyklu.",
    });
    scheduleNext(expectedRunId);
    return;
  }

  const fp = computeFrameFingerprint(shot.data);
  if (fp === lastFingerprint) {
    emit({
      checksDone: state.checksDone + 1,
      skippedStaticFrames: state.skippedStaticFrames + 1,
      lastNote: "Ekran bez zmian — pominięto zapytanie AI (0 USD).",
    });
    scheduleNext(expectedRunId);
    return;
  }
  lastFingerprint = fp;

  const prompt = `Warunek obserwowany przez użytkownika: "${state.condition}". Ekran: ${shot.screenWidth}x${shot.screenHeight}. Sprawdź, czy warunek właśnie pojawił się na ekranie.`;
  let raw = "";
  try {
    raw = askVision
      ? await askVision(SENTINEL_WATCH_SYSTEM, prompt, { data: shot.data, mediaType: shot.mediaType })
      : (
          await aiRequest({
            task: "E_vision",
            system: SENTINEL_WATCH_SYSTEM,
            history: [{ role: "user", content: prompt, image: { data: shot.data, mediaType: shot.mediaType } }],
          })
        ).text;
  } catch (err) {
    if (expectedRunId !== sentinelRunId) return;
    const msg = err instanceof Error ? err.message : String(err);
    emit({
      checksDone: state.checksDone + 1,
      visionCalls: state.visionCalls + 1,
      lastNote: `Chwilowy błąd wizji: ${msg.slice(0, 80)}`,
    });
    scheduleNext(expectedRunId);
    return;
  }

  if (expectedRunId !== sentinelRunId) return;

  const hit = parseSentinelVerdict(raw, shot);
  if (hit) {
    clearTimer();
    emit({
      status: "awaiting_decision",
      checksDone: state.checksDone + 1,
      visionCalls: state.visionCalls + 1,
      hit,
      lastNote: hit.question,
    });
    for (const cb of alertListeners) {
      try { cb(hit, state.condition); } catch { /* ignore */ }
    }
    return;
  }

  emit({
    checksDone: state.checksDone + 1,
    visionCalls: state.visionCalls + 1,
    lastNote: "Sprawdzono zmianę na ekranie — jeszcze nie widać celu.",
  });
  scheduleNext(expectedRunId);
}

function scheduleNext(myRunId: number): void {
  if (myRunId !== sentinelRunId || state.status !== "watching") return;
  clearTimer();
  timerId = setTimeout(() => {
    void runSentinelTick(myRunId);
  }, state.intervalMs);
}

/**
 * Uruchom nieblokującego Strażnika Ekranu w tle (Dual-Track: w międzyczasie możesz normalnie rozmawiać jak z kumplem).
 */
export function startOmniSentinel(opts: StartSentinelOptions): { ok: boolean; text: string; spokenText: string } {
  const act: SentinelActuator = { ...DEFAULT_ACTUATOR, ...(opts.actuator || {}) };
  if (!act.isDesktop()) {
    return {
      ok: false,
      text: "Strażnik Ekranu wymaga aplikacji desktopowej JARVIS (Linux / Windows).",
      spokenText: "Strażnik Ekranu działa tylko na komputerze.",
    };
  }
  const condition = String(opts.condition || "").trim();
  if (condition.length < 3) {
    return {
      ok: false,
      text: "Opisz krótko, czego mam wypatrywać na ekranie.",
      spokenText: "Powiedz, czego dokładnie mam wypatrywać na ekranie.",
    };
  }

  clearTimer();
  sentinelRunId += 1;
  const myId = sentinelRunId;
  lastFingerprint = "";
  activeOpts = { actuator: act, askVision: opts.askVision };

  const intervalMs = Math.max(3000, Math.min(30000, Number(opts.intervalMs) || 5000));
  const maxChecks = Math.max(1, Math.min(60, Number(opts.maxChecks) || 24));

  emit({
    status: "watching",
    condition,
    intervalMs,
    checksDone: 0,
    maxChecks,
    visionCalls: 0,
    skippedStaticFrames: 0,
    hit: null,
    lastNote: `Obserwuję ekran co ${Math.round(intervalMs / 1000)} s (limit ${maxChecks} sprawdzeń). Możesz normalnie ze mną rozmawiać.`,
  });

  // Pierwszy check za chwilę (nie blokuje odpowiedzi w czacie!)
  timerId = setTimeout(() => {
    void runSentinelTick(myId);
  }, 50);

  return {
    ok: true,
    text: `👁 **Strażnik Ekranu aktywny:** wypatruję „${condition}” co ${Math.round(intervalMs / 1000)} s (statyczne klatki = 0 USD, limit ${maxChecks} sprawdzeń). Możesz ze mną normalnie gadać w międzyczasie — odezwę się, gdy tylko to zobaczę!`,
    spokenText: `Jasne, pilnuję ekranu i wypatruję: ${condition}. Możemy normalnie gadać, dam znać jak tylko to zobaczę.`,
  };
}

/**
 * Wykonaj decyzję użytkownika po wykryciu celu przez Strażnika Ekranu (z pełnym Desktop RiskGuard!).
 */
export async function resolveSentinelDecision(
  decision: "click" | "double" | "right" | "move" | "resume" | "stop",
): Promise<{ ok: boolean; text: string; spokenText: string }> {
  if (decision === "stop") {
    stopOmniSentinel("Zatrzymano Strażnika Ekranu decyzją użytkownika.");
    return { ok: true, text: "⏹ Zatrzymałem Strażnika Ekranu.", spokenText: "Wyłączam strażnika." };
  }

  if (decision === "resume") {
    if (!activeOpts || !state.condition) {
      return { ok: false, text: "Strażnik nie jest aktywny.", spokenText: "Strażnik nie jest aktywny." };
    }
    lastFingerprint = "";
    emit({ status: "watching", hit: null, lastNote: "Pominięto — obserwuję ekran dalej…" });
    scheduleNext(sentinelRunId);
    return { ok: true, text: "▶ Pomijam i obserwuję ekran dalej.", spokenText: "Okej, szukam dalej." };
  }

  const hit = state.hit;
  const act = activeOpts?.actuator || DEFAULT_ACTUATOR;
  if (!hit) {
    return { ok: false, text: "Brak aktywnego wykrytego elementu do wykonania akcji.", spokenText: "Nie mam teraz żadnego zaznaczonego celu." };
  }

  // Twardy Desktop RiskGuard przed kliknięciem / ruchem na wykrytym celu
  const risk = assessDesktopActionRisk(`${hit.label} ${hit.summary}`, decision, hit.risk);
  if (risk.blocked) {
    return {
      ok: false,
      text: `🛡️ ${risk.reason || "RiskGuard zablokował wrażliwy element."}`,
      spokenText: "Zablokowałem tę akcję ze względów bezpieczeństwa — hasła i 2FA wpisz ręcznie.",
    };
  }

  const res =
    decision === "move"
      ? await act.moveCursor({ mode: "absolute", x: hit.x, y: hit.y, smooth: true })
      : await act.mouseAction({ action: decision, x: hit.x, y: hit.y, smooth: true });

  if (!res.ok) {
    return { ok: false, text: res.message, spokenText: "Nie udało się wykonać ruchu na ekranie." };
  }

  // Po udanej akcji automatycznie wznawiamy czujność albo zostawiamy info
  const verb = decision === "move" ? "Wskazałem kursorem" : decision === "double" ? "Kliknąłem dwukrotnie" : decision === "right" ? "Kliknąłem prawym" : "Kliknąłem";
  lastFingerprint = "";
  emit({ status: "watching", hit: null, lastNote: `${verb} „${hit.label}” — obserwuję dalej.` });
  scheduleNext(sentinelRunId);

  return {
    ok: true,
    text: `🎯 ${verb} **${hit.label}** (${hit.x}, ${hit.y}). Strażnik wrócił do obserwacji.`,
    spokenText: `${verb} ${hit.label}. Wracam do obserwacji.`,
  };
}

/**
 * Dual-Track router decyzji głosowej: gdy Strażnik czeka na decyzję (`awaiting_decision`),
 * przechwytuje WYŁĄCZNIE wyraźne komendy decyzji (kliknij/wskaż/szukaj dalej/stop),
 * a każdą normalną rozmowę „jak z kumplem” przepuszcza nietkniętą (`handled: false`)!
 */
export async function tryHandleSentinelVoiceReply(transcript: string): Promise<SentinelDecisionResult> {
  if (state.status !== "awaiting_decision" || !state.hit) {
    return { handled: false };
  }
  const f = foldPolish(transcript).replace(/^(?:hej |ok |ej )?jarvis\s+/, "").trim();
  if (!f) return { handled: false };

  if (/^(?:kliknij to|kliknij go|kliknij ja|kliknij|zrob to|wykonaj|wykonaj to|otworz to|tak kliknij|dawaj kliknij)$/.test(f)) {
    const r = await resolveSentinelDecision("click");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }
  if (/^(?:kliknij dwa razy|kliknij dwukrotnie|dwuklik na to|otworz dwuklikiem)$/.test(f)) {
    const r = await resolveSentinelDecision("double");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }
  if (/^(?:prawy klik na to|kliknij prawym na to|kliknij prawym)$/.test(f)) {
    const r = await resolveSentinelDecision("right");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }
  if (/^(?:przesun tam kursor|wskaz to|pokaz gdzie|najedz na to)$/.test(f)) {
    const r = await resolveSentinelDecision("move");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }
  if (/^(?:szukaj dalej|zignoruj|zignoruj to|pomin|pomin to|zostaw to|olej to|obserwuj dalej)$/.test(f)) {
    const r = await resolveSentinelDecision("resume");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }
  if (/^(?:zatrzymaj straznika|wylacz straznika|przestan pilnowac|wystarczy straznik)$/.test(f)) {
    const r = await resolveSentinelDecision("stop");
    return { handled: true, ok: r.ok, text: r.text, spokenText: r.spokenText };
  }

  // Każda inna wypowiedź idzie dalej do zwykłej rozmowy „jak z kumplem”!
  return { handled: false };
}
