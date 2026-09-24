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

interface AppRuntime {
  kernel: Kernel;
  runtime: JarvisRuntime;
}

let runtime: Promise<AppRuntime> | null = null;
let uiSpeaker: Speaker | null = null;

/** Everything the runtime says (results, questions, consent) goes through the UI's speaker. */
export function setRuntimeSpeaker(s: Speaker | null): void {
  uiSpeaker = s;
}

const forwardingSpeaker: Speaker = {
  say: (t) => uiSpeaker?.say(t),
  cancel: () => uiSpeaker?.cancel(),
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

/** Build the app runtime once; a failed start closes what it opened so a retry starts clean. */
export async function createAppRuntime(bridge = desktopEnvBridge(), speaker: Speaker = forwardingSpeaker, session: SessionOptions = {}): Promise<AppRuntime> {
  if (!bridge) throw new Error("runtime is only available in the desktop app");
  const journal = hasIndexedDb() ? new DexieJournal() : undefined;
  try {
    const kernel = journal ? await Kernel.restore(journal) : new Kernel();
    const rt = new JarvisRuntime({ kernel, env: new IpcEnvironment("managed-browser", bridge), speaker, session });
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
      return createAppRuntime(desktopEnvBridge(), forwardingSpeaker, { mail: transport ? new GmailMailService(transport) : undefined });
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
  // Do not start the browser session for plain chat: only a command, or a runtime already up.
  if (quick.type === "unknown" && !runtime) return null;
  const { runtime: rt } = await getAppRuntime();
  if (!rt.claims(text, (cmd) => shouldRoute(cmd, rt.kernel.state))) return null;
  onClaimed?.(); // e.g. show the user's words before anything the runtime says
  return rt.onText(text);
}
