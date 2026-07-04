import { describe, it, expect } from "vitest";
import { assessSocialFit, countHashtags, PLATFORM_LIMITS } from "../src/lib/socialFit";

describe("socialFit — countHashtags", () => {
  it("liczy hashtagi z polskimi znakami", () => {
    expect(countHashtags("super post #strony #firmaWKrakówie #design")).toBe(3);
    expect(countHashtags("bez hashtagów")).toBe(0);
  });
});

describe("socialFit — assessSocialFit", () => {
  it("Instagram: za mało hashtagów → wskazówka o sweet-spocie", () => {
    const r = assessSocialFit("instagram", "Krótki post bez tagów. #jeden");
    expect(r.hashtags).toBe(1);
    expect(r.issues.some((i) => /Mało hashtag/.test(i))).toBe(true);
  });

  it("TikTok: za dużo hashtagów → wskazówka", () => {
    const r = assessSocialFit("tiktok", "Hej #a #b #c #d #e #f #g");
    expect(r.issues.some((i) => /Za dużo hashtag/.test(i))).toBe(true);
  });

  it("ostrzega o progu widoczności przy długim tekście", () => {
    const r = assessSocialFit("tiktok", "x".repeat(150) + " #a #b #c");
    expect(r.issues.some((i) => /więcej/.test(i))).toBe(true);
  });

  it("przekroczenie twardego limitu znaków", () => {
    const r = assessSocialFit("instagram", "y".repeat(2300) + " #a #b #c #d #e");
    expect(r.issues.some((i) => /Za długie/.test(i))).toBe(true);
  });

  it("Facebook toleruje brak hashtagów (hashMin 0)", () => {
    const r = assessSocialFit("facebook", "Konwersacyjny post bez hashtagów, krótki.");
    expect(r.issues.some((i) => /Mało hashtag/.test(i))).toBe(false);
  });

  it("limity pokrywają wszystkie 4 platformy", () => {
    expect(Object.keys(PLATFORM_LIMITS)).toEqual(["instagram", "facebook", "tiktok", "linkedin"]);
  });
});
