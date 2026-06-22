// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { recordBossDecision, recentBossDecisions, bossMemoryDigest, loadBossDecisions } from "../src/lib/bossMemory";

beforeEach(() => localStorage.clear());

describe("bossMemory — pamięć decyzji Szefa (ciągłość)", () => {
  it("zapisuje i zwraca najnowsze na górze", () => {
    recordBossDecision("wybieramy hosting A", 1);
    recordBossDecision("wysyłamy ofertę w piątek", 2);
    const r = recentBossDecisions();
    expect(r[0].text).toMatch(/ofertę w piątek/);
    expect(r[1].text).toMatch(/hosting A/);
  });

  it("deduplikuje po treści (ta sama decyzja nie mnoży wpisów)", () => {
    recordBossDecision("budżet to 2000 zł");
    recordBossDecision("budżet to 2000 zł");
    expect(loadBossDecisions().length).toBe(1);
  });

  it("ignoruje śmieci i pamięta limit", () => {
    recordBossDecision("");
    recordBossDecision("ok");
    expect(loadBossDecisions().length).toBe(0);
    for (let i = 0; i < 60; i++) recordBossDecision(`decyzja numer ${i}`);
    expect(loadBossDecisions().length).toBeLessThanOrEqual(40);
  });

  it("digest pusty, gdy brak; z treścią, gdy są decyzje", () => {
    expect(bossMemoryDigest()).toBe("");
    recordBossDecision("przechodzimy na abonament roczny");
    expect(bossMemoryDigest()).toMatch(/USTALENIA/);
    expect(bossMemoryDigest()).toMatch(/abonament roczny/);
  });
});
