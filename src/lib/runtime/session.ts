// Action session (mission 5.2 ACTION lane, M2 slice): turns a final utterance into a task of
// verified micro-actions on a ComputerEnvironment, keeping perception, referents and the
// clipboard in the kernel. The same code runs against the YouTube fixture in tests and the
// real managed browser in production; there is no separate demo engine.

import { decidePolicy, type ActionClass, type Policy } from "../permissionClasses";
import { performAction, type PerformResult } from "./actions";
import { instructionEmails, pickCandidate, resolveContact, type Contact } from "./contacts";
import { mailIdempotencyKey, sendExactlyOnce, type MailService, type SendOptions } from "./mail";
import { isUntrusted, type Provenance } from "./provenance";
import { parseCommand, type Command } from "./commands";
import type { ClipboardRead, ComputerEnvironment, ElementInfo, ElementTarget, EnvAction, EnvEvent, PageRead, ScrollAmount } from "./env/types";
import type { Kernel } from "./kernel";
import { TaskAbortedError } from "./kernel";
import type { RefQuery } from "./polish";
import { resolveReference, type Resolution } from "./resolve";
import { spanFor } from "./text";
import { isPrecondition, type Truth } from "./truth";
import type { Referent } from "./types";
import { fnv1a64, preview } from "./util";

export interface SessionOptions {
  /** Where "wejdź na YouTube" goes (the fixture URL in tests). */
  youtubeUrl?: string;
  consentChoice?: "reject" | "accept";
  now?: () => number;
  /** Mail service with a Sent read-back (Gmail in the app, a mock in tests). */
  mail?: MailService;
  mailOptions?: SendOptions;
  /** Address book for recipients named in the instruction. */
  contacts?: () => Promise<Contact[]>;
  /** User permission policies per action class (settings). */
  policies?: Partial<Record<ActionClass, Policy>>;
  /** Spoken while a task waits for the user (consent, "który Marcin?"). */
  onQuestion?: (text: string) => void;
  /** How long a task waits for consent or an answer before giving up. */
  answerTimeoutMs?: number;
}

export interface TurnResult {
  command: Command["type"];
  truth: Truth;
  /** Short Polish sentence for TTS / chat. */
  say: string;
  evidence?: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

const ORDINAL_WORDS = ["pierwszy", "drugi", "trzeci", "czwarty", "piąty", "szósty", "siódmy", "ósmy", "dziewiąty", "dziesiąty"];
const ordinalWord = (n: number) => ORDINAL_WORDS[n - 1] ?? `${n}.`;

export class ActionSession {
  private unsubscribe: (() => void) | null = null;
  private selSeq = 0;
  private readonly now: () => number;

