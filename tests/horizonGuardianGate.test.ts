import { describe, it, expect } from "vitest";
import { runMission, initMissionState, type NodeExecutor } from "../src/lib/horizon/missionRelay";
import type { Mission, MissionStep } from "../src/lib/horizon/types";

// Strażnik ↔ sztafeta: martwy węzeł wstrzymuje misję PRZED próbą wykonania kroku
// (żadnego strzelania w próżnię, żadnych cichych ponowień). Zdrowy węzeł przepuszcza.

const NOW = 1_700_000_000_000;
const mission = (steps: MissionStep[], id = "m1"): Mission => ({ id, title: "Test", steps, createdAt: NOW });

const twoSteps: MissionStep[] = [
  { id: "s1", node: "phone", capability: "prepare", correlationId: "c1", expect: { ready: true } },
  { id: "s2", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c2" },
];

describe("nodeIsDead — Strażnik wstrzymuje sztafetę na martwym węźle", () => {
  it("martwe urządzenie → misja PAUZUJE przed krokiem urządzenia; executor nie jest wołany dla niego", async () => {
    const calls: string[] = [];
    const exec: NodeExecutor = async (step) => {
      calls.push(step.node);
      return { actuated: true, readback: step.expect };
    };
    const r = await runMission(initMissionState(mission(twoSteps)), [], exec, {
      now: NOW,
      nodeIsDead: (n) => n === "device", // urządzenie martwe
    });
    expect(r.state.results.s1?.outcome.state).toBe("CONFIRMED"); // telefon przeszedł
    expect(r.state.results.s2).toBeUndefined();                  // krok urządzenia NIE wykonany
    expect(r.state.status).toBe("paused");
    expect(calls).toEqual(["phone"]);                            // executor nie strzelił w martwe urządzenie
  });

  it("wszystkie węzły zdrowe → misja domyka się normalnie", async () => {
    const exec: NodeExecutor = async (step) => ({ actuated: true, readback: step.expect });
    const r = await runMission(initMissionState(mission(twoSteps)), [], exec, {
      now: NOW,
      nodeIsDead: () => false,
    });
    expect(r.state.status).toBe("done");
    expect(r.state.results.s2?.outcome.state).toBe("CONFIRMED");
  });

  it("rehearsal: martwy węzeł NIE blokuje próby generalnej (nic nie wychodzi na zewnątrz)", async () => {
    const exec: NodeExecutor = async (step) => ({ actuated: true, readback: step.expect });
    const r = await runMission(initMissionState(mission(twoSteps)), [], exec, {
      now: NOW,
      rehearsal: true,
      nodeIsDead: () => true,
    });
    // W rehearsal kroki dają SIMULATED (nie CONFIRMED), ale gate Strażnika nie przerywa.
    expect(r.state.results.s1?.outcome.state).toBe("SIMULATED");
    expect(r.state.results.s2?.outcome.state).toBe("SIMULATED");
  });

  it("bez predykatu nodeIsDead zachowanie jest jak dotąd (brak regresji)", async () => {
    const exec: NodeExecutor = async (step) => ({ actuated: true, readback: step.expect });
    const r = await runMission(initMissionState(mission(twoSteps)), [], exec, { now: NOW });
    expect(r.state.status).toBe("done");
  });
});
