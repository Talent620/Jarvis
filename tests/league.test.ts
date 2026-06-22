import { describe, it, expect } from "vitest";
import { leagueRanking, bestBrain, type LeagueInput } from "../src/lib/league";
import type { IqResult } from "../src/lib/iqProbe";

const inputs: LeagueInput[] = [
  { provider: "anthropic", model: "claude-opus-4-8", label: "Claude", ready: true },
  { provider: "mistral", model: "mistral-small-latest", label: "Mistral", ready: true },
  { provider: "groq", model: "llama-3.1-8b-instant", label: "Groq", ready: false },
];
const res = (pct: number, ms = 1000): IqResult => ({ correct: 0, total: 6, pct, ms, at: 0 });

describe("leagueRanking — ranking Twoich mózgów", () => {
  it("gotowe na górze, niegotowe na dole", () => {
    const r = leagueRanking(inputs, {});
    expect(r[r.length - 1].ready).toBe(false);
    expect(r[0].ready).toBe(true);
  });

  it("bez pomiaru sortuje po orientacyjnym IQ (Opus > Mistral Small)", () => {
    const r = leagueRanking(inputs, {}).filter((x) => x.ready);
    expect(r[0].provider).toBe("anthropic");
  });

  it("zmierzony wynik ma pierwszeństwo nad orientacyjnym", () => {
    // Mistral zmierzony 100%, Opus niemierzony → Mistral wskakuje wyżej.
    const r = leagueRanking(inputs, { "mistral:mistral-small-latest": res(100) }).filter((x) => x.ready);
    expect(r[0].provider).toBe("mistral");
    expect(r[0].measured).toBe(100);
  });
});

describe("bestBrain — najmocniejszy gotowy", () => {
  it("zwraca najlepszy gotowy; pomija niegotowe", () => {
    const b = bestBrain(inputs, {});
    expect(b?.provider).toBe("anthropic");
  });
  it("null, gdy nic nie gotowe", () => {
    const none = inputs.map((i) => ({ ...i, ready: false }));
    expect(bestBrain(none, {})).toBeNull();
  });
});
