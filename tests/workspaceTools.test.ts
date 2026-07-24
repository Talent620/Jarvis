import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { inside, safeArgs } = require("../electron/workspace-tools.cjs");

describe("workspace tools safety", () => {
  it("blokuje wyjście poza katalog roboczy", () => {
    expect(() => inside("C:\\work", "..\\secret.txt")).toThrow(/poza katalog/);
    expect(inside("C:\\work", "src")).toBe("C:\\work\\src");
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
