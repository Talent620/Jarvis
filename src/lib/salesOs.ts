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

/**
 * Czy zrobić autonomiczną auto-synchronizację z Sales OS? Czysta (testowalna).
 * Warunki: włączone (everyMin>0), skonfigurowane (url+token), minęło ≥ everyMin od ostatniej.
 */
export function shouldAutoSyncSalesOs(opts: { everyMin: number; url?: string; token?: string; lastTs: number; now?: number }): boolean {
  const now = opts.now ?? Date.now();
  if (!(opts.everyMin > 0) || !opts.url?.trim() || !opts.token?.trim()) return false;
  return now - opts.lastTs >= opts.everyMin * 60_000;
}

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
  const crmInfo = [s.stage ? `etap ${s.stage}` : null, typeof s.score === "number" ? `score ${s.score}` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    id: uid(),
    company,
    url: s.website || undefined,
    contact: s.phone || s.email || undefined,
    email: s.email || undefined,
    niche: s.industry || undefined,
    location: s.region || undefined,
    note: s.nextActionNote || (crmInfo ? `Sales OS: ${crmInfo}` : undefined),
    value: typeof s.estimatedValue === "number" ? s.estimatedValue : undefined,
    status: mapLeadStatus(s.outcome, s.stage),
    origin: "salesos",
    crmId: s.id,
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
 * Scal snapshot Sales OS z lokalną listą leadów (mutuje `leads`): dodaje NOWE,
 * a istniejące leady Z CRM-u (po crmId lub nazwie) odświeża — status, etap,
 * wartość, kontakt. NIE nadpisuje własnych leadów użytkownika (np. z OSM) o tej
 * samej nazwie. Zachowuje teczkę (intel) i id. Czysta, testowalna.
 */
export function mergeSnapshotLeads(leads: Lead[], incoming: SalesOsLead[], now = Date.now()): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  for (const sl of incoming) {
    const mapped = mapSalesOsLead(sl, now);
    const existing =
      (mapped.crmId ? leads.find((l) => l.crmId === mapped.crmId) : undefined) ||
      leads.find((l) => l.company.toLowerCase() === mapped.company.toLowerCase());
    if (!existing) {
      leads.unshift(mapped);
      added++;
      continue;
    }
    // Odświeżamy tylko leady pochodzące z CRM-u — nie ruszamy własnych leadów użytkownika.
    if (existing.crmId || existing.origin === "salesos") {
      const next = {
        status: mapped.status,
        value: mapped.value,
        note: mapped.note,
        email: mapped.email ?? existing.email,
        contact: mapped.contact ?? existing.contact,
        url: mapped.url ?? existing.url,
        niche: mapped.niche ?? existing.niche,
        location: mapped.location ?? existing.location,
        crmId: mapped.crmId ?? existing.crmId,
      };
      // Mutuj (i podbij updatedAt) TYLKO gdy coś faktycznie się zmieniło — bez tego
      // każda auto-synchronizacja churn'owałaby updatedAt i przestawiała kolejność.
      const changed =
        existing.origin !== "salesos" ||
        existing.status !== next.status ||
        existing.value !== next.value ||
        existing.note !== next.note ||
        existing.email !== next.email ||
        existing.contact !== next.contact ||
        existing.url !== next.url ||
        existing.niche !== next.niche ||
        existing.location !== next.location ||
        existing.crmId !== next.crmId;
      if (changed) {
        Object.assign(existing, next, { origin: "salesos", updatedAt: now });
        updated++;
      }
    }
  }
  return { added, updated };
}

/**
 * Pobierz (read-only) leady z AI Sales OS: dołącz NOWE i odśwież istniejące
 * leady z CRM-u (status/etap/wartość). Własnych leadów użytkownika nie ruszamy.
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
    let updated = 0;
    const now = Date.now();
    store.setData((d) => {
      const r = mergeSnapshotLeads(d.leads, incoming, now);
      added = r.added;
      updated = r.updated;
    });
    const m = snap.metrics ? ` ${metricsToText(snap.metrics, snap.company?.name)}` : "";
    const parts: string[] = [];
    if (added) parts.push(`${added} nowych`);
    if (updated) parts.push(`${updated} zaktualizowanych`);
    return {
      ok: true,
      added,
      total: incoming.length,
      message: parts.length
        ? `✅ Sales OS: ${parts.join(" · ")} (na ${incoming.length}).${m}`
        : `Wszystko aktualne — ${incoming.length} leadów z Sales OS bez zmian.${m}`,
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
  // Domyślnie świeże leady, ale NIE te zsynchronizowane z Sales OS (bez echa).
  const all = leads ?? (store.data.leads || []).filter((l) => l.status === "new" && l.origin !== "salesos");
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

// --- Outreach: JARVIS zleca Sales OS-owi napisanie maila AI i jego WYSYŁKĘ ---
// Treść, scoring, kolejka akceptacji i wysyłka żyją w Sales OS (źródło prawdy);
// JARVIS jedynie wyzwala akcję tokenem. To znaczenie „żeby tworzyło tam maile,
// które się auto-wysyłają".

export interface OutreachInput {
  email?: string;
  name?: string;
  companyName?: string;
  phone?: string;
  website?: string;
  industry?: string;
  region?: string;
  /** Dodatkowy kontekst dla AI (np. „brak strony www; oferujemy stronę + Google profil"). */
  context?: string;
  /** Domyślnie true (napisz i WYŚLIJ). false = tylko szkic do kolejki akceptacji. */
  send?: boolean;
}

