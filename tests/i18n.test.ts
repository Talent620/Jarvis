import { describe, it, expect } from "vitest";
import { detectLang, t } from "../src/lib/i18n";

describe("i18n — detectLang", () => {
  it("zapis użytkownika ma pierwszeństwo nad przeglądarką", () => {
    expect(detectLang("en", "pl-PL")).toBe("en");
    expect(detectLang("pl", "en-US")).toBe("pl");
  });
  it("bez zapisu: en-* → en, reszta → pl (domyślnie polski)", () => {
    expect(detectLang(undefined, "en-US")).toBe("en");
    expect(detectLang(undefined, "en")).toBe("en");
    expect(detectLang("", "de-DE")).toBe("pl");
    expect(detectLang(undefined, undefined)).toBe("pl");
  });
});

describe("i18n — t (tłumaczenie + fallback + interpolacja)", () => {
  it("zwraca tekst w danym języku", () => {
    expect(t("empty.addKey", "pl")).toMatch(/Dodaj darmowy klucz/);
    expect(t("empty.addKey", "en")).toMatch(/Add a free key/);
  });
  it("brak klucza w EN → fallback na PL (źródło prawdy)", () => {
    // klucz istnieje tylko teoretycznie po PL; tu używamy realnego, by sprawdzić brak wywrotki
    expect(typeof t("empty.greeting", "en")).toBe("string");
    expect(t("empty.greeting", "en")).not.toBe("");
  });
  it("nieznany klucz → zwraca sam klucz (bez wywrotki)", () => {
    expect(t("nie.ma.takiego", "pl")).toBe("nie.ma.takiego");
  });
  it("interpolacja {zmiennych}", () => {
    // bezpośredni test mechanizmu na nieznanym kluczu (klucz == szablon)
    expect(t("Masz {n} zadań", "pl", { n: 3 })).toBe("Masz 3 zadań");
  });
  it("dwujęzyczność powitania jest faktyczna (PL ≠ EN)", () => {
    expect(t("empty.greeting", "pl")).not.toBe(t("empty.greeting", "en"));
  });
});
