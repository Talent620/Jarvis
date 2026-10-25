// M13 coder acceptance: the fake mode is the CI run of the whole path; the codex mode never runs
// in CI (it would use the user's paid plan).
import { describe, it, expect } from "vitest";
import { renderCoderReport, runCoderAcceptance } from "../../src/node/coder/acceptance";

describe("jarvis:coder:acceptance", () => {
  it("fake mode: detection, CONFIRMED fix with a live status answer, red test never 'gotowe', stop, force push BLOCKED", async () => {
    const r = await runCoderAcceptance({ mode: "fake", repoRoot: process.cwd() });
    expect(r.checks.map((c) => [c.name.slice(0, 40), c.status])).toEqual(r.checks.map((c) => [c.name.slice(0, 40), "PASS"]));
    expect(r.checks).toHaveLength(5);
    expect(r.verdict).toBe("PASS");
    const md = renderCoderReport(r);
    expect(md).toContain("# JARVIS coder acceptance (fake)");
    expect(md).toContain("Verdict: **PASS**");
  }, 60_000);

  it("codex mode refuses to spend anything in CI", async () => {
    const r = await runCoderAcceptance({ mode: "codex", repoRoot: process.cwd(), env: { CI: "1" } });
    expect(r.checks).toEqual([{ name: "codex: real task", status: "SKIP", detail: "refused in CI: this mode uses the user's paid Codex plan" }]);
  });
});
