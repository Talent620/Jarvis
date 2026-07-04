import { describe, it, expect } from "vitest";
import { freshThread, type StoredThread } from "../src/lib/liveThread";

const msgs = [
  { role: "user" as const, content: "cześć" },
  { role: "assistant" as const, content: "hej, co słychać" },
];

describe("freshThread — wznawiaj rozmowę tylko, gdy świeża", () => {
  it("świeży wątek (w oknie czasu) → wznawiamy", () => {
    const stored: StoredThread = { at: 1_000_000, msgs };
    expect(freshThread(stored, 1_000_000 + 5 * 60 * 1000)).toEqual(msgs); // 5 min później
  });
  it("stary wątek (po oknie) → świeży start", () => {
    const stored: StoredThread = { at: 1_000_000, msgs };
    expect(freshThread(stored, 1_000_000 + 40 * 60 * 1000)).toEqual([]); // 40 min później
  });
  it("brak/pusty wątek → pusto", () => {
    expect(freshThread(null, 123)).toEqual([]);
    expect(freshThread({ at: 100, msgs: [] }, 150)).toEqual([]);
  });
  it("bez znacznika czasu → nie wznawiamy (bezpiecznie)", () => {
    expect(freshThread({ at: 0, msgs }, 1000)).toEqual([]);
  });
  it("przycina do ostatnich 16 wiadomości", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const r = freshThread({ at: 5, msgs: many }, 10);
    expect(r.length).toBe(16);
    expect(r[r.length - 1].content).toBe("m29");
  });
});
