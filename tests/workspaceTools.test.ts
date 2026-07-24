import { createRequire } from "node:module";
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
});
