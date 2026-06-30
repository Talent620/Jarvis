// === Cyfrowy bliźniak biznesu (businessSimulator) ===
// JARVIS nie tylko opisuje przeszłość — pomaga PRZEWIDZIEĆ skutki decyzji. Z lokalnych danych
// (finanse, leady) buduje snapshot i liczy scenariusze „co jeśli" DETERMINISTYCZNIE. Gemini może
// zinterpretować wynik i wyjaśnić opcje, ale liczby pochodzą z silnika. ZAWSZE pokazujemy założenia
// i niepewność, a symulacja NIGDY nie zmienia realnych danych (czyste funkcje, bez store.setData).
// S9-safe (bez /u, \p, lookbehind).

import { financeKpis } from "./finance";
import type { Lead, FinanceProject } from "../types";

export interface BusinessSnapshot {
  recognizedRevenue: number;  // przychód rozpoznany
  pipelineValue: number;      // lejek (prognoza)
  receivables: number;        // należności (wystawione - wpłacone)
  costs: number;
  activeProjects: number;
  doneProjects: number;
  availableHours: number;     // dostępny czas (z capacity; 0 = nieznane)
  leadsCount: number;
  contactableLeads: number;   // leady z e-mailem (da się wysłać ofertę)
  risks: string[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Pure: zbuduj lokalny snapshot biznesu z danych (nie zmienia niczego). */
export function buildSnapshot(src: { finance?: FinanceProject[]; leads?: Lead[]; availableHours?: number; now?: number }): BusinessSnapshot {
  const finance = src.finance || [];
  const leads = src.leads || [];
  const k = financeKpis(finance);
  const risks: string[] = [];
  if (k.unpaid > 0) risks.push(`należności do odzyskania: ${r2(k.unpaid)} zł`);
  if (leads.length && leads.filter((l) => !!l.email).length === 0) risks.push("brak leadów z kontaktem e-mail");
  const overdue = finance.filter((p) => p.dueAt && src.now != null && p.dueAt < src.now && p.status !== "oplacone" && p.status !== "zamkniete" && p.status !== "anulowane").length;
  if (overdue) risks.push(`projekty po terminie: ${overdue}`);
  return {
    recognizedRevenue: k.revenue,
    pipelineValue: k.pipelineValue,
    receivables: k.unpaid,
    costs: k.costs,
    activeProjects: k.openCount,
    doneProjects: k.doneCount,
    availableHours: Math.max(0, src.availableHours ?? 0),
    leadsCount: leads.length,
    contactableLeads: leads.filter((l) => !!l.email).length,
    risks,
  };
}

export interface SimResult {
  metric: string;
  value: number;          // główny, deterministyczny wynik
  low: number;            // dolny brzeg niepewności
  high: number;           // górny brzeg niepewności
  assumptions: string[];  // jawne założenia
  uncertainty: string;    // krótko, dlaczego to widełki
  explanation: string;    // jawne zdanie (Gemini może rozwinąć)
}

/** Pure: czy współczynnik konwersji jest realistyczny? Zwraca [wartość po korekcie, ostrzeżenia]. */
function saneRate(rate: number): { rate: number; warn?: string } {
  if (!Number.isFinite(rate) || rate < 0) return { rate: 0, warn: "ujemny/niepoprawny współczynnik — przyjmuję 0" };
  if (rate > 1) return { rate: 1, warn: "współczynnik > 100% jest nierealny — przycinam do 100%" };
  return { rate };
}

/** Symulacja: „co jeśli wyślę N ofert?" — oczekiwany przychód = kontaktowalni × konwersja × średni deal. */
export function simulateSendOffers(input: { offers: number; conversionRate?: number; avgDealValue: number }): SimResult {
  const offers = Math.max(0, Math.floor(input.offers || 0));
  const { rate, warn } = saneRate(input.conversionRate ?? 0.05);
  const avg = Math.max(0, input.avgDealValue || 0);
  const expectedWins = offers * rate;
  const value = r2(expectedWins * avg);
  // Niepewność: konwersja realnie waha się ~±50%.
  const low = r2(expectedWins * 0.5 * avg);
  const high = r2(expectedWins * 1.5 * avg);
  const assumptions = [
    `konwersja ${Math.round(rate * 100)}% (domyślna, jeśli nieznana)`,
    `średnia wartość zlecenia ${avg} zł`,
    `${offers} wysłanych ofert`,
  ];
  if (warn) assumptions.push(warn);
  return {
    metric: "expected_revenue",
    value, low, high,
    assumptions,
    uncertainty: "Widełki wynikają z wahań konwersji (±50%) — to prognoza, nie pewnik.",
    explanation: `Wysyłka ${offers} ofert daje szacunkowo ${value} zł (od ${low} do ${high} zł), przy ~${Math.round(expectedWins)} wygranych.`,
  };
}

/** Symulacja: „co jeśli podniosę cenę o X%?" — uwzględnia spadek popytu (elastyczność). */
export function simulatePriceChange(input: { baselineRevenue: number; deltaPct: number; demandElasticity?: number }): SimResult {
  const base = Math.max(0, input.baselineRevenue || 0);
  const delta = clamp(input.deltaPct || 0, -90, 200);
  const elasticity = clamp(input.demandElasticity ?? 0.5, 0, 3);
  const demandFactor = Math.max(0, 1 - elasticity * (delta / 100));
  const value = r2(base * (1 + delta / 100) * demandFactor);
  // Widełki: elastyczność nieznana → policz przy 0 (brak spadku) i 1.0 (silny spadek).
  const high = r2(base * (1 + delta / 100) * 1);
  const low = r2(base * (1 + delta / 100) * Math.max(0, 1 - 1.0 * (delta / 100)));
  const assumptions = [
    `baseline przychodu ${base} zł`,
    `zmiana ceny ${delta > 0 ? "+" : ""}${delta}%`,
    `elastyczność popytu ${elasticity} (założona)`,
  ];
  if ((input.deltaPct || 0) !== delta) assumptions.push("zmiana ceny przycięta do realnego zakresu (-90%..+200%)");
  return {
    metric: "projected_revenue",
    value, low: Math.min(low, high), high: Math.max(low, high),
    assumptions,
    uncertainty: "Reakcja popytu jest niepewna — widełki liczą brak spadku vs silny spadek sprzedaży.",
    explanation: `Zmiana ceny o ${delta}% daje szacunkowo ${value} zł przychodu (widełki ${Math.min(low, high)}–${Math.max(low, high)} zł).`,
  };
}

export interface ClientEfficiency {
  client: string;
  profit: number;
  hours: number;
  profitPerHour: number;
}

/** Pure: który klient daje najlepszy ZYSK do CZASU? (zysk = przychód - koszt, na godzinę). */
export function bestClientByProfitToTime(finance: FinanceProject[]): ClientEfficiency[] {
  const live = (finance || []).filter((p) => p.status !== "anulowane");
  const byClient = new Map<string, { profit: number; hours: number }>();
  for (const p of live) {
    const c = (p.client || p.name || "—").trim() || "—";
    const cur = byClient.get(c) || { profit: 0, hours: 0 };
    cur.profit += (Number(p.amount) || 0) - (Number(p.cost) || 0);
    cur.hours += Number(p.hours) || 0;
    byClient.set(c, cur);
  }
  const out: ClientEfficiency[] = [];
  for (const [client, v] of byClient) {
    const hours = v.hours;
    const profitPerHour = hours > 0 ? r2(v.profit / hours) : v.profit; // brak godzin → sam zysk (nieporównywalny czasowo)
    out.push({ client, profit: r2(v.profit), hours, profitPerHour });
  }
  // Najlepszy stosunek zysk/czas na górze (klienci z godzinami przed tymi bez godzin przy remisie zysku).
  return out.sort((a, b) => b.profitPerHour - a.profitPerHour || b.profit - a.profit);
}

/** Pure: co NAJBARDZIEJ blokuje przychód? Deterministyczny wybór z snapshotu (z uzasadnieniem). */
export function biggestRevenueBlocker(snap: BusinessSnapshot): { blocker: string; reason: string } {
  if (snap.receivables > 0 && snap.receivables > snap.recognizedRevenue * 0.3)
    return { blocker: "należności", reason: `Duże należności (${snap.receivables} zł) zamrażają gotówkę — odzyskanie ich da szybki przychód.` };
  if (snap.leadsCount > 0 && snap.contactableLeads === 0)
    return { blocker: "brak kontaktowalnych leadów", reason: "Masz leady, ale bez kontaktu e-mail nie ma czego konwertować — uzupełnij kontakty." };
  if (snap.contactableLeads === 0 && snap.pipelineValue === 0 && snap.recognizedRevenue === 0)
    return { blocker: "brak kontaktowalnych leadów", reason: "Pusty pipeline i brak kontaktów — najpierw zdobądź leady z kontaktem." };
  if (snap.availableHours > 0 && snap.activeProjects > 0 && snap.availableHours < snap.activeProjects * 8)
    return { blocker: "brak czasu", reason: "Za mało dostępnych godzin na aktywne projekty — wąskie gardło to czas, nie leady." };
  if (snap.contactableLeads > 0 && snap.pipelineValue < snap.recognizedRevenue)
    return { blocker: "słaba konwersja lejka", reason: "Masz kontakty, ale lejek jest cienki — popraw oferty/follow-up." };
  return { blocker: "brak wyraźnego blokera", reason: "Dane nie wskazują jednego wąskiego gardła — skup się na największej szansie." };
}
