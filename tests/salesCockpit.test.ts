import { describe, it, expect } from "vitest";
import { computeCockpit, formatZl, winRatePct } from "../src/lib/salesCockpit";
import type { Lead, SentMail } from "../src/types";

// Kokpit sprzedaży: składa liczby z istniejących silników. Testy pilnują poprawności agregatów
// i UCZCIWOŚCI (win-rate null bez rozstrzygnięć, prognoza ważona < wartości lejka).

const NOW = new Date(2026, 6, 3, 12, 0, 0).getTime();
const lead = (o: Partial<Lead>): Lead => ({
  id: Math.random().toString(36).slice(2), company: "F", status: "new",
  createdAt: NOW - 20 * 86400_000, updatedAt: NOW, ...o,
} as Lead);

describe("computeCockpit — agregaty z leadów", () => {
  it("wartość lejka i prognoza ważona: expected < pipeline (ważenie prawdopodobieństwem)", () => {
    const leads = [
      lead({ status: "new", value: 10000 }),
      lead({ status: "offer", value: 10000 }),
      lead({ status: "won", value: 5000 }),
      lead({ status: "lost", value: 9000 }),
    ];
    const c = computeCockpit(leads, [], NOW);
    expect(c.pipeline).toBe(20000);       // new + offer (won/lost poza lejkiem)
    expect(c.won).toBe(5000);
    expect(c.expected).toBeGreaterThan(0);
    expect(c.expected).toBeLessThan(c.pipeline); // ważone < surowa wartość
    expect(c.counts.new).toBe(1);
    expect(c.counts.offer).toBe(1);
  });
  it("win-rate = wygrane/(wygrane+przegrane); null gdy nic nie rozstrzygnięte", () => {
    expect(computeCockpit([lead({ status: "won" }), lead({ status: "lost" }), lead({ status: "lost" })], [], NOW).winRate).toBeCloseTo(1 / 3);
    expect(computeCockpit([lead({ status: "new" }), lead({ status: "offer" })], [], NOW).winRate).toBeNull();
  });
  it("liczy maile wysłane dziś (nie wczoraj)", () => {
    const sent: SentMail[] = [
      { id: "1", to: "a@b.pl", subject: "x", via: "SMTP", at: NOW - 3600_000 } as SentMail,       // dziś
      { id: "2", to: "c@d.pl", subject: "y", via: "SMTP", at: NOW - 2 * 86400_000 } as SentMail,  // przedwczoraj
    ];
    expect(computeCockpit([], sent, NOW).sentToday).toBe(1);
  });
  it("puste dane nie wywracają kokpitu", () => {
    const c = computeCockpit([], undefined, NOW);
    expect(c.pipeline).toBe(0);
    expect(c.winRate).toBeNull();
    expect(c.todayActions).toBe(0);
  });
  it("zaległe follow-upy i akcje-dziś są liczbami ≥ 0", () => {
    const c = computeCockpit([lead({ status: "offer", nextFollowUpAt: NOW - 86400_000 })], [], NOW);
    expect(c.overdue).toBeGreaterThanOrEqual(0);
    expect(c.todayActions).toBeGreaterThanOrEqual(c.overdue);
  });
});

describe("formatery kokpitu", () => {
  it("formatZl: separator tysięcy + „zł”", () => {
    expect(formatZl(12000)).toMatch(/12[\s ]?000 zł/);
    expect(formatZl(0)).toBe("0 zł");
  });
  it("winRatePct: procent albo „—” dla null", () => {
    expect(winRatePct(0.42)).toBe("42%");
    expect(winRatePct(null)).toBe("—");
  });
});
