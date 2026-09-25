// Local acceptance (mission M6): safe defaults, progressive steps, report, publish rules.
import { describe, it, expect } from "vitest";
import { parseArgs, publishPlan, renderMarkdown, runSteps, verdictOf, type AcceptanceArgs, type AcceptanceReport } from "../src/node/acceptance/core";
import { probeCapabilities } from "../src/node/acceptance/capabilities";
import { acceptanceSteps, DraftOnlyMail } from "../src/node/acceptance/steps";
import { MemoryBrowser } from "./helpers/memoryBrowser";
import { MockMail } from "./helpers/mockMail";

describe("arguments", () => {
  it("defaults are safe: fixture mode, no real mail, one run, publish on", () => {
    expect(parseArgs([])).toEqual({ mode: "fixture", send: false, to: undefined, publish: true, runs: 1, headless: undefined });
  });
  it("flags and environment", () => {
    const a = parseArgs(["--mode=managed-browser", "--send", "--no-publish", "--runs=3", "--headless=false"], { JARVIS_ACCEPTANCE_TO: "me@example.com" });
    expect(a).toEqual({ mode: "managed-browser", send: true, to: "me@example.com", publish: false, runs: 3, headless: false });
    expect(parseArgs(["--runs=999"]).runs).toBe(1);
    expect(() => parseArgs(["--mode=production"])).toThrow(/unknown --mode/);
  });
});

describe("progressive steps and verdict", () => {
  it("a failed step skips what depends on it; errors become FAIL, never PASS", async () => {
    const r = await runSteps([
      { id: "a", title: "A", run: async () => ({ status: "PASS" }) },
      { id: "b", title: "B", needs: ["a"], run: async () => { throw new Error("boom\nstack"); } },
      { id: "c", title: "C", needs: ["b"], run: async () => ({ status: "PASS" }) },
      { id: "d", title: "D", needs: ["a"], run: async () => ({ status: "SIMULATED" }) },
      { id: "e", title: "E", needs: ["d"], run: async () => ({ status: "PASS" }) },
    ]);
    expect(r.map((x) => [x.id, x.status])).toEqual([["a", "PASS"], ["b", "FAIL"], ["c", "SKIP"], ["d", "SIMULATED"], ["e", "PASS"]]);
    expect(r[1].error).toBe("boom");
    expect(verdictOf(r)).toBe("FAIL");
    expect(verdictOf(r.filter((x) => x.status === "PASS"))).toBe("PASS");
    expect(verdictOf([{ id: "x", title: "x", status: "NEEDS_HARDWARE", ms: 0 }])).toBe("PARTIAL");
  });

  it("the markdown report lists every step with status and the capability matrix", () => {
    const report: AcceptanceReport = {
      startedAt: "t0", finishedAt: "t1", mode: "fixture",
      args: { mode: "fixture", send: false, publish: true, runs: 1 },
      host: { platform: "linux-x64", node: "v22", branch: "claude/x", commit: "abc" },
      capabilities: [{ id: "display", status: "missing", detail: "headless" }],
      steps: [{ id: "a", title: "Step | one", status: "PASS", ms: 5, evidence: "ok", latency: { d: { count: 2, p50: 3, p95: 4 } } }],
      verdict: "PASS",
    };
    const md = renderMarkdown(report);
    expect(md).toContain("| Step \\| one | PASS | 5 ms | ok |");
    expect(md).toContain("| display | missing | headless |");
    expect(md).toContain("| Step \\| one | d | 2 | 3 | 4 |");
    expect(md).toContain("mail=mock Gmail (fixture)");
  });
});

describe("publishing", () => {
  const args: AcceptanceArgs = parseArgs([]);
  const files = ["reports/acceptance-2026-09-24T23-55-17-595Z.md", "reports/acceptance-2026-09-24T23-55-17-595Z.json"];
  it("only on a mission branch, only report files, commit limited to those paths", () => {
    const p = publishPlan(args, "claude/intelligent-brahmagupta-jq7jqj", files, "fixture PASS");
    expect(p.publish).toBe(true);
    expect(p.commands).toEqual([
      ["git", "add", "--", ...files],
      ["git", "commit", "-m", "acceptance: fixture PASS", "--", ...files],
      ["git", "push", "-u", "origin", "claude/intelligent-brahmagupta-jq7jqj"],
    ]);
  });
  it("never on main or another branch, never with --no-publish, never other files", () => {
    expect(publishPlan(args, "main", files, "x").publish).toBe(false);
    expect(publishPlan(args, undefined, files, "x").publish).toBe(false);
    expect(publishPlan(parseArgs(["--no-publish"]), "claude/x", files, "x")).toMatchObject({ publish: false, reason: "--no-publish" });
    expect(publishPlan(args, "claude/x", [...files, "src/App.tsx"], "x").publish).toBe(false);
    expect(publishPlan(args, "claude/x", ["reports/../src/App.tsx"], "x").publish).toBe(false);
    expect(publishPlan(args, "claude/x", [], "x").publish).toBe(false);
  });
});

