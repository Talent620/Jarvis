// === 💰 Financial Intelligence — silnik liczący (klient-side, czysty) ===
// Serce modułu: z listy projektów liczy KPI (zysk, marża, VAT, ROI, cash flow, średnie, rankingi).
// CZYSTE i testowalne — UI tylko renderuje wynik. Dane trzymane w store (kolekcja financeProjects),
// spójnie z resztą Jarvisa (IndexedDB/localStorage). S9-safe, zero zależności sieciowych.

import type { FinanceProject, FinanceStatus } from "../types";

export const FINANCE_STATUSES: { id: FinanceStatus; label: string; group: "pipeline" | "realizacja" | "płatność" | "koniec" }[] = [
  { id: "lead", label: "Lead", group: "pipeline" },
  { id: "oferta", label: "Oferta", group: "pipeline" },
  { id: "negocjacje", label: "Negocjacje", group: "pipeline" },
  { id: "w_realizacji", label: "W realizacji", group: "realizacja" },
  { id: "review", label: "Review", group: "realizacja" },
  { id: "gotowe", label: "Gotowe", group: "realizacja" },
  { id: "oczekuje_platnosci", label: "Oczekuje płatności", group: "płatność" },
  { id: "oplacone", label: "Opłacone", group: "płatność" },
  { id: "zamkniete", label: "Zamknięte", group: "koniec" },
  { id: "anulowane", label: "Anulowane", group: "koniec" },
];

const ACTIVE: FinanceStatus[] = ["lead", "oferta", "negocjacje", "w_realizacji", "review", "gotowe", "oczekuje_platnosci"];
const DONE: FinanceStatus[] = ["oplacone", "zamkniete"];

const num = (x: number | undefined) => (typeof x === "number" && isFinite(x) ? x : 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface FinanceKpis {
  revenue: number; // przychód netto (bez anulowanych)
  costs: number;
  profit: number;
  margin: number; // %
  roi: number; // %
  vat: number;
  paid: number;
  unpaid: number; // przychód - zapłacone (na projektach nie-anulowanych)
  clients: number;
  total: number; // liczba projektów (bez anulowanych)
  openCount: number;
  doneCount: number;
  cancelledCount: number;
  avgValue: number;
  avgHours: number;
  effectiveHourlyRate: number; // przychód / suma godzin
  topClient: { name: string; revenue: number } | null;
  bestProject: { name: string; profit: number } | null;
}

/** Pure: policz wszystkie KPI z listy projektów (anulowane wyłączone z przychodu/zysku). */
export function financeKpis(projects: FinanceProject[]): FinanceKpis {
  const live = (projects || []).filter((p) => p.status !== "anulowane");
  const revenue = live.reduce((s, p) => s + num(p.amount), 0);
  const costs = live.reduce((s, p) => s + num(p.cost), 0);
  const profit = revenue - costs;
  const paid = live.reduce((s, p) => s + num(p.paidAmount), 0);
  const hours = live.reduce((s, p) => s + num(p.hours), 0);
  const vat = round2(live.reduce((s, p) => s + (num(p.amount) * num(p.vatRate)) / 100, 0));

  const byClient = new Map<string, number>();
  for (const p of live) { const c = (p.client || "").trim() || "—"; byClient.set(c, (byClient.get(c) || 0) + num(p.amount)); }
  let topClient: FinanceKpis["topClient"] = null;
  for (const [name, rev] of byClient) if (name !== "—" && (!topClient || rev > topClient.revenue)) topClient = { name, revenue: round2(rev) };

  let bestProject: FinanceKpis["bestProject"] = null;
  for (const p of live) { const pr = num(p.amount) - num(p.cost); if (!bestProject || pr > bestProject.profit) bestProject = { name: p.name || "Projekt", profit: round2(pr) }; }

  return {
    revenue: round2(revenue),
    costs: round2(costs),
    profit: round2(profit),
    margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    roi: costs > 0 ? round2((profit / costs) * 100) : 0,
    vat,
    paid: round2(paid),
    unpaid: round2(Math.max(0, revenue - paid)),
    clients: new Set(live.map((p) => (p.client || "").trim()).filter(Boolean)).size,
    total: live.length,
    openCount: live.filter((p) => ACTIVE.includes(p.status)).length,
    doneCount: live.filter((p) => DONE.includes(p.status)).length,
    cancelledCount: (projects || []).filter((p) => p.status === "anulowane").length,
    avgValue: live.length ? round2(revenue / live.length) : 0,
    avgHours: live.length ? round2(hours / live.length) : 0,
    effectiveHourlyRate: hours > 0 ? round2(revenue / hours) : 0,
    topClient,
    bestProject,
  };
}

/** Pure: przychód w rozbiciu na ostatnie N miesięcy (do wykresu/trendu). Najstarszy pierwszy. */
export function monthlyRevenue(projects: FinanceProject[], now: number, months = 6): { label: string; revenue: number }[] {
  const out: { label: string; revenue: number }[] = [];
  const base = new Date(now);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const rev = (projects || []).filter((p) => {
      if (p.status === "anulowane") return false;
      const at = p.doneAt || p.startAt || p.createdAt;
      if (!at) return false;
      const pd = new Date(at);
      return pd.getFullYear() === y && pd.getMonth() === m;
    }).reduce((s, p) => s + num(p.amount), 0);
    out.push({ label: `${String(m + 1).padStart(2, "0")}.${y}`, revenue: round2(rev) });
  }
  return out;
}

/** Pure: zwięzłe podsumowanie finansów do odpowiedzi czatu (głos/tekst). */
export function financeSummaryText(projects: FinanceProject[]): string {
  if (!projects || !projects.length) return "Brak projektów finansowych. Dodaj pierwszy — np. dodaj projekt na 8000 dla firmy X.";
  const k = financeKpis(projects);
  const zl = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;
  const lines = [
    `💰 Przychód ${zl(k.revenue)} · zysk ${zl(k.profit)} (marża ${k.margin}%, ROI ${k.roi}%).`,
    `Zapłacone ${zl(k.paid)} · do zapłaty ${zl(k.unpaid)}. Projekty: ${k.total} (aktywne ${k.openCount}, zamknięte ${k.doneCount}). Klienci: ${k.clients}.`,
  ];
  if (k.topClient) lines.push(`Najlepszy klient: ${k.topClient.name} (${zl(k.topClient.revenue)}).`);
  if (k.bestProject) lines.push(`Najdochodowszy projekt: ${k.bestProject.name} (${zl(k.bestProject.profit)}).`);
  return lines.join("\n");
}

/** Pure: ranking klientów wg przychodu (malejąco). */
export function clientRanking(projects: FinanceProject[], top = 5): { name: string; revenue: number; projects: number }[] {
  const map = new Map<string, { revenue: number; projects: number }>();
  for (const p of (projects || []).filter((x) => x.status !== "anulowane")) {
    const c = (p.client || "").trim();
    if (!c) continue;
    const cur = map.get(c) || { revenue: 0, projects: 0 };
    cur.revenue += num(p.amount); cur.projects += 1;
    map.set(c, cur);
  }
  return [...map.entries()].map(([name, v]) => ({ name, revenue: round2(v.revenue), projects: v.projects })).sort((a, b) => b.revenue - a.revenue).slice(0, top);
}