export interface OutreachResult {
  ok: boolean;
  message: string;
  sent?: boolean;
  drafted?: boolean;
}

/** Lead JARVIS-a → dane wejściowe outreachu (rozdziela e-mail/telefon z `contact`). */
export function leadToOutreachInput(l: Lead, context?: string): OutreachInput {
  const isEmail = (v?: string) => !!v && /\S+@\S+\.\S+/.test(v);
  const email = l.email || (isEmail(l.contact) ? l.contact : undefined);
  const phone = !isEmail(l.contact) ? l.contact : undefined;
  return {
    email,
    phone,
    name: l.company,
    companyName: l.company,
    website: l.url,
    industry: l.niche,
    region: l.location,
    context: context || l.note,
    send: true,
  };
}

/**
 * Zleć Sales OS-owi napisanie (AI) i wysyłkę maila do leada. Sales OS utworzy
 * lead (jeśli trzeba), wygeneruje pierwszy kontakt, wrzuci do kolejki akceptacji
 * i — domyślnie — od razu wyśle. Wymaga adresu e-mail przy wysyłce.
 */
export async function outreachViaSalesOs(input: OutreachInput): Promise<OutreachResult> {
  const url = baseUrl();
  if (!url || !token()) return { ok: false, message: "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje)." };
  const send = input.send !== false;
  if (send && !input.email?.trim()) {
    return { ok: false, message: "Do wysyłki potrzebny jest adres e-mail leada (albo użyj trybu „tylko szkic”)." };
  }
  try {
    const res = await fetchTimeout(
      `${url}/api/public/outreach`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-ingest-token": token() },
        body: JSON.stringify({ ...input, send }),
      },
      30000,
    );
    if (res.status === 401) return { ok: false, message: "Token odrzucony przez Sales OS." };
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, message: `Sales OS: ${(e as { error?: string }).error || res.status}` };
    }
    const d = (await res.json()) as { sent?: boolean; drafted?: boolean; provider?: string; simulated?: boolean };
    const who = input.companyName || input.name || "lead";
    if (d.sent) {
      return { ok: true, sent: true, drafted: d.drafted, message: `✅ Sales OS napisał i wysłał mail do „${who}”${d.simulated ? " (tryb symulacji — ustaw RESEND_API_KEY, by wysyłać naprawdę)" : ` (${d.provider})`}.` };
    }
    return { ok: true, sent: false, drafted: true, message: `📝 Sales OS przygotował szkic maila do „${who}” w kolejce akceptacji (nie wysłano).` };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z Sales OS: ${e instanceof Error ? e.message : e}` };
  }
}

/**
 * Wypchnij zmianę statusu leada z powrotem do lejka AI Sales OS (JARVIS → CRM).
 * Identyfikuje leada po `crmId` (gdy znany z synchronizacji) lub po e-mailu.
 * Zwraca null po cichu, gdy łącznik nie jest skonfigurowany albo nie ma jak
 * zidentyfikować leada — wołane „best-effort" przy zmianie statusu w UI.
 */
export async function pushLeadStatusToSalesOs(lead: Lead, status: LeadStatus): Promise<OutreachResult | null> {
  const url = baseUrl();
  if (!url || !token()) return null;
  const email = lead.email || (/\S+@\S+\.\S+/.test(lead.contact || "") ? lead.contact : undefined);
  if (!lead.crmId && !email) return null;
  try {
    const res = await fetchTimeout(
      `${url}/api/public/lead-status`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-ingest-token": token() },
        body: JSON.stringify({ ...(lead.crmId ? { leadId: lead.crmId } : {}), email, status }),
      },
      15000,
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { ok: false, message: `Sales OS: ${(e as { error?: string }).error || res.status}` };
    }
    const d = (await res.json()) as { stage?: string | null; outcome?: string };
    return { ok: true, message: `🔁 Status w Sales OS: „${lead.company}" → ${d.stage || d.outcome}.` };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z Sales OS: ${e instanceof Error ? e.message : e}` };
  }
}

/**
 * Wyślij zaległe szkice maili z kolejki Sales OS (do dziennego limitu firmy).
 * To „opróżnij kolejkę i auto-wyślij" — np. po masowym wysłaniu leadów z autoDraft.
 */
export async function flushSalesOsOutreach(max?: number): Promise<OutreachResult> {
  const url = baseUrl();
  if (!url || !token()) return { ok: false, message: "Najpierw uzupełnij adres AI Sales OS i token (⚙ → Integracje)." };
  try {
    const res = await fetchTimeout(
      `${url}/api/public/outreach`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-ingest-token": token() },
        body: JSON.stringify({ flushPending: true, ...(max ? { max } : {}) }),
      },
      30000,
    );
    if (!res.ok) return { ok: false, message: `Sales OS odpowiedział błędem (${res.status}).` };
    const d = (await res.json()) as { sent?: number; failed?: number; skipped?: number };
    const sent = d.sent ?? 0;
    return {
      ok: true,
      sent: sent > 0,
      message: sent
        ? `✅ Sales OS auto-wysłał ${sent} maili z kolejki${d.failed ? ` · nieudane: ${d.failed}` : ""}.`
        : "Brak maili do wysłania w kolejce Sales OS (albo osiągnięto dzienny limit).",
    };
  } catch (e) {
    return { ok: false, message: `Brak połączenia z Sales OS: ${e instanceof Error ? e.message : e}` };
  }
}
