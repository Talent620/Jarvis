// App integration of the JARVIS runtime: one kernel (journal in IndexedDB) and one JarvisRuntime
// (reflex, conversation status, serial action lane, consent) talking to the managed browser in
// the Electron main process. Only in the desktop app; web and mobile builds never route here.
// The chat model stays the app's own: side chat is not claimed by the runtime.

import { parseCommand, type Command } from "./commands";
import { IpcEnvironment, desktopEnvBridge } from "./env/ipc";
import { DexieJournal, hasIndexedDb } from "./journal";
import { Kernel } from "./kernel";
import type { KernelState } from "./reducer";
import { GmailMailService } from "./gmailService";
import { JarvisRuntime, type RuntimeTurn, type Speaker } from "./lanes/runtime";
import type { SessionOptions } from "./session";
import { exportDiagnostics, statusView, type Diagnostics, type StatusView } from "./diagnostics";
import { SkillLibrary, parseRememberSkill, parseRunSkill, type Skill, type SkillStore } from "./skills";
import { normalizeUtterance } from "./util";
import { BatchSTT, DeepgramSTT, FallbackSTT } from "./voice/adapters";
import { AppTTS, MicInput, pcm16ToWav } from "./voice/browserAudio";
import { VoiceSession, type VoiceSessionEvent } from "./voice/session";
import { VoiceControl } from "./voiceControl";
import { acquireVoice, releaseVoice } from "../voiceSession";
import type { ListenMode, SocketLike, StreamingSTT } from "./voice/types";

interface AppRuntime {
  kernel: Kernel;
  runtime: JarvisRuntime;
}

let runtime: Promise<AppRuntime> | null = null;
let current: AppRuntime | null = null;
type Watcher = (c: AppRuntimeControls) => (() => void) | void;
/** Watchers still waiting for the runtime, and cleanups of those already called. */
const waiting = new Set<Watcher>();
const cleanups = new Map<Watcher, (() => void) | void>();

/** What the status panel may do with the runtime: look, press a control, export diagnostics. */
export interface AppRuntimeControls {
  view(): StatusView;
  subscribe(fn: () => void): () => void;
  press(control: "pause" | "resume" | "stop"): void;
  diagnostics(): Diagnostics;
  skills(): Skill[];
  forgetSkill(name: string): void;
}

const ACTION_MODEL = "polecenia bez modelu (gramatyka PL), odczyt zwrotny";

function controlsOf(a: AppRuntime): AppRuntimeControls {
  const rt = a.runtime;
  return {
    view: () => statusView(a.kernel.state, { now: Date.now(), environment: rt.environmentId, model: ACTION_MODEL }),
    subscribe: (fn) => a.kernel.subscribe(() => fn()),
    press: (c) => { rt.press(c); },
    skills: () => rt.listSkills(),
    forgetSkill: (name) => { rt.forgetSkill(name); },
    diagnostics: () => exportDiagnostics({
      state: a.kernel.state, turns: rt.turns, skills: rt.listSkills(), environment: rt.environmentId, now: Date.now(),
      latency: voiceSpeaker ? voiceSpeaker.latency.summary() : undefined,
    }),
  };
}

function safeCall(fn: Watcher, c: AppRuntimeControls): (() => void) | void {
  try { return fn(c); } catch { return undefined; }
}

/**
 * Call `fn` once the app runtime exists (at once if it already does). It never starts the runtime
 * itself: the panel appears only after the user gave the runtime something to do.
 */
export function whenAppRuntime(fn: Watcher): () => void {
  if (current) cleanups.set(fn, safeCall(fn, controlsOf(current)));
  else waiting.add(fn);
  return () => {
    waiting.delete(fn);
    const cleanup = cleanups.get(fn);
    cleanups.delete(fn);
    if (typeof cleanup === "function") cleanup();
  };
}
let uiSpeaker: Speaker | null = null;
let voiceSpeaker: VoiceSession | null = null;

