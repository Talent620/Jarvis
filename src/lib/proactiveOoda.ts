// === Proaktywny OODA Loop (observe → orient → decide → suggest) ===
// JARVIS odzywa się RZADZIEJ, ale wtedy, kiedy naprawdę warto. Reaguje na ZDARZENIA z danych
// (nie ciągłe odpytywanie): OBSERVE (co się zmieniło), ORIENT (z którym celem/ryzykiem to związane),
// DECIDE (czy warto przerwać), SUGGEST (jedna najlepsza czynność). ACT dopiero po zgodzie.
// Wstępny ranking LOKALNY (nie wysyłamy danych do Gemini bez potrzeby). Respektuje ciszę, snooze i
// odrzucone kategorie. Buduje na istniejącej warstwie proactive (nie dubluje event-busa). S9-safe.

import type { Lead, FinanceProject } from "../types";
import type { OutcomeGoal } from "./goalGraph";

export type OodaCategory = "hot_lead" | "overdue_payment" | "project_deadline" | "goal_progress";

export interface OodaEvent {
  category: OodaCategory;
  entityId?: string;
  summary: string;
  urgency: number;   // 0..100
  value: number;     // 0..100 (waga biznesowa)
  at: number;
}

export interface ProactiveSuggestion {
  category: OodaCategory;
  entityId?: string;
  what: string;          // co
  whyNow: string;        // dlaczego teraz
  expectedEffect: string;// oczekiwany efekt
  confidence: number;    // 0..1
  score: number;         // ranking (po orientacji)
  relatedGoalId?: string;
  /** Stałe akcje UI: Zrób / Później / Nie proponuj tego. */
  actions: readonly ["Zrób", "Później", "Nie proponuj tego"];
}

const DAY = 86_400_000;
const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));
const ACTIONS = ["Zrób", "Później", "Nie proponuj tego"] as const;

const CLOSED = new Set<FinanceProject["status"]>(["oplacone", "zamkniete", "anulowane"]);

/** OBSERVE (pure): co realnie się zmieniło/wymaga uwagi? Zdarzenia z danych, bez sieci. */
export function observeEvents(data: { leads?: Lead[]; finance?: FinanceProject[] }, now: number): OodaEvent[] {
  const events: OodaEvent[] = [];

  for (const l of data.leads || []) {
    const value = typeof l.value === "number" ? l.value : 0;
    const stale = !l.lastContactedAt || now - l.lastContactedAt > 3 * DAY;
    const followDue = !!l.nextFollowUpAt && l.nextFollowUpAt <= now;
    const hot = l.status === "offer" || l.status === "contacted";
    if (followDue || (hot && stale)) {
      events.push({
        category: "hot_lead", entityId: l.id,
        summary: `Gorący lead: ${l.company}${followDue ? " (follow-up zaległy)" : ""}`,
        urgency: followDue ? 75 : 65, value: clamp100(value / 100), at: now,
      });
    }
  }

  for (const p of data.finance || []) {
    const unpaid = (Number(p.amount) || 0) - (Number(p.paidAmount) || 0);
    if (unpaid > 0 && p.dueAt && p.dueAt < now && !CLOSED.has(p.status)) {
      events.push({ category: "overdue_payment", entityId: p.id, summary: `Zaległa płatność: ${p.name} (${unpaid} zł)`, urgency: 90, value: clamp100(unpaid / 100), at: now });
    }
    if (p.dueAt && p.dueAt > now && p.dueAt - now < 2 * DAY && !CLOSED.has(p.status)) {
      events.push({ category: "project_deadline", entityId: p.id, summary: `Termin projektu blisko: ${p.name}`, urgency: 80, value: clamp100((Number(p.amount) || 0) / 100), at: now });
    }
  }

  return events;
}

/** ORIENT (pure): powiąż zdarzenie z celem/ryzykiem i policz wynik rankingu (lokalnie). */
export function orient(event: OodaEvent, goals: OutcomeGoal[] = []): { score: number; relatedGoalId?: string } {
  let score = event.urgency * 0.6 + event.value * 0.4;
  // Powiązanie z aktywnym celem podbija wagę (np. cel przychodowy ↔ zaległa płatność / gorący lead).
  const revenueGoal = goals.find((g) => g.metric === "revenue" || g.metric === "payments");
  const clientsGoal = goals.find((g) => g.metric === "clients_won" || g.metric === "leads");
  let relatedGoalId: string | undefined;
  if ((event.category === "overdue_payment") && revenueGoal) { score += 15; relatedGoalId = revenueGoal.id; }
  if (event.category === "hot_lead" && (clientsGoal || revenueGoal)) { score += 10; relatedGoalId = (clientsGoal || revenueGoal)?.id; }
  return { score: Math.round(score), relatedGoalId };
}

const SUGGEST_COPY: Record<OodaCategory, { what: (e: OodaEvent) => string; effect: string }> = {
  hot_lead: { what: (e) => `Odezwij się do leada — ${e.summary}`, effect: "większa szansa na odpowiedź i ofertę" },
  overdue_payment: { what: (e) => `Ponów płatność — ${e.summary}`, effect: "szybszy przychód z odzyskanej należności" },
  project_deadline: { what: (e) => `Domknij projekt przed terminem — ${e.summary}`, effect: "uniknięcie poślizgu i utrzymanie zaufania klienta" },
  goal_progress: { what: (e) => e.summary, effect: "ruch w stronę aktywnego celu" },
};

/**
 * DECIDE + SUGGEST (pure): z listy zdarzeń wybierz JEDNĄ najlepszą sugestię, respektując odrzucone
 * kategorie i ciszę/snooze (predykat isSilenced). Brak istotnych zmian → null (JARVIS milczy).
 */
export function decideSuggestion(
  data: { leads?: Lead[]; finance?: FinanceProject[] },
  opts: { now: number; goals?: OutcomeGoal[]; rejected?: Set<OodaCategory>; isSilenced?: (c: OodaCategory) => boolean },
): ProactiveSuggestion | null {
  const rejected = opts.rejected || new Set<OodaCategory>();
  const events = observeEvents(data, opts.now)
    .filter((e) => !rejected.has(e.category))
    .filter((e) => !(opts.isSilenced && opts.isSilenced(e.category)));
  if (!events.length) return null;

  const ranked = events
    .map((e) => ({ e, o: orient(e, opts.goals || []) }))
    .sort((a, b) => b.o.score - a.o.score);
  const top = ranked[0];
  const copy = SUGGEST_COPY[top.e.category];
  // Pewność rośnie z wynikiem; powiązanie z celem dodaje pewności.
  const confidence = Math.max(0.3, Math.min(0.95, top.o.score / 120 + (top.o.relatedGoalId ? 0.1 : 0)));
  return {
    category: top.e.category,
    entityId: top.e.entityId,
    what: copy.what(top.e),
    whyNow: top.e.summary,
    expectedEffect: copy.effect,
    confidence: Math.round(confidence * 100) / 100,
    score: top.o.score,
    relatedGoalId: top.o.relatedGoalId,
    actions: ACTIONS,
  };
}
