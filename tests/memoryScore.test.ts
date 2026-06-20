import { describe, it, expect } from "vitest";
import { recencyWeight, reinforcementWeight, memoryScore, shouldForget, reinforced } from "../src/lib/memoryScore";

const DAY = 86_400_000;
const now = 1_000 * DAY;

describe("memoryScore — rozpad świeżości (decay)", () => {
  it("świeże = 1, po połowicznym rozpadzie ~0.5, starsze mniej", () => {
    expect(recencyWeight({ createdAt: now }, now)).toBeCloseTo(1, 2);
    expect(recencyWeight({ createdAt: now - 30 * DAY }, now, 30)).toBeCloseTo(0.5, 2);
    expect(recencyWeight({ createdAt: now - 60 * DAY }, now, 30)).toBeCloseTo(0.25, 2);
  });
  it("przypięte nie zanikają", () => {
    expect(recencyWeight({ createdAt: now - 365 * DAY, pinned: true }, now)).toBe(1);
  });
  it("lastUsedAt liczy się ponad createdAt (użycie odświeża)", () => {
    const old = { createdAt: now - 100 * DAY, lastUsedAt: now - 1 * DAY };
    expect(recencyWeight(old, now, 30)).toBeGreaterThan(0.9);
  });
});

describe("memoryScore — wzmocnienie (reinforcement)", () => {
  it("rośnie z liczbą użyć, z nasyceniem", () => {
    expect(reinforcementWeight({ createdAt: now, useCount: 0 })).toBe(0);
    expect(reinforcementWeight({ createdAt: now, useCount: 5 })).toBeGreaterThan(0);
    expect(reinforcementWeight({ createdAt: now, useCount: 50 })).toBeCloseTo(1, 1);
    expect(reinforcementWeight({ createdAt: now, useCount: 5 })).toBeLessThan(reinforcementWeight({ createdAt: now, useCount: 20 }));
  });
});

describe("memoryScore — łączny wynik", () => {
  it("trafność do zapytania dominuje, ale trwałość podtrzymuje", () => {
    const fresh = { createdAt: now };
    expect(memoryScore(fresh, 1, now)).toBeGreaterThan(memoryScore(fresh, 0, now));
    expect(memoryScore({ createdAt: now, pinned: true }, 0, now)).toBe(1);
  });
  it("często używane stare wspomnienie bije rzadko używane świeższe (przy zerowej trafności)", () => {
    const oftenOld = { createdAt: now - 20 * DAY, lastUsedAt: now - 10 * DAY, useCount: 30 };
    const rareNew = { createdAt: now - 15 * DAY, useCount: 0 };
    expect(memoryScore(oftenOld, 0, now)).toBeGreaterThan(memoryScore(rareNew, 0, now));
  });
});

describe("memoryScore — zapominanie i wzmacnianie", () => {
  it("shouldForget: bardzo stare, nieużywane, niepinowane → zapomnij; pinowane → nigdy", () => {
    expect(shouldForget({ createdAt: now - 400 * DAY }, now)).toBe(true);
    expect(shouldForget({ createdAt: now - 400 * DAY, pinned: true }, now)).toBe(false);
    expect(shouldForget({ createdAt: now - 1 * DAY }, now)).toBe(false);
  });
  it("reinforced: inkrementuje useCount i odświeża lastUsedAt", () => {
    const r = reinforced({ createdAt: now - 10 * DAY, useCount: 2 }, now);
    expect(r.useCount).toBe(3);
    expect(r.lastUsedAt).toBe(now);
  });
});
