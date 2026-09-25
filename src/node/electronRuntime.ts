// Entry bundled into electron/gen/runtime.cjs for the Electron main process
// (scripts/build-electron-runtime.mjs). Keeps main.cjs a thin IPC adapter.

import { join } from "node:path";
import { resolveBrowserExecutable } from "./browserExecutable";
import { createEnvHost, type EnvHost } from "./envHost";
import { ManagedBrowser } from "./managedBrowser";
import { CompositeEnvironment } from "./compositeEnvironment";
import { LinuxDesktopEnvironment } from "./linux/environment";
import type { EnvEvent } from "../lib/runtime/env/types";

export interface ManagedBrowserHost extends EnvHost {
  onEvent(listener: (e: EnvEvent) => void): () => void;
}

export interface ManagedBrowserHostOptions {
  userDataPath: string;
  headless?: boolean;
  executablePath?: string;
  /** The system clipboard (Electron's clipboard.readText): the read-back for "skopiuj". */
  readClipboard?: () => string | Promise<string>;
}

/** One managed browser per app, with a dedicated profile under the app's userData folder. */
export function createManagedBrowserHost(opts: ManagedBrowserHostOptions): ManagedBrowserHost {
  const browser = new ManagedBrowser({
    userDataDir: join(opts.userDataPath, "jarvis-browser-profile"),
    executablePath: resolveBrowserExecutable(opts.executablePath) ?? undefined,
    headless: opts.headless ?? false,
    readClipboard: opts.readClipboard,
  });
  // On Linux the same runtime also reaches the desktop (clipboard, windows, input, AT-SPI).
  const env = process.platform === "linux" ? new CompositeEnvironment(browser, new LinuxDesktopEnvironment({ pollMs: 1000 })) : browser;
  const host = createEnvHost(env);
  return { ...host, onEvent: (l) => env.onEvent(l) };
}
