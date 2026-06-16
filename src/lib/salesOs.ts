// === Łącznik z AI Sales OS ===
// AI Sales OS to OSOBNE narzędzie (pełna aplikacja SaaS w katalogu `sales-os/`),
// z którego korzystasz w przeglądarce. JARVIS NIE wchłania go — zamiast tego ma
// do niego WGLĄD: jednym kliknięciem otwiera aplikację, jednym pobiera (read-only)
// jego leady i metryki, a jednym może odesłać leady znalezione przez siebie z
// powrotem do Sales OS (źródła prawdy). Dwa narzędzia, osobne, ale zsynchronizowane.
// Autoryzacja: ten sam token przechwytywania (X-Ingest-Token).

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

export interface SalesOsMetrics {
  totalLeads: number;
  byOutcome: Record<string, number>;
  wonValue: number;
}

export interface SalesOsSnapshot {
  company?: { id: string; name?: string | null };
  metrics?: SalesOsMetrics;
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

/**
 * Etap lejka Sales OS (nazwa) → status JARVIS-a (mapowanie 1:1).
 * Rozpoznaje domyślne nazwy (New/Contacted/Qualified/Proposal/Negotiation/Won/Lost)
 * oraz polskie odpowiedniki, gdy ktoś zmieni nazwy etapów. null = brak dopasowania.
 */
export function mapStage(stage?: string | null): LeadStatus | null {
  const s = (stage || "").toLowerCase().trim();
  if (!s) return null;
  if (/won|wygran|klient|zamkni/.test(s)) return "won";
  if (/lost|przegran|odrzuc|utrac/.test(s)) return "lost";
  if (/proposal|negotiat|oferta|propozycj|negocjac/.test(s)) return "offer";
  if (/contact|qualif|kontakt|kwalif|rozmow/.test(s)) return "contacted";
  if (/new|nowy|nowe|lead/.test(s)) return "new";
  return null;
}

/** Najlepszy status: wynik WON/LOST jest definitywny, inaczej decyduje etap lejka. */
export function mapLeadStatus(outcome?: string | null, stage?: string | null): LeadStatus {
  const o = (outcome || "").toUpperCase();
  if (o === "WON") return "won";
  if (o === "LOST" || o === "DISQUALIFIED") return "lost";
  return mapStage(stage) ?? mapOutcome(outcome);
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
    status: mapLeadStatus(s.outcome, s.stage),
    createdAt: ts(s.createdAt),
    updatedAt: ts(s.updatedAt),
  };
}

/** Lead JARVIS-a → ładunek dla publicznego endpointu inbound. Czysta, testowalna. */
export function leadToPublicPayload(l: Lead): Record<string, unknown> {
  const isEmail = (v?: string) => !!v && /\S+@\S+\.\S+/.test(v);
  const email = l.email || (isEmail(l.contact) ? l.contact : undefined);
  const phone = !isEmail(l.contact) ? l.contact : undefined;
  return {
    name: l.company,
    companyName: l.company,
    email: email || "",
    phone: phone || undefined,
    website: l.url || undefined,
    industry: l.niche || undefined,
    region: l.location || undefined,
    sourceDetail: "JARVIS",
    message: l.note || undefined,
  };
}

function baseUrl(): string {
  return (store.settings.salesOsUrl || "").trim().replace(/\/$/, "");
}

function token(): string {
  return (store.settings.salesOsToken || "").trim();
}

/** Czy łącznik jest skonfigurowany (adres + token). */
export function salesOsConfigured(): boolean {
  return !!baseUrl() && !!token();
}

// Ostatni pobrany snapshot — do podglądu metryk w UI bez ponownego zapytania.
let lastSnapshot: SalesOsSnapshot | null = null;
export function getLastSnapshot(): SalesOsSnapshot | null {
  return lastSnapshot;
}

/** Jeden klik: otwórz aplikację AI Sales OS w przeglądarce (lub natywnie). */
export function openSalesOs(): boolean {
  const url = baseUrl();
  if (!url) return false;
  void openUrl(url);
  return true;
}

