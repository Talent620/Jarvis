import { describe, it, expect, beforeEach } from "vitest";
import {
  withBackoff,
  dedupe,
  CircuitBreaker,
  cached,
  invalidateCache,
  clearMemCache,
} from "../src/lib/resilience";

const noSleep = () => Promise.resolve();

describe("resilience — withBackoff", () => {
  it("zwraca wynik bez ponawiania przy sukcesie", async () => {
    let calls = 0;
    const r = await withBackoff(async () => { calls++; return "ok"; }, { sleepFn: noSleep });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("ponawia do skutku (retries=2 → max 3 próby)", async () => {
    let calls = 0;
    const r = await withBackoff(async () => {
      calls++;
      if (calls < 3) throw new Error("net");
      return "ok";
    }, { retries: 2, baseMs: 1, sleepFn: noSleep });
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("rzuca ostatni błąd po wyczerpaniu prób", async () => {
    let calls = 0;
    await expect(withBackoff(async () => { calls++; throw new Error(`boom${calls}`); }, { retries: 2, baseMs: 1, sleepFn: noSleep }))
      .rejects.toThrow("boom3");
    expect(calls).toBe(3);
  });

  it("nie ponawia, gdy shouldRetry=false", async () => {
    let calls = 0;
    await expect(withBackoff(async () => { calls++; throw new Error("x"); }, { retries: 5, shouldRetry: () => false, sleepFn: noSleep }))
      .rejects.toThrow("x");
    expect(calls).toBe(1);
  });
});

describe("resilience — dedupe", () => {
  it("równoległe wywołania tego samego klucza dzielą jedną obietnicę", async () => {
    let calls = 0;
    const fn = () => { calls++; return new Promise((r) => setTimeout(() => r("v"), 10)); };
    const [a, b] = await Promise.all([dedupe("k", fn), dedupe("k", fn)]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(calls).toBe(1); // tylko jedno realne wywołanie
  });

  it("po rozwiązaniu kolejne wywołanie odpala ponownie", async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    await dedupe("k2", fn);
    await dedupe("k2", fn);
    expect(calls).toBe(2);
  });
});

describe("resilience — CircuitBreaker", () => {
  it("otwiera się po progu awarii i zamyka przy sukcesie", () => {
    let t = 1000;
    const cb = new CircuitBreaker(3, 5000, () => t);
    expect(cb.canPass("groq")).toBe(true);
    cb.onFailure("groq"); cb.onFailure("groq");
    expect(cb.canPass("groq")).toBe(true); // jeszcze pod progiem
    cb.onFailure("groq"); // 3. awaria → otwarcie
    expect(cb.canPass("groq")).toBe(false);
    expect(cb.state("groq")).toBe("open");
    t += 5001; // minął czas otwarcia → half-open (wpuść próbę)
    expect(cb.canPass("groq")).toBe(true);
    expect(cb.state("groq")).toBe("half");
    cb.onSuccess("groq"); // sukces → zamknięcie
    expect(cb.state("groq")).toBe("closed");
  });

  it("klucze są niezależne", () => {
    const cb = new CircuitBreaker(1, 1000);
    cb.onFailure("a");
    expect(cb.canPass("a")).toBe(false);
    expect(cb.canPass("b")).toBe(true);
  });
});

describe("resilience — cached (warstwa RAM)", () => {
  beforeEach(() => clearMemCache());

  it("liczy raz w obrębie TTL, potem zwraca z cache", async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    expect(await cached("w", fn, 1000)).toBe(1);
    expect(await cached("w", fn, 1000)).toBe(1); // z cache
    expect(calls).toBe(1);
  });

  it("invalidateCache wymusza ponowne policzenie", async () => {
    let calls = 0;
    const fn = async () => { calls++; return calls; };
    await cached("w2", fn, 1000);
    invalidateCache("w2");
    expect(await cached("w2", fn, 1000)).toBe(2);
  });

  it("błąd fn nie jest cache'owany", async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new Error("e"); };
    await expect(cached("w3", fn, 1000)).rejects.toThrow("e");
    await expect(cached("w3", fn, 1000)).rejects.toThrow("e");
    expect(calls).toBe(2);
  });
});
