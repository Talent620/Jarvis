import type { BusinessCandidate, BusinessProvider, BusinessQuery } from "./types";

interface CeidgFirm {
  nazwa?: string;
  wlasciciel?: { imie?: string; nazwisko?: string; nip?: string };
  adresDzialalnosci?: { miasto?: string; ulica?: string; budynek?: string; kod?: string };
  dataRozpoczecia?: string;
  telefon?: string;
  email?: string;
  www?: string;
  pkdGlowny?: string;
}

/**
 * CEIDG (Polish sole-trader registry, dane.biznes.gov.pl) — freshly registered
 * companies in a city. New businesses rarely have a website yet, which makes
 * them ideal web-design prospects. Activated by CEIDG_API_TOKEN (free JWT from
 * dane.biznes.gov.pl); returns [] on any failure.
 */
export function ceidgProvider(token: string): BusinessProvider {
  return {
    name: "ceidg",
    live: true,
    async search(q: BusinessQuery): Promise<BusinessCandidate[]> {
      try {
        const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const params = new URLSearchParams({
          dataod: from,
          status: "AKTYWNY",
          miasto: q.city,
          limit: String(Math.min(25, Math.max(q.limit, 10))),
        });
        const res = await fetch(
          `https://dane.biznes.gov.pl/api/ceidg/v2/firmy?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        );
        if (!res.ok) {
          console.error("[prospecting] ceidg error", res.status, await res.text());
          return [];
        }
        const data = (await res.json()) as { firmy?: CeidgFirm[] };
        const firms = Array.isArray(data.firmy) ? data.firmy : [];
        return firms.map((f) => {
          const owner = [f.wlasciciel?.imie, f.wlasciciel?.nazwisko].filter(Boolean).join(" ");
          const addr = f.adresDzialalnosci;
          const signals = ["Newly registered (last 30 days)"];
          if (!f.www) signals.push("No website — needs one");
          return {
            name: f.nazwa ?? owner ?? "New business",
            phone: f.telefon ?? null,
            email: f.email ?? null,
            website: f.www ?? null,
            hasWebsite: Boolean(f.www),
            address: addr
              ? [addr.ulica, addr.budynek, addr.kod, addr.miasto].filter(Boolean).join(" ")
              : null,
            city: addr?.miasto ?? q.city,
            category: f.pkdGlowny ?? q.category,
            rating: null,
            reviewCount: null,
            mapsUrl: null,
            nip: f.wlasciciel?.nip ?? null,
            registeredAt: f.dataRozpoczecia ?? null,
            signals,
            source: "BUSINESS_REGISTRY",
            sourceDetail: "CEIDG",
          } satisfies BusinessCandidate;
        });
      } catch (e) {
        console.error("[prospecting] ceidg search failed:", e);
        return [];
      }
    },
  };
}
