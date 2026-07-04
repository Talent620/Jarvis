// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { DeviceEmulator } from "../src/lib/horizon/deviceEmulator";
import { deviceExecutor } from "../src/lib/horizon/deviceNode";
import { undoLastStep, lastUndoableStep } from "../src/lib/horizon/missionUndo";
import { runMission, initMissionState, type NodeExecutor } from "../src/lib/horizon/missionRelay";
import { evidenceForMission } from "../src/lib/horizon/evidenceLedger";
import { runTool } from "../src/lib/tools";
import { clearMissionLog } from "../src/lib/horizon/missionLog";
import { resetDemoEmulator, demoEmulator } from "../src/lib/horizon/demoMission";
import type { Mission, MissionStep } from "../src/lib/horizon/types";

// „Cofnij" w świecie fizycznym: operacja odwrotna + potwierdzenie odczytem zwrotnym,
// NIGDY kasowanie dowodu (cofnięcie = nowy fakt). Twarde granice = nieodwracalne.

const NOW = 1_700_000_000_000;
const mission = (steps: MissionStep[], id = "m1"): Mission => ({ id, title: "Test", steps, createdAt: NOW });

beforeEach(() => {
  clearMissionLog();
  resetDemoEmulator();
});

describe("undoLastStep — operacja odwrotna z odczytem zwrotnym", () => {
  it("cofa ostatni krok urządzenia: przywraca stan sprzed i potwierdza; dowód dopisany, nie skasowany", async () => {
    const dev = new DeviceEmulator({ name: "esp32", initial: { led: "off" } });
    const exec = deviceExecutor(dev);
    const steps: MissionStep[] = [
      { id: "s1", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c1" },
    ];
    const r = await runMission(initMissionState(mission(steps)), [], exec, { now: NOW });
    expect(dev.snapshot().led).toBe("on");
    const kwityPrzed = evidenceForMission(r.ledger, "m1").length;

    const undo = await undoLastStep(r.state, r.ledger, exec, NOW + 1);
    expect(undo.ok).toBe(true);
    expect(dev.snapshot().led).toBe("off"); // faktyczny stan cofnięty (dowód, nie deklaracja)
    // Dowód cofnięcia DOPISANY (nic nie skasowano).
    const kwity = evidenceForMission(undo.ledger, "m1");
    expect(kwity.length).toBe(kwityPrzed + 1);
    expect(kwity[kwity.length - 1].capability).toBe("undo:set_state");
    expect(kwity[kwity.length - 1].state).toBe("CONFIRMED");
    expect(undo.message).toMatch(/Cofnięto/);
    expect(undo.message).toMatch(/nic nie skasowałem/);
  });

  it("cofnięcie bez potwierdzenia odczytem → NIE ogłasza cofnięcia (brak dowodu skutku)", async () => {
    // Urządzenie, które ACK-uje set_state, ale read_state kłamie że nic się nie zmieniło.
    const stubborn = {
      async call(name: string) {
        if (name === "read_state") return { content: [{ type: "text" as const, text: JSON.stringify({ led: "on" }) }] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ ack: true }) }] };
      },
    };
    // Najpierw prawdziwie zapal led prawdziwym emulatorem, potem podmień exec na uparte urządzenie.
    const dev = new DeviceEmulator({ initial: { led: "off" } });
    const realExec = deviceExecutor(dev);
    const steps: MissionStep[] = [
      { id: "s1", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c1" },
    ];
    const r = await runMission(initMissionState(mission(steps)), [], realExec, { now: NOW });
    const stubbornExec = deviceExecutor(stubborn);
    const undo = await undoLastStep(r.state, r.ledger, stubbornExec, NOW + 1);
    expect(undo.ok).toBe(false);
    expect(undo.message).toMatch(/nie potwierdziła się odczytem/);
  });

  it("nie ma czego cofnąć / twarda granica jest nieodwracalna", async () => {
    // Krok płatności (hardStop) zatwierdzony przez człowieka — mimo CONFIRMED NIE jest cofalny.
    const exec: NodeExecutor = async (s) => ({ actuated: true, readback: s.expect, priorReadback: { paid: false } });
    const steps: MissionStep[] = [
      { id: "s1", node: "exe", capability: "pay_invoice", correlationId: "c1", hardStop: "payment", expect: { paid: true } },
    ];
    const r1 = await runMission(initMissionState(mission(steps)), [], exec, { now: NOW });
    const r2 = await runMission(r1.state, r1.ledger, exec, { now: NOW + 1, approvedStops: new Set(["s1"]) });
    expect(r2.state.results.s1.outcome.state).toBe("CONFIRMED");
    expect(lastUndoableStep(r2.state)).toBeNull(); // płatność nieodwracalna

    const undo = await undoLastStep(r2.state, r2.ledger, exec, NOW + 2);
    expect(undo.ok).toBe(false);
    expect(undo.message).toMatch(/nieodwracalne/);
  });
});

describe("narzędzie mission_undo — przez runTool", () => {
  it("po pokazie cofa ostatni krok urządzenia (alarm→off), realny stan emulatora się zmienia", async () => {
    await runTool("mission_demo", {}); // kończy z led=on, alarm=armed
    expect(demoEmulator().snapshot()).toEqual({ led: "on", alarm: "armed" });

    const out = await runTool("mission_undo", {});
    expect(out).toMatch(/Cofnięto/);
    // Ostatni krok pokazu to alarm=armed (prior: off) → po cofnięciu alarm=off.
    expect(demoEmulator().snapshot().alarm).toBe("off");
  });

  it("pusty dziennik → uczciwy komunikat, nic nie cofa", async () => {
    const out = await runTool("mission_undo", {});
    expect(out).toMatch(/Nie ma żadnej misji do cofnięcia/);
  });
});
