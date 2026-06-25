import { describe, it, expect } from "vitest";
import { cleanForSpeech, speechShape } from "../src/lib/voice";

describe("cleanForSpeech — tekst gotowy do wypowiedzenia", () => {
  it("zdejmuje pogrubienie/kursywę, zostawia słowa", () => {
    expect(cleanForSpeech("To jest **ważne** i *pilne*")).toBe("To jest ważne i pilne");
  });
  it("zamienia linki na slowo link (nie literuje URL-a)", () => {
    expect(cleanForSpeech("Wejdź na https://example.com/foo teraz")).toBe("Wejdź na link teraz");
    expect(cleanForSpeech("[mój sklep](https://x.pl)")).toBe("mój sklep");
  });
  it("usuwa nagłówki, punktory i numerację list", () => {
    expect(cleanForSpeech("# Tytuł\n- punkt a\n- punkt b")).toBe("Tytuł. punkt a. punkt b");
    expect(cleanForSpeech("1. raz\n2. dwa")).toBe("raz. dwa");
  });
  it("pomija blok kodu i zdejmuje backticki z kodu inline", () => {
    expect(cleanForSpeech("Uruchom `ollama serve` proszę")).toBe("Uruchom ollama serve proszę");
  });
  it("usuwa emoji, zachowuje wielokropek i myślnik", () => {
    expect(cleanForSpeech("Gotowe ✅ — działa 🚀… naprawdę")).toBe("Gotowe — działa… naprawdę");
  });
  it("nowa linia bez kropki dostaje pauzę-kropkę", () => {
    expect(cleanForSpeech("Cześć\nco słychać")).toBe("Cześć. co słychać");
  });
  it("nie wywala się i nie używa flagi /u (kompatybilność S9)", () => {
    expect(() => cleanForSpeech("A 😀 B")).not.toThrow();
    expect(cleanForSpeech("A 😀 B")).toBe("A B");
  });
  it("zwykłe zdanie zostaje nietknięte", () => {
    expect(cleanForSpeech("Mam dla Ciebie trzy pomysły na dziś.")).toBe("Mam dla Ciebie trzy pomysły na dziś.");
  });
});

describe("speechShape — naturalna wymowa skrótów i symboli", () => {
  it("rozwija skróty (np., itp., m.in., ok., nr, ul.)", () => {
    expect(speechShape("zrób np. to itp.")).toBe("zrób na przykład to i tym podobne");
    expect(speechShape("m.in. ok. 5 rzeczy")).toBe("między innymi około 5 rzeczy");
    expect(speechShape("nr 7 na ul. Główna")).toBe("numer 7 na ulica Główna");
  });
  it("czyta procenty i stopnie po ludzku", () => {
    expect(speechShape("wzrost o 50%")).toBe("wzrost o 50 procent");
    expect(speechShape("dziś 20°C")).toBe("dziś 20 stopni");
  });
  it("nie psuje zwykłego zdania", () => {
    expect(speechShape("Mam dla Ciebie trzy pomysły.")).toBe("Mam dla Ciebie trzy pomysły.");
  });
});
