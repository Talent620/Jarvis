import { describe, it, expect, beforeEach } from "vitest";
import { startGeneration, cancelGeneration, isCurrent, resetGeneration } from "../src/lib/generation";

beforeEach(() => resetGeneration());

describe("strażnik generowania (Stop)", () => {
  it("świeży token jest aktualny", () => {
    const t = startGeneration();
    expect(isCurrent(t)).toBe(true);
  });

  it("Stop unieważnia bieżącą generację (spóźniona odpowiedź odrzucona)", () => {
    const t = startGeneration();
    cancelGeneration();
    expect(isCurrent(t)).toBe(false);
  });

  it("nowa generacja unieważnia poprzednią", () => {
    const a = startGeneration();
    const b = startGeneration();
    expect(isCurrent(a)).toBe(false);
    expect(isCurrent(b)).toBe(true);
  });

  it("po anulowaniu kolejna generacja znów jest aktualna", () => {
    startGeneration();
    cancelGeneration();
    const c = startGeneration();
    expect(isCurrent(c)).toBe(true);
  });
});