/** Pobierz snapshot (firma + metryki + leady) bez dotykania store. */
export async function fetchSnapshot(limit = 300): Promise<SalesOsSnapshot> {
  const url = baseUrl();
  if (!url || !token()) throw new Error("Brak adresu lub tokenu AI Sales OS.");
  const res = await fetchTimeout(
    `${url}/api/public/sync?limit=${limit}`,
    { headers: { "x-ingest-token": token() } },
    20000,
  );
  if (res.status === 401) throw new Error("Token odrzucony (sprawdź X-Ingest-Token).");
  if (!res.ok) throw new Error(`Sales OS odpowiedział błędem (${res.status}).`);
  const snap = (await res.json()) as SalesOsSnapshot;
  lastSnapshot = { ...snap, leads: Array.isArray(snap.leads) ? snap.leads : [] };
  return lastSnapshot;
}

/** Zwięzła, czytelna mapa pól metryk → tekst. Czysta, testowalna. */
export function metricsToText(m?: SalesOsMetrics, companyName?: string | null): string {
  if (!m) return "Brak metryk z Sales OS.";
  const won = m.byOutcome?.WON ?? 0;
  const lost = m.byOutcome?.LOST ?? 0;
  const open = m.totalLeads - won - lost;
  const who = companyName ? `${companyName}: ` : "";
  return `📊 ${who}${m.totalLeads} leadów · otwarte ${open} · klienci ${won} · odrzuceni ${lost} · wartość wygranych ${m.wonValue.toLocaleString("pl-PL")} zł.`;
}

/** Sprawdź połączenie z Sales OS i zwróć krótki status (read-only). */
export async function testSalesOs(): Promise<string> {
  if (!salesOsConfigured()) return "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje).";
  try {
    const snap = await fetchSnapshot(1);
    return `✅ Połączono z Sales OS${snap.company?.name ? ` (${snap.company.name})` : ""}. ${metricsToText(snap.metrics, snap.company?.name)}`;
  } catch (e) {
    return `❌ ${e instanceof Error ? e.message : e}`;
  }
}

/** Statystyki/wgląd z Sales OS jako tekst (do czatu/asystenta). */
export async function salesOsStatsText(): Promise<string> {
  if (!salesOsConfigured()) return "AI Sales OS nie jest połączony (⚙ → Integracje).";
  try {
    const snap = await fetchSnapshot(300);
    return metricsToText(snap.metrics, snap.company?.name);
  } catch (e) {
    return `Nie udało się pobrać statystyk z Sales OS: ${e instanceof Error ? e.message : e}`;
  }
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
  if (!salesOsConfigured()) {
    return { ok: false, message: "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje)." };
  }
  try {
    const snap = await fetchSnapshot(300);
    const incoming = snap.leads;
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
    const m = snap.metrics ? ` ${metricsToText(snap.metrics, snap.company?.name)}` : "";
    return {
      ok: true,
      added,
      total: incoming.length,
      message: added
        ? `✅ Zsynchronizowano: ${added} nowych leadów z Sales OS (na ${incoming.length}).${m}`
        : `Wszystkie ${incoming.length} leadów z Sales OS już masz w Pulpicie.${m}`,
    };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z Sales OS: ${e instanceof Error ? e.message : e}` };
  }
}

export interface PushResult {
  ok: boolean;
  message: string;
  pushed?: number;
  failed?: number;
}

/**
 * Odeślij leady JARVIS-a do AI Sales OS (przez publiczny endpoint inbound).
 * Sales OS pozostaje źródłem prawdy — to ono scoringuje, dedupuje i prowadzi
 * lejek. Domyślnie wysyła leady o statusie „new" (świeżo znalezione przez OSM).
 */
export async function pushLeadsToSalesOs(leads?: Lead[]): Promise<PushResult> {
  const url = baseUrl();
  if (!url || !token()) {
    return { ok: false, message: "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje)." };
  }
  const all = leads ?? (store.data.leads || []).filter((l) => l.status === "new");
  if (!all.length) return { ok: true, message: "Brak leadów do wysłania do Sales OS.", pushed: 0, failed: 0 };

  const cap = Math.min(50, all.length);
  let pushed = 0;
  let failed = 0;
  for (const lead of all.slice(0, cap)) {
    try {
      const res = await fetchTimeout(
        `${url}/api/public/leads`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-ingest-token": token() },
          body: JSON.stringify(leadToPublicPayload(lead)),
        },
        15000,
      );
      if (res.ok) pushed++;
      else failed++;
    } catch {
      failed++;
    }
  }
  const tail = all.length > cap ? ` (limit ${cap}/turę — powtórz, by wysłać kolejne)` : "";
  return {
    ok: pushed > 0 || failed === 0,
    pushed,
    failed,
    message: `📤 Wysłano do Sales OS: ${pushed}${failed ? ` · nieudane: ${failed}` : ""}${tail}.`,
  };
}
