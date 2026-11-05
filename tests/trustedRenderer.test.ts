import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { isTrustedAppUrl, isTrustedAppIpc } = require("../electron/trusted-renderer.cjs");
const appUrl = pathToFileURL(fileURLToPath(new URL("../dist/index.html", import.meta.url))).href;

describe("desktop IPC document boundary", () => {
  it("accepts application navigation and hash routes", () => {
    expect(isTrustedAppUrl(appUrl)).toBe(true);
    expect(isTrustedAppUrl(`${appUrl}#runtime`)).toBe(true);
  });
  it("rejects downloaded local HTML and remote documents", () => {
    for (const url of ["file:///tmp/download.html", "https://example.com", `${appUrl}?foreign=1`, `${appUrl}/other`, "about:blank"])
      expect(isTrustedAppUrl(url)).toBe(false);
  });
  it("rejects other windows and child frames even with the same URL", () => {
    const frame = { url: appUrl };
    const webContents = { mainFrame: frame };
    const window = { webContents, isDestroyed: () => false };
    expect(isTrustedAppIpc({ sender: webContents, senderFrame: frame }, window)).toBe(true);
    expect(isTrustedAppIpc({ sender: webContents, senderFrame: { url: appUrl } }, window)).toBe(false);
    expect(isTrustedAppIpc({ sender: { mainFrame: frame }, senderFrame: frame }, window)).toBe(false);
    frame.url = "file:///tmp/download.html";
    expect(isTrustedAppIpc({ sender: webContents, senderFrame: frame }, window)).toBe(false);
  });
});
