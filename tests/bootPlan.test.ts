import { describe, it, expect } from "vitest";
import { bootPlan } from "../src/components/Boot";

describe("Boot — skrócony splash po pierwszym uruchomieniu", () => {
  it("pierwsze uruchomienie = pełne premium (1900ms)", () => {
    expect(bootPlan(false).totalMs).toBe(1900);
  });
  it("kolejne uruchomienia = skrócone (<1000ms)", () => {
    expect(bootPlan(true).totalMs).toBeLessThan(1000);
    expect(bootPlan(true).stepMs).toBeLessThan(bootPlan(false).stepMs);
  });
});
