// Locate a Chromium for browser tests: JARVIS_CHROMIUM_PATH (set by scripts/cloud-setup.sh),
// the pinned Playwright's own download, the matching Chrome for Testing, then the image one.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

export function findChromium(): string {
  const candidates: string[] = [];
  if (process.env.JARVIS_CHROMIUM_PATH) candidates.push(process.env.JARVIS_CHROMIUM_PATH);
  candidates.push(chromium.executablePath());
  try {
    const browsers = JSON.parse(readFileSync("node_modules/playwright-core/browsers.json", "utf8")).browsers as { name: string; browserVersion?: string }[];
    const v = browsers.find((b) => b.name === "chromium")?.browserVersion;
    if (v) candidates.push(join(homedir(), ".cache", "jarvis-chrome", "chrome", `linux-${v}`, "chrome-linux64", "chrome"));
  } catch { /* no browsers.json */ }
  candidates.push("/opt/pw-browsers/chromium");
  const hit = candidates.find((c) => c && existsSync(c));
  if (!hit) throw new Error(`BLOCKED: no Chromium found for browser tests (tried: ${candidates.join(", ")}). Run scripts/cloud-setup.sh or npx playwright install chromium.`);
  return hit;
}
