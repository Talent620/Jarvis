// Fallback escalation with vision (mission M10). The semantic environment acts first; when it
// cannot find a target, a verified locator from the cache is tried, then a vision model on a
// screenshot, then the honest NEEDS_CAPABILITY / not found. A vision hit is only a pointer click:
// the runtime still confirms the action by the same read-back, and only a confirmed click is
// remembered. The model's output is untrusted: only a box inside the image is used.

import { LocatorCache } from "../locatorCache";
import { needsBefore, readQueryFor, verify } from "../postconditions";
import type { CapabilityState } from "../types";
import type { ActResult, ComputerEnvironment, ElementTarget, EnvAction, EnvEvent, PageRead, ReadQuery, ReadResult } from "./types";

export interface ScreenImage {
  data: string;
  width: number;
  height: number;
  /** Layout signature (e.g. URL plus viewport): a cached box is only reused on the same one. */
  signature: string;
}

export interface Screen {
  capture(): Promise<ScreenImage>;
  click(x: number, y: number): Promise<boolean>;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface VisionModel {
  locate(image: ScreenImage, description: string, signal?: AbortSignal): Promise<{ found: boolean; box?: Box; confidence: number }>;
}

export interface EscalationOptions {
  cache: LocatorCache;
  vision?: VisionModel;
  screen?: Screen;
  minConfidence?: number;
  now?: () => number;
}

const CLICKABLE = new Set<EnvAction["kind"]>(["browser.open", "browser.focus"]);

function describe(t: ElementTarget): string {
  return t.semanticKey ? `${t.kind ?? "element"} ${t.semanticKey}` : t.ref;
}

const boxToString = (b: Box) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`;
function parseBox(s: string): Box | null {
  const n = s.split(",").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? { x: n[0], y: n[1], w: n[2], h: n[3] } : null;
}
const inside = (b: Box, img: ScreenImage) => b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= img.width && b.y + b.h <= img.height;

export class EscalatingEnvironment implements ComputerEnvironment {
  readonly id: string;
  private readonly now: () => number;
  constructor(private readonly primary: ComputerEnvironment, private readonly o: EscalationOptions) {
    this.id = `${primary.id}+vision`;
    this.now = o.now ?? (() => Date.now());
  }

  async capabilities(): Promise<CapabilityState[]> {
    const caps = await this.primary.capabilities();
    const ready = !!this.o.vision && !!this.o.screen;
    return [...caps, { id: "vision", status: ready ? "available" : "missing", checkedAt: this.now(), provider: this.id, detail: ready ? "fallback only, confirmed by read-back" : "no vision model configured" }];
  }

  private async scope(): Promise<string> {
    try {
      const p = (await this.primary.read({ kind: "page" })) as PageRead;
      const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(p.url ?? "");
      return m ? m[1].toLowerCase() : this.primary.id;
    } catch {
      return this.primary.id;
    }
  }

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    const first = await this.primary.act(action, signal);
    const { vision, screen, cache } = this.o;
    if (first.status !== "not_found" || !CLICKABLE.has(action.kind) || !screen) return first;
    const target = (action as { target: ElementTarget }).target;
    const key = target.semanticKey ?? target.ref;
    const scope = await this.scope();
    const query = readQueryFor(action);
    const before = needsBefore(action) ? await this.primary.read(query).catch(() => undefined) : undefined;
    const image = await screen.capture();
    let box: Box | null = null;
    let via: "cache" | "vision" = "cache";
    const cached = cache.get(scope, key, image.signature);
    if (cached?.locator.strategy === "vision") box = parseBox(cached.locator.value);
    if (!box) {
      if (!vision) return { ...first, error: `${first.error ?? "not found"}; no vision fallback configured` };
      via = "vision";
      const v = await vision.locate(image, describe(target), signal).catch(() => ({ found: false, confidence: 0 }) as { found: boolean; box?: Box; confidence: number });
      if (!v.found || !v.box || v.confidence < (this.o.minConfidence ?? 0.6) || !inside(v.box, image)) {
        return { ...first, error: `${first.error ?? "not found"}; vision did not find it reliably` };
      }
      box = v.box;
    }
    if (signal?.aborted) return { status: "failed", error: "aborted" };
    const clicked = await screen.click(box.x + box.w / 2, box.y + box.h / 2);
    if (!clicked) {
      cache.recordFailure(scope, key);
      return { status: "failed", error: "pointer click failed" };
    }
    // The same read-back the runtime will do decides whether this locator is worth keeping.
    const after = await this.primary.read(query).catch(() => undefined);
    const ok = !!after && verify(action, before, after, { status: "done" }, this.now()).truth === "CONFIRMED";
    if (ok) cache.recordVerified(scope, key, { strategy: "vision", value: boxToString(box) }, image.signature);
    else cache.recordFailure(scope, key);
    return { status: "done", data: { via, box: boxToString(box) } };
  }

  read(q: ReadQuery): Promise<ReadResult> { return this.primary.read(q); }
  snapshot(maxChars?: number): Promise<string> { return this.primary.snapshot ? this.primary.snapshot(maxChars) : Promise.resolve(""); }
  onEvent(l: (e: EnvEvent) => void): () => void { return this.primary.onEvent(l); }
  close(): Promise<void> { return this.primary.close(); }
}
