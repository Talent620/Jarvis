// ManagedBrowser environment (mission 5.6): Playwright driving a dedicated JARVIS browser
// profile (never the user's own profile or logins). Node only: runs in the Electron main
// process behind IPC, and directly in tests and the acceptance CLI.
//
// Perception is event driven (navigation, list mutations, scroll, selection) through an
// exposed binding; nothing polls screenshots. Elements carry data-jarvis-ref and a semantic
// key, so after a framework re-render the target is found again instead of used blindly.

import { existsSync } from "node:fs";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
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
}

class Aborted extends Error {
  constructor() { super("aborted"); this.name = "AbortError"; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMMENT_THREAD = "ytd-comment-thread-renderer";
const VIDEO_LINKS = "a#video-title, a#video-title-link";
const CONSENT_REJECT = /^(Odrzuć wszystko|Reject all)$/i;
const CONSENT_ACCEPT = /^(Zaakceptuj wszystko|Accept all)$/i;

/** In-page perception and overlay, installed in every document before any page script runs. */
function initScript(): void {
  const w = window as unknown as {
    __jarvisEmit?: (payload: unknown) => void;
    __jarvisOverlay?: { track: (selector: string) => void; clear: () => void; rect: () => DOMRect | null };
  };
  const emit = (payload: unknown) => { try { w.__jarvisEmit?.(payload); } catch { /* binding not ready */ } };

  let signature = "";
  let pending = false;
  const listSignature = () => Array.from(document.querySelectorAll("[data-comment-id]"))
    .filter((e) => !e.parentElement?.closest("[data-comment-id]"))
    .map((e) => e.getAttribute("data-comment-id")).join(",");
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
  const start = () => {
    signature = listSignature();
    new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" && Array.from(r.removedNodes).concat(Array.from(r.addedNodes)).some((n) => n instanceof Element && (n.matches("[data-comment-id]") || !!n.querySelector?.("[data-comment-id]"))))) onMutation();
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("scroll", () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; emit({ type: "scroll", scrollY: window.scrollY }); }, 150);
  }, { passive: true });
  document.addEventListener("selectionchange", () => emit({ type: "selection", text: String(document.getSelection() || "") }));

