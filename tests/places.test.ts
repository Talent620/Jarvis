import { describe, it, expect } from "vitest";
import {
  mapLinks,
  parsePlaces,
  normalizePlaces,
  rankPlaces,
  buildPlacesPrompt,
  type Place,
} from "../src/lib/places";

describe("mapLinks", () => {
  it("buduje linki do map i wyszukiwarki z zakodowanym zapytaniem", () => {
    const links = mapLinks("wiertarka Bosch", "Kraków");
    const names = links.map((l) => l.name);
    expect(names).toContain("Mapy Google");
    expect(names).toContain("Szukaj w Google");
    const g = links.find((l) => l.name === "Mapy Google")!;
    expect(g.url).toContain("query=wiertarka%20Bosch%20sklep%20Krak");
  });

  it("dodaje link z dokładną pozycją, gdy są współrzędne", () => {
    const links = mapLinks("apteka", "", { lat: 52.23, lon: 21.01 });
    const here = links.find((l) => l.name === "Mapy Google (tu)")!;
    expect(here.url).toContain("@52.23,21.01,13z");
  });

  it("dla pustego zapytania zwraca pustą listę", () => {
    expect(mapLinks("   ")).toEqual([]);
  });
});

describe("parsePlaces", () => {
  it("parsuje czysty JSON", () => {
    const raw = '{"place":"Kraków","places":[{"name":"Sklep A","address":"ul. X 1","distanceKm":1.2,"price":199,"currency":"PLN","hours":"9-18"}],"tips":["Zadzwoń wcześniej"]}';
    const r = parsePlaces(raw)!;
    expect(r.place).toBe("Kraków");
    expect(r.places).toHaveLength(1);
    expect(r.places[0].distanceKm).toBe(1.2);
    expect(r.tips).toEqual(["Zadzwoń wcześniej"]);
  });

  it("radzi sobie z markdownem i jednostkami w liczbach", () => {
    const raw = '```json\n{"places":[{"name":"B","distanceKm":"2,5 km","price":"1 299 zł"}]}\n```';
    const r = parsePlaces(raw)!;
    expect(r.places[0].distanceKm).toBe(2.5);
    expect(r.places[0].price).toBe(1299);
  });

  it("odrzuca miejsca bez nazwy", () => {
    const raw = '{"places":[{"address":"bez nazwy","distanceKm":1},{"name":"OK","distanceKm":2}]}';
    const r = parsePlaces(raw)!;
    expect(r.places).toHaveLength(1);
    expect(r.places[0].name).toBe("OK");
  });

  it("zwraca null dla śmieci", () => {
    expect(parsePlaces("brak json")).toBeNull();
  });
});

describe("normalizePlaces", () => {
  it("pomija nieprawidłowy url i puste pola", () => {
    const p = normalizePlaces([{ name: "X", url: "nie-url", address: "  " }]);
    expect(p[0].url).toBeUndefined();
    expect(p[0].address).toBeUndefined();
  });
});

describe("rankPlaces", () => {
  const places: Place[] = [
    { name: "Blisko drogo", distanceKm: 1, price: 250, currency: "PLN" },
    { name: "Daleko tanio", distanceKm: 8, price: 150, currency: "PLN" },
    { name: "Średnio", distanceKm: 4, price: 200, currency: "PLN" },
    { name: "Bez ceny", distanceKm: 2 },
  ];
  it("sortuje po odległości", () => {
    const r = rankPlaces(places);
    expect(r.byDistance.map((p) => p.distanceKm)).toEqual([1, 2, 4, 8]);
  });
  it("wskazuje najbliższe", () => {
    expect(rankPlaces(places).nearest!.name).toBe("Blisko drogo");
  });
  it("wskazuje tańsze, ale dalej (różne od najbliższego)", () => {
    const r = rankPlaces(places);
    expect(r.cheaperFar!.name).toBe("Daleko tanio");
    expect(r.cheaperFar!.price).toBe(150);
  });
  it("gdy brak cen, cheaperFar jest null", () => {
    const r = rankPlaces([{ name: "A", distanceKm: 1 }, { name: "B", distanceKm: 3 }]);
    expect(r.cheaperFar).toBeNull();
  });
  it("nie wskazuje cheaperFar, gdy najtańsze jest też najbliższe", () => {
    const r = rankPlaces([
      { name: "Najbliżej i najtaniej", distanceKm: 1, price: 100 },
      { name: "Dalej drożej", distanceKm: 5, price: 200 },
    ]);
    expect(r.cheaperFar).toBeNull();
  });
});

describe("buildPlacesPrompt", () => {
  it("zawiera lokalizację i wymóg JSON", () => {
    const p = buildPlacesPrompt("Wrocław");
    expect(p).toContain("Wrocław");
    expect(p.toLowerCase()).toContain("json");
    expect(p).toContain("distanceKm");
  });
});
