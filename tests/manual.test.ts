import { describe, it, expect } from "vitest";
import { MANUAL, searchManual, manualCategories, type ManualEntry } from "../src/lib/manual";

describe("manual (instrukcja obsługi)", () => {
  it("każdy wpis ma komplet pól (jak uruchomić + do czego)", () => {
    for (const e of MANUAL) {
      expect(e.id, `id w ${e.title}`).toBeTruthy();
      expect(e.title).toBeTruthy();
      expect(e.how, `how w ${e.id}`).toBeTruthy();
      expect(e.what, `what w ${e.id}`).toBeTruthy();
      expect(e.category).toBeTruthy();
    }
  });

  it("identyfikatory są unikalne", () => {
    const ids = MANUAL.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puste zapytanie zwraca całą listę", () => {
    expect(searchManual("")).toHaveLength(MANUAL.length);
    expect(searchManual("   ")).toHaveLength(MANUAL.length);
  });

  it("znajduje po tytule", () => {
    const r = searchManual("łowca");
    expect(r.some((e) => e.id === "bargain")).toBe(true);
  });

  it("jest odporne na polskie znaki (bez ogonków też działa)", () => {
    expect(searchManual("lowca").some((e) => e.id === "bargain")).toBe(true);
    expect(searchManual("głos").some((e) => e.id === "voicemode")).toBe(true);
    expect(searchManual("glos").some((e) => e.id === "voicemode")).toBe(true);
  });

  it("ignoruje wielkość liter", () => {
    expect(searchManual("LEADY").some((e) => e.id === "sales")).toBe(true);
  });

  it("szuka po słowach kluczowych i opisie, nie tylko tytule", () => {
    expect(searchManual("crm").some((e) => e.id === "sales")).toBe(true); // keyword
    expect(searchManual("fiszki").some((e) => e.id === "cards")).toBe(true); // keyword/opis
  });

  it("wymaga obecności WSZYSTKICH słów zapytania", () => {
    const r = searchManual("reklamy google");
    expect(r.some((e) => e.id === "ads")).toBe(true);
    // słowo nieistniejące zawęża wynik do zera
    expect(searchManual("reklamy banan")).toHaveLength(0);
  });

  it("nieznane hasło → pusta lista", () => {
    expect(searchManual("xyzqwerty")).toHaveLength(0);
  });

  it("manualCategories zwraca kategorie w kolejności wystąpienia, bez duplikatów", () => {
    const cats = manualCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats[0]).toBe(MANUAL[0].category);
  });

  it("kluczowe funkcje są opisane", () => {
    const ids = new Set(MANUAL.map((e: ManualEntry) => e.id));
    for (const must of ["chat", "sales", "boss", "guardian", "settings", "recall"]) {
      expect(ids.has(must), `brakuje wpisu: ${must}`).toBe(true);
    }
  });
});
