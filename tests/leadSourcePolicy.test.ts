// === Zgodność źródeł i kontaktu (leadSourcePolicy) — testy ===
// doNotContact blokuje każdą AUTO-wysyłkę; draft nadal może powstać. Publiczny e-mail to nie zgoda.
// System ma dowód pochodzenia danych i uczciwy backoff dla źródeł (OSM 1 req/s).
import { describe, it, expect } from "vitest";
import {
  evaluateContactPolicy, buildSourceEvidence, delayUntilAllowed, afterSuccess, afterFailure,
  NOMINATIM_MIN_INTERVAL_MS, unavailableMessage,
} from "../src/lib/leadSourcePolicy";

describe("leadSourcePolicy — możliwość kontaktu", () => {
  it("publiczny e-mail → wymaga potwierdzenia, NIE auto-wysyłka; draft OK", () => {
    const p = evaluateContactPolicy({ hasEmail: true });
    expect(p.permission).toBe("requires_confirmation");
    expect(p.canAutoSend).toBe(false);
    expect(p.canDraft).toBe(true);
    expect(p.legalBasisNote).not.toMatch(/zgodne z prawem/i);
    expect(p.legalBasisNote).toMatch(/wymaga potwierdzenia/i);
  });

  it("doNotContact → blokuje auto-wysyłkę, ale draft nadal można przygotować", () => {
    const p = evaluateContactPolicy({ hasEmail: true, doNotContact: true });
    expect(p.canAutoSend).toBe(false);
    expect(p.canDraft).toBe(true);
    expect(p.suppressionReason).toMatch(/doNotContact/);
  });

  it("potwierdzona podstawa → auto-wysyłka dozwolona", () => {
    const p = evaluateContactPolicy({ hasEmail: true, contactConfirmed: true });
    expect(p.permission).toBe("confirmed");
    expect(p.canAutoSend).toBe(true);
  });

  it("opt-out → brak wysyłki i brak draftu, powód wypisania", () => {
    const p = evaluateContactPolicy({ hasEmail: true, optOut: true });
    expect(p.permission).toBe("opted_out");
    expect(p.canAutoSend).toBe(false);
    expect(p.canDraft).toBe(false);
    expect(p.suppressionReason).toMatch(/opt-out/i);
  });
});

describe("leadSourcePolicy — dowód pochodzenia", () => {
  it("evidence ma źródło, czas i możliwość usunięcia", () => {
    const e = buildSourceEvidence("osm", 123, "https://osm.example/x");
    expect(e.source).toBe("osm");
    expect(e.fetchedAt).toBe(123);
    expect(e.removable).toBe(true);
  });
});

describe("leadSourcePolicy — limitowanie zapytań (OSM 1/s + backoff)", () => {
  it("w ciągu 1 s → trzeba odczekać; po 1 s → można od razu", () => {
    const st = afterSuccess(1000);
    expect(delayUntilAllowed(st, 1500)).toBeGreaterThan(0);       // 500 ms po → jeszcze czekaj
    expect(delayUntilAllowed(st, 1000 + NOMINATIM_MIN_INTERVAL_MS)).toBe(0);
  });

  it("kolejne błędy zwiększają backoff; sukces go resetuje", () => {
    let st = afterFailure({ lastAt: 0, failures: 0 }, 1000);
    const d1 = delayUntilAllowed(st, 1000);
    st = afterFailure(st, 1000);
    const d2 = delayUntilAllowed(st, 1000);
    expect(d2).toBeGreaterThan(d1);        // backoff rośnie
    st = afterSuccess(1000);
    expect(delayUntilAllowed(st, 1000 + NOMINATIM_MIN_INTERVAL_MS)).toBe(0); // reset
  });

  it("komunikat o niedostępności jest uczciwy", () => {
    expect(unavailableMessage("Overpass")).toMatch(/niedostępne/i);
  });
});
