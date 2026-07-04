// === Cofnij w świecie fizycznym, głosem ===
// „Cofnij" = OPERACJA ODWROTNA na węźle (przywróć stan sprzed kroku), potwierdzona
// odczytem zwrotnym — NIGDY kasowanie kwitu. Cofnięcie to NOWY, potwierdzony fakt
// w łańcuchu dowodów (uczciwość: historia się nie zmienia, dopisujemy prawdę).
// Cofać wolno WYŁĄCZNIE kroki odwracalne: krok urządzenia (device) z zapamiętanym
// stanem sprzed akcji, NIE będący twardą granicą. Płatność/publikacja/MFA są
// nieodwracalne — mówimy to wprost, zamiast udawać cofnięcie.
import { climbLadder } from "./truthLadder";
import { appendEvidence } from "./evidenceLedger";
import type { NodeExecutor } from "./missionRelay";
import type { EvidenceEntry, MissionState, MissionStep, StepResult } from "./types";

export interface UndoResult {
  ok: boolean;
  message: string;
  state: MissionState;
  ledger: EvidenceEntry[];
}

/** Ostatni krok nadający się do cofnięcia (device, CONFIRMED, ma priorReadback, nie hardStop). */
export function lastUndoableStep(state: MissionState): { step: MissionStep; result: StepResult } | null {
  const steps = state.mission.steps;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const r = state.results[step.id];
    if (!r || r.outcome.state !== "CONFIRMED") continue;
    if (step.node !== "device") continue; // tylko fizyczne kroki cofamy operacją odwrotną
    if (step.hardStop) continue; // twarde granice są nieodwracalne z założenia
    if (!r.priorReadback || !step.expect) continue; // brak zapamiętanego stanu = nie ryzykujemy
    return { step, result: r };
  }
  return null;
}

/**
 * Cofnij ostatni odwracalny krok misji: wykonaj operację odwrotną (set_state na stan
 * sprzed kroku), potwierdź odczytem zwrotnym, dopisz kwit UNDO. Zwraca uczciwy komunikat.
 * `exec` to ten sam NodeExecutor co w sztafecie (transport wstrzyknięty → testowalne).
 */
export async function undoLastStep(
  state: MissionState,
  ledger: EvidenceEntry[],
  exec: NodeExecutor,
  now: number,
): Promise<UndoResult> {
  const cand = lastUndoableStep(state);
  if (!cand) {
    return {
      ok: false,
      message:
        "Nie mam czego bezpiecznie cofnąć. Cofam tylko odwracalne kroki na urządzeniu (twarde granice jak płatność czy publikacja są z definicji nieodwracalne).",
      state,
      ledger,
    };
  }
  const { step, result } = cand;
  const key = Object.keys(step.expect!)[0];
  const priorValue = result.priorReadback![key];

  // Operacja odwrotna: przywróć zapamiętaną wartość sprzed kroku, tym samym adapterem.
  const undoStep: MissionStep = {
    id: step.id + ":undo",
    node: "device",
    capability: "set_state",
    args: { key, value: priorValue },
    expect: { [key]: priorValue },
    correlationId: step.correlationId + ":undo",
  };
  let ex;
  try {
    ex = await exec(undoStep);
  } catch (e) {
    ex = { actuated: false, actuateError: e instanceof Error ? e.message : String(e) };
  }
  const outcome = climbLadder({
    actuated: ex.actuated,
    actuateError: ex.actuateError,
    expect: undoStep.expect,
    readback: ex.readback,
    source: "device",
    now,
  });

  const undoResult: StepResult = { stepId: undoStep.id, node: "device", outcome, readback: ex.readback };
  const nextLedger = appendEvidence(ledger, state.mission, undoResult, undoStep.correlationId, "undo:" + step.capability, now);

  if (outcome.state !== "CONFIRMED") {
    return {
      ok: false,
      message: `Próba cofnięcia „${step.capability}" nie potwierdziła się odczytem zwrotnym — nie ogłaszam cofnięcia bez dowodu. Urządzenie mogło nie odpowiedzieć; spróbuj ponownie.`,
      state,
      ledger: nextLedger,
    };
  }

  // Uczciwość: krok w results zostaje CONFIRMED (był), ale dopisujemy fakt cofnięcia
  // do wyniku (undoneAt), żeby status/„dlaczego" mówiły prawdę o bieżącym stanie.
  const results = {
    ...state.results,
    [step.id]: { ...result, outcome: { ...result.outcome, evidence: { ...result.outcome.evidence, message: "cofnięte przez operację odwrotną" } } },
  };
  return {
    ok: true,
    message: `Cofnięto „${step.capability}" na urządzeniu: przywrócono ${key}=${String(priorValue)} i potwierdzono odczytem zwrotnym. Dowód cofnięcia dopisany do łańcucha (nic nie skasowałem).`,
    state: { ...state, results },
    ledger: nextLedger,
  };
}
