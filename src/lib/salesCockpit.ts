// === Kokpit sprzedaży (salesCockpit) — „zdrowie firmy na jeden rzut oka" ===
// PO CO: CRM solo-operatora ma odpowiadać na „jak stoję i co robić", zanim zaczniesz klikać.
// Ten czysty silnik składa KLUCZOWE liczby z ISTNIEJĄCYCH silników (pipelineForecast, followUpsDue,
// callNowList, sentTodayCount) — bez nowej logiki i bez zmyślania. UI (SalesCockpit) tylko renderuje.
// S9-safe. Uczciwość: win-rate = null, gdy nic nie rozstrzygnięte (nie udajemy 0%/100%).

import type { Lead, SentMail, LeadStatus } from "../types";
import { pipelineForecast, followUpsDue, callNowList } from "./salesEngine";
import { sentTodayCount } from "./mailer";

export interface Cockpit {
  /** Wartość otwartego lejka (zł) — suma value leadów nie-wygranych/nie-przegranych. */
  pipeline: number;
  /** Prognoza ważona prawdopodobieństwem etapu (zł) — ile realnie „wisi". */
  expected: number;
  /** Wygrane łącznie (zł). */
  won: number;
  wonCount: number;
  lostCount: number;
  /** Skuteczność: wygrane/(wygrane+przegrane), 0..1 — albo null, gdy brak rozstrzygnięć. */
  winRate: number | null;
  /** Zaległe/należne follow-upy (szt.) — do zrobienia, bo termin minął. */
  overdue: number;
  /** Do zrobienia dziś (szt.): „dzwoń teraz" + należne follow-upy. */
  todayActions: number;
  /** Maile wysłane dziś (higiena wysyłki). */
  sentToday: number;
  /** Liczności per etap (do kokpitu i tablicy lejka). */
  counts: Record<LeadStatus, number>;
}

/** Pure: policz kokpit z leadów + skrzynki wysłanych. Reużywa gotowe silniki, zero nowej logiki. */
export function computeCockpit(leads: Lead[], sentMail: SentMail[] | undefined, now = Date.now()): Cockpit {
  const f = pipelineForecast(leads || []);
  const overdue = followUpsDue(leads || [], now).length;
  const todayActions = callNowList(leads || [], new Date(now)).length + overdue;
  const decided = f.counts.won + f.counts.lost;
  const winRate = decided > 0 ? f.counts.won / decided : null;
  return {
    pipeline: f.pipeline,
    expected: f.expected,
    won: f.won,
    wonCount: f.counts.won,
    lostCount: f.counts.lost,
    winRate,
    overdue,
    todayActions,
    sentToday: sentTodayCount(sentMail || [], now),
    counts: f.counts,
  };
}

/** Pure: kwota w zł, po polsku (spacje jako separator tysięcy). */
export function formatZl(n: number): string {
  return `${Math.round(n || 0).toLocaleString("pl-PL")} zł`;
}

/** Pure: win-rate jako procent lub „—" gdy brak rozstrzygnięć (uczciwie, nie 0%). */
export function winRatePct(r: number | null): string {
  return r == null ? "—" : `${Math.round(r * 100)}%`;
}
