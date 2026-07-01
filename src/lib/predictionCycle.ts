// === Adapter cyklu Dziennika Predykcji ===
// Cienka warstwa między CZYSTYM silnikiem (predictionLedger.ts) a store'em. Wpinana w istniejący,
// bezpieczny cykl aplikacji (tick Agenta proaktywnego + pierwszy przebieg ~12 s po starcie) —
// dzięki temu prognozy powstają i rozstrzygają się BEZ otwierania teczki klienta (LeadDetail
// tylko WYŚWIETLA). Idempotentny: silnik zwraca tę samą referencję, gdy nic się nie zmieniło,
// więc wielokrotne wywołanie nie tworzy duplikatów ani zbędnych zapisów store.
// Zero sieci, zero zgody (czysty lokalny zapis — jak remember_fact), S9-safe (jeden przebieg
// O(leady + rekordy) co tick, bez pracy przy renderze komponentów).

import { store, uid } from "./store";
import { relationshipStatus } from "./salesEngine";
import { runPredictionCycle, type CycleLeadInput, type PredictionCycleResult } from "./predictionLedger";

/** Czy uczenie Dziennika Predykcji jest włączone (domyślnie TAK; wyłączalne w panelu prognoz). */
export function predictionLearningEnabled(): boolean {
  return store.settings.predictionLearning !== false;
}

/**
 * Jeden przebieg cyklu na REALNYCH danych store. Zwraca wynik silnika (dla nudge'a proaktywnego);
 * zapisuje store TYLKO gdy coś się realnie zmieniło.
 */
export function runPredictionCycleOnStore(now = Date.now()): PredictionCycleResult {
  const d = store.data;
  const leads: CycleLeadInput[] = (d.leads || []).map((l) => ({
    id: l.id,
    company: l.company,
    status: l.status,
    lastContactedAt: l.lastContactedAt,
    overdue: relationshipStatus(l, now).overdue,
  }));
  // Finanse → prognoza: suma kwot „oczekuje płatności" per klient (po leadId) podnosi stawkę
  // (krótsze okno, jawna przesłanka „zaniedbanie kosztuje realne pieniądze").
  const awaitingPaymentByLead: Record<string, number> = {};
  for (const p of d.financeProjects || []) {
    if (p.leadId && p.status === "oczekuje_platnosci") {
      const due = Math.max(0, (Number(p.amount) || 0) - (Number(p.paidAmount) || 0));
      if (due > 0) awaitingPaymentByLead[p.leadId] = (awaitingPaymentByLead[p.leadId] || 0) + due;
    }
  }
  const result = runPredictionCycle({
    ledger: d.predictionLedger || [],
    leads,
    awaitingPaymentByLead,
    now,
    learningEnabled: predictionLearningEnabled(),
    makeId: uid,
  });
  if (result.changed) {
    store.setData((data) => { data.predictionLedger = result.ledger; });
  }
  return result;
}
