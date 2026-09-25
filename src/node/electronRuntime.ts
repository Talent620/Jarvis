// Entry bundled into electron/gen/runtime.cjs for the Electron main process
// (scripts/build-electron-runtime.mjs). Keeps main.cjs a thin IPC adapter.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeServer } from "./bridge/server";
import { Pairing, TokenStore, type TokenRecord } from "./bridge/protocol";
import { resolveBrowserExecutable } from "./browserExecutable";
import { createEnvHost, type EnvHost } from "./envHost";
import { ManagedBrowser } from "./managedBrowser";
import { CompositeEnvironment } from "./compositeEnvironment";
import { SelectableBrowser } from "./selectableBrowser";
import { LinuxDesktopEnvironment } from "./linux/environment";
import { WindowsDesktopEnvironment } from "./windows/uia";
import type { ComputerEnvironment, EnvEvent } from "../lib/runtime/env/types";

// Coding agents under JARVIS (M11-M13): Codex CLI, Claude Code CLI, a local model.
export { createCoderHost, type CoderHost } from "./coder/host";

export interface ManagedBrowserHost extends EnvHost {
  onEvent(listener: (e: EnvEvent) => void): () => void;
}

export interface ManagedBrowserHostOptions {
  userDataPath: string;
  headless?: boolean;
  executablePath?: string;
  /** The system clipboard (Electron's clipboard.readText): the read-back for "skopiuj". */
  readClipboard?: () => string | Promise<string>;
  /** The user's own browser (BrowserBridge): "w mojej przeglądarce" switches to it. */
  userBrowser?: ComputerEnvironment;
}

/** One managed browser per app, with a dedicated profile under the app's userData folder. */
export function createManagedBrowserHost(opts: ManagedBrowserHostOptions): ManagedBrowserHost {
  const browser = new ManagedBrowser({
    userDataDir: join(opts.userDataPath, "jarvis-browser-profile"),
    executablePath: resolveBrowserExecutable(opts.executablePath) ?? undefined,
    headless: opts.headless ?? false,
    readClipboard: opts.readClipboard,
  });
  // The same runtime also reaches the desktop: AT-SPI and X11/Wayland tools on Linux, UI
  // Automation on Windows. Elsewhere desktop actions are NEEDS_CAPABILITY.
  const desktop = process.platform === "linux" ? new LinuxDesktopEnvironment({ pollMs: 1000 }) : process.platform === "win32" ? new WindowsDesktopEnvironment() : null;
  const browsers = opts.userBrowser ? new SelectableBrowser(browser, opts.userBrowser) : browser;
  const env = desktop ? new CompositeEnvironment(browsers, desktop) : browsers;
  const host = createEnvHost(env);
  return { ...host, onEvent: (l) => env.onEvent(l) };
}

export interface BridgeHost {
  /** The user's current tab as an environment (NEEDS_CAPABILITY until the extension connects). */
  env: ComputerEnvironment;
  start(): Promise<number>;
  /** A new one-time pairing code to show the user. */
  pair(): string;
  status(): { connected: boolean; port: number | null; paired: { extensionId: string; browser: string; createdAt: number }[] };
  revoke(extensionId: string): void;
  close(): Promise<void>;
}

/** BrowserBridge (M8) for the desktop app: loopback server, token hashes kept in userData. */
export function createBridgeHost(opts: { userDataPath: string; port?: number }): BridgeHost {
  const file = join(opts.userDataPath, "jarvis-bridge-tokens.json");
  let records: TokenRecord[] = [];
  try { records = JSON.parse(readFileSync(file, "utf8")) as TokenRecord[]; } catch { records = []; }
  const tokens = new TokenStore(records, (r) => { try { writeFileSync(file, JSON.stringify(r), { mode: 0o600 }); } catch { /* not fatal */ } });
  const pairing = new Pairing();
  const server = new BridgeServer({ tokens, pairing, port: opts.port ?? 47823 });
  let port: number | null = null;
  return {
    env: server.env,
    start: async () => (port = await server.start()),
    pair: () => pairing.issue(),
    status: () => ({ connected: server.env.connected, port, paired: tokens.list() }),
    revoke: (id) => tokens.revoke(id),
    close: () => server.close(),
  };
}
