import { describe, it, expect } from "vitest";
import { enhanceImagePrompt, IMAGE_STYLES } from "../src/lib/imagePrompt";

describe("enhanceImagePrompt — wzmacniacz promptu obrazu", () => {
  it("dodaje tokeny stylu i jakości do surowego opisu", () => {
    const out = enhanceImagePrompt("kawa na drewnianym stole", "product");
    expect(out).toMatch(/kawa na drewnianym stole/);
    expect(out).toMatch(/product photography/);
    expect(out).toMatch(/8k|masterpiece/);
  });
  it("auto i każdy styl daje niepusty, wzbogacony prompt", () => {
    for (const s of IMAGE_STYLES) {
      const out = enhanceImagePrompt("portret kobiety", s.id);
      expect(out.length).toBeGreaterThan("portret kobiety".length);
    }
  });
  it("nie dubluje, gdy prompt już bogaty (8k/photorealistic itp.)", () => {
    const rich = "a cat, photorealistic, 8k, masterpiece";
    expect(enhanceImagePrompt(rich, "auto")).toBe(rich);
  });
  it("pusty wejściowy → pusty", () => {
    expect(enhanceImagePrompt("", "auto")).toBe("");
    expect(enhanceImagePrompt("   ", "cinematic")).toBe("");
  });
});
