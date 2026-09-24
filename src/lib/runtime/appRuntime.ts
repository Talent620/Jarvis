// App integration of the JARVIS runtime: one kernel (journal in IndexedDB) and one action
// session talking to the managed browser in the Electron main process. Only in the desktop
// app; web and mobile builds never route commands here.

import { parseCommand, type Command } from "./commands";
import { IpcEnvironment, desktopEnvBridge } from "./env/ipc";
import { DexieJournal, hasIndexedDb } from "./journal";
import { Kernel } from "./kernel";
import type { KernelState } from "./reducer";
import { ActionSession, type TurnResult } from "./session";

interface AppRuntime {
  kernel: Kernel;
  session: ActionSession;
}

let runtime: Promise<AppRuntime> | null = null;

export function runtimeAvailable(): boolean {
  return desktopEnvBridge() !== null;
}

/**
 * Should this utterance go to the action runtime instead of the chat model? Conservative:
 * referring commands ("następny", "skopiuj") only when there is something on screen to refer to.
 */
export function shouldRoute(cmd: Command, state: KernelState | undefined): boolean {
  const pageOpen = !!state?.page && state.page.id !== "closed";
  const hasCollection = !!state && Object.values(state.referents.byId).some((r) => r.type === "Collection" && r.valid);
  const hasSelection = !!state && Object.values(state.referents.byId).some((r) => r.type === "Selection" && r.valid);
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
    default:
      return false;
  }
}

export function getAppRuntime(): Promise<AppRuntime> {
  if (!runtime) {
    runtime = (async () => {
      const bridge = desktopEnvBridge();
      if (!bridge) throw new Error("runtime is only available in the desktop app");
      const kernel = hasIndexedDb() ? await Kernel.restore(new DexieJournal()) : new Kernel();
      const session = new ActionSession(kernel, new IpcEnvironment("managed-browser", bridge));
      await session.start();
      return { kernel, session };
    })();
    runtime.catch(() => { runtime = null; });
  }
  return runtime;
}

/** Route a typed or spoken command to the runtime; null when it is not a runtime command. */
export async function tryRuntimeCommand(text: string): Promise<TurnResult | null> {
  if (!runtimeAvailable()) return null;
  const cmd = parseCommand(text);
  if (cmd.type === "unknown") return null;
  const rt = await getAppRuntime();
  if (!shouldRoute(cmd, rt.kernel.state)) return null;
  return rt.session.handle(text);
}
