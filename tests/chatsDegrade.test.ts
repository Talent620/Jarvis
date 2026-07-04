// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { saveChats, setChatStorageWarner, type ChatSession } from "../src/lib/chats";

const big = (id: string, n: number): ChatSession => ({
  id, title: "T", updatedAt: 1,
  messages: Array.from({ length: n }, () => ({ role: "user", text: "x", image: "data:img" + "a".repeat(50) } as any)),
});

beforeEach(() => { localStorage.clear(); setChatStorageWarner(null); });
afterEach(() => { vi.restoreAllMocks(); setChatStorageWarner(null); });

describe("chats — brak cichej degradacji", () => {
  it("normalny zapis → ok, bez degradacji (tier 0)", () => {
    const r = saveChats([big("a", 1)]);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.tier).toBe(0);
  });

  it("gdy pełny zapis rzuca QuotaExceeded → degraduje i ZGŁASZA warning", () => {
    let warned: any = null;
    setChatStorageWarner((res) => { warned = res; });
    const real = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      calls++;
      if (calls <= 1) { const e = new Error("Quota"); (e as any).name = "QuotaExceededError"; throw e; } // pierwszy (pełny) poziom pada
      return real.call(this, k, v);
    });
    const r = saveChats([big("a", 5), big("b", 5)]);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.tier).toBeGreaterThan(0);
    expect(warned?.degraded).toBe(true); // UI dostało sygnał
  });

  it("gdy wszystkie próby padają → ok=false i warning o pełnej pamięci", () => {
    let warned: any = null;
    setChatStorageWarner((res) => { warned = res; });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const r = saveChats([big("a", 3)]);
    expect(r.ok).toBe(false);
    expect(r.keptSessions).toBe(0);
    expect(warned?.ok).toBe(false);
  });
});
