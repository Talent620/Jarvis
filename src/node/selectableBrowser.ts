// Which browser the runtime drives (B-035): JARVIS's managed browser by default, the user's own
// browser through the BrowserBridge extension after "w mojej przeglądarce". Browser actions and
// reads go to the selected one; page reads say which browser answered, so the switch itself is
// confirmed by a read-back. Events of the browser that is not selected are dropped, so the user's
// own tabs never move JARVIS's page state while it works in its own browser (and vice versa).

import type { ActResult, ComputerEnvironment, EnvAction, EnvEvent, PageRead, ReadQuery, ReadResult } from "../lib/runtime/env/types";
import type { CapabilityState } from "../lib/runtime/types";

export class SelectableBrowser implements ComputerEnvironment {
  readonly id = "managed-browser";
  private target: "managed" | "user" = "managed";
  private listeners = new Set<(e: EnvEvent) => void>();
  private offs: (() => void)[] = [];

  constructor(private readonly managed: ComputerEnvironment, private readonly user: ComputerEnvironment) {
    this.offs.push(managed.onEvent((e) => { if (this.target === "managed") this.emit(e); }));
    this.offs.push(user.onEvent((e) => { if (this.target === "user") this.emit(e); }));
  }

  get selected(): "managed" | "user" {
    return this.target;
  }

  private get current(): ComputerEnvironment {
    return this.target === "user" ? this.user : this.managed;
  }

  private emit(e: EnvEvent): void {
    for (const l of [...this.listeners]) { try { l(e); } catch { /* listener errors stay local */ } }
  }

  async capabilities(): Promise<CapabilityState[]> {
    const [m, u] = await Promise.all([this.managed.capabilities(), this.user.capabilities().catch(() => [])]);
    return [...m, ...u];
  }

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (action.kind !== "browser.use") return this.current.act(action, signal);
    if (action.target === "user") {
      const caps = await this.user.capabilities().catch(() => [] as CapabilityState[]);
      if (!caps.some((c) => c.id === "browser.bridge" && c.status === "available")) {
        return { status: "needs_capability", error: "the JARVIS extension is not connected in your browser (install it and pair it with the code from Settings)" };
      }
    }
    const was = this.target;
    this.target = action.target;
    if (was !== this.target) {
      // The page the runtime knew belongs to the other browser: announce the current one.
      const p = (await this.current.read({ kind: "page" }).catch(() => ({ open: false }))) as PageRead;
      if (p.open && p.pageId && p.url) this.emit({ type: "navigation", pageId: p.pageId, url: p.url, title: p.title ?? "" });
    }
    return { status: "done", data: { browser: this.target } };
  }

  async read(q: ReadQuery): Promise<ReadResult> {
    const r = await this.current.read(q);
    return q.kind === "page" ? { ...(r as PageRead), browser: this.target } : r;
  }

  snapshot(maxChars?: number): Promise<string> {
    const env = this.current;
    return env.snapshot ? env.snapshot(maxChars) : Promise.resolve("");
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Closes JARVIS's own browser; the bridge belongs to its host and stays up. */
  async close(): Promise<void> {
    for (const off of this.offs) off();
    this.offs = [];
    this.listeners.clear();
    await this.managed.close();
  }
}
