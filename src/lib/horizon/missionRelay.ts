// === Sztafeta Misji (Mission Relay) — orkiestrator trwałego celu wielowęzłowego ===
// Jeden cel, wiele węzłów (telefon/EXE/urządzenie). Reguły (spójne z resztą JARVIS-a):
//  • idempotencja: krok CONFIRMED nigdy nie wykonuje się 2× (bezpieczne wznowienie);
//  • „wyślij-raz": correlationId już CONFIRMED w rejestrze → krok pomijany bez akcji;
//  • outbound NIGDY nie jest ponawiany automatycznie: FAILED → misja PAUZUJE (nie pętli);
//  • twarda granica STOP → Karta Przekazania, status „awaiting_human" (nic się nie dzieje);
//  • CONFIRMED tylko przez odczyt zwrotny (drabina prawdy).
// Orkiestrator jest CZYSTY względem transportu: dostaje `NodeExecutor` (wstrzyknięty),
// więc testuje się bez sieci, a w produkcie tym executorem jest adapter MCP/IPC.
import { climbLadder } from "./truthLadder";
import { appendEvidence, isCorrelationConfirmed } from "./evidenceLedger";
import { makeHandoff, isHardStop } from "./handoff";
import type { EvidenceEntry, Mission, MissionState, MissionStep, StepResult } from "./types";

/** Wynik wykonania kroku na węźle: czy akcja przeszła + odczyt zwrotny. */
export interface NodeExecResult {
  actuated: boolean;
  actuateError?: string;
  readback?: Record<string, unknown>;
  /** Stan węzła SPRZED akcji (odczyt przed wykonaniem) — umożliwia cofnięcie. */
  priorReadback?: Record<string, unknown>;
}

/**
 * Wykonawca węzła: wykonuje `capability` z argumentami i zwraca wynik akcji + odczyt
 * zwrotny. W testach — emulator; w produkcie — adapter MCP (device) / IPC (exe) / lokal (phone).
 */
export type NodeExecutor = (step: MissionStep) => Promise<NodeExecResult>;

export interface RelayOptions {
  now: number;
  /** Tryb próby generalnej — kroki dają SIMULATED, nic nie wychodzi na zewnątrz. */
  rehearsal?: boolean;
  /**
   * Zbiór stepId, które człowiek zatwierdził (przełamane Karty Przekazania).
   * Krok hardStop wykonuje się TYLKO, jeśli jego id jest tutaj.
   */
  approvedStops?: Set<string>;
}

const NODE_SOURCE: Record<MissionStep["node"], string> = {
  phone: "phone",
  exe: "exe",
  device: "device",
};

/** Utwórz świeży stan sztafety dla misji. Czyste. */
export function initMissionState(mission: Mission): MissionState {
  return { mission, results: {}, status: "running" };
}

/**
 * Wykonaj sztafetę od bieżącego stanu. Zwraca NOWY stan + zaktualizowany rejestr dowodów.
 * Wielokrotne wywołanie na tym samym stanie jest idempotentne (nie dubluje akcji).
 */
export async function runMission(
  state: MissionState,
  ledger: EvidenceEntry[],
  exec: NodeExecutor,
  opts: RelayOptions,
): Promise<{ state: MissionState; ledger: EvidenceEntry[] }> {
  const results: Record<string, StepResult> = { ...state.results };
  let evid = ledger;
  let pendingHandoff = state.pendingHandoff;
  let status: MissionState["status"] = "running";
  const approved = opts.approvedStops || new Set<string>();

  for (const step of state.mission.steps) {
    const prior = results[step.id];
    // Idempotencja: krok już potwierdzony — nie wykonuj ponownie.
    if (prior && prior.outcome.state === "CONFIRMED") continue;

    // Twarda granica STOP PRZED jakimkolwiek skrótem (weryfikator, problem B):
    // krok graniczny nigdy nie jest pomijany „na skróty" — także w próbie generalnej
    // (rehearsal celowo fail-closed: STOP daje awaiting_human, nie SIMULATED).
    if (isHardStop(step) && !approved.has(step.id)) {
      pendingHandoff = makeHandoff(state.mission, step, opts.now);
      status = "awaiting_human";
      break; // sztafeta czeka na człowieka — nic dalej się nie dzieje
    }

    // „Wyślij-raz": ten correlationId już potwierdzony W TEJ MISJI (np. w poprzednim
    // przebiegu przed restartem) — pomiń bez akcji. Zakres per misja: kolizja
    // correlationId z INNĄ misją nie tworzy fantomowego CONFIRMED.
    if (isCorrelationConfirmed(evid, step.correlationId, state.mission.id)) {
      results[step.id] = prior || {
        stepId: step.id,
        node: step.node,
        outcome: { state: "CONFIRMED", evidence: { message: "już potwierdzone (wyślij-raz)" } },
      };
      continue;
    }

    // Wykonaj krok na węźle (transport wstrzyknięty).
    let ex: NodeExecResult;
    try {
      ex = opts.rehearsal ? { actuated: false } : await exec(step);
    } catch (e) {
      ex = { actuated: false, actuateError: e instanceof Error ? e.message : String(e) };
    }

    const outcome = climbLadder({
      actuated: ex.actuated,
      actuateError: ex.actuateError,
      expect: step.expect,
      readback: ex.readback,
      rehearsal: opts.rehearsal,
      source: NODE_SOURCE[step.node],
      now: opts.now,
    });

    const result: StepResult = { stepId: step.id, node: step.node, outcome, readback: ex.readback, priorReadback: ex.priorReadback };
    results[step.id] = result;
    evid = appendEvidence(evid, state.mission, result, step.correlationId, step.capability, opts.now);

    // Outbound nigdy nie jest ponawiany automatycznie: błąd → PAUZA (człowiek decyduje).
    if (outcome.state === "FAILED") {
      status = "paused";
      break;
    }
    // ATTEMPTED bez potwierdzenia w trybie realnym też wstrzymuje sztafetę (brak dowodu skutku).
    if (outcome.state === "ATTEMPTED" && !opts.rehearsal) {
      status = "paused";
      break;
    }
  }

  // Ustal status końcowy, jeśli nie przerwano wcześniej.
  if (status === "running") {
    const allConfirmed = state.mission.steps.every((s) => results[s.id]?.outcome.state === "CONFIRMED");
    status = allConfirmed ? "done" : opts.rehearsal ? "paused" : "running";
  }
  // Karta Przekazania żyje WYŁĄCZNIE gdy sztafeta czeka na człowieka (weryfikator,
  // problem C): zatwierdzony-a-nieudany krok nie zostawia wiszącej, nieaktualnej karty.
  if (status !== "awaiting_human") pendingHandoff = undefined;

  return { state: { mission: state.mission, results, pendingHandoff, status }, ledger: evid };
}

/** Postęp misji: ile kroków potwierdzonych z ilu. Czyste. */
export function missionProgress(state: MissionState): { confirmed: number; total: number } {
  const total = state.mission.steps.length;
  const confirmed = state.mission.steps.filter((s) => state.results[s.id]?.outcome.state === "CONFIRMED").length;
  return { confirmed, total };
}
