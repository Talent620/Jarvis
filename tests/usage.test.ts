// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { bucketOf, track, orderForBucket, hasWeekOfData, hourlyActivity, resetAdaptive } from "../src/lib/usage";

const at = (daysAgo: number, hour: number): number => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 30, 0, 0);
  return d.getTime();
};

describe("Adaptive UI — tracker użycia", () => {
  beforeEach(() => resetAdaptive());

  it("bucketOf dzieli dobę: rano 5–12, dzień 12–18, wieczór 18–5", () => {
    expect(bucketOf(new Date(2026, 0, 1, 8))).toBe("morning");
    expect(bucketOf(new Date(2026, 0, 1, 14))).toBe("day");
    expect(bucketOf(new Date(2026, 0, 1, 21))).toBe("evening");
    expect(bucketOf(new Date(2026, 0, 1, 2))).toBe("evening");
  });

  it("orderForBucket sortuje wg częstości w danej porze, stabilnie dla reszty", () => {
    // rano: dziennik 3×, zarabianie 1×; wieczorem: zarabianie 2×
    track("journal", at(2, 9));
    track("journal", at(3, 8));
    track("journal", at(1, 10));
    track("money", at(2, 9));
    track("money", at(1, 20));
    track("money", at(2, 21));
    const ids = ["money", "journal", "help"];
    expect(orderForBucket(ids, "morning")[0]).toBe("journal");
    expect(orderForBucket(ids, "evening")[0]).toBe("money");
    // nieużywane "help" zachowuje pozycję względną na końcu
    expect(orderForBucket(ids, "morning")[2]).toBe("help");
  });

  it("hasWeekOfData wymaga ≥10 zdarzeń i tygodnia historii", () => {
    expect(hasWeekOfData()).toBe(false);
    for (let i = 0; i < 12; i++) track("x", at(8, 10) + i * 1000);
    expect(hasWeekOfData()).toBe(true);
  });

  it("zdarzenia starsze niż 30 dni są przycinane przy zapisie", () => {
    track("old", at(40, 10));
    track("fresh", at(1, 10)); // ten zapis czyści stare
    expect(orderForBucket(["old", "fresh"], "morning")[0]).toBe("fresh");
    const hours = hourlyActivity();
    expect(hours[10]).toBe(1); // tylko świeże zdarzenie w oknie 7 dni
  });
});
