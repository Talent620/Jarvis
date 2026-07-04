// W3 One Active Bet + dowody — implementuje Wykonawca B (PLAN.md).
// Sygnatury i typy są UMOWĄ (Wykonawca A importuje createBet/BetConflictError).
// Zasada zerowa: stan „zrobione” działania istnieje WYŁĄCZNIE z artefaktem
// dowodowym — jedyna droga to closeAction(...) z ważnym dowodem; schemat SQL
// dodatkowo pilnuje CHECK ((done_at IS NULL) = (proof_id IS NULL)).
import { all, one, run, batch, rowsModified, now, uuid } from "./db";

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

/** Zwróć aktywny zakład (0 lub 1 w całej bazie) albo null. */
export function activeBet(): BetRow | null {
  return one<BetRow>("SELECT * FROM bets WHERE status = 'active' LIMIT 1");
}

/** Utwórz zakład — odmowa (BetConflictError), gdy aktywny już istnieje. */
export function createBet(text: string, prediction: string, source: "manual" | "ai"): BetRow {
  if (activeBet()) throw new BetConflictError();
  const bet: BetRow = {
    id: uuid(),
    text,
    prediction,
    source,
    created_at: now(), // czas nadaje SYSTEM
    status: "active",
    outcome: null,
    learned: null,
    resolved_at: null,
  };
  run(
    "INSERT INTO bets (id, text, prediction, source, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
    [bet.id, bet.text, bet.prediction, bet.source, bet.created_at, bet.status]
  );
  return bet;
}

/** Działania zakładu rosnąco po czasie utworzenia. */
export function listActions(betId: string): ActionRow[] {
  return all<ActionRow>(
    "SELECT * FROM actions WHERE bet_id = ? ORDER BY created_at ASC",
    [betId]
  );
}

/** Dodaj działanie — startuje jako „do zrobienia” (bez done_at i proof_id). */
export function addAction(betId: string, text: string): ActionRow {
  const action: ActionRow = {
    id: uuid(),
    bet_id: betId,
    text,
    created_at: now(),
    done_at: null,
    proof_id: null,
  };
  run(
    "INSERT INTO actions (id, bet_id, text, created_at, done_at, proof_id) VALUES (?, ?, ?, ?, NULL, NULL)",
    [action.id, action.bet_id, action.text, action.created_at]
  );
  return action;
}

/**
 * JEDYNA droga do „zrobione”: walidacja dowodu → INSERT proofs (czas SYSTEMOWY)
 * → JEDEN UPDATE actions ustawiający done_at i proof_id RAZEM.
 * Nieważny dowód → ProofRequiredError, stan działania bez zmian.
 */
export function closeAction(actionId: string, proof: ProofInput): void {
  // Stan działania PRZED czymkolwiek (adwersarze A/P6): już domknięte albo nieistniejące
  // działanie nie może zostawić osieroconego artefaktu w bazie.
  const act = one<ActionRow>("SELECT * FROM actions WHERE id = ?", [actionId]);
  if (!act) throw new Error("Nie znaleziono działania — odśwież widok i spróbuj ponownie.");
  if (act.done_at != null) throw new Error("To działanie jest już domknięte dowodem.");

  // Walidacja artefaktu — bez niej nie ma „zrobione”.
  if (proof.kind === "note") {
    if (!proof.note || proof.note.trim().length === 0) {
      throw new ProofRequiredError("Notatka dowodowa jest pusta — bez treści nie ma dowodu.");
    }
  } else if (proof.kind === "link") {
    const url = (proof.url ?? "").trim();
    // Adwersarz A2 (runda 2): parsowanie przez URL zamiast regexa — „https://.”,
    // „http://#”, „http://:” odpadają (host musi zawierać znak alfanumeryczny),
    // a poprawny „HTTP://example.com” przechodzi (protokół normalizowany).
    let validUrl = false;
    try {
      const u = new URL(url);
      validUrl = (u.protocol === "http:" || u.protocol === "https:") && /[a-z0-9]/i.test(u.hostname);
    } catch {
      validUrl = false;
    }
    if (!validUrl) {
      throw new ProofRequiredError(
        "Link dowodowy musi być pełnym adresem URL z hostem (np. https://example.com/...)."
      );
    }
  } else if (proof.kind === "file") {
    if (!proof.bytes || proof.bytes.length === 0) {
      throw new ProofRequiredError("Plik dowodowy jest pusty — bez bajtów nie ma dowodu.");
    }
  } else {
    throw new ProofRequiredError();
  }

  const proofId = uuid();
  const ts = now(); // timestamp dowodu nadaje SYSTEM — nigdy użytkownik
  // P7: jedna transakcja SQL + jeden snapshot — bez okna „proof jest, done nie ma”.
  batch(() => {
    if (proof.kind === "note") {
      run("INSERT INTO proofs (id, kind, note, created_at) VALUES (?, 'note', ?, ?)", [
        proofId,
        proof.note.trim(),
        ts,
      ]);
    } else if (proof.kind === "link") {
      run("INSERT INTO proofs (id, kind, url, created_at) VALUES (?, 'link', ?, ?)", [
        proofId,
        proof.url.trim(),
        ts,
      ]);
    } else {
      run(
        "INSERT INTO proofs (id, kind, file_name, file_mime, file_blob, created_at) VALUES (?, 'file', ?, ?, ?, ?)",
        [proofId, proof.name, proof.mime, proof.bytes, ts]
      );
    }
    // Oba pola naraz — schemat ma CHECK, że done_at i proof_id są NULL albo ustawione RAZEM.
    run("UPDATE actions SET done_at = ?, proof_id = ? WHERE id = ? AND done_at IS NULL", [
      ts,
      proofId,
      actionId,
    ]);
    // Defense-in-depth (runda 2): UPDATE, który nic nie trafił, wycofuje CAŁĄ partię
    // (ROLLBACK przez batch) — dowód nigdy nie zostaje osierocony w bazie.
    if (rowsModified() === 0) {
      throw new Error("To działanie zostało już domknięte w międzyczasie — dowód nie został zapisany.");
    }
  });
}

/** Odczyt artefaktu dowodowego (podgląd w UI). */
export function getProof(proofId: string): ProofRow | null {
  return one<ProofRow>("SELECT * FROM proofs WHERE id = ?", [proofId]);
}

/** Rozstrzygnięcie zakładu: werdykt + wnioski; czas rozstrzygnięcia nadaje SYSTEM. */
export function resolveBet(betId: string, outcome: "hit" | "miss" | "unclear", learned: string): void {
  // Tylko AKTYWNY zakład da się rozstrzygnąć — werdykt rozstrzygniętego jest niezmienny.
  run(
    "UPDATE bets SET status = 'resolved', outcome = ?, learned = ?, resolved_at = ? WHERE id = ? AND status = 'active'",
    [outcome, learned, now(), betId]
  );
  // Runda 2: cichy no-op (0 wierszy) to utrata werdyktu — mówimy o tym wprost.
  if (rowsModified() === 0) {
    throw new Error("Zakład nie jest już aktywny — werdykt nie został zapisany.");
  }
}

/** Historia rozstrzygniętych zakładów — najnowsze najpierw. */
export function betHistory(): BetRow[] {
  return all<BetRow>("SELECT * FROM bets WHERE status = 'resolved' ORDER BY resolved_at DESC");
}
