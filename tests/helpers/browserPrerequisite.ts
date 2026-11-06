import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";

export interface BrowserAttempt {
  executable: string;
  status: "READY" | "BLOCKED" | "FAIL";
  reason: string;
  code: string;
  errorSha256?: string;
  phase?: "inspect_executable" | "launch" | "new_page" | "set_content" | "read_title" | "read_version" | "close";
  errorDetail?: string;
  cleanupErrorDetail?: string;
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

/** Only bounded diagnostic text is public. Never serialize launch options or the environment. */
export function browserErrorDetail(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*[A-Za-z]", "g"), "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/gi, "[REDACTED URL]")
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, "[REDACTED HEADER]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED AUTH]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passphrase|credentials?|authorization|cookie|key)["']?\s*(?:[:=]\s*|\s+))(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(/\p{Cc}/gu, character => character === "\n" || character === "\t" ? character : "");
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^Call log:|^Browser logs:|<launching>|^[-\s]*at\s/.test(line));
  const priority = (line: string) => /\[err\].*(?:FATAL|ERROR|failed|cannot|denied|not found|exception)/i.test(line) ? 0
    : /(?:process did exit|exitCode=|signal=)/i.test(line) ? 1 : /\[err\]/.test(line) ? 2 : 3;
  const unique = [...new Set(lines)];
  // Stable sort leaves original ordering within each priority, including the first error line.
  unique.sort((a, b) => priority(a) - priority(b));
  return unique.slice(0, 6).map(line => line.slice(0, 300)).join(" | ").slice(0, 1800) || "(no error detail)";
}

export function browserPrerequisiteSummary(result: BrowserPrerequisite): string {
  return result.attempts.filter(attempt => attempt.status !== "READY").sort((a, b) => Number(b.status === "FAIL") - Number(a.status === "FAIL")).map(attempt =>
    `${attempt.phase || "prerequisite"} ${attempt.status}: ${attempt.errorDetail || attempt.reason}; code=${attempt.code}; executable=${browserErrorDetail(attempt.executable).slice(0, 300)}${attempt.cleanupErrorDetail ? `; cleanup=${attempt.cleanupErrorDetail}` : ""}`,
  ).join("; ").slice(0, 2400);
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
        result.attempts.push({ executable: candidate, status: "FAIL", code: "EXECUTABLE_INSPECTION_FAILED", reason: "Nieoczekiwany błąd odczytu pliku wykonywalnego.", phase: "inspect_executable", errorDetail: browserErrorDetail(error), errorSha256: createHash("sha256").update(error instanceof Error ? error.message : String(error)).digest("hex") });
        return { ...result, status: "FAIL" };
      }
      result.attempts.push({ executable: candidate, status: "BLOCKED", code: "EXECUTABLE_MISSING", reason: "Nie znaleziono zainstalowanego pliku wykonywalnego." });
      continue;
    }
    if (visited.has(executable)) continue;
    visited.add(executable);
    let browser: Browser | undefined;
    let phase: BrowserAttempt["phase"] = "launch";
    try {
      browser = await launch({ executablePath: executable, headless: true, chromiumSandbox: true, timeout: 15000 });
      phase = "new_page";
      const page = await browser.newPage({ serviceWorkers: "block", ignoreHTTPSErrors: false });
      phase = "set_content";
      await page.setContent("<!doctype html><title>JARVIS sandbox precondition</title>", { timeout: 5000 });
      phase = "read_title";
      if (await page.title() !== "JARVIS sandbox precondition") throw new Error("Renderer probe returned an unexpected title.");
      phase = "read_version";
      const version = browser.version();
      phase = "close";
      await browser.close(); browser = undefined;
      result.attempts.push({ executable, status: "READY", code: "SANDBOXED_RENDERER_STARTED", reason: "Uruchomiono i zamknięto własny sandboxowany renderer; brak kontaktu z internetem." });
      return { ...result, status: "READY", selectedExecutable: executable, browserVersion: version };
    } catch (error) {
      let cleanupFailed = false;
      let cleanupErrorDetail: string | undefined;
      if (browser) { try { await browser.close(); } catch (cleanupError) { cleanupFailed = true; cleanupErrorDetail = browserErrorDetail(cleanupError); } }
      const known = cleanupFailed ? null : knownPrerequisiteFailure(error);
      result.attempts.push({ executable, status: known ? "BLOCKED" : "FAIL", code: known?.code || "UNEXPECTED_PROBE_FAILURE",
        reason: known?.reason || "Nieoczekiwany błąd próby renderera; nie uznano go za brak środowiska.",
        errorSha256: createHash("sha256").update(error instanceof Error ? error.message : String(error)).digest("hex"),
        phase, errorDetail: browserErrorDetail(error), ...(cleanupErrorDetail ? { cleanupErrorDetail } : {}),
      });
      if (!known) return { ...result, status: "FAIL" };
    }
  }
  return result;
}
