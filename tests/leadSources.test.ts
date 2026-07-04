// === Zunifikowany rejestr źródeł (leadSources) — testy ===
// UI ma UCZCIWIE pokazywać, które źródło jest live/fallback/sample/niedostępne. OSM darmowe offline-first;
// płatne live tylko z kluczem i online; CEIDG live tylko gdy adapter podłączony; mock zawsze sample.
import { describe, it, expect } from "vitest";
import { describeLeadSources, liveSources, sourceBadge } from "../src/lib/leadSources";

const byId = (cfg: Parameters<typeof describeLeadSources>[0]) => Object.fromEntries(describeLeadSources(cfg).map((s) => [s.id, s]));

describe("leadSources — status źródeł", () => {
  it("online bez kluczy → OSM live (darmowy), Tavily/Google niedostępne, mock sample", () => {
    const s = byId({ online: true });
    expect(s.osm.status).toBe("live");
    expect(s.osm.free).toBe(true);
    expect(s.tavily.status).toBe("unavailable");
    expect(s.google_places.status).toBe("unavailable");
    expect(s.mock.status).toBe("sample");
  });

  it("z kluczami i online → Tavily i Google live", () => {
    const s = byId({ online: true, tavilyKey: "tvly-x", googlePlacesKey: "AIza-x" });
    expect(s.tavily.status).toBe("live");
    expect(s.google_places.status).toBe("live");
    expect(s.google_places.note).toMatch(/placeId/); // polityka Google widoczna
  });

  it("offline → wszystkie sieciowe niedostępne (OSM też wymaga sieci)", () => {
    const s = byId({ online: false, tavilyKey: "x", googlePlacesKey: "y" });
    expect(s.osm.status).toBe("unavailable");
    expect(s.tavily.status).toBe("unavailable");
  });

  it("CEIDG live TYLKO gdy adapter podłączony (inaczej uczciwie niedostępne)", () => {
    expect(byId({ online: true }).ceidg.status).toBe("unavailable");
    expect(byId({ online: true, ceidgReady: true }).ceidg.status).toBe("live");
  });

  it("liveSources zwraca tylko realnie użyteczne; badge ma ikonę", () => {
    expect(liveSources({ online: true, googlePlacesKey: "x" })).toEqual(expect.arrayContaining(["osm", "google_places"]));
    expect(liveSources({ online: false })).toEqual([]);
    expect(sourceBadge({ id: "osm", label: "OpenStreetMap", status: "live", free: true, note: "" })).toMatch(/🟢/);
  });
});
