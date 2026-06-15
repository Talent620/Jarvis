import { describe, it, expect } from "vitest";
import { adSystem, adUserPrompt, AD_PLATFORMS, AD_GOALS } from "../src/lib/adStudio";

describe("adStudio — generator reklam", () => {
  it("ma 2 platformy (Google, Meta)", () => {
    expect(AD_PLATFORMS.map((p) => p.id).sort()).toEqual(["google", "meta"]);
  });

  it("adSystem(google) wymusza limity i sekcje wyszukiwarki", () => {
    const s = adSystem("google");
    expect(s).toMatch(/30 znaków/);
    expect(s).toMatch(/90 znaków/);
    expect(s).toMatch(/SŁOWA KLUCZOWE/);
    expect(s).toMatch(/WYŁĄCZNIE/);
  });

  it("adSystem(meta) ma CTA, kreacje i grupę docelową", () => {
    const s = adSystem("meta");
    expect(s).toMatch(/CTA/);
    expect(s).toMatch(/KREACJE/);
    expect(s).toMatch(/GRUPA DOCELOWA/);
  });

  it("adUserPrompt zawiera produkt, odbiorcę, cel i budżet gdy podane", () => {
    const p = adUserPrompt({ platform: "google", product: "strony www", audience: "firmy z Poznania", goal: "leady/kontakty", budget: "30 zł/dzień" });
    expect(p).toContain("strony www");
    expect(p).toContain("firmy z Poznania");
    expect(p).toContain("leady/kontakty");
    expect(p).toContain("30 zł/dzień");
  });

  it("adUserPrompt pomija opcjonalne gdy puste", () => {
    const p = adUserPrompt({ platform: "meta", product: "szparagi" });
    expect(p).toContain("szparagi");
    expect(p).not.toMatch(/Grupa docelowa/);
    expect(p).not.toMatch(/Budżet/);
  });

  it("cele obejmują sprzedaż i leady", () => {
    expect(AD_GOALS).toContain("sprzedaż");
    expect(AD_GOALS).toContain("leady/kontakty");
  });

  it("adUserPrompt przycina bardzo długi produkt", () => {
    const p = adUserPrompt({ platform: "google", product: "y".repeat(5000) });
    expect(p.length).toBeLessThan(2100);
    expect(p).toContain("Produkt/usługa: ");
  });
});
