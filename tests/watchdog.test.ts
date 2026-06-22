import { describe, it, expect } from "vitest";
import { topIssue, newIssues, alertText, type WatchIssue } from "../src/lib/watchdog";

const err = (id: string): WatchIssue => ({ id, title: `Błąd ${id}`, detail: "", severity: "err" });
const warn = (id: string): WatchIssue => ({ id, title: `Uwaga ${id}`, detail: "", severity: "warn" });

describe("watchdog — wybór i nowość problemów (pure)", () => {
  it("topIssue: błąd ma pierwszeństwo przed ostrzeżeniem", () => {
    expect(topIssue([warn("a"), err("b"), warn("c")])?.id).toBe("b");
    expect(topIssue([warn("a")])?.id).toBe("a");
    expect(topIssue([])).toBeNull();
  });

  it("newIssues: zwraca tylko niezaalarmowane (po id)", () => {
    const curr = [err("x"), warn("y"), warn("z")];
    expect(newIssues(["x"], curr).map((i) => i.id)).toEqual(["y", "z"]);
    expect(newIssues(new Set(["x", "y", "z"]), curr)).toEqual([]);
  });

  it("alertText: krótki, z ikoną wg wagi", () => {
    expect(alertText(err("k"))).toMatch(/^⛔ /);
    expect(alertText(warn("k"))).toMatch(/^⚠ /);
  });
});
