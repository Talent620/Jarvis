import { store, uid } from "./store";
import { notify } from "./notifications";
import { draftOffer } from "./offer";
import type { Lead } from "../types";

// Auto-prospekting: kilka razy dziennie JARVIS sam wyszukuje nowe firmy (leady)
// w Twojej niszy i zapisuje je do Pulpitu Sprzedaży. Działa, gdy aplikacja jest
// otwarta (przeglądarka/WebView nie pozwala na pełne tło).

export interface RawLead {
  company: string;
  url?: string;
}

// Z surowych wyników wyszukiwania wyłuskaj kandydatów na leady (nazwa + strona).
export function leadsFromResults(results: any[]): RawLead[] {
  const out: RawLead[] = [];
  const seen = new Set<string>();
  for (const r of results || []) {
    const url = (r.url as string) || undefined;
    let company = String(r.title || "").split(/[|\-–·—:]/)[0].trim();
    if (!company && url) {
      try {
        company = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* ignore */
      }
    }
    company = company.slice(0, 60).trim();
    const key = company.toLowerCase();
    if (company && !seen.has(key)) {
      seen.add(key);
      out.push({ company, url });
    }
  }
  return out;
}

export async function runProspecting(): Promise<{ added: number; error?: string }> {
  const s = store.settings;
  if (!s.tavilyApiKey?.trim()) return { added: 0, error: "Brak klucza Tavily (⚙ → AI)." };
  if (!s.prospectNiche?.trim() || !s.prospectLocation?.trim())
    return { added: 0, error: "Ustaw niszę i lokalizację w ⚙ → Zachowanie." };

  const query = `${s.prospectNiche} ${s.prospectLocation} firma kontakt strona`;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: s.tavilyApiKey, query, max_results: 10, search_depth: "advanced" }),
    });
    const d = await res.json();
    if (!res.ok) return { added: 0, error: d?.error || `Błąd ${res.status}.` };

    const cands = leadsFromResults(d.results || []);
    const fresh: Lead[] = [];
    const now = Date.now();
    store.setData((data) => {
      for (const c of cands) {
        if (data.leads.some((l) => l.company.toLowerCase() === c.company.toLowerCase())) continue;
        const lead: Lead = { id: uid(), company: c.company, url: c.url, niche: s.prospectNiche, location: s.prospectLocation, status: "new", createdAt: now, updatedAt: now };
        data.leads.unshift(lead);
        fresh.push(lead);
      }
    });
    const added = fresh.length;

    // Auto-szkice ofert: dla pierwszych kilku nowych leadów (limit kosztów).
    if (added && s.autoDraftOffers) {
      for (const lead of fresh.slice(0, 3)) {
        const offer = await draftOffer(lead);
        if (offer) {
          store.setData((data) => {
            const l = data.leads.find((x) => x.id === lead.id);
            if (l) {
              l.offer = offer;
              l.status = "offer";
              l.updatedAt = Date.now();
            }
          });
        }
      }
    }

    if (added) notify("JARVIS — nowe leady", `Znalazłem ${added} nowych firm (${s.prospectNiche}, ${s.prospectLocation}).`);
    return { added };
  } catch (e) {
    return { added: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
