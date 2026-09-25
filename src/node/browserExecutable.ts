// Which Chromium the managed browser uses on this machine. Order: explicit setting,
// JARVIS_CHROMIUM_PATH, Playwright's own download, then a system Chrome/Chromium. Returns null
// when none exists, so the capability is reported as missing instead of failing at launch.

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const SYSTEM_CANDIDATES: Record<string, string[]> = {
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
};

export function resolveBrowserExecutable(explicit?: string, platform: string = process.platform, exists: (p: string) => boolean = existsSync): string | null {
  const list = [explicit, process.env.JARVIS_CHROMIUM_PATH, safePlaywrightPath(), ...(SYSTEM_CANDIDATES[platform] ?? [])];
  for (const p of list) if (p && exists(p)) return p;
  return null;
}

function safePlaywrightPath(): string | undefined {
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}
