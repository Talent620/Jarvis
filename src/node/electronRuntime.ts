// Entry bundled into electron/gen/runtime.cjs for the Electron main process
// (scripts/build-electron-runtime.mjs). Keeps main.cjs a thin IPC adapter.

import { join } from "node:path";
import { resolveBrowserExecutable } from "./browserExecutable";
import { createEnvHost, type EnvHost } from "./envHost";
import { ManagedBrowser } from "./managedBrowser";
import type { EnvEvent } from "../lib/runtime/env/types";

export interface ManagedBrowserHost extends EnvHost {
  onEvent(listener: (e: EnvEvent) => void): () => void;
}

/** One managed browser per app, with a dedicated profile under the app's userData folder. */
export function createManagedBrowserHost(opts: { userDataPath: string; headless?: boolean; executablePath?: string }): ManagedBrowserHost {
  const browser = new ManagedBrowser({
    userDataDir: join(opts.userDataPath, "jarvis-browser-profile"),
    executablePath: resolveBrowserExecutable(opts.executablePath) ?? undefined,
    headless: opts.headless ?? false,
  });
  const host = createEnvHost(browser);
  return { ...host, onEvent: (l) => browser.onEvent(l) };
}
