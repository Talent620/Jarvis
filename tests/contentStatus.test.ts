// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { saveContentPost, markContentPublished, contentStatusOf, isPublished, CONTENT_STATUS_LABEL } from "../src/lib/contentStudio";
import { store } from "../src/lib/store";

describe("contentStudio — uczciwy status (wygenerowanie ≠ publikacja)", () => {
  beforeEach(() => { store.setData((d) => { d.contentPosts = []; }); });

  it("nowy post jest SZKICEM, nie publikacją", () => {
    saveContentPost("instagram", "promo", "Treść posta");
    const p = store.data.contentPosts[0];
    expect(contentStatusOf(p)).toBe("draft");
    expect(isPublished(p)).toBe(false);
  });

  it("ręczne oznaczenie → published_manual + publishedAt", () => {
    saveContentPost("facebook", "oferta", "Tekst");
    const id = store.data.contentPosts[0].id;
    markContentPublished(id, 12345);
    const p = store.data.contentPosts.find((x) => x.id === id)!;
    expect(p.status).toBe("published_manual");
    expect(p.publishedAt).toBe(12345);
    expect(isPublished(p)).toBe(true);
  });

  it("stary post bez statusu liczy się jako draft (kompatybilność wsteczna)", () => {
    store.setData((d) => { d.contentPosts = [{ id: "old", platform: "tiktok", topic: "x", text: "y", at: 1 } as any]; });
    expect(contentStatusOf(store.data.contentPosts[0])).toBe("draft");
    expect(isPublished(store.data.contentPosts[0])).toBe(false);
  });

  it("etykiety statusów istnieją dla każdego stanu", () => {
    for (const s of ["draft", "ready", "published_manual", "published_confirmed", "failed"] as const) {
      expect(CONTENT_STATUS_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});
