import { describe, expect, it } from "vitest";
import { recommendLocalResearchAgent } from "../src/lib/localResearchAgent";

describe("local research agent hardware advisor", () => {
  it("dobiera 4B dla GTX 1050 Ti i 16 GB RAM", () => {
    const r = recommendLocalResearchAgent({ platform: "win32", cpu: "i5-6600K", cores: 4, ramGb: 16, gpu: "GTX 1050 Ti", vramGb: 4 });
    expect(r.model).toBe("qwen3.5:4b");
    expect(r.context).toBe(4096);
  });

  it("nie wciska dużego modelu na słaby sprzęt", () => {
    expect(recommendLocalResearchAgent({ platform: "linux", cpu: "x", cores: 2, ramGb: 8, gpu: "", vramGb: 0 }).model).toBe("qwen3:1.7b");
  });

  it("wykorzystuje 9B dopiero przy dużym zapasie pamięci", () => {
    expect(recommendLocalResearchAgent({ platform: "linux", cpu: "x", cores: 12, ramGb: 32, gpu: "RTX", vramGb: 12 }).model).toBe("qwen3.5:9b");
  });
});
