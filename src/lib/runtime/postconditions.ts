// Postconditions (mission 5.8): every micro-action declares an end condition checked on a
// read-back, through the truth ladder (horizon/truthLadder.ts), the common standard for all
// actions. An "ok" from the environment is at most ATTEMPTED.

import { climbLadder } from "../horizon/truthLadder";
import type { Truth } from "./truth";
import type {
  ActResult, ClipboardRead, CollectionRead, ElementRead, EnvAction, PageRead, ReadQuery, ReadResult, SelectionRead,
} from "./env/types";
import { preview } from "./util";

export interface Verification {
  truth: Truth;
  evidence: string;
  reason?: string;
}

/** Which read-back proves the action's end condition. */
export function readQueryFor(a: EnvAction): ReadQuery {
  switch (a.kind) {
    case "browser.findCollection": return { kind: "collection", itemKind: a.itemKind };
    case "browser.focus": return { kind: "element", target: a.target };
    case "text.select": return { kind: "selection" };
    case "clipboard.copy": return { kind: "clipboard" };
    default: return { kind: "page" };
  }
}

/** Does this action need a "before" read-back (relative postconditions)? */
export const needsBefore = (a: EnvAction): boolean =>
  a.kind === "browser.scroll" || a.kind === "browser.open" || a.kind === "browser.findCollection";

function urlParts(u: string | undefined): { host: string; path: string } {
  const m = /^[a-z]+:\/\/([^/?#]+)([^?#]*)/i.exec(u || "");
  return m ? { host: m[1].toLowerCase(), path: m[2] || "/" } : { host: "", path: "" };
}

const CONSENT_HOSTS = /(^|\.)consent\.(youtube|google)\.com$/;
const nearBottom = (p: PageRead): boolean =>
  p.scrollY !== undefined && p.viewportHeight !== undefined && p.documentHeight !== undefined &&
  p.scrollY + p.viewportHeight >= p.documentHeight - 2;

function ladder(result: ActResult, expect: Record<string, unknown>, readback: Record<string, unknown>, evidence: string, now: number): Verification {
  const o = climbLadder({ actuated: result.status === "done", actuateError: result.error, expect, readback, now, source: "readback" });
  const truth: Truth = o.state === "CONFIRMED" ? "CONFIRMED" : o.state === "FAILED" ? "FAILED" : o.state === "SIMULATED" ? "SIMULATED" : "ATTEMPTED";
  return truth === "CONFIRMED" ? { truth, evidence } : { truth, evidence, reason: o.evidence?.message ?? "read-back mismatch" };
}

export function verify(a: EnvAction, before: ReadResult | undefined, after: ReadResult, result: ActResult, now: number): Verification {
  // Precondition failures from the environment are reported as such, never as FAILED effects.
  if (result.status === "needs_permission") return { truth: "NEEDS_PERMISSION", evidence: "", reason: result.error };
  if (result.status === "needs_capability") return { truth: "NEEDS_CAPABILITY", evidence: "", reason: result.error };
  if (result.status === "blocked") return { truth: "BLOCKED", evidence: "", reason: result.error };
  if (result.status === "not_found") return { truth: "FAILED", evidence: "", reason: result.error ?? "target not found" };

  switch (a.kind) {
    case "browser.launch": {
      const p = after as PageRead;
      return ladder(result, { open: true }, { open: !!p.open }, `browser open, page ${p.url ?? "about:blank"}`, now);
    }
    case "browser.navigate": {
      const p = after as PageRead;
      const want = urlParts(a.url);
      const got = urlParts(p.url);
      const arrived = got.host === want.host || (!!p.consentWall && CONSENT_HOSTS.test(got.host));
      return ladder(result, { arrived: true }, { arrived }, `url ${p.url}${p.consentWall ? " (consent wall)" : ""}`, now);
    }
    case "browser.consent": {
      const p = after as PageRead;
      return ladder(result, { consentWall: false }, { consentWall: !!p.consentWall }, `consent wall gone, url ${p.url}`, now);
    }
    case "browser.open": {
      const b = before as PageRead | undefined;
      const p = after as PageRead;
      const moved = !!p.url && p.url !== b?.url;
      return ladder(result, { navigated: true }, { navigated: moved }, `url ${b?.url ?? "?"} -> ${p.url}`, now);
    }
    case "browser.scroll": {
      const b = before as PageRead | undefined;
      const p = after as PageRead;
      const y0 = b?.scrollY ?? 0;
      const y1 = p.scrollY ?? 0;
      if (a.direction === "down" && b && nearBottom(b) && y1 <= y0 + 1) return { truth: "BLOCKED", evidence: `scrollY ${y0}`, reason: "already at the end of the page" };
      if (a.direction === "up" && y0 <= 0 && y1 <= 0) return { truth: "BLOCKED", evidence: "scrollY 0", reason: "already at the top of the page" };
      const moved = a.direction === "down" ? y1 > y0 + 1 : y1 < y0 - 1;
      const reached = a.amount === "end" ? nearBottom(p) : a.amount === "start" ? y1 <= 1 : moved;
      return ladder(result, { moved: true }, { moved: reached }, `scrollY ${Math.round(y0)} -> ${Math.round(y1)}`, now);
    }
    case "browser.scrollTo": {
      const p = after as PageRead;
      const ok = Math.abs((p.scrollY ?? -1e9) - a.y) <= 2;
      return ladder(result, { at: true }, { at: ok }, `scrollY ${Math.round(p.scrollY ?? 0)} (target ${a.y})`, now);
    }
    case "browser.findCollection": {
      const c = after as CollectionRead;
      const b = before as CollectionRead | undefined;
      const min = a.more ? (b?.count ?? 0) + 1 : a.minItems ?? 1;
      return ladder(result, { enough: true }, { enough: c.count >= min }, `${c.count} ${a.itemKind} items visible`, now);
    }
    case "browser.focus": {
      const e = after as ElementRead;
      return ladder(result, { found: true, inViewport: true, highlighted: true },
        { found: e.found, inViewport: !!e.inViewport, highlighted: !!e.highlighted },
        `${a.target.ref} in viewport, highlighted${e.reResolved ? " (re-found after re-render)" : ""}`, now);
    }
    case "text.select": {
      const s = after as SelectionRead;
      const inTarget = !s.ref || s.ref === a.target.ref;
      return ladder(result, { text: a.expected, visible: true, inTarget: true },
        { text: s.text, visible: s.visible, inTarget }, `selection "${preview(s.text, 40)}" visible=${s.visible}`, now);
    }
    case "clipboard.copy": {
      const c = after as ClipboardRead;
      if (!c.ok) return { truth: result.status === "done" ? "ATTEMPTED" : "FAILED", evidence: "", reason: `clipboard unreadable: ${c.error ?? "unknown"}` };
      return ladder(result, { text: a.expected }, { text: c.text }, `clipboard "${preview(c.text ?? "", 40)}"`, now);
    }
    default:
      return { truth: "ATTEMPTED", evidence: "", reason: "no postcondition" };
  }
}
