// === Codzienny Growth Orchestrator (growthOrchestrator) ===
// Po otwarciu aplikacji Marcin od razu wie, co DZIŚ najbardziej przesunie biznes. Raz dziennie
// wybieramy maks. TRZY działania o najwyższym oczekiwanym ROI z LOKALNYCH danych (działa offline).
// Każda rekomendacja ma wartość, dowody, koszt, ryzyko, wymaganą zgodę i oczekiwany efekt. Działania
// zewnętrzne (wysyłka/publikacja/wydatek) ZAWSZE zatrzymują się na zgodzie. Orkiestrator uczy się z
// zaakceptowanych/odrzuconych rekomendacji (bezpieczne granice). Czyste i testowalne. S9-safe.

import type { Lead, FinanceProject } from "../types";
import { financeKpis } from "./finance";
import type { AgentPlan } from "./agentPlanner";

export type GrowthActionKind = "research" | "build_demo" | "send_followup" | "publish_post" | "check_payment";

export interface GrowthAction {
  id: string;
  kind: GrowthActionKind;
  title: string;
  expectedValue: number;    // proxy ROI (do rankingu)
  evidence: string[];
  cost: string;
  risk: "low" | "medium" | "high";
  requiredPermission: "none" | "consent"; // outbound → consent
  expectedEffect: string;
  entityId?: string;
}

const DAY = 86_400_000;

export type OrchestratorWeights = Record<GrowthActionKind, number>;
export const DEFAULT_ORCH_WEIGHTS: OrchestratorWeights = {
  research: 1, build_demo: 1, send_followup: 1, publish_post: 1, check_payment: 1,
};

export interface OrchestratorInput {
  leads?: Lead[];
  finance?: FinanceProject[];
  approvedPostsCount?: number; // zatwierdzone posty gotowe do publikacji
  now: number;
  weights?: OrchestratorWeights;
}

/**
 * Pure: zaplanuj do 3 działań dnia z lokalnych danych (offline OK). Ranking wg oczekiwanego ROI z
 * wagami uczenia. Działania zewnętrzne wymagają zgody (requiredPermission=consent).
 */
export function planDailyGrowth(input: OrchestratorInput): GrowthAction[] {
  const leads = input.leads || [];
  const finance = input.finance || [];
  const w = input.weights || DEFAULT_ORCH_WEIGHTS;
  const k = financeKpis(finance);
  const actions: GrowthAction[] = [];

  // 1) Zaległe/oczekujące płatności → sprawdź płatność (odzysk gotówki). Sam sprawdź = bez zgody.
  const unpaid = k.unpaid;
  if (unpaid > 0) {
    actions.push({
      id: "check_payment", kind: "check_payment", title: "Sprawdź i ponaglij zaległe płatności",
      expectedValue: Math.min(100, unpaid / 100) * w.check_payment,
      evidence: [`należności: ${unpaid} zł`], cost: "kilka minut", risk: "low",
      requiredPermission: "none", expectedEffect: "szybszy przychód z odzyskanej gotówki",
    });
  }

  // 2) Gorący lead ze stroną słabą/bez strony → zbuduj demo (lokalne, bez zgody).
  const hot = leads.find((l) => (l.status === "offer" || l.status === "contacted") && (!l.lastContactedAt || input.now - l.lastContactedAt > 3 * DAY));
  if (hot) {
    actions.push({
      id: `build_demo:${hot.id}`, kind: "build_demo", title: `Zbuduj demo dla: ${hot.company}`,
      expectedValue: (55 + (typeof hot.value === "number" ? Math.min(30, hot.value / 500) : 0)) * w.build_demo,
      evidence: [`lead: ${hot.company}`, `status: ${hot.status}`], cost: "kilka minut (AI)", risk: "low",
      requiredPermission: "none", expectedEffect: "mocny materiał sprzedażowy pod ofertę", entityId: hot.id,
    });
  }

  // 3) Follow-up do leada z e-mailem (zaległy) → wysyłka WYMAGA zgody.
  const followUp = leads.find((l) => l.email && l.nextFollowUpAt && l.nextFollowUpAt <= input.now);
  if (followUp) {
    actions.push({
      id: `send_followup:${followUp.id}`, kind: "send_followup", title: `Wyślij zatwierdzony follow-up: ${followUp.company}`,
      expectedValue: 50 * w.send_followup, evidence: [`follow-up zaległy: ${followUp.company}`], cost: "1 e-mail",
      risk: "medium", requiredPermission: "consent", expectedEffect: "przypomnienie o ofercie zwiększa szansę odpowiedzi", entityId: followUp.id,
    });
  }

  // 4) Zatwierdzony post → publikacja WYMAGA zgody.
  if ((input.approvedPostsCount || 0) > 0) {
    actions.push({
      id: "publish_post", kind: "publish_post", title: "Opublikuj zatwierdzony post",
      expectedValue: 35 * w.publish_post, evidence: [`gotowe posty: ${input.approvedPostsCount}`], cost: "1 publikacja",
      risk: "medium", requiredPermission: "consent", expectedEffect: "zasięg i świeże leady",
    });
  }

  // 5) Za mało leadów → research (lokalne, bez zgody). Zawsze sensowna opcja offline.
  const activeLeads = leads.filter((l) => l.status !== "lost" && l.status !== "won").length;
  if (activeLeads < 5) {
    actions.push({
      id: "research", kind: "research", title: "Zbadaj 10 nowych firm (kandydaci)",
      expectedValue: (30 + (5 - activeLeads) * 5) * w.research, evidence: [`aktywnych leadów: ${activeLeads}`], cost: "kilka minut",
      risk: "low", requiredPermission: "none", expectedEffect: "świeże szanse na górze lejka",
    });
  }

  return actions.sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 3);
}

/** Pure: zamień działanie na bezpieczny plan narzędziowy (jedno kliknięcie). Outbound → requiresConsent. */
export function actionToPlan(action: GrowthAction): AgentPlan {
  const tool: Record<GrowthActionKind, string> = {
    research: "find_leads", build_demo: "lead_dossier", send_followup: "gmail_send", publish_post: "run_automation", check_payment: "finance_summary",
  };
  return {
    goal: action.title,
    steps: [{
      id: "s1", intent: action.title, tool: tool[action.kind],
      requiresConsent: action.requiredPermission === "consent" ? true : undefined,
      ...(action.entityId ? { arguments: { id: action.entityId } } : {}),
    }],
    confidence: 0.8,
  };
}

// — Uczenie z akceptacji/odrzucenia (bezpieczne granice) —
const MIN = 0.5, MAX = 2, STEP = 0.1;

/** Pure: douczaj wagę rodzaju działania — akceptacja podnosi, odrzucenie obniża (w granicach). */
export function recordDecision(weights: OrchestratorWeights, kind: GrowthActionKind, accepted: boolean): OrchestratorWeights {
  const next = { ...weights };
  next[kind] = Math.max(MIN, Math.min(MAX, weights[kind] + (accepted ? STEP : -STEP)));
  return next;
}
