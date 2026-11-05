import { describe, expect, it, vi } from "vitest";
import type { Browser, LaunchOptions } from "playwright-core";
import { installedBrowserCandidates, probeSandboxedBrowser } from "./helpers/browserPrerequisite";

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
