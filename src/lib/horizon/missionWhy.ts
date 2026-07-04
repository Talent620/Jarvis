// === Czarna skrzynka misji: „dlaczego?" bez ekranu ===
// Czyste, ludzkie wyjaśnienie STANU misji z faktów (kroki, dowody, blokady) — nigdy
// z domysłu. Odpowiada na „dlaczego to zrobiłeś / dlaczego stoi / co dalej", tak żeby
// dało się to WYPOWIEDZIEĆ w słuchawce (bez emoji-śmieci w torze głosowym).
import { missionProgress } from "./missionRelay";
import type { EvidenceEntry, MissionState, MissionStep, StepResult } from "./types";

const NODE: Record<MissionStep["node"], string> = {
  phone: "telefonie",
  exe: "komputerze",
  device: "urządzeniu",
};

/** Pierwszy krok, który jeszcze NIE jest potwierdzony (blokada postępu). */
function firstUnconfirmed(state: MissionState): { step: MissionStep; result?: StepResult } | null {
  for (const step of state.mission.steps) {
    const r = state.results[step.id];
    if (!r || r.outcome.state !== "CONFIRMED") return { step, result: r };
  }
  return null;
}

/**
 * Wyjaśnij, dlaczego misja jest w bieżącym stanie — po ludzku, z FAKTÓW.
 * `voice=true` zwraca wariant bez emoji (do TTS).
 */
export function explainMission(
  state: MissionState,
  ledger: EvidenceEntry[],
  opts: { voice?: boolean } = {},
): string {
  const p = missionProgress(state);
  const head = `Misja „${state.mission.title}": ${p.confirmed} z ${p.total} kroków potwierdzonych.`;
  const parts: string[] = [head];

  if (state.status === "awaiting_human" && state.pendingHandoff) {
    parts.push(
      `Stoi, bo krok „${state.pendingHandoff.kind}" to twarda granica — wymaga Twojego potwierdzenia. ${state.pendingHandoff.prompt}`,
    );
  } else if (state.status === "paused") {
    const blk = firstUnconfirmed(state);
    if (blk) {
      const where = NODE[blk.step.node];
      if (blk.result?.outcome.state === "FAILED") {
        const why = blk.result.outcome.evidence?.message || "urządzenie odmówiło";
        parts.push(
          `Wstrzymana na kroku „${blk.step.capability}" na ${where}: ${why}. Nie ponawiam tego sam — czekam na Twoją decyzję (możesz kazać wznowić).`,
        );
      } else if (blk.result?.outcome.state === "ATTEMPTED") {
        parts.push(
          `Wstrzymana na kroku „${blk.step.capability}" na ${where}: komenda poszła, ale nie dostałem potwierdzenia odczytem zwrotnym — nie ogłaszam sukcesu bez dowodu.`,
        );
      } else {
        parts.push(`Wstrzymana przed krokiem „${blk.step.capability}" na ${where}.`);
      }
    }
  } else if (state.status === "done") {
    parts.push("Domknięta — każdy krok potwierdzony odczytem zwrotnym z węzła, nie samą deklaracją.");
  } else if (state.status === "failed") {
    parts.push("Zakończona błędem — szczegóły w łańcuchu dowodów poniżej.");
  } else {
    const blk = firstUnconfirmed(state);
    if (blk) parts.push(`W toku — następny krok to „${blk.step.capability}" na ${NODE[blk.step.node]}.`);
  }

  // Ostatnie fakty z łańcucha dowodowego (max 3) — to jest „czarna skrzynka".
  const story = evidenceTail(ledger, state.mission.id, 3);
  if (story.length) {
    parts.push(opts.voice ? "Ostatnie fakty: " + story.join("; ") + "." : "Ostatnie dowody:\n" + story.map((s) => "  • " + s).join("\n"));
  }

  const text = parts.join(opts.voice ? " " : "\n");
  // Tor głosowy: bez znaków, które TTS czyta jak śmieci.
  return opts.voice ? text.replace(/[••]/g, "").replace(/\s+/g, " ").trim() : text;
}

/** Ostatnie N faktów misji jako czytelne zdania (bez emoji). */
export function evidenceTail(ledger: EvidenceEntry[], missionId: string, n: number): string[] {
  const kto: Record<MissionStep["node"], string> = { phone: "telefon", exe: "komputer", device: "urządzenie" };
  const verdict: Record<string, string> = {
    CONFIRMED: "potwierdzone odczytem",
    ATTEMPTED: "wysłane, bez potwierdzenia",
    FAILED: "nieudane",
    SIMULATED: "próba generalna",
    DRAFT: "przygotowane",
  };
  return ledger
    .filter((e) => e.missionId === missionId)
    .slice(-n)
    .map((e) => `${kto[e.node]} — ${e.capability}: ${verdict[e.state] || e.state}`);
}