  constructor(readonly kernel: Kernel, readonly env: ComputerEnvironment, private readonly opts: SessionOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Probe capabilities and start mirroring environment perception into the kernel. */
  async start(): Promise<void> {
    const mailCaps = this.opts.mail ? await this.opts.mail.capabilities().catch(() => []) : [];
    this.kernel.dispatch({ type: "CapabilitiesUpdated", capabilities: [...(await this.env.capabilities()), ...mailCaps] });
    this.unsubscribe?.();
    this.unsubscribe = this.env.onEvent(this.onEnvEvent);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onEnvEvent = (e: EnvEvent): void => {
    const k = this.kernel;
    const page = k.state.page;
    switch (e.type) {
      case "navigation":
        if (page?.id === e.pageId) return; // already synchronized by the action itself
        k.dispatch({ type: "ObservationReceived", env: this.env.id, kind: "navigation", page: { id: e.pageId, url: e.url, title: e.title, scrollY: 0 } });
        return;
      case "dom":
        k.dispatch({ type: "ObservationReceived", env: this.env.id, kind: e.change === "major" ? "dom_major" : "dom_minor", scope: e.pageId, detail: { change: e.change } });
        return;
      case "scroll":
        if (page && page.id === e.pageId) k.dispatch({ type: "ObservationReceived", env: this.env.id, kind: "scroll", page: { id: page.id, url: page.url, title: page.title, scrollY: e.scrollY } });
        return;
      case "selection":
        k.dispatch({ type: "ObservationReceived", env: this.env.id, kind: "selection", scope: e.pageId, detail: { text: preview(e.text, 80) } });
        return;
      case "closed":
        k.dispatch({ type: "ObservationReceived", env: this.env.id, kind: "navigation", page: { id: "closed", url: "about:closed", title: "" } });
        return;
    }
  };

  // ---------------------------------------------------------------- helpers

  private act(taskId: string, action: EnvAction, stepId?: string): Promise<PerformResult> {
    return performAction({ kernel: this.kernel, env: this.env, now: this.now }, { taskId, action, stepId });
  }

  /** Make sure the kernel knows the page the environment is on (navigation events are async). */
  private async syncPage(): Promise<PageRead> {
    const p = (await this.env.read({ kind: "page" })) as PageRead;
    if (p.open && p.pageId && this.kernel.state.page?.id !== p.pageId) {
      this.kernel.dispatch({
        type: "ObservationReceived", env: this.env.id, kind: "navigation",
        page: { id: p.pageId, url: p.url ?? "", title: p.title ?? "", scrollY: p.scrollY },
      });
    }
    return p;
  }

  private targetOf(r: Referent): ElementTarget {
    return { ref: String(r.metadata.envRef ?? r.id), semanticKey: r.semanticKey, kind: typeof r.metadata.kind === "string" ? r.metadata.kind : undefined };
  }

  /** Register environment items as Element referents plus one Collection (cursor kept on re-read). */
  private registerCollection(itemKind: string, items: ElementInfo[]): string {
    const k = this.kernel;
    const pageId = k.state.page?.id ?? "page";
    const ids = items.map((it) => `${pageId}/${it.ref}`);
    items.forEach((it, i) => {
      const id = ids[i];
      const existing = k.state.referents.byId[id];
      if (existing?.valid && existing.metadata.text === it.text) return;
      k.dispatch({
        type: "ReferentAdded",
        referent: {
          id, type: "Element", source: this.env.id, scope: pageId, semanticKey: it.semanticKey, confidence: 1, salience: 0.5,
          metadata: { kind: it.kind, text: it.text, author: it.author, pinned: it.pinned, href: it.href, envRef: it.ref, index: it.index },
          provenance: "UNTRUSTED_WEB",
        },
      });
    });
    const collectionId = `${pageId}/collection:${itemKind}`;
    const existing = k.state.referents.byId[collectionId];
    const oldMeta = k.state.referents.collections[collectionId];
    // Semantic key of the item the user was on, to keep the focus across a re-read.
    const focusedKey = oldMeta && oldMeta.cursor >= 0 ? k.state.referents.byId[oldMeta.items[oldMeta.cursor]]?.semanticKey : undefined;
    if (existing?.valid && oldMeta) {
      k.dispatch({ type: "CollectionUpdated", collectionId, items: ids });
    } else {
      k.dispatch({
        type: "ReferentAdded",
        referent: { id: collectionId, type: "Collection", source: this.env.id, scope: pageId, semanticKey: `collection:${itemKind}`, confidence: 1, salience: 0.8, metadata: { kind: itemKind } },
        items: ids,
        itemKind,
      });
      const again = focusedKey ? items.findIndex((it) => it.semanticKey === focusedKey) : -1;
      if (again >= 0) k.dispatch({ type: "CollectionCursorMoved", collectionId, cursor: again });
    }
    return collectionId;
  }

  private async collect(taskId: string, itemKind: string, more: boolean, stepId: string): Promise<PerformResult> {
    const r = await this.act(taskId, { kind: "browser.findCollection", itemKind, minItems: 1, more }, stepId);
    const items = (r.result?.data?.items ?? []) as ElementInfo[];
    if (r.truth === "CONFIRMED" && items.length) this.registerCollection(itemKind, items);
    return r;
  }

  private dispatchAll(res: Resolution): void {
    for (const e of res.events) this.kernel.dispatch(e);
  }

  private async runTask(goal: string, command: Command, fn: (taskId: string) => Promise<Omit<TurnResult, "command" | "taskId">>, amendTaskId?: string): Promise<TurnResult> {
    const k = this.kernel;
    const amend = amendTaskId ? k.state.tasks[amendTaskId] : undefined;
    let taskId: string;
    if (amend && (amend.status === "done" || amend.status === "running" || amend.status === "paused")) {
      // "nie ten, następny" refines the current goal instead of starting a new one.
      taskId = amend.id;
      k.dispatch({ type: "TaskAmended", taskId, change: goal });
    } else {
      taskId = k.id("task");
      k.dispatch({ type: "TaskCreated", taskId, goal, kind: command.type });
    }
    try {
      const r = await fn(taskId);
      const status = r.truth === "CONFIRMED" ? "done" : isPrecondition(r.truth) ? "blocked" : "failed";
      if (k.state.tasks[taskId]?.status === "cancelled") return { ...r, command: command.type, taskId, truth: "FAILED", say: "Przerwałem." };
      k.dispatch({ type: "TaskStatusChanged", taskId, status, reason: r.evidence ?? r.say });
      return { ...r, command: command.type, taskId };
    } catch (e) {
      if (e instanceof TaskAbortedError || k.state.tasks[taskId]?.status === "cancelled") return { command: command.type, taskId, truth: "FAILED", say: "Przerwałem." };
      k.dispatch({ type: "TaskStatusChanged", taskId, status: "failed", reason: e instanceof Error ? e.message : String(e) });
      return { command: command.type, taskId, truth: "FAILED", say: "Coś poszło nie tak, nie udało się." };
    }
  }

  private failSay(r: PerformResult, what: string): string {
    if (r.truth === "NEEDS_PERMISSION") return `${what}: potrzebuję uprawnienia.`;
    if (r.truth === "NEEDS_CAPABILITY" || r.truth === "NEEDS_HARDWARE") return `${what}: nie mam do tego narzędzia na tym komputerze.`;
    if (r.reason === "cancelled") return "Przerwałem.";
    return `${what}: nie udało się (${r.reason ?? "brak potwierdzenia"}).`;
  }

  // ---------------------------------------------------------------- commands

  async handle(text: string, opts: { amendTaskId?: string; command?: Command } = {}): Promise<TurnResult> {
    const cmd = opts.command ?? parseCommand(text);
    if (opts.amendTaskId && cmd.type === "focusItem") return this.runTask(text, cmd, (t) => this.focusItem(t, cmd.query), opts.amendTaskId);
    switch (cmd.type) {
      case "browser.launch": return this.runTask(text, cmd, (t) => this.launch(t));
      case "browser.gotoSite": return this.runTask(text, cmd, (t) => this.gotoYoutube(t, cmd.openFirst));
      case "browser.openItem": return this.runTask(text, cmd, (t) => this.openItem(t, cmd.query));
      case "scroll": return this.runTask(text, cmd, (t) => this.scroll(t, cmd.direction, cmd.amount));
      case "findCollection": return this.runTask(text, cmd, (t) => this.find(t, cmd.itemKind, cmd.more));
      case "focusItem": return this.runTask(text, cmd, (t) => this.focusItem(t, cmd.query));
      case "selectText": return this.runTask(text, cmd, (t) => this.selectText(t, cmd.query));
      case "copy": return this.runTask(text, cmd, (t) => this.copy(t, cmd.query));
      case "send": return this.runTask(text, cmd, (t) => this.send(t, text, cmd.query));
      default: return { command: "unknown", truth: "BLOCKED", say: "Nie wiem, co mam zrobić." };
    }
  }

  /** Reverse the most recent reversible action (scroll position), confirmed by read-back. */
  async undo(): Promise<TurnResult> {
    const k = this.kernel;
    const records = Object.values(k.state.tasks)
      .flatMap((t) => t.undo.map((u) => ({ u, at: k.state.actions[u.actionId]?.endedAt ?? 0 })))
      .filter(({ u }) => !this.undone.has(u.actionId) && u.data.pageId === k.state.page?.id)
      .sort((a, b) => b.at - a.at);
    const last = records[0]?.u;
    const command: Command = { type: "unknown", text: "cofnij" };
    if (!last || typeof last.data.scrollY !== "number") {
      return { command: command.type, truth: "BLOCKED", say: "Nie mam czego bezpiecznie cofnąć." };
    }
    return this.runTask("cofnij", command, async (taskId) => {
      const r = await this.act(taskId, { kind: "browser.scrollTo", y: last.data.scrollY as number }, "undo");
      if (r.truth === "CONFIRMED") this.undone.add(last.actionId);
      return r.truth === "CONFIRMED"
        ? { truth: r.truth, say: "Cofnięte.", evidence: r.evidence }
        : { truth: r.truth, say: this.failSay(r, "Cofanie"), evidence: r.reason };
    });
  }

  private undone = new Set<string>();

  private async launch(taskId: string) {
    const r = await this.act(taskId, { kind: "browser.launch" }, "launch");
    if (r.truth !== "CONFIRMED") return { truth: r.truth, say: this.failSay(r, "Przeglądarka"), evidence: r.reason };
    const k = this.kernel;
    if (!k.state.referents.byId["browser:window"]?.valid) {
      k.dispatch({ type: "ReferentAdded", referent: { id: "browser:window", type: "Window", source: this.env.id, semanticKey: "window:managed-browser", confidence: 1, salience: 0.4, metadata: { app: "JARVIS browser" } } });
      k.dispatch({ type: "ReferentAdded", referent: { id: "browser:tab", type: "Tab", source: this.env.id, parent: "browser:window", semanticKey: "tab:managed-browser", confidence: 1, salience: 0.4, metadata: {} } });
      k.dispatch({ type: "WindowFocused", windowId: "browser:window", app: "JARVIS browser", title: "JARVIS" });
    }
    await this.syncPage();
    return { truth: r.truth, say: "Już. Przeglądarka jest otwarta.", evidence: r.evidence };
  }

  private async gotoYoutube(taskId: string, openFirst: boolean) {
    const page = (await this.env.read({ kind: "page" })) as PageRead;
    if (!page.open) {
      const l = await this.launch(taskId);
      if (l.truth !== "CONFIRMED") return l;
    }
    const url = this.opts.youtubeUrl ?? "https://www.youtube.com/";
    const nav = await this.act(taskId, { kind: "browser.navigate", url }, "navigate");
    if (nav.truth !== "CONFIRMED") return { truth: nav.truth, say: this.failSay(nav, "YouTube"), evidence: nav.reason };
    let p = await this.syncPage();
    let consentNote = "";
    if (p.consentWall) {
      const choice = this.opts.consentChoice ?? "reject";
      const c = await this.act(taskId, { kind: "browser.consent", choice }, "consent");
      if (c.truth !== "CONFIRMED") return { truth: c.truth, say: this.failSay(c, "Ekran zgody"), evidence: c.reason };
      p = await this.syncPage();
      consentNote = choice === "reject" ? " Odrzuciłem dodatkowe ciasteczka." : " Zaakceptowałem ciasteczka.";
    }
    if (openFirst) {
      const o = await this.openItem(taskId, { ordinal: 1, noun: "video" });
      return { ...o, say: `Jestem na YouTube.${consentNote} ${o.say}` };
    }
    return { truth: "CONFIRMED" as Truth, say: `Jestem na YouTube.${consentNote}`, evidence: `${nav.evidence}; ${p.url}` };
  }

  private async openItem(taskId: string, query: RefQuery) {
    const found = await this.collect(taskId, "video", false, "find-videos");
    if (found.truth !== "CONFIRMED") return { truth: found.truth, say: this.failSay(found, "Lista filmów"), evidence: found.reason };
    const res = resolveReference(this.kernel.state, { query: { ...query, noun: "video" } });
    if (res.status !== "resolved") return { truth: "BLOCKED" as Truth, say: "Nie widzę takiego filmu.", evidence: res.status };
    this.dispatchAll(res);
    const o = await this.act(taskId, { kind: "browser.open", target: this.targetOf(res.referent) }, "open-video");
    if (o.truth !== "CONFIRMED") return { truth: o.truth, say: this.failSay(o, "Film"), evidence: o.reason };
    await this.syncPage();
    return { truth: o.truth, say: `Otwieram: ${preview(String(res.referent.metadata.text ?? "film"), 60)}.`, evidence: o.evidence };
  }

  private async scroll(taskId: string, direction: "down" | "up", amount: ScrollAmount) {
    const r = await this.act(taskId, { kind: "browser.scroll", direction, amount }, "scroll");
    if (r.truth === "CONFIRMED") return { truth: r.truth, say: "Już.", evidence: r.evidence };
    if (r.truth === "BLOCKED") return { truth: r.truth, say: direction === "down" ? "Jesteśmy już na dole strony." : "Jesteśmy już na górze strony.", evidence: r.reason };
    return { truth: r.truth, say: this.failSay(r, "Przewijanie"), evidence: r.reason };
  }

  private async find(taskId: string, itemKind: "comment" | "video", more: boolean) {
    const r = await this.collect(taskId, itemKind, more, "find");
    if (r.truth !== "CONFIRMED") {
      return { truth: r.truth, say: itemKind === "comment" ? "Nie znalazłem komentarzy." : "Nie znalazłem filmów.", evidence: r.reason };
    }
    const n = ((r.result?.data?.items ?? []) as ElementInfo[]).length;
    return { truth: r.truth, say: itemKind === "comment" ? `Mam komentarze, widzę ${n}.` : `Widzę ${n} filmów.`, evidence: r.evidence, data: { count: n } };
  }

  /** Resolve an item reference, loading more items or re-reading the list when needed. */
  private async resolveItem(taskId: string, query: RefQuery, verb?: "select" | "copy"): Promise<Resolution> {
    const kind = "comment";
    let res = resolveReference(this.kernel.state, { query, verb });
    for (let round = 0; round < 3; round++) {
      if (res.status === "resolved" || res.status === "ambiguous") return res;
      const needList = res.status === "stale" || (res.status === "none" && (res.reason === "no_collection" || res.needMore));
      if (!needList) return res;
      const more = res.status === "none" && !!res.needMore && res.reason !== "no_collection";
      const r = await this.collect(taskId, kind, more, `load-${round}`);
      if (r.truth !== "CONFIRMED") return res;
      res = resolveReference(this.kernel.state, { query, verb });
    }
    return res;
  }

  private async focusItem(taskId: string, query: RefQuery) {
    const res = await this.resolveItem(taskId, query);
    if (res.status !== "resolved") {
      const say = res.status === "none" && (res.reason === "end_of_collection" || res.reason === "out_of_range") ? "Nie ma więcej komentarzy." : "Nie wiem, o który chodzi.";
      return { truth: "BLOCKED" as Truth, say, evidence: res.status };
    }
    this.dispatchAll(res);
    const r = await this.act(taskId, { kind: "browser.focus", target: this.targetOf(res.referent) }, "focus");
    if (r.truth !== "CONFIRMED") return { truth: r.truth, say: this.failSay(r, "Komentarz"), evidence: r.reason };
    const m = res.referent.metadata;
    const pos = res.cursor !== undefined ? ordinalWord(res.cursor + 1) : "ten";
    const pinned = m.pinned ? " (przypięty)" : "";
    return { truth: r.truth, say: `${pos[0].toUpperCase()}${pos.slice(1)} komentarz${pinned}, od ${m.author}: „${preview(String(m.text ?? ""), 80)}”.`, evidence: r.evidence, data: { referentId: res.referent.id } };
  }

  private async selectText(taskId: string, query: RefQuery) {
    const res = await this.resolveItem(taskId, query, "select");
    if (res.status !== "resolved" || !res.range) return { truth: "BLOCKED" as Truth, say: "Nie wiem, w którym tekście zaznaczyć.", evidence: res.status };
    const text = String(res.referent.metadata.text ?? "");
    const span = spanFor(text, res.range.unit, res.range.count);
    if (!span.text) return { truth: "BLOCKED" as Truth, say: "W tym tekście nie ma liter do zaznaczenia.", evidence: "empty span" };
    this.dispatchAll(res);
    const target = this.targetOf(res.referent);
    const r = await this.act(taskId, { kind: "text.select", target, start: span.start, end: span.end, expected: span.text }, "select");
    if (r.truth !== "CONFIRMED") return { truth: r.truth, say: this.failSay(r, "Zaznaczenie"), evidence: r.reason };
    const k = this.kernel;
    const id = `sel:${++this.selSeq}`;
    k.dispatch({
      type: "ReferentAdded",
      referent: {
        id, type: "Selection", source: this.env.id, scope: res.referent.scope, parent: res.referent.id,
        semanticKey: `selection:${res.referent.semanticKey}:${span.start}-${span.end}`, confidence: 1, salience: 0.9,
        metadata: { text: span.text, start: span.start, end: span.end, envRef: target.ref, parentSemanticKey: target.semanticKey, complete: span.complete },
        provenance: res.referent.provenance,
      },
    });
    k.dispatch({ type: "ReferentVerified", referentId: id, evidence: r.evidence });
    const partial = span.complete ? "" : ` W tekście jest tylko ${span.units.length}.`;
    return { truth: r.truth, say: `Zaznaczyłem „${span.text}”.${partial}`, evidence: r.evidence, data: { selection: span.text, referentId: id } };
  }

  private async copy(taskId: string, query: RefQuery) {
    const res = resolveReference(this.kernel.state, { query, verb: "copy" });
    if (res.status === "stale") return { truth: "BLOCKED" as Truth, say: "Zaznaczenie wygasło, bo strona się zmieniła. Zaznacz jeszcze raz.", evidence: res.reason };
    if (res.status !== "resolved") return { truth: "BLOCKED" as Truth, say: "Nie mam nic zaznaczonego do skopiowania.", evidence: res.status };
    const sel = res.referent;
    const text = String(sel.metadata.text ?? "");
    this.dispatchAll(res);
    const reselect = typeof sel.metadata.start === "number" && typeof sel.metadata.end === "number"
      ? { target: { ref: String(sel.metadata.envRef), semanticKey: String(sel.metadata.parentSemanticKey ?? "") || undefined }, start: sel.metadata.start, end: sel.metadata.end }
      : undefined;
    const r = await this.act(taskId, { kind: "clipboard.copy", expected: text, reselect }, "copy");
    if (r.truth !== "CONFIRMED") return { truth: r.truth, say: this.failSay(r, "Kopiowanie"), evidence: r.reason };
    this.kernel.dispatch({ type: "ClipboardChanged", hash: fnv1a64(text), preview: preview(text, 80), byJarvis: true, provenance: sel.provenance ?? "UNTRUSTED_WEB" });
    return { truth: r.truth, say: `Skopiowane: „${text}”.`, evidence: r.evidence, data: { clipboard: text } };
  }

  // ---------------------------------------------------------------- step 8: send (mission 5.9, 5.11-5.13)

  private question: { taskId: string; candidates: Contact[]; resolve: (c: Contact | null) => void } | null = null;

  /** A question is waiting for the user's answer ("Którego Marcina?"). */
  hasPendingQuestion(): boolean {
    return this.question !== null;
  }

  /** Try to answer the pending question. Returns false when the text is not an answer. */
  answer(text: string): boolean {
    const q = this.question;
    if (!q) return false;
    const picked = pickCandidate(text, q.candidates);
    if (picked) {
      this.question = null;
      q.resolve(picked);
      return true;
    }
    if (/^(nie|anuluj|stop|zostaw|nie wysylaj|nikomu)\b/.test(normalizeForAnswer(text))) {
      this.question = null;
      q.resolve(null);
      return true;
    }
    return false;
  }

  private ask(taskId: string, text: string, candidates: Contact[]): Promise<Contact | null> {
    this.kernel.dispatch({ type: "TaskStatusChanged", taskId, status: "blocked", reason: "waiting for the recipient" });
    this.opts.onQuestion?.(text);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { if (this.question?.taskId === taskId) { this.question = null; resolve(null); } }, this.opts.answerTimeoutMs ?? 120_000);
      const off = this.kernel.subscribe((s) => {
        if (s.tasks[taskId]?.status === "cancelled" && this.question?.taskId === taskId) { this.question = null; clearTimeout(timer); off(); resolve(null); }
      });
      this.question = { taskId, candidates, resolve: (c) => { clearTimeout(timer); off(); resolve(c); } };
    });
  }

