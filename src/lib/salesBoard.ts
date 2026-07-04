// === Tablica lejka (salesBoard) — grupowanie leadów w kolumny etapów ===
// PO CO: „gdzie kto jest" widać najlepiej jako kanban — karty w kolumnach etapów, z sumą wartości
// pod każdą. Ten czysty silnik tylko GRUPUJE i SUMUJE (reużywa PIPELINE_STAGES z clientRecord);
// przeciąganie/zapis robi cienki komponent. S9-safe.

import type { Lead, LeadStatus } from "../types";
import { PIPELINE_STAGES, type PipelineStage } from "./clientRecord";

export interface BoardColumn {
  stage: PipelineStage;
  leads: Lead[];
  /** Suma wartości leadów w tej kolumnie (zł). */
  total: number;
}

/** Pure: pogrupuj leady w kolumny wg etapów lejka (kolejność i etykiety z PIPELINE_STAGES). */
export function boardColumns(leads: Lead[]): BoardColumn[] {
  return PIPELINE_STAGES.map((stage) => {
    const inStage = (leads || []).filter((l) => l.status === stage.id);
    const total = inStage.reduce((s, l) => s + (l.value || 0), 0);
    return { stage, leads: inStage, total };
  });
}

/** Pure: treść śladu w osi czasu po przeniesieniu karty na inny etap. */
export function stageMoveNote(toLabel: string): string {
  return `➡ Etap zmieniony na: ${toLabel}`;
}

/** Pure: etykieta etapu po id (albo id, gdy nieznany). */
export function stageLabelOf(id: LeadStatus): string {
  return PIPELINE_STAGES.find((s) => s.id === id)?.label ?? id;
}