/** What the UI's speaker gets: `voice` means a voice session already speaks it (show only). */
export type UiSpeakMeta = { utteranceId?: string; voice?: boolean };

/** Everything the runtime says (results, questions, consent) goes through the UI's speaker. */
export function setRuntimeSpeaker(s: Speaker | null): void {
  uiSpeaker = s;
}

const forwardingSpeaker: Speaker = {
  say: (t, meta) => {
    uiSpeaker?.say(t, { ...meta, voice: !!voiceSpeaker } as UiSpeakMeta);
    voiceSpeaker?.say(t, meta);
  },
  cancel: () => { uiSpeaker?.cancel(); voiceSpeaker?.cancel(); },
};

export function runtimeAvailable(): boolean {
  return desktopEnvBridge() !== null;
}

/**
 * Should this command go to the action runtime instead of the chat model? Conservative:
 * referring commands ("następny", "skopiuj") only when there is something on screen to refer to.
 */
export function shouldRoute(cmd: Command, state: KernelState | undefined): boolean {
  const pageOpen = !!state?.page && state.page.id !== "closed";
  const hasCollection = !!state && Object.values(state.referents.byId).some((r) => r.type === "Collection" && r.valid);
  const hasSelection = !!state && Object.values(state.referents.byId).some((r) => r.type === "Selection" && r.valid);
  const hasCopy = !!state?.clipboard?.byJarvis;
  switch (cmd.type) {
    case "browser.launch":
    case "browser.gotoSite":
    case "browser.use":
      return true;
    case "scroll":
    case "browser.openItem":
    case "findCollection":
      return pageOpen;
    case "focusItem":
    case "selectText":
      return pageOpen && hasCollection;
    case "copy":
      return pageOpen && hasSelection;
    case "send":
      return hasSelection || hasCopy;
    default:
      return false;
  }
}

const SKILLS_KEY = "jarvis.skills.v1";

/** Skills survive a restart in local storage; unreadable storage means an empty library. */
export const localSkillStore: SkillStore = {
  load: () => {
    try { return JSON.parse(globalThis.localStorage?.getItem(SKILLS_KEY) ?? "[]") as Skill[]; } catch { return []; }
  },
  save: (skills) => {
    try { globalThis.localStorage?.setItem(SKILLS_KEY, JSON.stringify(skills)); } catch { /* full or blocked: kept for this session */ }
  },
};

/** Build the app runtime once; a failed start closes what it opened so a retry starts clean. */
export async function createAppRuntime(bridge = desktopEnvBridge(), speaker: Speaker = forwardingSpeaker, session: SessionOptions = {}): Promise<AppRuntime> {
  if (!bridge) throw new Error("runtime is only available in the desktop app");
  const journal = hasIndexedDb() ? new DexieJournal() : undefined;
  try {
    const kernel = journal ? await Kernel.restore(journal) : new Kernel();
    const rt = new JarvisRuntime({ kernel, env: new IpcEnvironment("managed-browser", bridge), speaker, session, skills: new SkillLibrary(localSkillStore) });
    await rt.start();
    return { kernel, runtime: rt };
  } catch (e) {
    journal?.close();
    throw e;
  }
}

export function getAppRuntime(): Promise<AppRuntime> {
  if (!runtime) {
    runtime = (async () => {
      // Mail with Sent read-back through the connected Gmail (desktop bridge or backend). No
      // address book yet: recipients come from the user's words ("na adres ...") until one exists.
      const { gmailTransport } = await import("../google");
      const transport = gmailTransport();
      const app = await createAppRuntime(desktopEnvBridge(), forwardingSpeaker, { mail: transport ? new GmailMailService(transport) : undefined });
      current = app;
      // A failing panel callback must never fail (and so duplicate) the runtime start.
      for (const fn of [...waiting]) { waiting.delete(fn); cleanups.set(fn, safeCall(fn, controlsOf(app))); }
      return app;
    })();
    runtime.catch(() => { runtime = null; });
  }
  return runtime;
}

