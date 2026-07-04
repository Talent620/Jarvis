// === Google Places jako źródło leadów (googlePlaces) — testy ===
// Płatne API MOCKOWANE (żadnych realnych zapytań). Sprawdzamy parser (nowe i stare API), brak klucza,
// błąd HTTP (429), oraz mapowanie na kandydatów z placeId jako stabilnym identyfikatorem (id_only).
import { describe, it, expect, vi } from "vitest";
import { parseGooglePlaces, searchGooglePlaces, googlePlacesToCandidates, type FetchLike } from "../src/lib/googlePlaces";

const NOW = 17_000_000_000;
const okResponse = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body } as Response);

describe("googlePlaces — parser", () => {
  it("nowe API v1 (places[]) → miejsca z placeId, nazwą, kontaktem", () => {
    const places = parseGooglePlaces({ places: [
      { id: "PL1", displayName: { text: "Fryzjer Ola" }, formattedAddress: "Kraków, Rynek 1", websiteUri: "https://ola.example", nationalPhoneNumber: "12 345 67 89" },
      { id: "PL2", displayName: { text: "Barber X" } },
    ] });
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({ placeId: "PL1", name: "Fryzjer Ola", website: "https://ola.example" });
  });

  it("stare API (results[]) też działa; dedup po placeId", () => {
    const places = parseGooglePlaces({ results: [
      { place_id: "PL9", name: "Salon A", formatted_address: "Warszawa", website: "https://a.example" },
      { place_id: "PL9", name: "Salon A (dup)" },
    ] });
    expect(places).toHaveLength(1);
    expect(places[0].placeId).toBe("PL9");
  });

  it("wpisy bez placeId/nazwy są pomijane", () => {
    expect(parseGooglePlaces({ places: [{ displayName: { text: "Bez id" } }, { id: "X" }] })).toHaveLength(0);
  });
});

describe("googlePlaces — wyszukiwanie (mock fetch)", () => {
  it("brak klucza → pusta lista (nie udajemy wyników), bez wywołania sieci", async () => {
    const fetchImpl = vi.fn();
    expect(await searchGooglePlaces("fryzjer Kraków", "", fetchImpl as unknown as FetchLike)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("klucz + wyniki → miejsca; wysyła textQuery i FieldMask", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ places: [{ id: "PL1", displayName: { text: "Fryzjer Ola" } }] }));
    const places = await searchGooglePlaces("fryzjer Kraków", "KEY", fetchImpl as unknown as FetchLike);
    expect(places).toHaveLength(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(init.body).toContain("fryzjer Kraków");
  });

  it("błąd HTTP (429) → rzuca (obsługa przez recoveryPolicy u wołającego)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as Response));
    await expect(searchGooglePlaces("x", "KEY", fetchImpl as unknown as FetchLike)).rejects.toThrow(/429/);
  });
});

describe("googlePlaces — mapowanie na kandydatów (placeId = id_only)", () => {
  it("kandydat z Google ma źródło google_places, sourceId=placeId i politykę id_only", () => {
    const cands = googlePlacesToCandidates([{ placeId: "PL1", name: "Fryzjer Ola", website: "https://ola.example", phone: "123" }], NOW);
    expect(cands[0].source).toBe("google_places");
    expect(cands[0].sourceId).toBe("PL1");
    expect(cands[0].persistencePolicy).toBe("id_only"); // Google: trwale tylko placeId
    expect(cands[0].contactability).toBe("phone");       // ma telefon → kontakt telefoniczny
  });

  it("miejsce tylko ze stroną (bez telefonu) → kontakt przez formularz", () => {
    const cands = googlePlacesToCandidates([{ placeId: "PL2", name: "Salon", website: "https://s.example" }], NOW);
    expect(cands[0].contactability).toBe("form");
  });
});
