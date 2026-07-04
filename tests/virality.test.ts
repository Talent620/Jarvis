import { describe, it, expect } from "vitest";
import { viralityScore } from "../src/lib/virality";

describe("viralityScore — potencjał wiralności posta", () => {
  it("mocny post (hook+liczba+CTA+hashtagi+emoji+akapity) → wysoki wynik", () => {
    const post = "3 błędy, które zabijają Twój zasięg 🚀\n\nWiększość firm robi je codziennie.\n\nJak ich uniknąć? Zapisz ten post i napisz w komentarzu, który Cię zaskoczył.\n\n#marketing #zasieg #socialmedia";
    const r = viralityScore(post);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(["A", "B"]).toContain(r.grade);
  });

  it("słaby post (brak haka/CTA/hashtagów) → niski wynik i wskazówki", () => {
    const r = viralityScore("Oferujemy usługi tworzenia stron internetowych dla firm. Zapraszamy do kontaktu.");
    expect(r.score).toBeLessThan(55);
    expect(r.tips.length).toBeGreaterThan(0);
    expect(r.tips.join(" ")).toMatch(/CTA|HOOK|magnes/i);
  });

  it("pusty tekst nie wywala się", () => {
    expect(() => viralityScore("")).not.toThrow();
    expect(viralityScore("").grade).toBe("D");
  });
});
