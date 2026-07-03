// === Węzeł EXE od strony Sztafety Misji ===
// Lokalny Windows EXE jest „zwykłym" węzłem MCP na loopbacku (127.0.0.1:4318) — używamy
// TEGO SAMEGO adaptera co emulator/ESP32 (httpMcpDevice + deviceExecutor + drabina prawdy).
// „Realny lokalny węzeł" oznacza: probe idzie przez uwierzytelniony HTTP-MCP, a CONFIRMED
// pada dopiero po osobnym read_state (windowVisible) — samo ACK z show_window = ATTEMPTED.
// UCZCIWOŚĆ: to jest przetestowane logiką (Vitest) i w Node/CI; uruchomienie na
// ZAINSTALOWANYM EXE użytkownika wymaga świeżego artefaktu Windows i nie jest tu dowiedzione.
import { httpMcpDevice } from "./mcpDevice";
import { deviceExecutor } from "./deviceNode";
import { runMission, initMissionState, type NodeExecutor } from "./missionRelay";
import { missionProgress } from "./missionRelay";
import { evidenceStory } from "./evidenceLedger";
import type { Mission, MissionStep } from "./types";

export const EXE_URL = "http://127.0.0.1:4318/";

/** Zbuduj executor węzła EXE: transport HTTP-MCP z tokenem, allowlista tylko loopback. */
export function exeExecutor(token: string): NodeExecutor {
  const dev = httpMcpDevice({
    url: EXE_URL,
    token,
    allowlist: ["127.0.0.1", "localhost"], // fail-closed: nic poza loopbackiem
    timeoutMs: 4000,
  });
  return deviceExecutor(dev);
}

/**
 * Krok próby EXE: przywołaj okno (show_window) i potwierdź odczytem zwrotnym
 * (windowVisible === true). Bez tokenu / bez odpowiedzi EXE → krok FAILED (Drabina Prawdy),
 * a nie fałszywe „zrobione".
 */
export function exeProbeStep(correlationId: string): MissionStep {
  return {
    id: "exe-probe",
    node: "device",
    capability: "show_window",
    args: {},
    expect: { windowVisible: true },
    correlationId,
  };
}

/**
 * Uruchom próbę realnego lokalnego węzła EXE. Zwraca uczciwy raport po polsku.
 * Bez działającego EXE (brak tokenu albo listener nie stoi) — krok FAILED, raport mówi
 * „NIEPOTWIERDZONY", zamiast udawać sukces.
 */
export async function runExeProbe(token: string | null, now: number, makeId: () => string): Promise<string> {
  if (!token) {
    return "🖥 Węzeł EXE: brak połączenia z lokalnym programem Windows (nie działa listener albo brak tokenu). Status: NIEPOTWIERDZONY — nie udaję, że EXE odpowiedział. Uruchom aplikację desktopową JARVIS i włącz lokalny węzeł.";
  }
  const id = "exe-" + makeId();
  const mission: Mission = {
    id,
    title: "Próba realnego węzła Windows EXE (loopback)",
    steps: [exeProbeStep(id + "-c1")],
    createdAt: now,
  };
  const { state, ledger } = await runMission(initMissionState(mission), [], exeExecutor(token), { now });
  const prog = missionProgress(state);
  const story = evidenceStory(ledger, id).map((l) => "  • " + l).join("\n");

  if (state.status === "done" && prog.confirmed === prog.total) {
    return [
      "🖥 Węzeł EXE: POTWIERDZONY.",
      "Przywołałem okno przez uwierzytelniony HTTP-MCP (127.0.0.1:4318), a osobny odczyt zwrotny potwierdził, że okno jest widoczne — CONFIRMED z dowodu, nie z ACK.",
      "",
      "Łańcuch dowodów:",
      story,
    ].join("\n");
  }
  return [
    "🖥 Węzeł EXE: NIEPOTWIERDZONY.",
    `Program odpowiedział, ale odczyt zwrotny nie potwierdził skutku (stan kroku: ${state.results["exe-probe"]?.outcome.state || "brak"}). Nie ogłaszam sukcesu bez dowodu.`,
    "",
    "Łańcuch dowodów:",
    story,
  ].join("\n");
}