  private waitConsent(consentId: string, taskId: string): Promise<"granted" | "denied" | "timeout" | "cancelled"> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: "granted" | "denied" | "timeout" | "cancelled") => { if (done) return; done = true; clearTimeout(timer); off(); resolve(r); };
      const check = () => {
        const s = this.kernel.state;
        const c = s.consents[consentId];
        if (c?.status === "granted") finish("granted");
        else if (c?.status === "denied") finish("denied");
        else if (s.tasks[taskId]?.status === "cancelled") finish("cancelled");
      };
      const timer = setTimeout(() => finish("timeout"), this.opts.answerTimeoutMs ?? 120_000);
      const off = this.kernel.subscribe(check);
      check();
    });
  }

  private async send(taskId: string, text: string, query: RefQuery) {
    const k = this.kernel;
    const mail = this.opts.mail;
    if (!mail) return { truth: "NEEDS_CAPABILITY" as Truth, say: "Nie mam skonfigurowanej poczty z odczytem Wysłanych." };

    // 1. What is "to": the fresher of the selection and the clipboard (typed by the verb).
    const res = resolveReference(k.state, { query, verb: "send" });
    if (res.status === "stale") return { truth: "BLOCKED" as Truth, say: "To, co było zaznaczone, wygasło, bo strona się zmieniła. Zaznacz albo skopiuj jeszcze raz.", evidence: res.reason };
    if (res.status !== "resolved") return { truth: "BLOCKED" as Truth, say: "Nie wiem, co wysłać: najpierw coś zaznacz albo skopiuj.", evidence: res.status };
    this.dispatchAll(res);
    let content = String(res.referent.metadata.text ?? "");
    let provenance: Provenance = res.referent.provenance ?? "UNTRUSTED_WEB";
    let warning = "";
    // A selection JARVIS already copied means "the copied text": check the clipboard itself, so an
    // outside change after "skopiuj" is caught whichever referent was a hair fresher.
    const copiedSelection = res.referent.type === "Selection" && !!k.state.clipboard?.jarvisHash && k.state.clipboard.jarvisHash === fnv1a64(content);
    if (res.referent.type === "Clipboard" || copiedSelection) {
      const clip = (await this.env.read({ kind: "clipboard" })) as ClipboardRead;
      if (!clip.ok) return { truth: "NEEDS_PERMISSION" as Truth, say: "Nie mogę odczytać schowka.", evidence: clip.error };
      content = clip.text ?? "";
      const hash = fnv1a64(content);
      const cb = k.state.clipboard;
      if (cb?.jarvisHash && hash !== cb.jarvisHash) {
        // Changed outside JARVIS since "skopiuj": warn at the consent boundary, treat as untrusted.
        k.dispatch({ type: "ClipboardChanged", hash, preview: preview(content, 80), byJarvis: false, provenance: "UNTRUSTED_CLIPBOARD" });
        provenance = "UNTRUSTED_CLIPBOARD";
        warning = " Uwaga: schowek zmienił się poza mną od ostatniego kopiowania.";
      }
    }
    if (!content.trim()) return { truth: "BLOCKED" as Truth, say: "Nie ma czego wysłać, treść jest pusta." };

    // 2. Recipient: only from the user's own words or the address book, never from the content.
    let to: string;
    let name: string;
    const spoken = instructionEmails(text);
    if (spoken.length === 1) {
      to = spoken[0];
      name = to;
    } else {
      const contacts = this.opts.contacts ? await this.opts.contacts() : [];
      const r = resolveContact(text, contacts);
      let contact: Contact | null = null;
      if (r.status === "resolved") contact = r.contact;
      else if (r.status === "ambiguous") {
        contact = await this.ask(taskId, r.question, r.candidates);
        if (!contact) return { truth: "BLOCKED" as Truth, say: "Dobrze, nie wysyłam.", evidence: "no recipient chosen" };
        k.dispatch({ type: "TaskStatusChanged", taskId, status: "running", reason: "recipient chosen" });
      } else {
        const who = r.tokens.length ? r.tokens.join(" ") : "tej osoby";
        return { truth: "BLOCKED" as Truth, say: `Nie znam adresu: ${who}. Podaj adres albo dodaj kontakt.`, evidence: "recipient not found" };
      }
      to = contact.emails[0];
      name = contact.name;
    }
    const outgoing = { to, subject: preview(content, 40), body: content };

    // 3. Consent exactly once, at the commit boundary, with the final arguments.
    const key = mailIdempotencyKey(outgoing);
    const alreadyAttempted = !!k.state.idempotency[key];
    const policy = decidePolicy("EXTERNAL_SIDE_EFFECT", { untrustedContent: isUntrusted(provenance), privateData: true }, this.opts.policies);
    if (policy === "DENY") return { truth: "BLOCKED" as Truth, say: "Wysyłanie maili jest wyłączone w ustawieniach." };
    if (policy === "ASK" && !alreadyAttempted) {
      const consentId = k.id("consent");
      const summary = `Wysłać mail do ${name} <${to}> z treścią «${preview(content, 60)}»?${warning}`;
      k.dispatch({ type: "ConsentRequested", consentId, taskId, summary, args: { to, name, subject: outgoing.subject, body: preview(content, 200), warning: warning.trim() } });
      this.opts.onQuestion?.(summary);
      const decision = await this.waitConsent(consentId, taskId);
      if (decision !== "granted") {
        return { truth: (decision === "cancelled" ? "FAILED" : "BLOCKED") as Truth, say: decision === "timeout" ? "Nie dostałem odpowiedzi, nie wysyłam." : "Dobrze, nie wysyłam.", evidence: decision };
      }
    }

    // 4. Send exactly once and confirm from Sent.
    const r = await sendExactlyOnce(k, mail, { taskId, stepId: "send", mail: outgoing }, this.opts.mailOptions);
    const first = name.split(/\s+/)[0];
    if (r.truth === "CONFIRMED") {
      return { truth: r.truth, say: r.duplicate ? `To już wysłałem wcześniej do ${first}.` : `Wysłane do ${first}. Jest w Wysłanych.`, evidence: r.evidence, data: { to, body: content, duplicate: !!r.duplicate } };
    }
    if (r.truth === "UNKNOWN_AFTER_ATTEMPT") {
      return { truth: r.truth, say: "Nie mam pewności, czy mail wyszedł: nie widzę go w Wysłanych. Nie wysyłam drugi raz, żeby nie zdublować.", evidence: r.reason };
    }
    return { truth: r.truth, say: `Nie udało się wysłać: ${r.reason ?? "błąd poczty"}.`, evidence: r.reason };
  }
}

const normalizeForAnswer = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").trim();
