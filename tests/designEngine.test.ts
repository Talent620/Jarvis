import { describe, it, expect } from "vitest";
import { designSystemPrompt, parseDesignTokens, designTokensSummary, SELF_CRITIQUE_INSTRUCTION, DESIGN_TOKENS_MARK } from "../src/lib/designEngine";

// Premium Web Design Engine: testy pilnują (1) że prompt NIESIE metodologię (anti-template
// guard, restraint ruchu, tokeny, samokrytyka) i twarde zasady potoku, (2) że parser tokenów
// NIGDY nie rzuca i nie przepuszcza śmieci do UI (hex-y idą w inline style!).

const OPTS = { kindHint: "TYP: landing", styleHint: "STYL: swiss", isEdit: false, fullSpec: "KOMPLETNOŚĆ: sekcje..." };

describe("designSystemPrompt — metodologia obecna w prompcie", () => {
  const p = designSystemPrompt(OPTS);

  it("anti-template guard: trzy zakazane AI-looki wymienione wprost", () => {
    expect(p).toContain("ANTI-TEMPLATE GUARD");
    expect(p).toContain("#F4F1EA");            // krem + serif + terracotta
    expect(p).toMatch(/acid-green/i);           // czerń + kwaśny akcent
    expect(p).toMatch(/broadsheet/i);           // gazetowy layout z liniami
  });
  it("ruch = POWŚCIĄGLIWOŚĆ: expo-out, jeden moment, prefers-reduced-motion, bez bibliotek", () => {
    expect(p).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(p).toMatch(/One orchestrated moment/i);
    expect(p).toContain("prefers-reduced-motion");
    // Zaadaptowane z uploadu: zewnętrzne biblioteki animacji są ZAKAZANE (kontrakt jednego pliku)
    expect(p).toMatch(/NO external animation libraries/i);
  });
  it("samokrytyka (Faza 7): squint/template/Chanel/feeling/pacing/motion/30 000+", () => {
    expect(p).toMatch(/Squint test/i);
    expect(p).toMatch(/Chanel test/i);
    expect(p).toMatch(/Template test/i);
    expect(p).toContain("30 000+");
  });
  it("twarde zasady pliku: tylko kod od <!DOCTYPE html>, jeden plik, polska treść", () => {
    expect(p).toContain("<!DOCTYPE html>");
    expect(p).toContain("JEDEN plik HTML");
    expect(p).toMatch(/PO POLSKU/);
    expect(p).toContain("images.unsplash.com");
  });
  it("kontrakt tokenów: instrukcja osadzenia komentarza DESIGN-TOKENS w <head>", () => {
    expect(p).toContain(DESIGN_TOKENS_MARK);
    expect(p).toContain('"signature"');
    expect(p).toMatch(/inside <head>/i);
  });
  it("hierarchia: Brand Kit > temat; blueprint steruje STRUKTURĄ, filozofia WYKONANIEM", () => {
    expect(p).toMatch(/Brand Kit .*MUST derive/i);
    expect(p).toMatch(/plan wins on STRUCTURE/i);
  });
  it("nowa strona zawiera FULL_SPEC; edycja NIE (nie wymuszamy przebudowy)", () => {
    expect(p).toContain("KOMPLETNOŚĆ: sekcje...");
    const edit = designSystemPrompt({ ...OPTS, isEdit: true });
    expect(edit).not.toContain("KOMPLETNOŚĆ: sekcje...");
    // ale twarde zasady i filozofia zostają także przy edycji
    expect(edit).toContain("<!DOCTYPE html>");
    expect(edit).toContain("ANTI-TEMPLATE GUARD");
  });
  it("hint typu i stylu doklejone; SELF_CRITIQUE_INSTRUCTION niepusta (pętla Ulepsz)", () => {
    expect(p).toContain("TYP: landing");
    expect(p).toContain("STYL: swiss");
    expect(SELF_CRITIQUE_INSTRUCTION.length).toBeGreaterThan(20);
    expect(SELF_CRITIQUE_INSTRUCTION).toMatch(/PHASE 7/);
  });
});

