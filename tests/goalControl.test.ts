import { describe, expect, it } from "vitest";
import { beginGoalRun, isGoalRunning, requestGoalPause } from "../src/lib/goalControl";

describe("sterowanie celem", () => {
  it("nie uruchamia tego samego celu dwa razy i czyści rejestr po zakończeniu", () => {
    const run = beginGoalRun("cel-test");
    try {
      expect(isGoalRunning("cel-test")).toBe(true);
      expect(() => beginGoalRun("cel-test")).toThrow(/już wykonywany/);
      expect(requestGoalPause("cel-test")).toBe(true);
      expect(run.shouldStop()).toBe(true);
    } finally { run.finish(); }
    expect(isGoalRunning("cel-test")).toBe(false);
    expect(requestGoalPause("cel-test")).toBe(false);
  });
});
