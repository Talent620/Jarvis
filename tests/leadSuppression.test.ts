// === Trwałe odrzucenie (leadSuppression) — testy ===
// Odrzucony kandydat NIE może wrócić przy kolejnym wyszukiwaniu bez świadomego cofnięcia.
import { describe, it, expect } from "vitest";
import { suppressionKey, addSuppression, removeSuppression, isSuppressed, filterSuppressed } from "../src/lib/leadSuppression";

const NOW = 1_000;

describe("leadSuppression — klucz i lista", () => {
  it("klucz z sourceId gdy jest; inaczej ze znormalizowanej nazwy", () => {
    expect(suppressionKey({ sourceId: "osm:123", company: "X" })).toBe("sid:osm:123");
    expect(suppressionKey({ company: "Salon Ola" })).toBe("co:salon-ola");
  });

  it("dodanie wyklucza; ta sama firma nie duplikuje wpisu", () => {
    let list = addSuppression([], { company: "Salon Ola" }, { reason: "nie moja nisza", now: NOW });
    list = addSuppression(list, { company: "Salon Ola" }, { reason: "znów", now: NOW + 1 });
    expect(list).toHaveLength(1);
    expect(isSuppressed(list, { company: "Salon Ola" })).toBe(true);
  });

  it("filterSuppressed usuwa wykluczonych z wyników wyszukiwania", () => {
    const list = addSuppression([], { sourceId: "osm:9", company: "Bar Beta" }, { reason: "x", now: NOW });
    const candidates = [
      { sourceId: "osm:9", company: "Bar Beta" },
      { sourceId: "osm:10", company: "Kawiarnia" },
    ];
    const out = filterSuppressed(candidates, list);
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe("Kawiarnia");
  });

  it("cofnięcie (undo) przywraca kandydata do kolejnych wyszukiwań", () => {
    const c = { company: "Salon Ola" };
    let list = addSuppression([], c, { reason: "pomyłka", now: NOW });
    expect(isSuppressed(list, c)).toBe(true);
    list = removeSuppression(list, suppressionKey(c));
    expect(isSuppressed(list, c)).toBe(false);
  });
});
