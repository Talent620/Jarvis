// === PROJECT HORIZON — Sztafeta Misji z Drabiną Prawdy: typy rdzenia ===
// Jeden trwały cel wędruje między węzłami (telefon / Windows EXE / urządzenie).
// Każdy krok przechodzi drabinę prawdy SIMULATED → ATTEMPTED → CONFIRMED, gdzie
// CONFIRMED wymaga ODCZYTU ZWROTNEGO z węzła (nie deklaracji). Czyste typy, S9-safe.
import type { ActionOutcome } from "../actionOutcome";

/** Węzeł wykonawczy sztafety. „device” to fizyczne urządzenie ALBO jego emulator. */
export type MissionNode = "phone" | "exe" | "device";

/** Twarde granice STOP — nigdy nie omijane; zamieniane w Kartę Przekazania. */
export type HardStopKind =
  | "password"
  | "biometrics"
  | "mfa"
  | "captcha"
  | "terms"
  | "payment"
  | "publish"
  | "broad_consent";

export interface MissionStep {
  id: string;
  /** Węzeł, który ma wykonać ten krok. */
  node: MissionNode;
  /** Zdolność do wywołania na węźle (np. nazwa narzędzia MCP „set_led”). */
  capability: string;
  /** Argumenty wywołania. */
  args?: Record<string, unknown>;
  /**
   * Oczekiwany stan po wykonaniu, sprawdzany ODCZYTEM ZWROTNYM. Klucz→wartość
   * porównywane z tym, co węzeł RAPORTUJE po akcji. Brak = krok bez read-backu
   * (nie może osiągnąć CONFIRMED — najwyżej ATTEMPTED).
   */
  expect?: Record<string, unknown>;
  /** Twarda granica: krok wymaga ludzkiego potwierdzenia na telefonie (Karta Przekazania). */
  hardStop?: HardStopKind;
  /** Klucz idempotencji wysyłki — „wyślij-raz” mimo powtórnych przebiegów. */
  correlationId: string;
}

/** Wynik pojedynczego kroku po przejściu drabiny prawdy. */
export interface StepResult {
  stepId: string;
  node: MissionNode;
  outcome: ActionOutcome;
  /** Surowy odczyt zwrotny z węzła (do audytu i weryfikacji CONFIRMED). */
  readback?: Record<string, unknown>;
}

/** Wpis rejestru dowodów — jeden kwit na akcję, spięty jednym traceId. */
export interface EvidenceEntry {
  traceId: string;
  missionId: string;
  stepId: string;
  correlationId: string;
  node: MissionNode;
  capability: string;
  state: ActionOutcome["state"];
  at: number;
  readback?: Record<string, unknown>;
  message?: string;
}

/** Karta Przekazania: STOP napotkany na węźle X → zatwierdzenie na telefonie. */
export interface HandoffCard {
  missionId: string;
  stepId: string;
  fromNode: MissionNode;
  kind: HardStopKind;
  /** Krótki, przyjazny opis dla człowieka (co i dlaczego wymaga potwierdzenia). */
  prompt: string;
  createdAt: number;
}

export interface Mission {
  id: string;
  title: string;
  steps: MissionStep[];
  createdAt: number;
}

/** Stan sztafety — trwały, wznawialny, idempotentny. */
export interface MissionState {
  mission: Mission;
  /** Wyniki kroków wg stepId (CONFIRMED nigdy nie wykonuje się 2×). */
  results: Record<string, StepResult>;
  /** Aktywna Karta Przekazania (jeśli sztafeta czeka na człowieka). */
  pendingHandoff?: HandoffCard;
  /** Czy misja jest domknięta (wszystkie kroki CONFIRMED) albo zatrzymana błędem. */
  status: "running" | "awaiting_human" | "done" | "failed" | "paused";
}
