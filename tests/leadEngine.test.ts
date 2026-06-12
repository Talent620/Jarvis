// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseElement, nicheToOverpass, toOverpassBbox, buildOverpassQuery, saveLeads } from "../src/lib/leads";
import { store } from "../src/lib/store";

describe("silnik leadów (OSM) — czyste funkcje", () => {
  it("parseElement wyciąga nazwę, telefon, stronę, adres", () => {
    const el = { tags: { name: "Salon Ola", "contact:phone": "+48 600 100 200", website: "https://salonola.pl", "addr:street": "Rynek", "addr:housenumber": "5", "addr:city": "Kraków", shop: "hairdresser" } };
    const lead = parseElement(el)!;
    expect(lead.company).toBe("Salon Ola");
    expect(lead.phone).toBe("+48 600 100 200");
    expect(lead.website).toBe("https://salonola.pl");
    expect(lead.address).toBe("Rynek 5, Kraków");
    expect(lead.kind).toBe("hairdresser");
    expect(lead.hasWebsite).toBe(true);
  });

  it("parseElement: brak nazwy → null; brak strony → hasWebsite false", () => {
    expect(parseElement({ tags: { phone: "123" } })).toBeNull();
    expect(parseElement({ tags: { name: "Bar X", amenity: "bar" } })!.hasWebsite).toBe(false);
  });

  it("nicheToOverpass mapuje polskie nisze na tagi OSM (odporne na odmianę)", () => {
    expect(nicheToOverpass("fryzjer")).toContain("hairdresser");
    expect(nicheToOverpass("warsztat samochodowy")).toContain("car_repair");
    expect(nicheToOverpass("restauracja")).toContain("restaurant");
    expect(nicheToOverpass("coś dziwnego")).toBeNull(); // → szerokie wyszukiwanie
    expect(nicheToOverpass("")).toBeNull();
  });

  it("toOverpassBbox przestawia kolejność z Nominatim (S,W,N,E)", () => {
    // Nominatim: [minLat, maxLat, minLon, maxLon]
    const bb = toOverpassBbox(["50.0", "50.1", "19.9", "20.0"]);
    expect(bb).toEqual([50.0, 19.9, 50.1, 20.0]);
    expect(toOverpassBbox(["x", "y"])).toBeNull();
  });

  it("buildOverpassQuery: nisza → wąskie zapytanie; brak → szerokie (shop/craft/office)", () => {
    const bbox: [number, number, number, number] = [50, 19, 51, 20];
    expect(buildOverpassQuery(bbox, "fryzjer")).toContain("hairdresser");
    const broad = buildOverpassQuery(bbox);
    expect(broad).toContain('["shop"]');
    expect(broad).toContain('["craft"]');
    expect(broad).toContain('["office"]');
  });
});

describe("zapis leadów", () => {
  beforeEach(() => store.setData((d) => { d.leads = []; }));

  it("saveLeads dodaje nowe, dedupuje po nazwie, oznacza brak strony", () => {
    const raws = [
      { company: "Firma A", phone: "111", hasWebsite: false },
      { company: "Firma B", website: "https://b.pl", hasWebsite: true },
      { company: "firma a", hasWebsite: false }, // duplikat (case-insensitive)
    ];
    const added = saveLeads(raws as any, "fryzjer", "Kraków");
    expect(added).toHaveLength(2);
    const a = store.data.leads.find((l) => l.company === "Firma A")!;
    expect(a.contact).toBe("111");
    expect(a.note).toMatch(/Brak strony/);
    expect(a.location).toBe("Kraków");
  });
});