  // Overlay: a fixed box that follows the target through scrolls and re-renders.
  let selector: string | null = null;
  let box: HTMLDivElement | null = null;
  const place = () => {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!box) {
      box = document.createElement("div");
      box.id = "jarvis-overlay";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #28c0c8;border-radius:8px;box-shadow:0 0 0 4px rgba(40,192,200,.25)";
      document.documentElement.appendChild(box);
    }
    if (!el) { box.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${r.left - 4}px`;
    box.style.top = `${r.top - 4}px`;
    box.style.width = `${r.width + 8}px`;
    box.style.height = `${r.height + 8}px`;
  };
  const loop = () => { place(); if (selector) requestAnimationFrame(loop); };
  w.__jarvisOverlay = {
    track: (sel: string) => { const was = selector; selector = sel; if (!was) requestAnimationFrame(loop); place(); },
    clear: () => { selector = null; if (box) box.style.display = "none"; },
    rect: () => (box && box.style.display !== "none" ? box.getBoundingClientRect() : null),
  };
}

/** Semantic key -> CSS selector that finds the element again after a re-render. */
export function semanticSelector(semanticKey: string | undefined): string | null {
  if (!semanticKey) return null;
  const esc = (s: string) => s.replace(/["\\]/g, "\\$&");
  if (semanticKey.startsWith("comment:")) return `[data-comment-id="${esc(semanticKey.slice(8))}"]`;
  if (semanticKey.startsWith("video:")) return `a[href="${esc(semanticKey.slice(6))}"]`;
  return null;
}

export class ManagedBrowser implements ComputerEnvironment {
  readonly id = "managed-browser";
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private listeners = new Set<(e: EnvEvent) => void>();
  private pageSeq = 0;
  private pageId = "";
  private lastUrl = "";
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
    const exe = this.opts.executablePath ?? chromium.executablePath();
    const present = !!exe && existsSync(exe);
    return [{
      id: "browser.managed.semantic",
      status: present ? "available" : "missing",
      provider: "playwright-chromium",
      detail: present ? (this.context ? "running" : "ready to launch") : `no browser at ${exe}`,
      checkedAt: now,
    }];
  }

  async close(): Promise<void> {
    const c = this.context;
    this.context = null;
    this.page = null;
    if (c) await c.close().catch(() => undefined);
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
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ctx.exposeBinding("__jarvisEmit", (source, payload) => this.onPageEvent(source.page, payload as Record<string, unknown>));
    await ctx.addInitScript(initScript);
    ctx.on("close", () => { this.context = null; this.page = null; this.emit({ type: "closed" }); });
    this.context = ctx;
    this.attach(ctx.pages()[0] ?? await ctx.newPage());
    ctx.on("page", (p) => this.attach(p)); // a new tab takes the focus, like a user would expect
    return { status: "done" };
  }

  private attach(p: Page): void {
    this.page = p;
    p.on("framenavigated", (frame) => {
      if (frame !== p.mainFrame() || p !== this.page) return;
      const url = frame.url();
      if (url === this.lastUrl) return;
      this.lastUrl = url;
      this.pageId = `page-${++this.pageSeq}`;
      void p.title().catch(() => "").then((title) => this.emit({ type: "navigation", pageId: this.pageId, url, title }));
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

  private async locate(target: ElementTarget): Promise<{ loc: Locator; reResolved: boolean } | null> {
    const p = this.requirePage();
    const byRef = p.locator(`[data-jarvis-ref="${target.ref.replace(/["\\]/g, "\\$&")}"]`);
    if (await byRef.count() === 1) return { loc: byRef, reResolved: false };
    const sel = semanticSelector(target.semanticKey);
    if (!sel) return null;
    const bySemantic = p.locator(sel);
    if (await bySemantic.count() !== 1) return null;
    await bySemantic.evaluate((el, ref) => el.setAttribute("data-jarvis-ref", ref), target.ref);
    return { loc: bySemantic, reResolved: true };
  }

  private async open(target: ElementTarget): Promise<ActResult> {
    const p = this.requirePage();
    const found = await this.locate(target);
    if (!found) return { status: "not_found", error: `element ${target.ref} not found` };
    const before = p.url();
    await found.loc.click();
    await p.waitForURL((u) => u.toString() !== before, { timeout: this.timeout }).catch(() => undefined);
    await p.waitForLoadState("domcontentloaded").catch(() => undefined);
    return { status: "done", reResolved: found.reResolved, data: { url: p.url() } };
  }

  private async settleScroll(p: Page): Promise<number> {
    let last = await p.evaluate(() => window.scrollY);
    for (let i = 0; i < 20; i++) {
      await sleep(50);
      const y = await p.evaluate(() => window.scrollY);
      if (Math.abs(y - last) < 0.5) return y;
      last = y;
    }
    return last;
  }

  private async scroll(direction: "down" | "up", amount: string): Promise<ActResult> {
    const p = this.requirePage();
    const { y, vh, max } = await p.evaluate(() => ({
      y: window.scrollY, vh: window.innerHeight, max: document.documentElement.scrollHeight - window.innerHeight,
    }));
    if (amount === "end" || amount === "start") {
      await p.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), amount === "end" ? max : 0);
    } else {
      const factor = amount === "little" ? 0.35 : amount === "more" ? 0.6 : 0.85;
      const dy = Math.round(vh * factor) * (direction === "down" ? 1 : -1);
      await p.mouse.move(Math.round((this.opts.viewport?.width ?? 1280) / 2), Math.round(vh / 2));
      await p.mouse.wheel(0, dy);
    }
    await this.settleScroll(p);
    return { status: "done", undo: { scrollY: y } };
  }

  private async scrollTo(y: number): Promise<ActResult> {
    const p = this.requirePage();
    await p.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);
    await this.settleScroll(p);
    return { status: "done" };
  }

  /** Tag and describe the items of a list; comments via the YouTube skill, videos via links. */
  private async extract(itemKind: string): Promise<ElementInfo[]> {
    const p = this.requirePage();
    if (itemKind === "comment") {
      return p.evaluate((threadSel) => {
        const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); };
        return Array.from(document.querySelectorAll(threadSel)).map((el, index) => {
          const text = el.querySelector("#content-text")?.textContent ?? "";
          const author = (el.querySelector("#author-text")?.textContent ?? "").trim();
          const id = el.getAttribute("data-comment-id") || `h${hash(author + "\n" + text)}`;
          const ref = `yt-comment:${id}`;
          el.setAttribute("data-jarvis-ref", ref);
          return { ref, semanticKey: `comment:${id}`, kind: "comment", index, text, author, pinned: !!el.querySelector("#pinned-comment-badge") };
        });
      }, COMMENT_THREAD);
    }
    if (itemKind === "video") {
      return p.evaluate((sel) => {
        const seen = new Set<string>();
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(sel));
        const all = links.length ? links : Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/watch"]'));
        return all.filter((a) => { const h = a.getAttribute("href") || ""; if (!h || seen.has(h)) return false; seen.add(h); return true; })
          .map((a, index) => {
            const href = a.getAttribute("href") || "";
            const ref = `yt-video:${href}`;
            a.setAttribute("data-jarvis-ref", ref);
            return { ref, semanticKey: `video:${href}`, kind: "video", index, text: (a.textContent || "").trim(), href };
          });
      }, VIDEO_LINKS);
    }
    return [];
  }

  private async findCollection(itemKind: string, minItems: number, more: boolean, signal?: AbortSignal): Promise<ActResult> {
    const p = this.requirePage();
    const y0 = await p.evaluate(() => window.scrollY);
    if (itemKind === "comment") {
      const section = p.locator("ytd-comments#comments, [role='region'][aria-label='Komentarze']").first();
      if (await section.count() === 0) return { status: "not_found", error: "no comments section on this page" };
      const threads = p.locator(COMMENT_THREAD);
      const start = await threads.count();
      const want = more ? start + 1 : minItems;
      const deadline = Date.now() + this.timeout;
      for (let step = 0; step < 24 && Date.now() < deadline; step++) {
        if (signal?.aborted) throw new Aborted();
        const n = await threads.count();
        if (n >= want) break;
        // Scroll the section (or its end, for continuation) into the lower part of the viewport.
        const { top, bottom, vh } = await section.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
        });
        const dy = more || n > 0 ? Math.max(120, Math.min(bottom - vh * 0.7, vh * 0.8)) : Math.max(120, Math.min(top - vh * 0.25, vh * 0.8));
        await p.mouse.move(640, Math.round(vh / 2));
        await p.mouse.wheel(0, dy);
        await this.settleScroll(p);
        await sleep(200);
      }
      // Wait for the pending page of comments, if any, then describe what is on screen.
      await p.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, COMMENT_THREAD, { timeout: 3000 }).catch(() => undefined);
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
    const y = await p.evaluate(() => window.scrollY);
    await found.loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }));
    const sel = semanticSelector(target.semanticKey) ?? `[data-jarvis-ref="${target.ref.replace(/["\\]/g, "\\$&")}"]`;
    await p.evaluate((s) => (window as unknown as { __jarvisOverlay?: { track: (x: string) => void } }).__jarvisOverlay?.track(s), sel);
    await this.settleScroll(p);
    await sleep(40);
    return { status: "done", reResolved: found.reResolved, undo: { scrollY: y } };
  }

  private async select(target: ElementTarget, start: number, end: number): Promise<ActResult> {
    const found = await this.locate(target);
    if (!found) return { status: "not_found", error: `element ${target.ref} not found` };
    const ok = await found.loc.evaluate((el, range) => {
      const root = el.querySelector("#content-text") ?? el;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let startNode: Text | null = null;
      let startOff = 0;
      let endNode: Text | null = null;
      let endOff = 0;
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const len = n.data.length;
        if (!startNode && range.start <= offset + len) { startNode = n; startOff = range.start - offset; }
        if (range.end <= offset + len) { endNode = n; endOff = range.end - offset; break; }
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
    }, { start, end });
    return ok ? { status: "done", reResolved: found.reResolved } : { status: "failed", error: "text offsets outside the element" };
  }

  private async copy(expected: string, reselect?: { target: ElementTarget; start: number; end: number }): Promise<ActResult> {
    const p = this.requirePage();
    const current = await p.evaluate(() => String(document.getSelection() || ""));
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

  // ---------------------------------------------------------------- read-backs

  async read(q: ReadQuery): Promise<ReadResult> {
    if (!this.page || this.page.isClosed()) {
      if (q.kind === "page") return { open: false } satisfies PageRead;
      if (q.kind === "selection") return { text: "", visible: false } satisfies SelectionRead;
      if (q.kind === "clipboard") return { ok: false, error: "browser is not running" } satisfies ClipboardRead;
      if (q.kind === "element") return { found: false } satisfies ElementRead;
      return { count: 0, items: [] } satisfies CollectionRead;
    }
    const p = this.page;
    switch (q.kind) {
      case "page": {
        const info = await p.evaluate(() => ({
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
        return p.evaluate(() => {
          const s = document.getSelection();
          const text = String(s || "");
          if (!s || !s.rangeCount || !text) return { text, visible: false };
          const range = s.getRangeAt(0);
          const r = range.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
          const node = range.commonAncestorContainer;
          const el = (node.nodeType === 1 ? node as Element : node.parentElement)?.closest("[data-jarvis-ref], [data-comment-id]");
          const ref = el?.getAttribute("data-jarvis-ref") || (el?.getAttribute("data-comment-id") ? `yt-comment:${el.getAttribute("data-comment-id")}` : undefined);
          return { text, visible, ref };
        }) as Promise<SelectionRead>;
      case "clipboard":
        try {
          const text = await p.evaluate(() => navigator.clipboard.readText());
          return { ok: true, text } satisfies ClipboardRead;
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) } satisfies ClipboardRead;
        }
      case "element": {
        const found = await this.locate(q.target);
        if (!found) return { found: false } satisfies ElementRead;
        const info = await found.loc.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
          const o = (window as unknown as { __jarvisOverlay?: { rect: () => DOMRect | null } }).__jarvisOverlay?.rect() ?? null;
          const highlighted = !!o && Math.abs(o.top + 4 - r.top) < 6 && Math.abs(o.left + 4 - r.left) < 6;
          return { inViewport, highlighted, text: el.querySelector("#content-text")?.textContent ?? el.textContent ?? "" };
        });
        return { found: true, reResolved: found.reResolved, ...info } satisfies ElementRead;
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
