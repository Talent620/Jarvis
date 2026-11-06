import { describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright-core";
import { browserErrorDetail, browserPrerequisiteSummary, installedBrowserCandidates, probeSandboxedBrowser } from "./helpers/browserPrerequisite";

function renderer(title = "JARVIS sandbox precondition") {
  const close = vi.fn(async () => {});
  return { close, browser: { close, version: () => "controlled-unit-fixture",
    newPage: vi.fn(async () => ({ setContent: vi.fn(async () => {}), title: async () => title })),
  } as unknown as Browser };
}
const resolveExecutable = async (path: string) => path;

describe("sandboxed browser prerequisite (unit regressions, not native execution)", () => {
  it("tries the installed Chrome after a known Chromium sandbox failure without relaxing launch options", async () => {
    const { browser, close } = renderer();
    const launch = vi.fn(async (options: LaunchOptions) => {
      if (options.executablePath === "/distro/chromium") throw new Error("Chromium sandboxing failed! No usable sandbox!");
      return browser;
    });
    const result = await probeSandboxedBrowser({ candidates: ["/distro/chromium", "/opt/google/chrome/chrome"], resolveExecutable, launch });
    expect(result).toMatchObject({ status: "READY", selectedExecutable: "/opt/google/chrome/chrome", chromiumSandbox: true });
    expect(result.attempts.map(a => a.status)).toEqual(["BLOCKED", "READY"]);
    expect(close).toHaveBeenCalledOnce();
    for (const [options] of launch.mock.calls) {
      expect(options).toMatchObject({ chromiumSandbox: true, headless: true, timeout: 15000 });
      expect(options.args).toBeUndefined();
      expect(options.ignoreDefaultArgs).toBeUndefined();
    }
  });

  it("reports every unusable sandbox as BLOCKED with no selected browser", async () => {
    const launch = vi.fn(async () => { throw new Error("No usable sandbox!"); });
    const result = await probeSandboxedBrowser({ candidates: ["/first", "/second"], resolveExecutable, launch });
    expect(result).toMatchObject({ status: "BLOCKED", selectedExecutable: null, browserVersion: null });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every(a => a.code === "SANDBOX_UNAVAILABLE")).toBe(true);
  });

  it("keeps unexpected failures as FAIL instead of hiding them behind a fallback", async () => {
    const launch = vi.fn(async () => { throw new Error("unexpected transport implementation failure"); });
    const result = await probeSandboxedBrowser({ candidates: ["/first", "/second"], resolveExecutable, launch });
    expect(result.status).toBe("FAIL");
    expect(result.attempts[0].code).toBe("UNEXPECTED_PROBE_FAILURE");
    expect(result.attempts[0]).toMatchObject({ phase: "launch", errorDetail: "unexpected transport implementation failure" });
    expect(result.attempts[0].errorSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(browserPrerequisiteSummary(result).slice(0, 240)).toContain("launch FAIL: unexpected transport implementation failure");
    expect(launch).toHaveBeenCalledOnce();
  });

  it("puts useful stderr and process-exit evidence ahead of verbose launch flags", () => {
    const detail = browserErrorDetail(new Error([
      "browserType.launch: Target page, context or browser has been closed",
      "Browser logs:",
      "<launching> /opt/google/chrome/google-chrome " + "--verbose-fixture ".repeat(1000),
      "[pid=123][err] FATAL: failed to initialize renderer resource",
      "[pid=123] <process did exit: exitCode=null, signal=SIGTRAP>",
      "Call log:",
      "  - <launching> /opt/google/chrome/google-chrome --verbose-fixture",
      "  at synthetic stack frame",
    ].join("\n")));
    expect(detail).toMatch(/^\[pid=123\]\[err\] FATAL:/);
    expect(detail).toContain("exitCode=null, signal=SIGTRAP");
    expect(detail).not.toContain("verbose-fixture");
    expect(detail).not.toContain("stack frame");
    expect(detail.length).toBeLessThanOrEqual(1800);
  });

  it("redacts URL credentials/query/fragment, auth and key values before bounding diagnostic output", () => {
    const detail = browserErrorDetail([
      "ERROR https://user-secret:password-secret@example.test/path?token=query-secret#fragment-secret",
      "Authorization: Bearer header-secret",
      "api_key='quoted secret' token=token-secret password=pass-secret key=key-secret",
      'payload {"client_secret":"json-secret","access_token":"access-secret"}',
      "Cookie: session=cookie-secret",
      "Basic YXV0aDpzZWNyZXQ= sk-12345678901234567890 github_pat_12345678901234567890",
      "x".repeat(10000),
    ].join("\n"));
    for (const value of ["user-secret", "password-secret", "query-secret", "fragment-secret", "header-secret", "quoted secret", "token-secret", "pass-secret", "key-secret", "json-secret", "access-secret", "cookie-secret", "YXV0aDpzZWNyZXQ=", "12345678901234567890"]) expect(detail).not.toContain(value);
    expect(detail).toContain("[REDACTED");
    expect(detail.length).toBeLessThanOrEqual(1800);
  });

  it("identifies the renderer phase, preserves cleanup diagnostics and does not retry unknown failure", async () => {
    const { browser, close } = renderer();
    close.mockRejectedValue(new Error("close channel unexpectedly failed"));
    vi.mocked(browser.newPage).mockRejectedValue(new Error("newPage resource failure"));
    const launch = vi.fn(async () => browser);
    const result = await probeSandboxedBrowser({ candidates: ["/first", "/second"], resolveExecutable, launch });
    expect(result).toMatchObject({ status: "FAIL", attempts: [{ phase: "new_page", errorDetail: "newPage resource failure", cleanupErrorDetail: "close channel unexpectedly failed" }] });
    expect(launch).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("leads the public summary with the actual failed attempt even after missing candidates", async () => {
    const launch = vi.fn(async () => { throw new Error("process launch ECONNRESET diagnostic"); });
    const result = await probeSandboxedBrowser({ candidates: ["/absent", "/present", "/later"], resolveExecutable: async path => {
      if (path === "/absent") throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return path;
    }, launch });
    expect(result.status).toBe("FAIL");
    expect(result.attempts.map(attempt => attempt.code)).toEqual(["EXECUTABLE_MISSING", "UNEXPECTED_PROBE_FAILURE"]);
    expect(browserPrerequisiteSummary(result)).toMatch(/^launch FAIL: process launch ECONNRESET diagnostic/);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("records absent executables without launching anything or downloading a browser", async () => {
    const launch = vi.fn();
    const result = await probeSandboxedBrowser({ candidates: ["/absent"], resolveExecutable: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, launch });
    expect(result).toMatchObject({ status: "BLOCKED", attempts: [{ code: "EXECUTABLE_MISSING" }] });
    expect(launch).not.toHaveBeenCalled();
  });

  it("requires a correct renderer result and closes the owned failed probe", async () => {
    const { browser, close } = renderer("wrong-title");
    expect((await probeSandboxedBrowser({ candidates: ["/probe"], resolveExecutable, launch: async () => browser })).status).toBe("FAIL");
    expect(close).toHaveBeenCalledOnce();
  });

  it("recognizes hosted system Chrome while respecting an explicitly configured executable", () => {
    expect(installedBrowserCandidates()).toContain("/opt/google/chrome/chrome");
    expect(installedBrowserCandidates("/owner/chrome")).toEqual(["/owner/chrome"]);
  });
});
