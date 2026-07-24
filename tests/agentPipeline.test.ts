import { describe, expect, it } from "vitest";
import { runAgentPipeline, roleForStep } from "../src/lib/agentPipeline";
import { confirmed, failed } from "../src/lib/actionOutcome";

describe("agent pipeline", () => {
  it("przypisuje specjalistów na podstawie celu kroku", () => {
    expect(roleForStep({ id: "1", intent: "napisz moduł" })).toBe("coder");
    expect(roleForStep({ id: "2", intent: "uruchom testy" })).toBe("tester");
    expect(roleForStep({ id: "3", intent: "napraw błąd" })).toBe("debugger");
    expect(roleForStep({ id: "4", intent: "oceń diff" })).toBe("reviewer");
  });

  it("kończy zatwierdzeniem tylko po potwierdzeniu wszystkich kroków", async () => {
    const result = await runAgentPipeline(
      { goal: "zmiana", steps: [{ id: "code", intent: "napisz kod" }, { id: "test", intent: "uruchom testy", dependsOn: ["code"] }] },
      { toolExists: () => true, riskOf: () => "read", execTool: async () => ({ outcome: confirmed() }), now: () => 1 },
    );
    expect(result.approved).toBe(true);
    expect(result.events.map((event) => event.role)).toEqual(["planner", "coder", "tester", "reviewer"]);
  });

  it("reviewer odrzuca przebieg z błędem", async () => {
    const result = await runAgentPipeline(
      { goal: "zmiana", steps: [{ id: "code", intent: "napisz kod", tool: "write" }] },
      { toolExists: () => true, riskOf: () => "write", execTool: async () => ({ outcome: failed("boom") }), now: () => 1 },
    );
    expect(result.approved).toBe(false);
    expect(result.events.at(-1)?.state).toBe("failed");
  });
});
