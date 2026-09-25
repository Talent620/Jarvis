// One ComputerEnvironment over the managed browser and the desktop adapter (M7): desktop actions
// and reads go to the desktop, everything else to the browser. The runtime sees one contract,
// one capability list and one event stream.

import type { ActResult, ComputerEnvironment, EnvAction, EnvEvent, ReadQuery, ReadResult } from "../lib/runtime/env/types";
import type { CapabilityState } from "../lib/runtime/types";

const DESKTOP_ACTIONS = new Set<EnvAction["kind"]>(["desktop.keys", "desktop.type", "window.activate", "clipboard.write"]);
const DESKTOP_READS = new Set<ReadQuery["kind"]>(["window", "windows", "focused"]);

export class CompositeEnvironment implements ComputerEnvironment {
  readonly id: string;
  constructor(private readonly browser: ComputerEnvironment, private readonly desktop: ComputerEnvironment | null) {
    this.id = desktop ? `${browser.id}+${desktop.id}` : browser.id;
  }

  private forDesktop(a: EnvAction): boolean {
    return DESKTOP_ACTIONS.has(a.kind) || (a.kind === "text.select" && a.target.ref.startsWith("atspi:"));
  }

  async capabilities(): Promise<CapabilityState[]> {
    const [b, d] = await Promise.all([this.browser.capabilities(), this.desktop ? this.desktop.capabilities().catch(() => []) : Promise.resolve([])]);
    return [...b, ...d];
  }

  act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    if (this.forDesktop(action)) {
      return this.desktop ? this.desktop.act(action, signal) : Promise.resolve({ status: "needs_capability", error: "no desktop adapter on this platform" });
    }
    return this.browser.act(action, signal);
  }

  read(query: ReadQuery): Promise<ReadResult> {
    if (DESKTOP_READS.has(query.kind)) {
      return this.desktop ? this.desktop.read(query) : Promise.resolve(query.kind === "windows" ? { windows: [], error: "no desktop adapter" } : { found: false, error: "no desktop adapter" });
    }
    return this.browser.read(query);
  }

  snapshot(maxChars?: number): Promise<string> {
    return this.browser.snapshot ? this.browser.snapshot(maxChars) : Promise.resolve("");
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    const offs = [this.browser.onEvent(listener), ...(this.desktop ? [this.desktop.onEvent(listener)] : [])];
    return () => { for (const off of offs) off(); };
  }

  async close(): Promise<void> {
    await Promise.all([this.browser.close(), this.desktop?.close()]);
  }
}
