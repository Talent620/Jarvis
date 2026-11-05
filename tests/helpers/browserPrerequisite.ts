import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";

export interface BrowserAttempt {
  executable: string;
  status: "READY" | "BLOCKED" | "FAIL";
  reason: string;
  code: string;
  errorSha256?: string;
}
export interface BrowserPrerequisite {
  status: "READY" | "BLOCKED" | "FAIL";
  selectedExecutable: string | null;
  browserVersion: string | null;
  attempts: BrowserAttempt[];
  chromiumSandbox: true;
  mode: "headless sandboxed browser prerequisite, not desktop or agent acceptance";
}

export function installedBrowserCandidates(configured?: string): string[] {
  // An explicit configuration must be tested as-is. Otherwise prefer installed
  // Chrome before distro wrappers (e.g. Ubuntu's Chromium snap launcher).
  return configured ? [configured] : [
    "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/opt/google/chrome/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
}

function knownPrerequisiteFailure(error: unknown): { code: string; reason: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/Chromium sandboxing failed|No usable sandbox|Failed to move to new namespace|Running as root without --no-sandbox/i.test(message)) {
    return { code: "SANDBOX_UNAVAILABLE", reason: "Systemowy Chromium nie może uruchomić wymaganego sandboxa. Zabezpieczenia pozostają włączone." };
  }
  if (/error while loading shared libraries|Host system is missing dependencies|cannot open shared object file/i.test(message)) {
    return { code: "SYSTEM_DEPENDENCY_MISSING", reason: "Brakuje bibliotek systemowych wymaganych przez ten zainstalowany Chromium; niczego nie instalowano." };
  }
  return null;
}

/** A real renderer probe, independent from the product adapter. It never installs
 * browsers, alters sandbox policy, or turns an unexpected failure into a skip. */
export async function probeSandboxedBrowser(options: {
  candidates?: string[];
  resolveExecutable?: (path: string) => Promise<string>;
  launch?: (options: LaunchOptions) => Promise<Browser>;
} = {}): Promise<BrowserPrerequisite> {
  const result: BrowserPrerequisite = {
    status: "BLOCKED", selectedExecutable: null, browserVersion: null, attempts: [],
    chromiumSandbox: true, mode: "headless sandboxed browser prerequisite, not desktop or agent acceptance",
  };
  const resolveExecutable = options.resolveExecutable || realpath;
  const launch = options.launch || chromium.launch.bind(chromium);
  const visited = new Set<string>();
  for (const candidate of options.candidates || installedBrowserCandidates(process.env.JARVIS_BROWSER_EXECUTABLE)) {
    let executable: string;
    try { executable = await resolveExecutable(candidate); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        result.attempts.push({ executable: candidate, status: "FAIL", code: "EXECUTABLE_INSPECTION_FAILED", reason: "Nieoczekiwany błąd odczytu pliku wykonywalnego." });
        return { ...result, status: "FAIL" };
      }
      result.attempts.push({ executable: candidate, status: "BLOCKED", code: "EXECUTABLE_MISSING", reason: "Nie znaleziono zainstalowanego pliku wykonywalnego." });
      continue;
    }
    if (visited.has(executable)) continue;
    visited.add(executable);
    let browser: Browser | undefined;
    try {
      browser = await launch({ executablePath: executable, headless: true, chromiumSandbox: true, timeout: 15000 });
      const page = await browser.newPage({ serviceWorkers: "block", ignoreHTTPSErrors: false });
      await page.setContent("<!doctype html><title>JARVIS sandbox precondition</title>", { timeout: 5000 });
      if (await page.title() !== "JARVIS sandbox precondition") throw new Error("Renderer probe returned an unexpected title.");
      const version = browser.version();
      await browser.close(); browser = undefined;
      result.attempts.push({ executable, status: "READY", code: "SANDBOXED_RENDERER_STARTED", reason: "Uruchomiono i zamknięto własny sandboxowany renderer; brak kontaktu z internetem." });
      return { ...result, status: "READY", selectedExecutable: executable, browserVersion: version };
    } catch (error) {
      let cleanupFailed = false;
      if (browser) { try { await browser.close(); } catch { cleanupFailed = true; } }
      const known = cleanupFailed ? null : knownPrerequisiteFailure(error);
      result.attempts.push({ executable, status: known ? "BLOCKED" : "FAIL", code: known?.code || "UNEXPECTED_PROBE_FAILURE",
        reason: known?.reason || "Nieoczekiwany błąd próby renderera; nie uznano go za brak środowiska.",
        errorSha256: createHash("sha256").update(error instanceof Error ? error.message : String(error)).digest("hex"),
      });
      if (!known) return { ...result, status: "FAIL" };
    }
  }
  return result;
}
