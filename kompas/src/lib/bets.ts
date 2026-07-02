// W3 One Active Bet + dowody — implementuje Wykonawca B (PLAN.md).
// Ten plik startuje jako STUB KONTRAKTOWY integratora: sygnatury są UMOWĄ
// (Wykonawca A importuje createBet/BetConflictError w ekranie Tydzień).
// Wykonawca B podmienia ciała, NIE zmienia sygnatur.

export type ProofInput =
  | { kind: "note"; note: string }
  | { kind: "link"; url: string }
  | { kind: "file"; name: string; mime: string; bytes: Uint8Array };

export interface BetRow {
  id: string;
  text: string;
  prediction: string;
  source: "manual" | "ai";
  created_at: number;
  status: "active" | "resolved";
  outcome: "hit" | "miss" | "unclear" | null;
  learned: string | null;
  resolved_at: number | null;
}

export interface ActionRow {
  id: string;
  bet_id: string;
  text: string;
  created_at: number;
  done_at: number | null;
  proof_id: string | null;
}

export interface ProofRow {
  id: string;
  kind: "file" | "note" | "link";
  note: string | null;
  url: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_blob: Uint8Array | null;
  created_at: number;
}

/** Istnieje już aktywny zakład — najpierw rozstrzygnij bieżący. */
export class BetConflictError extends Error {
  constructor() {
    super("Masz już aktywny zakład — najpierw rozstrzygnij bieżący.");
    this.name = "BetConflictError";
  }
}

/** Domknięcie działania wymaga ważnego artefaktu dowodowego. */
export class ProofRequiredError extends Error {
  constructor(msg = "Stan „zrobione” istnieje tylko z artefaktem dowodowym.") {
    super(msg);
    this.name = "ProofRequiredError";
  }
}

const TODO = (co: string): never => {
  throw new Error("W3/W4 do implementacji: " + co);
};

export function activeBet(): BetRow | null {
  return TODO("activeBet");
}
export function createBet(_text: string, _prediction: string, _source: "manual" | "ai"): BetRow {
  return TODO("createBet");
}
export function listActions(_betId: string): ActionRow[] {
  return TODO("listActions");
}
export function addAction(_betId: string, _text: string): ActionRow {
  return TODO("addAction");
}
export function closeAction(_actionId: string, _proof: ProofInput): void {
  TODO("closeAction");
}
export function getProof(_proofId: string): ProofRow | null {
  return TODO("getProof");
}
export function resolveBet(_betId: string, _outcome: "hit" | "miss" | "unclear", _learned: string): void {
  TODO("resolveBet");
}
export function betHistory(): BetRow[] {
  return TODO("betHistory");
}
