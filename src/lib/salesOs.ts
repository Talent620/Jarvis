// === Łącznik z AI Sales OS ===
// AI Sales OS to OSOBNE narzędzie (pełna aplikacja SaaS w katalogu `sales-os/`),
// z którego korzystasz w przeglądarce. JARVIS NIE wchłania go — zamiast tego ma
// do niego WGLĄD: jednym kliknięciem otwiera aplikację i jednym kliknięciem
// pobiera (read-only) jej leady do Pulpitu Sprzedaży. Dwa narzędzia, osobne,
// ale zsynchronizowane. Autoryzacja: ten sam token przechwytywania (X-Ingest-Token).

import { fetchTimeout } from "./http";
import { store, uid } from "./store";
import { openUrl } from "./deviceControl";
import type { Lead, LeadStatus } from "../types";

/** Surowy lead zwracany przez `GET /api/public/sync` w AI Sales OS. */
export interface SalesOsLead {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  website?: string | null;
  industry?: string | null;
  region?: string | null;
  outcome?: string | null;
  estimatedValue?: number | null;
  score?: number | null;
  hasWebsite?: boolean | null;
  stage?: string | null;
  nextActionNote?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface SalesOsSnapshot {
  company?: { id: string; name?: string | null };
  metrics?: { totalLeads: number; byOutcome: Record<string, number>; wonValue: number };
  leads: SalesOsLead[];
  syncedAt?: string;
}

/** Status leada w Sales OS → status w Pulpicie JARVIS-a. Czysta, testowalna. */
export function mapOutcome(outcome?: string | null): LeadStatus {
  switch ((outcome || "").toUpperCase()) {
    case "WON":
      return "won";
    case "LOST":
    case "DISQUALIFIED":
      return "lost";
    case "IN_PROGRESS":
    case "CONTACTED":
      return "contacted";
    default:
      return "new";
  }
}

/** Lead z Sales OS → Lead JARVIS-a (czysta, testowalna; bez dotykania store). */
export function mapSalesOsLead(s: SalesOsLead, now = Date.now()): Lead {
  const company = (s.companyName || s.name || "Bez nazwy").slice(0, 80);
  const ts = (iso?: string | null) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : now;
  };
  return {
    id: uid(),
    company,
    url: s.website || undefined,
    contact: s.phone || s.email || undefined,
    email: s.email || undefined,
    niche: s.industry || undefined,
    location: s.region || undefined,
    note: s.nextActionNote || (s.stage ? `Etap (Sales OS): ${s.stage}` : undefined),
    value: typeof s.estimatedValue === "number" ? s.estimatedValue : undefined,
    status: mapOutcome(s.outcome),
    createdAt: ts(s.createdAt),
    updatedAt: ts(s.updatedAt),
  };
}

function baseUrl(): string {
  return (store.settings.salesOsUrl || "").trim().replace(/\/$/, "");
}

/** Jeden klik: otwórz aplikację AI Sales OS w przeglądarce (lub natywnie). */
export function openSalesOs(): boolean {
  const url = baseUrl();
  if (!url) return false;
  void openUrl(url);
  return true;
}

export interface SyncResult {
  ok: boolean;
  message: string;
  added?: number;
  total?: number;
}

/**
 * Pobierz (read-only) leady z AI Sales OS i dołącz NOWE do Pulpitu Sprzedaży.
 * Dedup po nazwie firmy — nie nadpisujemy tego, co już masz w JARVIS-ie.
 */
export async function syncFromSalesOs(): Promise<SyncResult> {
  const url = baseUrl();
  const token = (store.settings.salesOsToken || "").trim();
  if (!url || !token) {
    return { ok: false, message: "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje)." };
  }
  try {
    const res = await fetchTimeout(
      `${url}/api/public/sync?limit=300`,
      { headers: { "x-ingest-token": token } },
      20000,
    );
    if (res.status === 401) return { ok: false, message: "Token odrzucony przez Sales OS — sprawdź X-Ingest-Token." };
    if (!res.ok) return { ok: false, message: `Sales OS odpowiedział błędem (${res.status}).` };
    const snap = (await res.json()) as SalesOsSnapshot;
    const incoming = Array.isArray(snap.leads) ? snap.leads : [];
    if (!incoming.length) return { ok: true, message: "Sales OS nie ma jeszcze leadów.", added: 0, total: 0 };

    let added = 0;
    const now = Date.now();
    store.setData((d) => {
      for (const sl of incoming) {
        const lead = mapSalesOsLead(sl, now);
        if (d.leads.some((l) => l.company.toLowerCase() === lead.company.toLowerCase())) continue;
        d.leads.unshift(lead);
        added++;
      }
    });
    return {
      ok: true,
      added,
      total: incoming.length,
      message: added
        ? `✅ Zsynchronizowano: ${added} nowych leadów z Sales OS (na ${incoming.length}).`
        : `Wszystkie ${incoming.length} leadów z Sales OS już masz w Pulpicie.`,
    };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z Sales OS: ${e instanceof Error ? e.message : e}` };
  }
}
