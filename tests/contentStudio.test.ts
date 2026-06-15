import { describe, it, expect } from "vitest";
import { contentSystem, contentUserPrompt, PLATFORMS, TONES, saveContentPost } from "../src/lib/contentStudio";
import { store } from "../src/lib/store";

describe("contentStudio — generator postów", () => {
  it("ma 4 platformy z unikalnymi id", () => {
    expect(PLATFORMS).toHaveLength(4);
    expect(new Set(PLATFORMS.map((p) => p.id)).size).toBe(4);
    expect(PLATFORMS.map((p) => p.id)).toContain("instagram");
  });

  it("contentSystem dobiera zasady pod platformę", () => {
    expect(contentSystem("instagram")).toMatch(/hashtag/i);
    expect(contentSystem("tiktok")).toMatch(/reel|hak/i);
    expect(contentSystem("linkedin")).toMatch(/profesjonal/i);
    // zawsze: zwróć wyłącznie gotowy post
    expect(contentSystem("facebook")).toMatch(/WYŁĄCZNIE/);
  });

  it("contentUserPrompt zawiera temat, ton i markę gdy podane", () => {
    const p = contentUserPrompt({ platform: "instagram", topic: "promocja szparagów", tone: "sprzedażowy", brand: "Przempol" });
    expect(p).toContain("promocja szparagów");
    expect(p).toContain("sprzedażowy");
    expect(p).toContain("Przempol");
  });

  it("contentUserPrompt pomija markę/ton gdy puste", () => {
    const p = contentUserPrompt({ platform: "facebook", topic: "kulisy pracy" });
    expect(p).toContain("kulisy pracy");
    expect(p).not.toMatch(/Marka/);
    expect(p).not.toMatch(/Ton:/);
  });

  it("dostępne tony obejmują sprzedażowy i profesjonalny", () => {
    expect(TONES).toContain("sprzedażowy");
    expect(TONES).toContain("profesjonalny");
  });

  it("saveContentPost dokłada najnowszy na górę i pomija pusty", () => {
    store.setData((d) => { d.contentPosts = []; });
    saveContentPost("instagram", "temat A", "post A");
    saveContentPost("facebook", "temat B", "post B");
    saveContentPost("tiktok", "pusty", "   "); // pominięty
    expect(store.data.contentPosts).toHaveLength(2);
    expect(store.data.contentPosts[0].text).toBe("post B");
    expect(store.data.contentPosts[0].platform).toBe("facebook");
  });
});
