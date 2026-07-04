// === Raporty sprzedaży (salesReports) — analityka z danych, które JUŻ masz ===
// PO CO: „gdzie tracę klientów", „które nisze/miasta konwertują", „jak szło w czasie" — bez
// żmudnych dashboardów. Liczone WPROST z leadów + finansów (uczciwie, nie z pustego lejka
// kampanijnego, którego solo-operator nie zasila). Czyste funkcje, testowalne. S9-safe.
//
// (Osobno istnieje growthAttribution/campaignRoi — lejek KAMPANIJNY z AttributionEvent; przyda się,
//  gdy ruszą płatne kampanie z utm/landingami. Te raporty są z realnej pracy 1:1 z klientem.)

import type { Lead, FinanceProject, LeadStatus } from "../types";

// — 1. Lejek konwersji (z etapów leadów) —

export interface FunnelReport {
  total: number;
  engaged: number;   // wyszli poza „nowy” (byli zaczepieni)
  offered: number;   // dostali ofertę (offer lub won)
  won: number;
  lost: number;
  /** Odsetek zaczepionych = engaged/total. null gdy brak leadów. */
  engageRate: number | null;
  /** Odsetek z ofertą wśród zaczepionych = offered/engaged. */
  offerRate: number | null;
  /** Domknięcie z oferty = won/offered. */
  closeRate: number | null;
  /** Skuteczność = won/(won+lost). null gdy nic nie rozstrzygnięte. */
  winRate: number | null;
}

const rate = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Pure: lejek konwersji z etapów leadów (uczciwe przybliżenie — status mówi „jak daleko doszli”). */
export function leadFunnel(leads: Lead[]): FunnelReport {
  let engaged = 0, offered = 0, won = 0, lost = 0;
  for (const l of leads || []) {
    if (l.status !== "new") engaged++;
    if (l.status === "offer" || l.status === "won") offered++;
    if (l.status === "won") won++;
    if (l.status === "lost") lost++;
  }
  const total = (leads || []).length;
  return {
    total, engaged, offered, won, lost,
    engageRate: rate(engaged, total),
    offerRate: rate(offered, engaged),
    closeRate: rate(won, offered),
    winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 1000 : null,
  };
}

// — 2. Skuteczność segmentów (nisza / miasto / źródło) —

export type SegmentDim = "niche" | "location" | "origin";

export interface Segment {
  key: string;
  count: number;
  won: number;
  lost: number;
  wonValue: number;      // suma wartości wygranych (zł)
  winRate: number | null; // won/(won+lost)
}

/**
 * Pure: pogrupuj leady wg wymiaru (nisza/miasto/źródło) i policz skuteczność. Puste pole → „—".
 * Sortowanie: najpierw po wartości wygranych, potem po liczbie (najwartościowsze segmenty na górze).
 */
export function segmentReport(leads: Lead[], dim: SegmentDim): Segment[] {
  const map = new Map<string, { count: number; won: number; lost: number; wonValue: number }>();
  for (const l of leads || []) {
    const raw = (l[dim] as string | undefined) || "";
    const key = raw.trim() || "—";
    let e = map.get(key);
    if (!e) { e = { count: 0, won: 0, lost: 0, wonValue: 0 }; map.set(key, e); }
    e.count++;
    if (l.status === "won") { e.won++; e.wonValue += l.value || 0; }
    else if (l.status === "lost") e.lost++;
  }
  return [...map.entries()]
    .map(([key, e]) => ({ key, count: e.count, won: e.won, lost: e.lost, wonValue: e.wonValue, winRate: e.won + e.lost > 0 ? Math.round((e.won / (e.won + e.lost)) * 1000) / 1000 : null }))
    .sort((a, b) => b.wonValue - a.wonValue || b.count - a.count);
}

// — 3. Wygrane/przegrane + przychód w czasie (miesięcznie) —

export interface MonthRow {
  ym: string;     // "2026-07"
  label: string;  // "lip 2026"
  won: number;
  lost: number;
  revenue: number; // realny wpływ z Finansów (paidAmount) w tym miesiącu
}

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ymLabel(d: Date): string {
  return d.toLocaleDateString("pl-PL", { month: "short", year: "numeric" });
}

/**
 * Pure: ostatnie `months` miesięcy — wygrane/przegrane leady (wg updatedAt jako przybliżenie daty
 * domknięcia) + REALNY przychód z Finansów (paidAmount wg paidAt). now wstrzykiwane (determinizm).
 */
export function monthlyOutcomes(leads: Lead[], finance: FinanceProject[] | undefined, now = Date.now(), months = 6): MonthRow[] {
  const base = new Date(now);
  const rows: MonthRow[] = [];
  const idx = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const k = ymKey(d);
    idx.set(k, rows.length);
    rows.push({ ym: k, label: ymLabel(d), won: 0, lost: 0, revenue: 0 });
  }
  for (const l of leads || []) {
    if (l.status !== "won" && l.status !== "lost") continue;
    const i = idx.get(ymKey(new Date(l.updatedAt)));
    if (i == null) continue;
    if (l.status === "won") rows[i].won++; else rows[i].lost++;
  }
  for (const p of finance || []) {
    if (!p.paidAt || !p.paidAmount) continue;
    const i = idx.get(ymKey(new Date(p.paidAt)));
    if (i == null) continue;
    rows[i].revenue += p.paidAmount;
  }
  return rows;
}

/** Pure: procent do wyświetlenia albo „—” gdy null. */
export function pct(r: number | null): string {
  return r == null ? "—" : `${Math.round(r * 100)}%`;
}

/** Pure: liczności per etap (dla ewentualnego wglądu). */
export function statusCounts(leads: Lead[]): Record<LeadStatus, number> {
  const c = { new: 0, contacted: 0, offer: 0, won: 0, lost: 0 } as Record<LeadStatus, number>;
  for (const l of leads || []) c[l.status]++;
  return c;
}
