// npm run jarvis:acceptance -- [--mode=fixture|managed-browser|local-desktop] [--runs=N]
//   [--send --to=<address>] [--no-publish] [--headless=false]
// Progressive local acceptance (mission M6). Writes reports/acceptance-<time>.md and .json and,
// on a mission branch (claude/*), commits and pushes only those report files.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, publishPlan, renderMarkdown, reportStem, runSteps, verdictOf, type AcceptanceReport } from "../../src/node/acceptance/core";
import { probeCapabilities } from "../../src/node/acceptance/capabilities";
import { acceptanceSteps } from "../../src/node/acceptance/steps";
import { backendGmailTransport } from "../../src/node/acceptance/gmailBackend";
import { ManagedBrowser } from "../../src/node/managedBrowser";
import { resolveBrowserExecutable } from "../../src/node/browserExecutable";
import { GmailMailService } from "../../src/lib/runtime/gmailService";
import { MockMail } from "../../tests/helpers/mockMail";
// @ts-expect-error plain ESM fixture without types
import { startYoutubeFixture } from "../../tests/fixtures/youtube/server.mjs";

const sh = (cmd: string, args: string[]): string | null => {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
};
const which = (bin: string) => sh(process.platform === "win32" ? "where" : "which", [bin]) !== null;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), process.env);
  const started = new Date();
  const stem = reportStem(started);
  mkdirSync("reports", { recursive: true });
  const chromium = resolveBrowserExecutable();
  const capabilities = await probeCapabilities({
    mode: args.mode, env: process.env, platform: process.platform, nodeVersion: process.version, chromium, which,
    reach: async (url) => {
      // Only a real answer from the site counts; a proxy refusal (403/407) means blocked.
      try { const r = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) }); return r.status >= 200 && r.status < 400; } catch { return false; }
    },
  });
  const display = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const headless = args.headless ?? (args.mode === "fixture" || !display);
  const clipTool = ["wl-paste", "xclip"].find(which);
  const readSystemClipboard = clipTool
    ? async () => sh(clipTool, clipTool === "wl-paste" ? ["--no-newline"] : ["-o", "-selection", "clipboard"])
    : undefined;
  const profiles: string[] = [];
  const steps = acceptanceSteps({
    args, capabilities,
    startSite: async () => {
      if (args.mode === "managed-browser") return { url: "https://www.youtube.com/", close: async () => undefined };
      const f = await startYoutubeFixture({ rerenderMs: 2000 });
      return { url: `${f.url}/`, close: () => f.close() };
    },
    makeBrowser: () => {
      const dir = mkdtempSync(join(tmpdir(), "jarvis-acceptance-"));
      profiles.push(dir);
      return new ManagedBrowser({
        userDataDir: dir, executablePath: chromium ?? undefined, headless,
        readClipboard: args.mode === "local-desktop" && readSystemClipboard ? async () => (await readSystemClipboard()) ?? "" : undefined,
      });
    },
    mail: () => {
      if (args.mode === "fixture") return new MockMail();
      return new GmailMailService(backendGmailTransport(process.env.JARVIS_SYNC_URL ?? "", process.env.JARVIS_SYNC_TOKEN ?? ""));
    },
    shotPath: (id) => `${stem}-${id}.png`,
    readSystemClipboard,
  });
  const results = await runSteps(steps);
  for (const p of profiles) rmSync(p, { recursive: true, force: true });

  const report: AcceptanceReport = {
    startedAt: started.toISOString(), finishedAt: new Date().toISOString(), mode: args.mode,
    args: { mode: args.mode, send: args.send, publish: args.publish, runs: args.runs, headless, to: args.to ? "set" : "unset" },
    host: { platform: `${process.platform}-${process.arch}`, node: process.version, branch: sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined, commit: sh("git", ["rev-parse", "--short", "HEAD"]) ?? undefined },
    capabilities, steps: results, verdict: verdictOf(results),
  };
  writeFileSync(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${stem}.md`, renderMarkdown(report));
  const files = [`${stem}.md`, `${stem}.json`, ...results.filter((r) => r.screenshot).map((r) => r.screenshot!)];
  console.log(renderMarkdown(report));
  console.log(`report: ${stem}.md`);

  const plan = publishPlan(args, report.host.branch, files, `${args.mode} ${report.verdict} (${results.filter((r) => r.status === "PASS").length}/${results.length} PASS)`);
  console.log(`publish: ${plan.reason}`);
  for (const [cmd, ...rest] of plan.commands) {
    try { execFileSync(cmd, rest, { stdio: "inherit" }); } catch { console.log(`publish step failed: ${cmd} ${rest[0]}`); break; }
  }
  return report.verdict === "FAIL" ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