/**
 * Give a typed or spoken utterance to the runtime when it is the runtime's (a command for the
 * screen, a control for a running task, an answer to its question). Null leaves it to the chat.
 * The turn returns as soon as it is routed; results are spoken through the UI speaker.
 */
export async function tryRuntimeText(text: string, onClaimed?: () => void): Promise<RuntimeTurn | null> {
  if (!runtimeAvailable()) return null;
  const quick = parseCommand(text);
  const norm = normalizeUtterance(text);
  const run = parseRunSkill(norm);
  const skill = !!parseRememberSkill(norm) || (!!run && new SkillLibrary(localSkillStore).has(run));
  // Do not start the browser session for plain chat: only a command, or a runtime already up.
  if (quick.type === "unknown" && !skill && !runtime) return null;
  const { runtime: rt } = await getAppRuntime();
  if (!rt.claims(text, (cmd) => shouldRoute(cmd, rt.kernel.state))) return null;
  onClaimed?.(); // e.g. show the user's words before anything the runtime says
  return rt.onText(text);
}

export interface AppVoiceIO {
  /** The app's speech output for one sentence (resolves when done). */
  speak: (text: string) => Promise<void>;
  stop: () => void;
  /** Batch recognizer (Groq Whisper or on-device) for a WAV clip. */
  transcribe: (wav: Blob) => Promise<string>;
  /** Deepgram browser credential, when the user configured one (never logged). */
  deepgramToken?: () => string;
  mode?: ListenMode;
  onEvent?: (e: VoiceSessionEvent) => void;
}

/**
 * Voice control of the runtime: microphone (echo cancellation on) -> streaming recognizer chain
 * -> JarvisRuntime -> speech with barge-in. Needs a microphone: acceptance on the user machine.
 */
export async function startAppVoice(io: AppVoiceIO): Promise<{ session: VoiceSession; stop: () => Promise<void>; recognizer: () => string }> {
  const { runtime: rt } = await getAppRuntime();
  const token = io.deepgramToken?.();
  const chain: (() => StreamingSTT)[] = [];
  if (token) chain.push(() => new DeepgramSTT({ connect: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike, protocols: ["token", token] }));
  chain.push(() => new BatchSTT({ transcribe: (frames) => io.transcribe(new Blob([pcm16ToWav(frames)], { type: "audio/wav" })) }));
  const stt = new FallbackSTT(chain);
  const session = new VoiceSession({ stt, tts: new AppTTS({ speak: io.speak, stop: io.stop }), mode: io.mode, onEvent: io.onEvent });
  session.attach(rt);
  const mic = new MicInput();
  voiceSpeaker = session;
  try {
    await session.start();
    await mic.start((f) => session.pushAudio(f));
  } catch (e) {
    voiceSpeaker = null;
    await session.stop().catch(() => undefined);
    throw e;
  }
  return {
    session,
    recognizer: () => stt.id,
    stop: async () => {
      if (voiceSpeaker === session) voiceSpeaker = null;
      await mic.stop();
      await session.stop();
    },
  };
}

let voiceControl: VoiceControl | null = null;

/** The voice controller if the user ever switched voice control on (status for the panel). */
export const peekVoiceControl = (): VoiceControl | null => voiceControl;

/**
 * The single "Sterowanie komputerem głosem" controller of the app (B-034). `io` is built by the
 * UI (speech output, batch recognizer, Deepgram key) at every start, so settings changes apply.
 */
export function appVoiceControl(io: () => AppVoiceIO): VoiceControl {
  if (!voiceControl) {
    voiceControl = new VoiceControl({
      start: async () => {
        const r = await startAppVoice(io());
        return { stop: r.stop, recognizer: r.recognizer() };
      },
      acquire: acquireVoice,
      release: releaseVoice,
    });
  }
  return voiceControl;
}
