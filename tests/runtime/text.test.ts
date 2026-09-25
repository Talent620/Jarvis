import { describe, it, expect, afterEach } from "vitest";
import { firstLetters, firstChars, firstWords, graphemes, isLetter, countLetters, countGraphemes, __setSegmenterForTests } from "../../src/lib/runtime/text";

afterEach(() => __setSegmenterForTests(undefined));

describe("graphemes and letters (mission 5.10)", () => {
  it("Łódź: four letters, Polish diacritics are letters", () => {
    expect(firstLetters("Łódź to miasto", 4).text).toBe("Łódź");
    expect(countLetters("Łódź")).toBe(4);
  });

  it("żółw", () => {
    const s = firstLetters("żółw", 4);
    expect(s).toMatchObject({ text: "żółw", start: 0, end: 4, complete: true });
  });

  it("@ at the start is not a letter", () => {
    const s = firstLetters("@marcin super", 4);
    expect(s.text).toBe("marc");
    expect(s.start).toBe(1);
    expect(s.end).toBe(5);
  });

  it("emoji at the start is skipped", () => {
    const text = "🔥 świetne";
    const s = firstLetters(text, 4);
    expect(s.text).toBe("świe");
    expect(text.slice(s.start, s.end)).toBe("świe");
  });

  it("emoji with skin tone modifiers is one grapheme and not a letter", () => {
    const text = "👍🏽👍🏿 Super";
    expect(graphemes(text).slice(0, 2).map((g) => g.text)).toEqual(["👍🏽", "👍🏿"]);
    expect(firstLetters(text, 4).text).toBe("Supe");
  });

  it("ZWJ family emoji is one grapheme", () => {
    expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    expect(firstLetters("👨‍👩‍👧 abcd", 4).text).toBe("abcd");
  });

  it("combining marks stay with their base letter", () => {
    const text = "école";
    const s = firstLetters(text, 2);
    expect(s.text).toBe("éc");
    expect(s.units).toEqual(["é", "c"]);
    expect(isLetter("é")).toBe(true);
  });

  it("NFD Polish letters (ó as o + combining acute) count once", () => {
    const text = "zółw";
    expect(countLetters(text)).toBe(4);
    expect(firstLetters(text, 4).text).toBe(text);
  });

  it("digits and punctuation are not letters; span stays contiguous", () => {
    expect(firstLetters("2024: rok", 3).text).toBe("rok");
    expect(firstLetters("a.b.c.d", 4).text).toBe("a.b.c.d");
    expect(firstLetters("Ala ma kota", 4).text).toBe("Ala m");
  });

  it("reports incomplete when fewer letters exist", () => {
    const s = firstLetters("🔥 ok!", 4);
    expect(s.text).toBe("ok");
    expect(s.complete).toBe(false);
    expect(firstLetters("🔥🔥", 2)).toMatchObject({ text: "", complete: false });
  });

  it("chars are graphemes after leading whitespace", () => {
    expect(firstChars("  🔥 świetne", 3).text).toBe("🔥 ś");
    expect(firstChars("Łódź", 2).text).toBe("Łó");
  });

  it("words are letter or digit runs", () => {
    expect(firstWords("@marcin super film!", 2).text).toBe("marcin super");
    expect(firstWords("🔥 świetne, naprawdę", 1).text).toBe("świetne");
  });

  it("fallback segmenter gives the same answers", () => {
    __setSegmenterForTests(null);
    expect(firstLetters("👍🏽 Łódź", 4).text).toBe("Łódź");
    expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    expect(countGraphemes("🇵🇱🇵🇱")).toBe(2);
    expect(firstLetters("école", 2).text).toBe("éc");
    expect(firstLetters("@marcin", 4).text).toBe("marc");
  });
});
