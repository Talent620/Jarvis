import { describe, it, expect } from "vitest";
import { buildUtmUrl, normalizeUrl, utmIssues, UTM_PRESETS } from "../src/lib/utm";

describe("utm — normalizeUrl", () => {
  it("dokłada https:// gdy brak schematu", () => {
    expect(normalizeUrl("www.v-ai.pl")).toBe("https://www.v-ai.pl");
    expect(normalizeUrl("http://x.pl")).toBe("http://x.pl");
    expect(normalizeUrl("https://x.pl")).toBe("https://x.pl");
    expect(normalizeUrl("")).toBe("");
  });
});

describe("utm — buildUtmUrl", () => {
  it("dokleja tagi, małe litery dla source/medium, spacje → myślniki", () => {
    const u = buildUtmUrl({ url: "www.v-ai.pl", source: "Google", medium: "CPC", campaign: "Wiosna 2026" });
    expect(u).toBe("https://www.v-ai.pl?utm_source=google&utm_medium=cpc&utm_campaign=Wiosna-2026");
  });

  it("zachowuje istniejące query (separator &) i #hash", () => {
    const u = buildUtmUrl({ url: "https://x.pl/oferta?ref=1#cennik", source: "instagram", medium: "social" });
    expect(u).toBe("https://x.pl/oferta?ref=1&utm_source=instagram&utm_medium=social#cennik");
  });

  it("pomija puste tagi (term/content)", () => {
    const u = buildUtmUrl({ url: "x.pl", source: "tiktok", medium: "social", term: "", content: "  " });
    expect(u).toBe("https://x.pl?utm_source=tiktok&utm_medium=social");
    expect(u).not.toMatch(/utm_term|utm_content/);
  });

  it("pusty URL → pusty wynik", () => {
    expect(buildUtmUrl({ url: "", source: "google", medium: "cpc" })).toBe("");
  });
});

describe("utm — utmIssues i presety", () => {
  it("zgłasza braki adresu/źródła/medium", () => {
    expect(utmIssues({ url: "", source: "", medium: "" })).toHaveLength(3);
    expect(utmIssues({ url: "x.pl", source: "google", medium: "cpc" })).toHaveLength(0);
  });
  it("presety pokrywają reklamy, social i e-mail", () => {
    expect(UTM_PRESETS.some((p) => p.medium === "cpc")).toBe(true);
    expect(UTM_PRESETS.some((p) => p.medium === "social")).toBe(true);
    expect(UTM_PRESETS.some((p) => p.medium === "email")).toBe(true);
  });
});
