// === Drabina Prawdy: SIMULATED → ATTEMPTED → CONFIRMED przez ODCZYT ZWROTNY ===
// Reguła żelazna (spójna z ActionOutcome): CONFIRMED wolno nadać WYŁĄCZNIE, gdy odczyt
// zwrotny z węzła zgadza się z oczekiwanym stanem (`expect`). Sam ACK z akcji = najwyżej
// ATTEMPTED. Brak `expect` = krok bez weryfikacji → nie może przekroczyć ATTEMPTED.
// Błąd akcji → FAILED. Czyste, bez efektów ubocznych.
import { type ActionOutcome, confirmed, attempted, failed, simulated } from "../actionOutcome";

/** Płytkie porównanie oczekiwań z odczytem (klucz→wartość). Czyste. */
export function readbackMatches(
  expect: Record<string, unknown> | undefined,
  readback: Record<string, unknown> | undefined,
): boolean {
  if (!expect) return false; // brak oczekiwań = nie ma czego potwierdzić
  if (!readback) return false;
  for (const k of Object.keys(expect)) {
    // porównanie wartości prymitywnych; głębsze struktury po JSON (deterministyczne)
    const a = expect[k];
    const b = readback[k];
    const eq = a === b || JSON.stringify(a) === JSON.stringify(b);
    if (!eq) return false;
  }
  return true;
}

export interface LadderInput {
  /** Czy akcja (np. set_state) zakończyła się bez błędu transportu/urządzenia. */
  actuated: boolean;
  /** Komunikat błędu akcji (gdy !actuated). */
  actuateError?: string;
  /** Oczekiwany stan po akcji. */
  expect?: Record<string, unknown>;
  /** Odczyt zwrotny z węzła (read_state). */
  readback?: Record<string, unknown>;
  /** Tryb próby generalnej — nic nie wyszło na zewnątrz. */
  rehearsal?: boolean;
  /** Źródło/kanał do dowodu. */
  source?: string;
  now: number;
}

/**
 * Wylicz ActionOutcome kroku wg drabiny prawdy:
 *  - rehearsal → SIMULATED (nic nie ruszyło na zewnątrz);
 *  - !actuated → FAILED (potwierdzony błąd akcji);
 *  - actuated + readback zgodny z expect → CONFIRMED (z dowodem odczytu);
 *  - actuated, ale brak/rozjazd odczytu → ATTEMPTED (rozpoczęto, brak potwierdzenia).
 */
export function climbLadder(inp: LadderInput): ActionOutcome {
  if (inp.rehearsal) {
    return simulated("próba generalna — nic nie wyszło na zewnątrz");
  }
  if (!inp.actuated) {
    return failed(inp.actuateError || "akcja nie powiodła się", inp.source);
  }
  if (readbackMatches(inp.expect, inp.readback)) {
    return confirmed({
      confirmedAt: inp.now,
      source: inp.source,
      message: "potwierdzone odczytem zwrotnym",
    });
  }
  return attempted(inp.source, "wykonano, brak potwierdzenia odczytem zwrotnym");
}
