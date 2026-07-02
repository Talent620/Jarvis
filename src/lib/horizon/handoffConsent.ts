// === Karta Przekazania → znana bramka zgód (PermissionDialog) ===
// Misja w statusie awaiting_human pyta człowieka przez TEN SAM dialog zgód, którego
// używa każde narzędzie outbound — bez nowego UI. Różnice (celowe, twarda granica STOP):
//  • zgoda NIGDY nie jest zapamiętywana (płatność/publikacja/MFA to decyzje jednorazowe),
//  • auto-zgoda Trybu Szefa i zakres sesyjny NIE omijają Karty (surowsze niż outbound),
//  • brak UI zgody → misja UCZCIWIE zostaje awaiting_human (fail-closed, zero cichych wykonań),
//  • każda decyzja (także brak UI) ląduje w audycie.
import { askConsentUI, audit } from "../permissions";
import { runMission, type NodeExecutor, type RelayOptions } from "./missionRelay";
import type { EvidenceEntry, HandoffCard, MissionState } from "./types";

/**
 * Zapytaj człowieka o Kartę Przekazania przez dialog zgód. Zwraca decyzję;
 * fail-closed: brak podpiętego UI = odmowa (misja czeka dalej).
 */
export async function approveHandoff(card: HandoffCard): Promise<boolean> {
  const res = await askConsentUI({
    tool: "mission_handoff_" + card.kind,
    input: card.prompt,
    risk: "outbound",
  });
  const allow = !!res?.allow;
  audit({
    tool: "mission_handoff",
    input: card.prompt,
    status: allow ? "ok" : "denied",
    output: allow
      ? "zatwierdzono Kartę Przekazania (zgoda jednorazowa — nie jest zapamiętywana)"
      : res
        ? "odrzucono Kartę Przekazania — misja pozostaje wstrzymana"
        : "brak UI zgody — misja pozostaje wstrzymana (fail-closed)",
  });
  return allow;
}

/**
 * Kontynuuj misję czekającą na człowieka: pokaż Kartę w dialogu zgód; po zatwierdzeniu
 * wykonaj TYLKO ten jeden zatwierdzony krok STOP (i dalszy ciąg sztafety). Odmowa/brak UI
 * → stan bez zmian (awaiting_human). Idempotentne dla misji nieczekających (no-op).
 */
export async function continueMissionWithConsent(
  state: MissionState,
  ledger: EvidenceEntry[],
  exec: NodeExecutor,
  opts: Omit<RelayOptions, "approvedStops">,
): Promise<{ state: MissionState; ledger: EvidenceEntry[]; asked: boolean }> {
  if (state.status !== "awaiting_human" || !state.pendingHandoff) {
    return { state, ledger, asked: false };
  }
  const card = state.pendingHandoff;
  const allow = await approveHandoff(card);
  if (!allow) return { state, ledger, asked: true };
  const r = await runMission(state, ledger, exec, { ...opts, approvedStops: new Set([card.stepId]) });
  return { ...r, asked: true };
}
