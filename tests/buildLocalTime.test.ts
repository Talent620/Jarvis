import { describe, it, expect } from "vitest";
import { buildLocalTime } from "../src/lib/updater";

describe("updater — buildLocalTime (UTC → czas lokalny)", () => {
  it("parsuje znacznik UTC i zwraca niepustą datę lokalną", () => {
    const out = buildLocalTime("2026-06-30 13:44");
    expect(out).not.toBe("");
    expect(out).toMatch(/2026/);
  });

  it("nieparsowalne / puste → pusty string (bez wywałki)", () => {
    expect(buildLocalTime("")).toBe("");
    expect(buildLocalTime("dev")).toBe("");
    expect(buildLocalTime("brzydka data")).toBe("");
  });

  it("akceptuje znacznik z sekundami/sufiksem (bierze pierwsze 16 znaków)", () => {
    expect(buildLocalTime("2026-06-30 13:44:59")).not.toBe("");
  });
});