describe("parseDesignTokens — parser NIGDY nie rzuca, śmieć nie przechodzi", () => {
  const VALID = {
    feeling: ["assured", "quiet", "expensive"],
    colors: [{ name: "Ink", hex: "#101014" }, { name: "Bone", hex: "#EDE9E3" }, { name: "Akcent", hex: "#c53" }],
    type: { display: "Fraunces", body: "Inter", mono: "IBM Plex Mono" },
    space: "8px scale, sections 160/80",
    signature: { element: "Kinetyczny nagłówek hero", why: "Kancelaria żyje słowem. Litery w ruchu to jej materiał." },
  };
  const htmlWith = (tokens: string) =>
    `<!doctype html><html><head><!-- DESIGN-TOKENS ${tokens} --><title>x</title></head><body></body></html>`;

  it("round-trip: poprawny komentarz → pełne tokeny", () => {
    const t = parseDesignTokens(htmlWith(JSON.stringify(VALID)));
    expect(t).not.toBeNull();
    expect(t!.feeling).toEqual(["assured", "quiet", "expensive"]);
    expect(t!.colors).toHaveLength(3);
    expect(t!.colors[2].hex).toBe("#c53"); // #rgb też poprawny
    expect(t!.type.display).toBe("Fraunces");
    expect(t!.signature.element).toContain("Kinetyczny");
  });
  it("brak komentarza / pusty / null-owy HTML → null (stare projekty bez paniki)", () => {
    expect(parseDesignTokens("<!doctype html><html></html>")).toBeNull();
    expect(parseDesignTokens("")).toBeNull();
    expect(parseDesignTokens(undefined as unknown as string)).toBeNull();
  });
  it("zepsuty JSON (w tym urwany przez „-->” w środku) → null, nie wyjątek", () => {
    expect(parseDesignTokens(htmlWith("{nie-json"))).toBeNull();
    // sekwencja --> WEWNĄTRZ JSON-a urywa komentarz — parser ma to przeżyć jako null
    expect(parseDesignTokens(htmlWith('{"signature":{"element":"x --> y"}}'))).toBeNull();
    expect(parseDesignTokens(htmlWith("[1,2,3]"))).toBeNull(); // tablica to nie tokeny
    expect(parseDesignTokens(htmlWith('"string"'))).toBeNull();
  });
  it("BEZPIECZEŃSTWO: hex idzie do inline style — wszystko poza #rgb/#rrggbb odpada", () => {
    const evil = { colors: [
      { name: "xss", hex: "red;background:url(javascript:alert(1))" },
      { name: "url", hex: "url(x)" },
      { name: "ok", hex: "#AABBCC" },
    ], signature: { element: "e", why: "w" } };
    const t = parseDesignTokens(htmlWith(JSON.stringify(evil)));
    expect(t!.colors).toHaveLength(1);
    expect(t!.colors[0].hex).toBe("#AABBCC");
  });
  it("przycinanie: za długie pola obcięte, max 8 kolorów, max 5 przymiotników", () => {
    const bloated = {
      feeling: Array.from({ length: 20 }, (_, i) => `adj${i}` + "x".repeat(200)),
      colors: Array.from({ length: 30 }, (_, i) => ({ name: `c${i}`, hex: "#112233" })),
      signature: { element: "e".repeat(999), why: "w".repeat(9999) },
    };
    const t = parseDesignTokens(htmlWith(JSON.stringify(bloated)));
    expect(t!.feeling).toHaveLength(5);
    expect(t!.feeling[0].length).toBeLessThanOrEqual(40);
    expect(t!.colors).toHaveLength(8);
    expect(t!.signature.element.length).toBeLessThanOrEqual(160);
    expect(t!.signature.why.length).toBeLessThanOrEqual(400);
  });
  it("kadłubek bez kolorów I bez signature → null (to nie są tokeny)", () => {
    expect(parseDesignTokens(htmlWith('{"feeling":["a"]}'))).toBeNull();
    expect(parseDesignTokens(htmlWith('{"space":"8px"}'))).toBeNull();
  });
  it("designTokensSummary składa tylko obecne pola, po ludzku", () => {
    const t = parseDesignTokens(htmlWith(JSON.stringify(VALID)))!;
    const s = designTokensSummary(t);
    expect(s).toContain("Charakter: assured · quiet · expensive");
    expect(s).toContain("Ink #101014");
    expect(s).toContain("Element-podpis: Kinetyczny nagłówek hero");
    // wariant minimalny: tylko signature
    const min = parseDesignTokens(htmlWith('{"signature":{"element":"X","why":""}}'))!;
    expect(designTokensSummary(min)).toBe("Element-podpis: X");
  });
});
