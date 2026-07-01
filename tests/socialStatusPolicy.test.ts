// === Uczciwe statusy social + zgodność S9 (statusPolicy) — testy ===
// Nie istnieje ścieżka, w której SYMULACJA wygląda jak realna publikacja. Sprawdzamy: brak tokena →
// SIMULATED (nie PUBLISHED), odpowiedź API z ID → PUBLISHED_CONFIRMED, błąd → FAILED, licznik pomija
// symulacje (ale liczy legacy PUBLISHED), oraz polskie hashtagi bez /u i \p{L}.
import { describe, it, expect } from "vitest";
import {
  extractHashtags, derivePublishStatus, isSimulated, isPublishedLike, countPublished, SIMULATION_TOAST,
} from "../sales-os/src/lib/social/statusPolicy";

describe("statusPolicy — uczciwe statusy publikacji", () => {
  it("brak tokena → SIMULATED (NIGDY PUBLISHED)", () => {
    const s = derivePublishStatus({ hasToken: false, externalId: "sim_fb_x" });
    expect(s).toBe("SIMULATED");
    expect(isSimulated(s)).toBe(true);
    expect(isPublishedLike(s)).toBe(false);
  });

  it("odpowiedź API z ID → PUBLISHED_CONFIRMED", () => {
    expect(derivePublishStatus({ hasToken: true, externalId: "12345_67890" })).toBe("PUBLISHED_CONFIRMED");
  });

  it("błąd API → FAILED", () => {
    expect(derivePublishStatus({ hasToken: true, error: "Graph API 400" })).toBe("FAILED");
  });

  it("token, bez ID i bez błędu → PUBLISHING (rozpoczęto, brak potwierdzenia); zaplanowane → SCHEDULED", () => {
    expect(derivePublishStatus({ hasToken: true })).toBe("PUBLISHING");
    expect(derivePublishStatus({ hasToken: true, scheduled: true })).toBe("SCHEDULED");
  });
});

describe("statusPolicy — licznik opublikowanych", () => {
  it("symulacja NIE liczy się jako opublikowana; legacy PUBLISHED nadal się liczy", () => {
    const records = [
      { status: "SIMULATED" }, { status: "PUBLISHED_CONFIRMED" },
      { status: "PUBLISHED" }, { status: "FAILED" }, { status: "DRAFT" },
    ];
    expect(countPublished(records)).toBe(2); // PUBLISHED_CONFIRMED + legacy PUBLISHED
  });

  it("komunikat symulacji jest jednoznaczny", () => {
    expect(SIMULATION_TOAST).toMatch(/nic nie opublikowano/i);
  });
});

describe("statusPolicy — hashtagi S9 (bez /u, \\p{L})", () => {
  it("wyłuskuje polskie hashtagi i zwykłe, unikatowe, do limitu", () => {
    const tags = extractHashtags("Zobacz #Kraków #ofertaWWW #Kraków #łódź_2026 #sale");
    expect(tags).toContain("#Kraków");
    expect(tags).toContain("#łódź_2026");
    expect(tags.filter((t) => t === "#Kraków")).toHaveLength(1); // unikat
  });

  it("brak hashtagów → pusta lista; limit działa", () => {
    expect(extractHashtags("bez tagów")).toEqual([]);
    expect(extractHashtags("#a #b #c #d", 2)).toHaveLength(2);
  });
});
