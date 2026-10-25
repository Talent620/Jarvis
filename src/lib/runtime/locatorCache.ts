// Verified locator cache (mission M10): how a target was found last time, kept only after the
// action it served was confirmed by a read-back. An entry dies on failure, on a changed page or
// app signature, or with age; vision locators (coordinates) die on the first failure.

export type LocatorStrategy = "semantic" | "aria" | "css" | "atspi" | "uia" | "android" | "vision";

export interface Locator {
  strategy: LocatorStrategy;
  /** Selector, accessibility path, semantic key, or "x,y,w,h" for vision. */
  value: string;
}

export interface LocatorEntry {
  scope: string;
  target: string;
  locator: Locator;
  verifiedAt: number;
  hits: number;
  failures: number;
  /** Structure signature of the page or app when it was verified (layout, list shape). */
  signature?: string;
}

export interface LocatorCacheOptions {
  ttlMs?: number;
  maxFailures?: number;
  maxEntries?: number;
  now?: () => number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export class LocatorCache {
  private entries = new Map<string, LocatorEntry>();
  private readonly now: () => number;
  constructor(private readonly o: LocatorCacheOptions = {}) {
    this.now = o.now ?? (() => Date.now());
  }

  private key(scope: string, target: string): string {
    return `${norm(scope)}\u0000${norm(target)}`;
  }

  /** A usable entry, or null: expired, failed too often, or verified on a different structure. */
  get(scope: string, target: string, signature?: string): LocatorEntry | null {
    const k = this.key(scope, target);
    const e = this.entries.get(k);
    if (!e) return null;
    const stale = this.now() - e.verifiedAt > (this.o.ttlMs ?? 7 * 24 * 3600_000);
    const changed = !!signature && !!e.signature && signature !== e.signature;
    if (stale || changed || e.failures >= (this.o.maxFailures ?? 2)) {
      this.entries.delete(k);
      return null;
    }
    e.hits++;
    return { ...e };
  }

  /** Only after the action using this locator was CONFIRMED. */
  recordVerified(scope: string, target: string, locator: Locator, signature?: string): void {
    const k = this.key(scope, target);
    this.entries.delete(k); // re-insert: most recent last
    this.entries.set(k, { scope: norm(scope), target: norm(target), locator, verifiedAt: this.now(), hits: 0, failures: 0, signature });
    const max = this.o.maxEntries ?? 500;
    while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value as string);
  }

  /** The locator did not lead to a confirmed action. */
  recordFailure(scope: string, target: string): void {
    const k = this.key(scope, target);
    const e = this.entries.get(k);
    if (!e) return;
    e.failures++;
    if (e.locator.strategy === "vision" || e.failures >= (this.o.maxFailures ?? 2)) this.entries.delete(k);
  }

  /** A site or app changed as a whole (redesign detected): forget its locators. */
  invalidateScope(scope: string): number {
    let n = 0;
    for (const [k, e] of this.entries) if (e.scope === norm(scope)) { this.entries.delete(k); n++; }
    return n;
  }

  export(): LocatorEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  import(list: LocatorEntry[]): void {
    for (const e of list) if (e && typeof e.scope === "string" && typeof e.target === "string" && e.locator) this.entries.set(this.key(e.scope, e.target), { ...e });
  }

  get size(): number {
    return this.entries.size;
  }
}
