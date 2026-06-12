import { store } from "./store";
import { notify } from "./notifications";
import { draftOffer } from "./offer";
import { findLeads } from "./leads";

// Auto-prospekting: kilka razy dziennie JARVIS sam wyszukuje nowe firmy (leady)
// w Twojej niszy i zapisuje je do Pulpitu Sprzedaży. Źródło: OpenStreetMap
// (darmowe, bez klucza). Działa, gdy aplikacja jest otwarta.

export async function runProspecting(): Promise<{ added: number; error?: string }> {
  const s = store.settings;
  if (!s.prospectLocation?.trim()) {
    return { added: 0, error: "Ustaw miasto (a najlepiej też niszę) w ⚙ → Zachowanie." };
  }
  const r = await findLeads({
    niche: s.prospectNiche?.trim() || undefined,
    location: s.prospectLocation.trim(),
    count: 15,
  });
  if (r.error) return { added: 0, error: r.error };

  // Auto-szkice ofert: dla pierwszych kilku nowych leadów (limit kosztów).
  if (r.addedLeads.length && s.autoDraftOffers) {
    for (const lead of r.addedLeads.slice(0, 3)) {
      const offer = await draftOffer(lead);
      if (offer) {
        store.setData((data) => {
          const l = data.leads.find((x) => x.id === lead.id);
          if (l) { l.offer = offer; l.status = "offer"; l.updatedAt = Date.now(); }
        });
      }
    }
  }

  if (r.added) notify("JARVIS — nowe leady", `Znalazłem ${r.added} nowych firm w ${r.city}.`);
  return { added: r.added };
}
