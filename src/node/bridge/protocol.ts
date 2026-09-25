// BrowserBridge protocol (mission M8): JSON messages between JARVIS (loopback WebSocket server)
// and a WebExtension in the user's own Chromium or Firefox. Pairing with a one-time code shown
// by JARVIS, then a session token; tokens are stored only as SHA-256 hashes and compared in
// constant time. Every message is validated before it is used.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PROTOCOL_VERSION = 1;

export type ExtensionMessage =
  | { type: "hello"; v: number; browser: "chromium" | "firefox"; extensionId: string; token?: string; pairCode?: string }
  | { type: "result"; id: number; ok: boolean; data?: unknown; error?: string }
  | { type: "event"; event: "tab"; tabId: number; url: string; title: string }
  | { type: "event"; event: "selection"; tabId: number; text: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "welcome"; v: number; token?: string }
  | { type: "error"; code: "unauthorized" | "bad_version" | "bad_message" | "timeout"; message: string }
  | { type: "cmd"; id: number; method: BridgeMethod; params?: Record<string, unknown> }
  | { type: "pong" };

export type BridgeMethod = "tab.get" | "tab.navigate" | "page.selection" | "page.copySelection";

const MAX_MESSAGE = 64 * 1024;
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** Parse and validate one message from the extension; null when it is not a valid message. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.type) {
    case "hello":
      if (typeof m.v !== "number" || (m.browser !== "chromium" && m.browser !== "firefox") || !isStr(m.extensionId, 200)) return null;
      if (m.token !== undefined && !isStr(m.token, 128)) return null;
      if (m.pairCode !== undefined && !(isStr(m.pairCode, 12) && /^\d{6}$/.test(m.pairCode))) return null;
      return { type: "hello", v: m.v, browser: m.browser, extensionId: m.extensionId, token: m.token as string | undefined, pairCode: m.pairCode as string | undefined };
    case "result":
      if (!Number.isInteger(m.id) || typeof m.ok !== "boolean") return null;
      if (m.error !== undefined && !isStr(m.error, 2000)) return null;
      return { type: "result", id: m.id as number, ok: m.ok, data: m.data, error: m.error as string | undefined };
    case "event":
      if (m.event === "tab" && Number.isInteger(m.tabId) && isStr(m.url, 4096) && isStr(m.title, 1000)) return { type: "event", event: "tab", tabId: m.tabId as number, url: m.url, title: m.title };
      if (m.event === "selection" && Number.isInteger(m.tabId) && isStr(m.text, 20_000)) return { type: "event", event: "selection", tabId: m.tabId as number, text: m.text };
      return null;
    case "ping":
      return { type: "ping" };
    default:
      return null;
  }
}

/** Which WebSocket origins may connect: extension pages only, optionally a fixed set of ids. */
export function originAllowed(origin: string | undefined, allowedIds?: string[]): boolean {
  const m = /^(chrome-extension|moz-extension):\/\/([a-z0-9-]{8,64})$/i.exec(origin ?? "");
  if (!m) return false;
  return !allowedIds?.length || allowedIds.includes(m[2]);
}

export const isLoopback = (addr: string | undefined): boolean => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** One-time pairing codes: 6 digits, short-lived, single use, few attempts. */
export class Pairing {
  private code: { hash: Buffer; expires: number } | null = null;
  private attempts = 0;
  constructor(private readonly ttlMs = 120_000, private readonly maxAttempts = 5, private readonly now: () => number = () => Date.now()) {}

  /** Show this code to the user in JARVIS; a new code replaces the old one. */
  issue(): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.code = { hash: sha256(code), expires: this.now() + this.ttlMs };
    this.attempts = 0;
    return code;
  }

  consume(candidate: string): boolean {
    const c = this.code;
    if (!c || this.now() > c.expires) { this.code = null; return false; }
    if (++this.attempts > this.maxAttempts) { this.code = null; return false; }
    const ok = timingSafeEqual(c.hash, sha256(candidate));
    if (ok) this.code = null;
    return ok;
  }
}

export interface TokenRecord { hash: string; extensionId: string; browser: string; createdAt: number }

/** Session tokens, persisted as hashes (a leaked store file does not give a working token). */
export class TokenStore {
  constructor(private records: TokenRecord[] = [], private readonly persist?: (r: TokenRecord[]) => void) {}

  issue(extensionId: string, browser: string, now = Date.now()): string {
    const token = randomBytes(32).toString("hex");
    this.records = [...this.records.filter((r) => r.extensionId !== extensionId), { hash: sha256(token).toString("hex"), extensionId, browser, createdAt: now }];
    this.persist?.(this.records);
    return token;
  }

  verify(token: string, extensionId: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    const h = sha256(token);
    return this.records.some((r) => r.extensionId === extensionId && timingSafeEqual(Buffer.from(r.hash, "hex"), h));
  }

  revoke(extensionId: string): void {
    this.records = this.records.filter((r) => r.extensionId !== extensionId);
    this.persist?.(this.records);
  }

  list(): Omit<TokenRecord, "hash">[] {
    return this.records.map(({ hash: _h, ...r }) => r);
  }
}
