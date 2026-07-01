// === E2E realnego przepływu dogfoodingu (dogfoodFlow) ===
// Odtwarza dokładnie ścieżkę użytkownika ze zrzutów, używając TYCH SAMYCH funkcji co UI:
// 1) znajdź kandydata z telefonem → 2) „kliknij telefon" (widoczna akcja) → 3) importuj →
// 4) widoczny w CRM „Do działania" → 5) odrzuć innego i ponów wyszukiwanie (nie wraca) →
// 6) zbuduj demo → 7) zasymuluj uciętą odpowiedź AI → 8) auto-naprawa daje poprawny HTML.
// Zero sieci, zero płatnego API.
import { describe, it, expect } from "vitest";
import { discoverLeadCandidates, importCandidates } from "../src/lib/leadCandidates";
import type { RawLead } from "../src/lib/leads";
import { telHref, hasPhone, matchContactFilter } from "../src/lib/contactActions";
import { leadBucket } from "../src/lib/crmBuckets";
import { addSuppression, filterSuppressed } from "../src/lib/leadSuppression";
import { buildGrowthContext, growthContextToBrief } from "../src/lib/growthContext";
import { repairTruncatedSite } from "../src/lib/webgen";
import type { Lead } from "../src/types";

const NOW = 20_000_000_000;

describe("dogfoodFlow — od kandydata z telefonem do naprawionego demo", () => {
  it("przechodzi całą ścieżkę bez ręcznego kopiowania danych", async () => {
    // 1) Znajdź kandydatów; jeden ma telefon, drugi nie.
    const raws: RawLead[] = [
      { company: "Fryzjer Ola", phone: "600 100 200", address: "Kraków", hasWebsite: false },
      { company: "Bez Telefonu", address: "Kraków", hasWebsite: false },
    ];
    const candidates = discoverLeadCandidates(raws, { source: "osm", now: NOW });
    const withPhone = candidates.find((c) => hasPhone(c));
    expect(withPhone?.company).toBe("Fryzjer Ola");
    expect(matchContactFilter(withPhone!, "phone")).toBe(true);

    // 2) „Kliknij telefon" — akcja jest WIDOCZNA (poprawny tel:), nie martwa.
    expect(telHref(withPhone!.phone)).toBe("tel:600100200");

    // 3) Importuj tego kandydata → nowy lead.
    const added = importCandidates([], [withPhone!], { now: NOW, makeId: (c) => `L-${c.id}` });
    expect(added).toHaveLength(1);
    const lead: Lead = { id: added[0].id, ...added[0] } as Lead;

    // 4) Widoczny w CRM „Do działania" (nie w Klientach/Archiwum).
    expect(leadBucket(lead)).toBe("actionable");

    // 5) Odrzuć DRUGIEGO kandydata i ponów wyszukiwanie — nie wraca.
    const rejected = candidates.find((c) => c.company === "Bez Telefonu")!;
    const suppression = addSuppression([], rejected, { reason: "brak telefonu", now: NOW });
    const reSearch = discoverLeadCandidates(raws, { source: "osm", now: NOW + 1000 });
    const visible = filterSuppressed(reSearch, suppression);
    expect(visible.some((c) => c.company === "Bez Telefonu")).toBe(false);
    expect(visible.some((c) => c.company === "Fryzjer Ola")).toBe(true);

    // 6) Zbuduj demo — brief z danych leada (bez przepisywania).
    const brief = growthContextToBrief(buildGrowthContext(lead));
    expect(brief.business).toBe("Fryzjer Ola");

    // 7) Zasymuluj UCIĘTĄ odpowiedź AI (urwany CSS — brak </style>, </body>, </html>).
    const truncated = `<!DOCTYPE html><html><head><title>Fryzjer Ola</title><style>body{font-family:sans-serif;`;

    // 8) Auto-naprawa: JEDNA próba dokończenia domyka dokument → poprawny, pobieralny HTML.
    const repaired = await repairTruncatedSite(truncated, async () => "}</style></head><body><h1>Fryzjer Ola</h1></body></html>");
    expect(repaired.repaired).toBe(true);
    expect(repaired.validation.truncated).toBe(false);
    expect(repaired.validation.safeToDownload).toBe(true);
  });

  it("gdy naprawa się nie uda — HTML pozostaje niepobieralny (nie dajemy uszkodzonego demo)", async () => {
    const truncated = `<!DOCTYPE html><html><head><script>function x(){`;
    const stillBroken = await repairTruncatedSite(truncated, async () => "console.log('nadal urwane'");
    expect(stillBroken.repaired).toBe(false);
    expect(stillBroken.validation.safeToDownload).toBe(false);
  });
});
