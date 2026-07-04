// === Kręgosłup procesu biznesowego (lead → kasa) ===
// Czysty, deterministyczny silnik: z ISTNIEJĄCYCH danych (lead, projekty finansowe, wysłane
// maile) wylicza, na którym etapie jest sprawa i jaki jest NASTĘPNY krok. NIE tworzy drugiego
// CRM — tylko czyta i wnioskuje. S9-safe, bez efektów ubocznych.

import type { Lead, FinanceProject, SentMail } from "../types";

export type BusinessStage =
  | "lead_found"
  | "dossier_ready"
  | "offer_ready"
  | "email_sent"
  | "finance_project_created"
  | "paid";

// Kolejność etapów (od początku do końca). Indeks = postęp.
export const STAGES: BusinessStage[] = [
  "lead_found", "dossier_ready", "offer_ready", "email_sent", "finance_project_created", "paid",
];

const STAGE_LABEL: Record<BusinessStage, string> = {
  lead_found: "Lead znaleziony",
  dossier_ready: "Teczka gotowa",
  offer_ready: "Oferta gotowa",
  email_sent: "Mail wysłany",
  finance_project_created: "Projekt finansowy",
  paid: "Opłacone",
};

export interface JourneyStep {
  stage: BusinessStage; // następny krok do zrobienia (albo "paid" gdy domknięte)
  done: boolean; // czy cały proces zamknięty (opłacone)
  label: string; // etykieta NASTĘPNEGO kroku
  reason: string; // dlaczego ten krok
  screen: string; // dokąd skierować (id ekranu dla open_screen/navIntent)
  leadId: string;
  reached: BusinessStage; // najdalszy osiągnięty etap
}

const norm = (s: string | undefined) => (s || "").trim().toLowerCase();

/**
 * Czy istnieje projekt finansowy powiązany z tym leadem? Preferuje wspólne ID (leadId) — odporne na
 * „Acme" vs „Acme Sp. z o.o."; string-match po nazwie klienta zostaje jako fallback dla starych/
 * ręcznie utworzonych projektów bez leadId (bezwarunkowy — nigdy nie słabszy niż wcześniej).
 */
function projectForLead(lead: Lead, projects: FinanceProject[]): FinanceProject | undefined {
  const list = projects || [];
  const byId = list.find((p) => p.leadId === lead.id);
  if (byId) return byId;
  const c = norm(lead.company);
  if (!c) return undefined;
  return list.find((p) => norm(p.client) === c);
}

/** Czy do firmy leada poszedł potwierdzony mail (skrzynka wysłanych)? */
function wasEmailed(lead: Lead, sent: SentMail[]): boolean {
  const c = norm(lead.company);
  return !!lead.lastContactedAt || (!!c && (sent || []).some((m) => norm(m.company) === c));
}

/**
 * Pure: wylicz najdalszy osiągnięty etap procesu dla danego leada.
 * Etapy są kumulatywne — „opłacone" implikuje wszystkie wcześniejsze.
 */
export function reachedStage(lead: Lead, projects: FinanceProject[], sent: SentMail[]): BusinessStage {
  const project = projectForLead(lead, projects);
  // TYLKO status "oplacone" (ustawiany przez applyPayment wyłącznie gdy paidAmount >= amount) liczy się
  // jako domknięty proces. Sama obecność paidAmount>0 NIE wystarcza — zaliczka/częściowa wpłata
  // zostawia status "oczekuje_platnosci" i proces nie może pokazywać się jako zakończony.
  if (project && project.status === "oplacone") return "paid";
  if (project) return "finance_project_created";
  if (wasEmailed(lead, sent) || lead.status === "won") return "email_sent";
  if (lead.offer || lead.intel?.email) return "offer_ready";
  if (lead.intel) return "dossier_ready";
  return "lead_found";
}

/** Pure: następny krok (rekomendacja + ekran) dla leada. */
export function computeJourney(lead: Lead, projects: FinanceProject[], sent: SentMail[]): JourneyStep {
  const reached = reachedStage(lead, projects, sent);
  const idx = STAGES.indexOf(reached);
  const done = reached === "paid";
  // następny etap = kolejny po osiągniętym (albo „paid", gdy domknięte)
  const nextStage = done ? "paid" : STAGES[Math.min(idx + 1, STAGES.length - 1)];

  // Klucz = NASTĘPNY etap do osiągnięcia; treść mówi, JAK go osiągnąć (stan zastany → akcja).
  // Uwaga na off-by-one: label/reason/screen NIE mogą opisywać etapu jako już osiągniętego —
  // „Opłacone" wolno powiedzieć wyłącznie w gałęzi done (inwariant: żadnego „opłacono" bez pełnej
  // wpłaty). Dlatego etykieta następnego kroku to AKCJA („Dopilnuj płatności"), nie nazwa stanu.
  const NEXT: Record<BusinessStage, { label: string; reason: string; screen: string }> = {
    lead_found: { label: "Zrób teczkę klienta", reason: "Masz leada — zacznij od teczki (audyt + analiza).", screen: "sales" }, // nieosiągalne jako następny krok (typ wymaga kompletu)
    dossier_ready: { label: "Zrób teczkę klienta", reason: "Masz leada — zacznij od teczki (audyt + analiza).", screen: "sales" },
    offer_ready: { label: "Przygotuj ofertę", reason: "Teczka gotowa — przygotuj ofertę.", screen: "sales" },
    email_sent: { label: "Wyślij maila", reason: "Oferta gotowa — wyślij maila do klienta.", screen: "sales" },
    finance_project_created: { label: "Utwórz projekt finansowy", reason: "Mail wysłany — gdy klient wygrany, utwórz projekt finansowy.", screen: "finance" },
    paid: { label: "Dopilnuj płatności", reason: "Projekt utworzony — dopilnuj płatności (pełna wpłata domyka proces).", screen: "finance" },
  };
  const info = NEXT[nextStage];
  return {
    stage: nextStage,
    done,
    label: done ? STAGE_LABEL.paid : info.label,
    reason: done ? "Proces domknięty — opłacone. Czas na treść o realizacji." : info.reason,
    screen: done ? "content" : info.screen,
    leadId: lead.id,
    reached,
  };
}

/** Pure: krótkie podsumowanie statusu procesu do czatu. */
export function businessStatusText(lead: Lead, projects: FinanceProject[], sent: SentMail[]): string {
  const j = computeJourney(lead, projects, sent);
  const pct = Math.round(((STAGES.indexOf(j.reached) + 1) / STAGES.length) * 100);
  return `📊 ${lead.company}: ${STAGE_LABEL[j.reached]} (${pct}%). Następny krok: ${j.label} — ${j.reason}`;
}
