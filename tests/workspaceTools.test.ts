import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { inside, safeArgs } = require("../electron/workspace-tools.cjs");

describe("workspace tools safety", () => {
  it("blokuje wyjście poza katalog roboczy", () => {
    expect(() => inside("C:\\work", "..\\secret.txt")).toThrow(/poza katalog/);
    expect(() => inside("C:\\work", "../secret.txt")).toThrow(/poza katalog/);
    expect(() => inside("/work", "../secret.txt")).toThrow(/poza katalog/);
    expect(() => inside("/work", "..\\secret.txt")).toThrow(/poza katalog/);
    expect(() => inside("/work", "/workspace-sibling/secret.txt")).toThrow(/poza katalog/);
    expect(inside("C:\\work", "src")).toBe("C:\\work\\src");
    expect(inside("/work", "src")).toBe("/work/src");
  });

  it("blokuje wyjście przez dowiązanie symboliczne", () => {
    const temp = mkdtempSync(join(tmpdir(), "jarvis-boundary-"));
    const root = join(temp, "workspace");
    const outside = join(temp, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");

    try {
      expect(() => inside(root, "link/secret.txt")).toThrow(/dowiązanie symboliczne/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("blokuje destrukcyjne argumenty terminala i gita", () => {
    expect(() => safeArgs(["reset", "--hard"])).toThrow(/zablokowana/);
    expect(() => safeArgs(["clean", "-fd"])).toThrow(/zablokowana/);
    expect(safeArgs(["status", "--short"])).toEqual(["status", "--short"]);
  });

  it("blokuje niebezpieczne protokoły przeglądarki", async () => {
    const { createWorkspaceTools } = require("../electron/workspace-tools.cjs");
    const runtime = createWorkspaceTools({ root: join(tmpdir(), "jarvis-workspace-browser-test"), openExternal: async () => undefined });
    await expect(runtime.call("browser_open", { url: "file:///C:/secret.txt" })).resolves.toMatchObject({ ok: false });
  });
});
