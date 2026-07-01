// === Ścieżka klienta (clientJourney) — cienki adapter nad businessFlow ===
// Nie duplikuje logiki: KOMPONUJE businessFlow.computeJourney (etap + „co dalej") i mapuje najdalszy
// osiągnięty etap na jeden z pięciu etapów lejka workspace'u: Kandydat → Do kontaktu → Oferta → Klient
// → Archiwum. Zwraca też JEDNO główne „Co dalej". Czyste i testowalne. S9-safe.

import type { Lead, FinanceProject, SentMail } from "../types";
import { computeJourney, STAGES, reachedStage, type BusinessStage } from "./businessFlow";

export type PipelineStage = "candidate" | "to_contact" | "offer" | "client" | "archive";

export const PIPELINE_LABEL: Record<PipelineStage, string> = {
  candidate: "Kandydat",
  to_contact: "Do kontaktu",
  offer: "Oferta",
  client: "Klient",
  archive: "Archiwum",
};

/** Pure: mapa najdalszego etapu biznesowego + statusu leada → etap lejka workspace'u. */
export function pipelineStageOf(lead: Pick<Lead, "status">, reached: BusinessStage): PipelineStage {
  if (lead.status === "lost") return "archive";
  if (lead.status === "won" || reached === "paid" || reached === "finance_project_created") return "client";
  if (reached === "offer_ready" || reached === "email_sent") return "offer";
  if (reached === "dossier_ready") return "to_contact";
  return "candidate";
}

export interface ClientJourneyView {
  stage: PipelineStage;
  stageLabel: string;
  reached: BusinessStage;
  progressPct: number;   // 0..100 — jak daleko w procesie
  nextLabel: string;     // krótka etykieta następnego kroku
  nextReason: string;    // JEDNO główne „Co dalej"
  screen: string;        // dokąd skierować
  done: boolean;
}

/** Pure: pełny widok ścieżki klienta dla leada (etap lejka + jedno „Co dalej"). */
export function clientJourney(lead: Lead, projects: FinanceProject[], sent: SentMail[]): ClientJourneyView {
  const j = computeJourney(lead, projects, sent);
  const reached = j.reached;
  const stage = pipelineStageOf(lead, reached);
  const progressPct = Math.round(((STAGES.indexOf(reached) + 1) / STAGES.length) * 100);
  return {
    stage,
    stageLabel: PIPELINE_LABEL[stage],
    reached,
    progressPct,
    nextLabel: j.label,
    nextReason: j.reason,
    screen: j.screen,
    done: j.done,
  };
}

/** Pure: policz leady w każdym etapie lejka (do plakietek na zakładkach workspace'u). */
export function pipelineCounts(leads: Lead[], projects: FinanceProject[], sent: SentMail[]): Record<PipelineStage, number> {
  const out: Record<PipelineStage, number> = { candidate: 0, to_contact: 0, offer: 0, client: 0, archive: 0 };
  for (const l of leads || []) out[pipelineStageOf(l, reachedStage(l, projects, sent))] += 1;
  return out;
}
