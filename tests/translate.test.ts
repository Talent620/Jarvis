import { describe, it, expect } from "vitest";
import { buildTranslatePrompt, cleanTranslation } from "../src/lib/translate";
import { LANGS, getLang } from "../src/lib/langs";

describe("silnik tłumaczenia — czyste funkcje", () => {
  it("buildTranslatePrompt nazywa język docelowy i zakazuje komentarzy", () => {
    const p = buildTranslatePrompt("ukraiński");
    expect(p).toMatch(/ukraiński/);
    expect(p).toMatch(/WY[ŁL]ĄCZNIE|tylko|wyłącznie/i);
  });

  it("cleanTranslation zdejmuje etykiety i cudzysłowy", () => {
    expect(cleanTranslation("Tłumaczenie: Dzień dobry")).toBe("Dzień dobry");
    expect(cleanTranslation("Translation: Hello")).toBe("Hello");
    expect(cleanTranslation("„Привіт”")).toBe("Привіт");
    expect(cleanTranslation('"Dobry wieczór"')).toBe("Dobry wieczór");
    expect(cleanTranslation("  Cześć  ")).toBe("Cześć");
  });

  it("cleanTranslation nie psuje normalnego zdania", () => {
    const s = "To jest normalne zdanie, bez etykiet.";
    expect(cleanTranslation(s)).toBe(s);
  });
});

describe("lista języków", () => {
  it("zawiera polski i ukraiński z kodami mowy/TTS", () => {
    const uk = getLang("uk");
    expect(uk.name).toBe("ukraiński");
    expect(uk.stt).toBe("uk-UA");
    expect(uk.tts).toBe("uk-UA");
    expect(getLang("pl").name).toBe("polski");
  });

  it("getLang dla nieznanego kodu zwraca polski (domyślny)", () => {
    expect(getLang("xx").code).toBe("pl");
  });

  it("każdy język ma komplet pól", () => {
    for (const l of LANGS) {
      expect(l.code && l.label && l.flag && l.name && l.stt && l.tts).toBeTruthy();
    }
  });
});
