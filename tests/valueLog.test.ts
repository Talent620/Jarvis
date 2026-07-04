import { describe, it, expect } from "vitest";
import { valueToday, valueAllTime, prettyMinutes } from "../src/lib/valueLog";
import type { AuditEntry } from "../src/types";

const NOW = Date.parse("2026-06-22T12:00:00Z");
const a = (tool: string, status: AuditEntry["status"], at: number): AuditEntry =>
  ({ id: Math.random().toString(36), at, tool, input: "", status } as AuditEntry);

describe("valueLog — realna wartość z audytu", () => {
  const audit: AuditEntry[] = [
    a("gmail_send", "ok", NOW),                         // dziś, 6 min
    a("add_task", "ok", NOW),                           // dziś, 2 min
    a("add_task", "denied", NOW),                       // odrzucone → nie liczy
    a("make_call", "ok", NOW - 5 * 86_400_000),         // inny dzień → nie dziś
  ];

  it("dziś liczy tylko udane akcje z dzisiaj + sumuje czas", () => {
    const v = valueToday(audit, NOW);
    expect(v.actions).toBe(2);
    expect(v.minutes).toBe(8); // 6 + 2
  });

  it("łącznie liczy wszystkie udane (różne dni)", () => {
    const v = valueAllTime(audit);
    expect(v.actions).toBe(3); // gmail + task + call
    expect(v.minutes).toBe(12); // 6 + 2 + 4
  });

  it("pusty audyt → 0", () => {
    expect(valueToday([], NOW)).toEqual({ actions: 0, minutes: 0 });
  });

  it("prettyMinutes formatuje godziny i minuty", () => {
    expect(prettyMinutes(25)).toBe("~25 min");
    expect(prettyMinutes(65)).toBe("~1 h 5 min");
    expect(prettyMinutes(120)).toBe("~2 h");
  });
});