describe("capability probe", () => {
  it("reports presence of credentials by name, never their values", async () => {
    const caps = await probeCapabilities({
      mode: "local-desktop", env: { JARVIS_SYNC_URL: "https://bff.example", JARVIS_SYNC_TOKEN: "super-secret-token" }, platform: "linux",
      nodeVersion: "v22", chromium: null, which: (b) => b === "xclip",
    });
    expect(JSON.stringify(caps)).not.toContain("super-secret-token");
    expect(JSON.stringify(caps)).not.toContain("bff.example");
    expect(caps.find((c) => c.id === "mail.gmail")?.status).toBe("available");
    expect(caps.find((c) => c.id === "clipboard.system")).toMatchObject({ status: "available", detail: "xclip" });
    expect(caps.find((c) => c.id === "display")?.status).toBe("needs_hardware");
    expect(caps.find((c) => c.id === "browser.chromium")?.status).toBe("missing");
  });
});

describe("acceptance steps on the in-memory site", () => {
  const browser = () => Object.assign(new MemoryBrowser(), { screenshot: async () => false, close: async () => undefined });
  const caps = [{ id: "browser.chromium", status: "available" as const }, { id: "mail.gmail", status: "needs_hardware" as const }];
  const site = async () => ({ url: "http://yt.test/", close: async () => undefined });

  it("fixture mode: every step passes with the mock Gmail, voice is marked SIMULATED", async () => {
    const mail = new MockMail();
    const r = await runSteps(acceptanceSteps({ args: parseArgs(["--runs=2"]), capabilities: caps, startSite: site, makeBrowser: browser, mail: () => mail, shotPath: (id) => `reports/acceptance-t-${id}.png` }));
    expect(r.map((x) => [x.id, x.status])).toEqual([
      ["capabilities", "PASS"], ["browser", "PASS"], ["golden-1-7", "PASS"], ["selection-clipboard", "PASS"],
      ["voice", "SIMULATED"], ["full-1-8", "PASS"], ["cleanup", "PASS"],
    ]);
    expect(mail.sent).toHaveLength(1);
  });

  it("a real site without --send: the consent is shown and answered no, nothing is sent", async () => {
    let made = 0;
    const r = await runSteps(acceptanceSteps({ args: parseArgs(["--mode=managed-browser"]), capabilities: caps, startSite: site, makeBrowser: browser, mail: () => { made++; return new MockMail(); }, shotPath: (id) => id }));
    const full = r.find((x) => x.id === "full-1-8")!;
    expect(full.status).toBe("SIMULATED");
    expect(full.evidence).toMatch(/^draft mode: consent "Wysłać mail do Marcin Kubicki <draft@example.invalid>/);
    expect(made).toBe(0); // the real mail service is never even constructed
  });

  it("--send without a recipient or a Gmail backend is BLOCKED, not attempted", async () => {
    const r = await runSteps(acceptanceSteps({ args: parseArgs(["--mode=managed-browser", "--send"]), capabilities: caps, startSite: site, makeBrowser: browser, mail: () => { throw new Error("must not be built"); }, shotPath: (id) => id }));
    expect(r.find((x) => x.id === "full-1-8")).toMatchObject({ status: "BLOCKED" });
  });

  it("the draft-only mail refuses to send", async () => {
    const m = new DraftOnlyMail();
    await expect(m.send({ to: "a@b.c", subject: "s", body: "b" })).rejects.toThrow(/draft mode/);
  });

  it("no Chromium: the run stops at the first step with an instruction", async () => {
    const r = await runSteps(acceptanceSteps({ args: parseArgs([]), capabilities: [{ id: "browser.chromium", status: "missing" }], startSite: site, makeBrowser: browser, mail: () => new MockMail(), shotPath: (id) => id }));
    expect(r[0]).toMatchObject({ status: "FAIL" });
    expect(r.slice(1, 6).every((x) => x.status === "SKIP")).toBe(true);
  });
});
