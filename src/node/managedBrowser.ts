// ManagedBrowser environment (mission 5.6): Playwright driving a dedicated JARVIS browser
// profile (never the user's own profile or logins). Node only: runs in the Electron main
// process behind IPC, and directly in tests and the acceptance CLI.
//
// Perception is event driven (navigation, list mutations, scroll, selection) through an
// exposed binding; nothing polls screenshots. Elements carry data-jarvis-ref plus a semantic
// key; every lookup re-checks identity, so a reused or re-rendered element is found again or
// reported missing, never used blindly. Read-backs run in an isolated JavaScript world (CDP),
// so page scripts cannot forge them.

import { existsSync } from "node:fs";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import type {
  ActResult, ClipboardRead, CollectionRead, ComputerEnvironment, ElementInfo, ElementRead, ElementTarget, EnvAction,
  EnvEvent, PageRead, ReadQuery, ReadResult, SelectionRead,
} from "../lib/runtime/env/types";
import type { CapabilityState } from "../lib/runtime/types";

export interface ManagedBrowserOptions {
  /** Dedicated profile directory (never the user's browser profile). */
  userDataDir: string;
  executablePath?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  actionTimeoutMs?: number;
  now?: () => number;
  /**
   * Read the OS clipboard from Node (Electron `clipboard.readText`). When set, pages get no
   * clipboard-read permission at all; otherwise (tests, headless) the read runs in an isolated world.
   */
  readClipboard?: () => Promise<string> | string;
}

class Aborted extends Error {
  constructor() { super("aborted"); this.name = "AbortError"; }
}

/** Upper bound for waiting on the "load" event before measuring or scrolling a page. */
const LOAD_WAIT_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CONSENT_REJECT = /^(Odrzuć wszystko|Reject all)$/i;
const CONSENT_ACCEPT = /^(Zaakceptuj wszystko|Accept all)$/i;
const ALLOWED_SCHEMES = /^https?:\/\//i;

/**
 * In-page library (plain ES2019), shared by the main-world perception script and by isolated
 * world read-backs. Comment identity: data-comment-id when the site has it (the fixture), else a
 * hash of author and text (the real YouTube markup has no stable id attribute).
 */
const PAGE_LIB = `var __j = {
  hash: function (s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); },
  threads: function () { return Array.prototype.slice.call(document.querySelectorAll("ytd-comment-thread-renderer")); },
  commentId: function (el) {
    var id = el.getAttribute("data-comment-id");
    if (id) return id;
    var t = el.querySelector("#content-text"), a = el.querySelector("#author-text");
    return "h" + __j.hash(((a && a.textContent) || "").trim() + "\\n" + ((t && t.textContent) || ""));
  },
  keyOf: function (el) {
    if (el.matches && el.matches("ytd-comment-thread-renderer")) return "comment:" + __j.commentId(el);
    if (el.tagName === "A") return "video:" + el.getAttribute("href");
    return null;
  },
  byKey: function (key) {
    if (!key) return null;
    if (key.indexOf("comment:") === 0) { var id = key.slice(8), ts = __j.threads(); for (var i = 0; i < ts.length; i++) if (__j.commentId(ts[i]) === id) return ts[i]; return null; }
    if (key.indexOf("video:") === 0) { var href = key.slice(6), as = document.querySelectorAll("a[href]"); for (var j = 0; j < as.length; j++) if (as[j].getAttribute("href") === href) return as[j]; return null; }
    return null;
  },
  find: function (ref, key) {
    var el = ref ? document.querySelector('[data-jarvis-ref="' + CSS.escape(ref) + '"]') : null;
    if (el && key && __j.keyOf(el) !== key) { el.removeAttribute("data-jarvis-ref"); el = null; }
    var again = false;
    if (!el && key) { el = __j.byKey(key); again = !!el; if (el && ref) el.setAttribute("data-jarvis-ref", ref); }
    return el ? { el: el, again: again } : null;
  }
};`;

interface PageLib {
  hash(s: string): string;
  threads(): Element[];
  commentId(el: Element): string;
  keyOf(el: Element): string | null;
  byKey(key?: string): Element | null;
  find(ref?: string, key?: string): { el: Element; again: boolean } | null;
}
declare const __j: PageLib;

