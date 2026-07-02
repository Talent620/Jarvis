// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { explainMission, evidenceTail } from "../src/lib/horizon/missionWhy";
import { runMission, initMissionState, type NodeExecutor } from "../src/lib/horizon/missionRelay";
import { runTool } from "../src/lib/tools";
import { clearMissionLog } from "../src/lib/horizon/missionLog";
import { resetDemoEmulator } from "../src/lib/horizon/demoMission";
import type { Mission, MissionStep } from "../src/lib/horizon/types";

// Czarna skrzynka misji: „dlaczego?" bez ekranu — wyjaśnienie z FAKTÓW, nie domysłu,
// z wariantem głosowym (bez emoji-śmieci dla TTS).

const NOW = 1_700_000_000_000;
const mission = (steps: MissionStep[], id = "m1"): Mission => ({ id, title: "Test", steps, createdAt: NOW });

beforeEach(() => {
  clearMissionLog();
  resetDemoEmulator();
});

describe("explainMission — wyjaśnia stan z faktów", () => {
  it("domknięta: mówi o potwierdzeniu odczytem zwrotnym", async () => {
    const steps: MissionStep[] = [
      { id: "s1", node: "phone", capability: "przygotuj", correlationId: "c1", expect: { ready: true } },
    ];
    const exec: NodeExecutor = async (s) => ({ actuated: true, readback: s.expect });
    const r = await runMission(initMissionState(mission(steps)), [], exec, { now: NOW });
    const txt = explainMission(r.state, r.ledger);
    expect(txt).toMatch(/1 z 1 kroków potwierdzonych/);
    expect(txt).toMatch(/odczytem zwrotnym/);
  });

  it("wstrzymana po usterce: podaje POWÓD i że nie ponawia sam", async () => {
    const steps: MissionStep[] = [
      { id: "s1", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c1" },
    ];
    const failing: NodeExecutor = async () => ({ actuated: false, actuateError: "usterka transientna urządzenia" });
    const r = await runMission(initMissionState(mission(steps)), [], failing, { now: NOW });
    expect(r.state.status).toBe("paused");
    const txt = explainMission(r.state, r.ledger);
    expect(txt).toMatch(/Wstrzymana/);
    expect(txt).toMatch(/usterka transientna/);
    expect(txt).toMatch(/Nie ponawiam tego sam/);
  });

  it("awaiting_human: tłumaczy twardą granicę i prośbę o potwierdzenie", async () => {
    const steps: MissionStep[] = [
      { id: "s1", node: "exe", capability: "pay_invoice", correlationId: "c1", hardStop: "payment", expect: { paid: true } },
    ];
    const exec: NodeExecutor = async (s) => ({ actuated: true, readback: s.expect });
    const r = await runMission(initMissionState(mission(steps)), [], exec, { now: NOW });
    const txt = explainMission(r.state, r.ledger);
    expect(txt).toMatch(/twarda granica/);
    expect(txt).toMatch(/payment/);
  });

  it("wariant głosowy: bez wypunktowań/emoji, jedno-liniowy", async () => {
    const steps: MissionStep[] = [
      { id: "s1", node: "phone", capability: "przygotuj", correlationId: "c1", expect: { ready: true } },
    ];
    const exec: NodeExecutor = async (s) => ({ actuated: true, readback: s.expect });
    const r = await runMission(initMissionState(mission(steps)), [], exec, { now: NOW });
    const voice = explainMission(r.state, r.ledger, { voice: true });
    expect(voice).not.toContain("•");
    expect(voice).not.toContain("\n");
    expect(voice).toMatch(/Ostatnie fakty:/);
  });
});

describe("evidenceTail — ostatnie fakty czytelnie", () => {
  it("mapuje stany na ludzkie zdania", () => {
    const ledger = [
      { traceId: "t", missionId: "m1", stepId: "s1", correlationId: "c1", node: "device" as const, capability: "set_state", state: "CONFIRMED" as const, at: NOW },
    ];
    const tail = evidenceTail(ledger, "m1", 3);
    expect(tail[0]).toMatch(/urządzenie — set_state: potwierdzone odczytem/);
  });
});

describe("narzędzie mission_why — przez runTool (bramka zgód, read)", () => {
  it("pusty dziennik → uczciwy komunikat; po pokazie → wyjaśnia domkniętą misję", async () => {
    const empty = await runTool("mission_why", {});
    expect(empty).toMatch(/Nie ma jeszcze żadnej misji/);

    await runTool("mission_demo", {});
    const why = await runTool("mission_why", {});
    expect(why).toMatch(/Pokaz Sztafety/);
    expect(why).toMatch(/potwierdzonych/);
    expect(why).toMatch(/odczyt/i);
  });
});
