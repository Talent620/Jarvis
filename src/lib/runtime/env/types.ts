// ComputerEnvironment contract (mission 5.6). Every environment (managed browser, browser
// bridge, Linux AT-SPI, Windows UIA, Android, vision, fixtures) exposes the same serializable
// actions and raw read-backs, so it can sit behind IPC. Environments never decide success:
// the runtime checks postconditions on read-backs (postconditions.ts) via the truth ladder.

import type { CapabilityState } from "../types";

export interface ElementTarget {
  /** Environment reference of the element, e.g. "yt-comment:c1". */
  ref: string;
  /** Stable semantic key used to re-find the element after a re-render. */
  semanticKey?: string;
  kind?: string;
}

export type ScrollAmount = "little" | "page" | "more" | "end" | "start";

export type EnvAction =
  | { kind: "browser.launch" }
  | { kind: "browser.navigate"; url: string }
  | { kind: "browser.consent"; choice: "reject" | "accept" }
  | { kind: "browser.open"; target: ElementTarget }
  | { kind: "browser.scroll"; direction: "down" | "up"; amount: ScrollAmount }
  | { kind: "browser.findCollection"; itemKind: string; minItems?: number; more?: boolean }
  | { kind: "browser.focus"; target: ElementTarget }
  | { kind: "text.select"; target: ElementTarget; start: number; end: number; expected: string }
  | { kind: "clipboard.copy"; expected: string; reselect?: { target: ElementTarget; start: number; end: number } }
  | { kind: "browser.scrollTo"; y: number }
  // Desktop (Linux adapters, M7; Windows UIA later). Key combos like "ctrl+c".
  | { kind: "desktop.keys"; keys: string; expectClipboard?: string }
  | { kind: "desktop.type"; text: string }
  | { kind: "window.activate"; windowId: string }
  | { kind: "clipboard.write"; text: string }
  // Visual aid only (numbered badges over candidates when a reference is ambiguous); empty clears.
  | { kind: "overlay.mark"; items: { target: ElementTarget; label: string }[] };

export type EnvActionKind = EnvAction["kind"];

export interface ElementInfo {
  ref: string;
  semanticKey: string;
  kind: string;
  index: number;
  text?: string;
  name?: string;
  href?: string;
  author?: string;
  pinned?: boolean;
  isReply?: boolean;
}

export interface ActResult {
  status: "done" | "failed" | "not_found" | "blocked" | "needs_permission" | "needs_capability";
  error?: string;
  /** Environment-specific output (e.g. collection items). */
  data?: { items?: ElementInfo[]; url?: string; [k: string]: unknown };
  /** Data needed to reverse the action (previous scrollY, ...). */
  undo?: Record<string, unknown>;
  /** The target had to be re-found after a re-render. */
  reResolved?: boolean;
}

/** Raw read-back queries. Answers are plain JSON so they can cross IPC. */
export type ReadQuery =
  | { kind: "page" }
  | { kind: "selection" }
  | { kind: "clipboard" }
  | { kind: "element"; target: ElementTarget }
  | { kind: "collection"; itemKind: string }
  | { kind: "window" }
  | { kind: "windows" }
  | { kind: "focused" };

export interface PageRead {
  open: boolean;
  pageId?: string;
  url?: string;
  title?: string;
  scrollY?: number;
  viewportHeight?: number;
  documentHeight?: number;
  consentWall?: boolean;
}

export interface SelectionRead {
  text: string;
  /** Environment ref of the element containing the selection, when known. */
  ref?: string;
  /** The selection rectangle intersects the viewport. */
  visible: boolean;
}

export interface ClipboardRead {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ElementRead {
  found: boolean;
  inViewport?: boolean;
  highlighted?: boolean;
  text?: string;
  reResolved?: boolean;
}

export interface CollectionRead {
  count: number;
  items: ElementInfo[];
}

/** A top-level window of the desktop. */
export interface WindowInfo {
  id: string;
  title: string;
  app?: string;
  pid?: number;
}

export interface WindowRead {
  found: boolean;
  window?: WindowInfo;
  error?: string;
}

export interface WindowListRead {
  windows: WindowInfo[];
  error?: string;
}

/** The element with keyboard focus (accessibility tree). */
export interface FocusedRead {
  found: boolean;
  app?: string;
  role?: string;
  name?: string;
  text?: string;
  error?: string;
}

export type ReadResult = PageRead | SelectionRead | ClipboardRead | ElementRead | CollectionRead | WindowRead | WindowListRead | FocusedRead;

/** Perception events pushed by the environment (no screenshot polling). */
export type EnvEvent =
  | { type: "navigation"; pageId: string; url: string; title: string }
  | { type: "dom"; pageId: string; change: "append" | "rerender" | "major"; detail?: string }
  | { type: "scroll"; pageId: string; scrollY: number }
  | { type: "selection"; pageId: string; text: string }
  | { type: "window"; windowId: string; title: string; app?: string }
  | { type: "closed" };

export interface ComputerEnvironment {
  readonly id: string;
  capabilities(): Promise<CapabilityState[]>;
  act(action: EnvAction, signal?: AbortSignal): Promise<ActResult>;
  read(query: ReadQuery): Promise<ReadResult>;
  /** Accessibility snapshot for diagnostics and fallback locators (bounded length). */
  snapshot?(maxChars?: number): Promise<string>;
  onEvent(listener: (e: EnvEvent) => void): () => void;
  close(): Promise<void>;
}