/** Main-world perception and overlay, installed in every document before page scripts run. */
function initScript(): void {
  const w = window as unknown as {
    __jarvisEmit?: (payload: unknown) => void;
    __jarvisOverlay?: { track: (ref: string, key?: string) => void; clear: () => void };
  };
  const emit = (payload: unknown) => { try { w.__jarvisEmit?.(payload); } catch { /* binding not ready */ } };

  let signature = "";
  let pending = false;
  const listSignature = () => __j.threads().map((e) => __j.commentId(e)).join(",");
  const onMutation = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const next = listSignature();
      if (next === signature) {
        emit({ type: "dom", change: "rerender" });
      } else {
        // First population and continuation pages extend the list; only a different order or
        // a removed item is a major change that invalidates references.
        const change = !signature || next.startsWith(signature) ? "append" : "major";
        signature = next;
        emit({ type: "dom", change, detail: String(next.split(",").filter(Boolean).length) });
      }
    }, 80);
  };
  const touchesThreads = (n: Node) => n instanceof Element && (n.matches("ytd-comment-thread-renderer") || !!n.querySelector("ytd-comment-thread-renderer"));
  const start = () => {
    signature = listSignature();
    new MutationObserver((records) => {
      if (records.some((r) => Array.from(r.removedNodes).some(touchesThreads) || Array.from(r.addedNodes).some(touchesThreads))) onMutation();
      schedulePlace();
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("scroll", () => {
    schedulePlace();
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; emit({ type: "scroll", scrollY: window.scrollY }); }, 150);
  }, { passive: true });
  window.addEventListener("resize", () => schedulePlace());
  let selTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener("selectionchange", () => {
    if (selTimer) return;
    selTimer = setTimeout(() => { selTimer = null; emit({ type: "selection", text: String(document.getSelection() || "") }); }, 150);
  });

  // Overlay: a fixed box following the target through scrolls and re-renders (event driven).
  let target: { ref: string; key?: string } | null = null;
  let box: HTMLDivElement | null = null;
  let frame = 0;
  function place() {
    frame = 0;
    if (!target) return;
    if (!box) {
      box = document.createElement("div");
      box.id = "jarvis-overlay";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #28c0c8;border-radius:8px;box-shadow:0 0 0 4px rgba(40,192,200,.25)";
      document.documentElement.appendChild(box);
    }
    const hit = __j.find(target.ref, target.key);
    if (!hit) { box.style.display = "none"; return; }
    const r = hit.el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${r.left - 4}px`;
    box.style.top = `${r.top - 4}px`;
    box.style.width = `${r.width + 8}px`;
    box.style.height = `${r.height + 8}px`;
  }
  function schedulePlace() {
    if (target && !frame) frame = requestAnimationFrame(place);
  }
  w.__jarvisOverlay = {
    track: (ref: string, key?: string) => { target = { ref, key }; place(); },
    clear: () => { target = null; if (box) box.style.display = "none"; },
  };
}

export class ManagedBrowser implements ComputerEnvironment {
  readonly id = "managed-browser";
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp = new WeakMap<Page, CDPSession>();
  private listeners = new Set<(e: EnvEvent) => void>();
  private pageSeq = 0;
  private pageId = "";
  private lastUrl = "";
  private expectingPopup = false;
  private readonly timeout: number;

  constructor(private readonly opts: ManagedBrowserOptions) {
    this.timeout = opts.actionTimeoutMs ?? 10_000;
  }

  onEvent(listener: (e: EnvEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(e: EnvEvent): void {
    for (const l of [...this.listeners]) { try { l(e); } catch { /* listener errors stay local */ } }
  }

  async capabilities(): Promise<CapabilityState[]> {
    const now = (this.opts.now ?? Date.now)();
    let exe = this.opts.executablePath;
    if (!exe) { try { exe = chromium.executablePath(); } catch { exe = undefined; } }
    const present = !!exe && existsSync(exe);
    return [{
      id: "browser.managed.semantic",
      status: present ? "available" : "missing",
      provider: "playwright-chromium",
      detail: present ? (this.context ? "running" : "ready to launch") : "no Chromium found: install Google Chrome or run `npx playwright install chromium`",
      checkedAt: now,
    }];
  }

  async close(): Promise<void> {
    const c = this.context;
    this.context = null;
    this.page = null;
    if (c) await c.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------- isolated world

  /** Evaluate a function in a fresh isolated world of the current page (page scripts cannot patch it). */
  private async iso<T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
    const p = this.requirePage();
    let session = this.cdp.get(p);
    if (!session) {
      session = await p.context().newCDPSession(p);
      this.cdp.set(p, session);
    }
    const tree = (await session.send("Page.getFrameTree")) as { frameTree: { frame: { id: string } } };
    const world = (await session.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id, worldName: "jarvis-readback" })) as { executionContextId: number };
    const expression = `${PAGE_LIB}\n(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
    const r = (await session.send("Runtime.evaluate", { expression, contextId: world.executionContextId, returnByValue: true, awaitPromise: true })) as {
      result: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? r.exceptionDetails.text ?? "evaluation failed");
    return r.result.value as T;
  }

  // ---------------------------------------------------------------- actions

  async act(action: EnvAction, signal?: AbortSignal): Promise<ActResult> {
    try {
      if (signal?.aborted) throw new Aborted();
      switch (action.kind) {
        case "browser.launch": return await this.launch();
        case "browser.navigate": return await this.navigate(action.url);
        case "browser.consent": return await this.consent(action.choice);
        case "browser.open": return await this.open(action.target);
        case "browser.scroll": return await this.scroll(action.direction, action.amount);
        case "browser.scrollTo": return await this.scrollTo(action.y);
        case "browser.findCollection": return await this.findCollection(action.itemKind, action.minItems ?? 1, !!action.more, signal);
        case "browser.focus": return await this.focus(action.target);
        case "text.select": return await this.select(action.target, action.start, action.end);
        case "clipboard.copy": return await this.copy(action.expected, action.reselect);
        default: return { status: "needs_capability", error: `unsupported action ${(action as EnvAction).kind}` };
      }
    } catch (e) {
      if (e instanceof Aborted) return { status: "failed", error: "aborted" };
      return { status: "failed", error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
    }
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("browser is not running");
    return this.page;
  }

  private async launch(): Promise<ActResult> {
    if (this.page && !this.page.isClosed()) return { status: "done", data: { alreadyRunning: true } };
    const ctx = await chromium.launchPersistentContext(this.opts.userDataDir, {
      headless: this.opts.headless ?? true,
      executablePath: this.opts.executablePath,
      viewport: this.opts.viewport ?? { width: 1280, height: 800 },
      locale: "pl-PL",
      args: ["--no-first-run", "--no-default-browser-check", "--disable-features=Translate"],
    });
    ctx.setDefaultTimeout(this.timeout);
    // With an OS clipboard reader (Electron) pages get no clipboard-read permission at all.
    await ctx.grantPermissions(this.opts.readClipboard ? ["clipboard-write"] : ["clipboard-read", "clipboard-write"]);
    await ctx.exposeBinding("__jarvisEmit", (source, payload) => this.onPageEvent(source.page, payload as Record<string, unknown>));
    await ctx.addInitScript({ content: `${PAGE_LIB}\n(${initScript.toString()})();` });
    ctx.on("close", () => { this.context = null; this.page = null; this.emit({ type: "closed" }); });
    this.context = ctx;
    this.attach(ctx.pages()[0] ?? await ctx.newPage());
    // New tabs take over only when JARVIS itself opened a link and the opener is its page;
    // a script's window.open never becomes the page JARVIS reads and acts on.
    ctx.on("page", (p) => {
      void (async () => {
        const opener = await p.opener().catch(() => null);
        if (this.expectingPopup && opener && opener === this.page) this.attach(p);
      })();
    });
    return { status: "done" };
  }

  private attach(p: Page): void {
    this.page = p;
    p.on("framenavigated", (frame) => {
      if (frame !== p.mainFrame() || p !== this.page) return;
      const url = frame.url();
      if (url === this.lastUrl) return;
      this.lastUrl = url;
      const id = `page-${++this.pageSeq}`;
      this.pageId = id;
      void p.title().catch(() => "").then((title) => {
        if (this.pageId === id) this.emit({ type: "navigation", pageId: id, url, title }); // drop stale titles
      });
    });
    p.on("close", () => { if (this.page === p) this.page = null; });
  }

  private onPageEvent(p: Page | undefined, payload: Record<string, unknown>): void {
    if (!p || p !== this.page) return;
    const pageId = this.pageId;
    if (payload.type === "dom") this.emit({ type: "dom", pageId, change: payload.change as "append" | "rerender" | "major", detail: payload.detail as string | undefined });
    else if (payload.type === "scroll") this.emit({ type: "scroll", pageId, scrollY: Number(payload.scrollY) });
    else if (payload.type === "selection") this.emit({ type: "selection", pageId, text: String(payload.text ?? "") });
  }

  private async navigate(url: string): Promise<ActResult> {
    if (!ALLOWED_SCHEMES.test(url)) return { status: "blocked", error: "only http and https addresses are allowed" };
    const p = this.requirePage();
    const resp = await p.goto(url, { waitUntil: "domcontentloaded" });
    return resp && resp.status() >= 400 ? { status: "failed", error: `HTTP ${resp.status()}` } : { status: "done", data: { url: p.url() } };
  }

  private async consent(choice: "reject" | "accept"): Promise<ActResult> {
    const p = this.requirePage();
    const button = p.getByRole("button", { name: choice === "reject" ? CONSENT_REJECT : CONSENT_ACCEPT });
    if (await button.count() === 0) return { status: "not_found", error: "no consent dialog" };
    const before = p.url();
    await Promise.all([p.waitForLoadState("domcontentloaded"), button.first().click()]);
    await p.waitForFunction(() => !document.querySelector("#consent, [aria-labelledby='consent-title']"), undefined, { timeout: this.timeout }).catch(() => undefined);
    return { status: "done", data: { from: before, url: p.url() } };
  }

  /** Find the target, re-checking its identity; re-tag it when found again after a re-render. */
  private async locate(target: ElementTarget): Promise<{ selector: string; reResolved: boolean } | null> {
    const hit = await this.iso((t: { ref: string; key?: string }) => {
      const r = __j.find(t.ref, t.key);
      return r ? { again: r.again } : null;
    }, { ref: target.ref, key: target.semanticKey });
    if (!hit) return null;
    return { selector: `[data-jarvis-ref="${target.ref.replace(/["\\]/g, "\\$&")}"]`, reResolved: hit.again };
  }

  private async open(target: ElementTarget): Promise<ActResult> {
    const p = this.requirePage();
    const found = await this.locate(target);
    if (!found) return { status: "not_found", error: `element ${target.ref} not found` };
    const before = p.url();
    this.expectingPopup = true;
    try {
      await p.locator(found.selector).first().click();
      await p.waitForURL((u) => u.toString() !== before, { timeout: this.timeout }).catch(() => undefined);
      await p.waitForLoadState("domcontentloaded").catch(() => undefined);
      // Styles and layout in place before the next step measures or scrolls the page.
      await p.waitForLoadState("load", { timeout: Math.min(this.timeout, LOAD_WAIT_MS) }).catch(() => undefined);
    } finally {
      this.expectingPopup = false;
    }
    return { status: "done", reResolved: found.reResolved, data: { url: this.requirePage().url() } };
  }

  private async settleScroll(): Promise<number> {
    let last = await this.iso(() => window.scrollY);
    for (let i = 0; i < 20; i++) {
      await sleep(50);
      const y = await this.iso(() => window.scrollY);
      if (Math.abs(y - last) < 0.5) return y;
      last = y;
    }
    return last;
  }

  private async scroll(direction: "down" | "up", amount: string): Promise<ActResult> {
    const p = this.requirePage();
    await p.waitForLoadState("load", { timeout: Math.min(this.timeout, LOAD_WAIT_MS) }).catch(() => undefined);
    const { y, vh, max } = await this.iso(() => ({
      y: window.scrollY, vh: window.innerHeight, max: document.documentElement.scrollHeight - window.innerHeight,
    }));
    // Programmatic and instant: a synthetic wheel right after a navigation can be dropped before
    // the first frame, and a scroll that lands late would then count twice. Lazy lists still load
    // (IntersectionObserver sees any scroll).
    const top = amount === "end" ? max : amount === "start" ? 0
      : y + Math.round(vh * (amount === "little" ? 0.35 : amount === "more" ? 0.6 : 0.85)) * (direction === "down" ? 1 : -1);
    await this.iso((t: number) => window.scrollTo({ top: t, behavior: "instant" as ScrollBehavior }), Math.max(0, Math.min(max, top)));
    await this.settleScroll();
    return { status: "done", undo: { scrollY: y } };
  }

  private async scrollTo(y: number): Promise<ActResult> {
    await this.iso((top: number) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);
    await this.settleScroll();
    return { status: "done" };
  }

  /** Tag and describe the items of a list; comments via the YouTube skill, videos via links. */
  private async extract(itemKind: string): Promise<ElementInfo[]> {
    if (itemKind === "comment") {
      return this.iso(() => __j.threads().map((el, index) => {
        const text = el.querySelector("#content-text")?.textContent ?? "";
        const author = (el.querySelector("#author-text")?.textContent ?? "").trim();
        const id = __j.commentId(el);
        const ref = `yt-comment:${id}`;
        el.setAttribute("data-jarvis-ref", ref);
        return { ref, semanticKey: `comment:${id}`, kind: "comment", index, text, author, pinned: !!el.querySelector("#pinned-comment-badge") };
      }));
    }
    if (itemKind === "video") {
      return this.iso(() => {
        const seen = new Set<string>();
        const primary = Array.from(document.querySelectorAll<HTMLAnchorElement>("a#video-title, a#video-title-link"));
        const all = primary.length ? primary : Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/watch"]'));
        return all.filter((a) => { const h = a.getAttribute("href") || ""; if (!h || seen.has(h)) return false; seen.add(h); return true; })
          .map((a, index) => {
            const href = a.getAttribute("href") || "";
            const ref = `yt-video:${href}`;
            a.setAttribute("data-jarvis-ref", ref);
            return { ref, semanticKey: `video:${href}`, kind: "video", index, text: (a.textContent || "").trim(), href };
          });
      });
    }
    return [];
  }

  private async findCollection(itemKind: string, minItems: number, more: boolean, signal?: AbortSignal): Promise<ActResult> {
    const p = this.requirePage();
    const y0 = await this.iso(() => window.scrollY);
    if (itemKind === "comment") {
      const hasSection = await this.iso(() => !!document.querySelector("ytd-comments#comments, [role='region'][aria-label='Komentarze']"));
      if (!hasSection) return { status: "not_found", error: "no comments section on this page" };
      const count = () => this.iso(() => __j.threads().length);
      const start = await count();
      const want = more ? start + 1 : minItems;
      const deadline = Date.now() + this.timeout;
      for (let step = 0; step < 24 && Date.now() < deadline; step++) {
        if (signal?.aborted) throw new Aborted();
        const n = await count();
        if (n >= want) break;
        // Scroll the section (or its end, for continuation) into the lower part of the viewport.
        const { top, bottom, vh } = await this.iso(() => {
          const el = document.querySelector("ytd-comments#comments, [role='region'][aria-label='Komentarze']") as Element;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
        });
        const dy = more || n > 0 ? Math.max(120, Math.min(bottom - vh * 0.7, vh * 0.8)) : Math.max(120, Math.min(top - vh * 0.25, vh * 0.8));
        await p.mouse.move(640, Math.round(vh / 2));
        await p.mouse.wheel(0, dy);
        await this.settleScroll();
        await sleep(200);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 3000 && (await count()) === 0) await sleep(50);
    }
    const items = await this.extract(itemKind);
    return items.length
      ? { status: "done", data: { items }, undo: { scrollY: y0 } }
      : { status: "not_found", error: `no ${itemKind} items found` };
  }

  private async focus(target: ElementTarget): Promise<ActResult> {
    const p = this.requirePage();
    const found = await this.locate(target);
    if (!found) return { status: "not_found", error: `element ${target.ref} not found` };
    const y = await this.iso(() => window.scrollY);
    await this.iso((t: { ref: string; key?: string }) => { __j.find(t.ref, t.key)?.el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }); }, { ref: target.ref, key: target.semanticKey });
    await p.evaluate((t) => (window as unknown as { __jarvisOverlay?: { track: (r: string, k?: string) => void } }).__jarvisOverlay?.track(t.ref, t.key), { ref: target.ref, key: target.semanticKey });
    await this.settleScroll();
    await sleep(40);
    return { status: "done", reResolved: found.reResolved, undo: { scrollY: y } };
  }

  private async select(target: ElementTarget, start: number, end: number): Promise<ActResult> {
    const found = await this.locate(target);
    if (!found) return { status: "not_found", error: `element ${target.ref} not found` };
    const ok = await this.iso((a: { ref: string; key?: string; start: number; end: number }) => {
      const hit = __j.find(a.ref, a.key);
      if (!hit) return false;
      const el = hit.el;
      const root = el.querySelector("#content-text") ?? el;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let startNode: Text | null = null;
      let startOff = 0;
      let endNode: Text | null = null;
      let endOff = 0;
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const len = n.data.length;
        if (!startNode && a.start <= offset + len) { startNode = n; startOff = a.start - offset; }
        if (a.end <= offset + len) { endNode = n; endOff = a.end - offset; break; }
        offset += len;
      }
      if (!startNode || !endNode) return false;
      const r = document.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(endNode, endOff);
      const rect = r.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      const s = document.getSelection();
      if (!s) return false;
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }, { ref: target.ref, key: target.semanticKey, start, end });
    return ok ? { status: "done", reResolved: found.reResolved } : { status: "failed", error: "text offsets outside the element" };
  }

  private async copy(expected: string, reselect?: { target: ElementTarget; start: number; end: number }): Promise<ActResult> {
    const p = this.requirePage();
    const current = await this.iso(() => String(document.getSelection() || ""));
    let reselected = false;
    if (current !== expected && reselect) {
      // The selection was lost (e.g. the list re-rendered): restore it before copying.
      const r = await this.select(reselect.target, reselect.start, reselect.end);
      if (r.status !== "done") return r;
      reselected = true;
    }
    await p.keyboard.press("ControlOrMeta+C");
    await sleep(30);
    return { status: "done", data: { reselected } };
  }

  // ---------------------------------------------------------------- read-backs (isolated world)

  async read(q: ReadQuery): Promise<ReadResult> {
    if (!this.page || this.page.isClosed()) {
      if (q.kind === "page") return { open: false } satisfies PageRead;
      if (q.kind === "selection") return { text: "", visible: false } satisfies SelectionRead;
      if (q.kind === "clipboard") return { ok: false, error: "browser is not running" } satisfies ClipboardRead;
      if (q.kind === "element") return { found: false } satisfies ElementRead;
      return { count: 0, items: [] } satisfies CollectionRead;
    }
    switch (q.kind) {
      case "page": {
        const info = await this.iso(() => ({
          url: location.href,
          title: document.title,
          scrollY: window.scrollY,
          viewportHeight: window.innerHeight,
          documentHeight: document.documentElement.scrollHeight,
          consentWall: !!document.querySelector("#consent, [aria-labelledby='consent-title']")
            || Array.from(document.querySelectorAll("button")).some((b) => /^(Odrzuć wszystko|Reject all)$/i.test((b.textContent || "").trim())),
        }));
        return { open: true, pageId: this.pageId, ...info } satisfies PageRead;
      }
      case "selection":
        return this.iso(() => {
          const s = document.getSelection();
          const text = String(s || "");
          if (!s || !s.rangeCount || !text) return { text, visible: false };
          const range = s.getRangeAt(0);
          const r = range.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
          const node = range.commonAncestorContainer;
          const el = (node.nodeType === 1 ? node as Element : node.parentElement)?.closest("ytd-comment-thread-renderer, [data-jarvis-ref]");
          const ref = el ? (el.matches("ytd-comment-thread-renderer") ? `yt-comment:${__j.commentId(el)}` : el.getAttribute("data-jarvis-ref") ?? undefined) : undefined;
          return { text, visible, ref };
        }) as Promise<SelectionRead>;
      case "clipboard":
        try {
          const text = this.opts.readClipboard ? await this.opts.readClipboard() : await this.iso(() => navigator.clipboard.readText());
          return { ok: true, text } satisfies ClipboardRead;
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) } satisfies ClipboardRead;
        }
      case "element": {
        const found = await this.locate(q.target);
        if (!found) return { found: false } satisfies ElementRead;
        const info = await this.iso((t: { ref: string; key?: string }) => {
          const hit = __j.find(t.ref, t.key);
          if (!hit) return null;
          const r = hit.el.getBoundingClientRect();
          const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
          const box = document.getElementById("jarvis-overlay");
          const o = box && box.style.display !== "none" ? box.getBoundingClientRect() : null;
          const highlighted = !!o && Math.abs(o.top + 4 - r.top) < 6 && Math.abs(o.left + 4 - r.left) < 6;
          return { inViewport, highlighted, text: hit.el.querySelector("#content-text")?.textContent ?? hit.el.textContent ?? "" };
        }, { ref: q.target.ref, key: q.target.semanticKey });
        return info ? ({ found: true, reResolved: found.reResolved, ...info } satisfies ElementRead) : ({ found: false } satisfies ElementRead);
      }
      case "collection": {
        const items = await this.extract(q.itemKind);
        return { count: items.length, items } satisfies CollectionRead;
      }
    }
  }

  async snapshot(maxChars = 4000): Promise<string> {
    if (!this.page || this.page.isClosed()) return "";
    const snap = await this.page.locator("body").ariaSnapshot({ mode: "ai", boxes: false, timeout: 3000 }).catch(() => "");
    return snap.length > maxChars ? `${snap.slice(0, maxChars)}\n…` : snap;
  }
}
