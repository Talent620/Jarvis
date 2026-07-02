import { describe, it, expect } from "vitest";
import { DeviceEmulator } from "../src/lib/horizon/deviceEmulator";
import { deviceExecutor } from "../src/lib/horizon/deviceNode";
import {
  runMission,
  initMissionState,
  missionProgress,
  type NodeExecutor,
} from "../src/lib/horizon/missionRelay";
import {
  appendEvidence,
  evidenceForMission,
  evidenceStory,
  isCorrelationConfirmed,
} from "../src/lib/horizon/evidenceLedger";
import { climbLadder, readbackMatches } from "../src/lib/horizon/truthLadder";
import { makeHandoff, isHardStop } from "../src/lib/horizon/handoff";
import type { EvidenceEntry, Mission, MissionStep } from "../src/lib/horizon/types";

const NOW = 1_700_000_000_000;

function mission(steps: MissionStep[]): Mission {
  return { id: "m1", title: "Misja testowa", steps, createdAt: NOW };
}

// Sztafeta: telefon (przygotuj) → EXE (przygotuj) → urządzenie (zapal diodę, read-back).
function relaySteps(): MissionStep[] {
  return [
    { id: "s1", node: "phone", capability: "prepare", correlationId: "c1", expect: { ready: true } },
    { id: "s2", node: "exe", capability: "prepare", correlationId: "c2", expect: { ready: true } },
    { id: "s3", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c3" },
  ];
}

/** Executor mieszany: phone/exe potwierdzają lokalnie, device idzie przez emulator MCP. */
function mixedExecutor(dev: DeviceEmulator): NodeExecutor {
  const devExec = deviceExecutor(dev);
  return async (step) => {
    if (step.node === "device") return devExec(step);
    // phone/exe: lokalne przygotowanie — read-back = to, czego oczekiwano (realny lokalny stan).
    return { actuated: true, readback: step.expect };
  };
}

describe("Drabina Prawdy — CONFIRMED tylko przez odczyt zwrotny", () => {
  it("readbackMatches: zgodny odczyt → true; rozjazd/brak → false", () => {
    expect(readbackMatches({ led: "on" }, { led: "on" })).toBe(true);
    expect(readbackMatches({ led: "on" }, { led: "off" })).toBe(false);
    expect(readbackMatches({ led: "on" }, undefined)).toBe(false);
    expect(readbackMatches(undefined, { led: "on" })).toBe(false); // brak oczekiwań = nie ma czego potwierdzić
  });

  it("akcja OK + zgodny read-back → CONFIRMED", () => {
    const o = climbLadder({ actuated: true, expect: { led: "on" }, readback: { led: "on" }, now: NOW });
    expect(o.state).toBe("CONFIRMED");
    expect(o.evidence?.confirmedAt).toBe(NOW);
  });

  it("akcja OK, ale read-back się nie zgadza → ATTEMPTED (nigdy CONFIRMED)", () => {
    const o = climbLadder({ actuated: true, expect: { led: "on" }, readback: { led: "off" }, now: NOW });
    expect(o.state).toBe("ATTEMPTED");
  });

  it("akcja OK, brak read-backu (brak expect) → ATTEMPTED, nie CONFIRMED", () => {
    const o = climbLadder({ actuated: true, now: NOW });
    expect(o.state).toBe("ATTEMPTED");
  });

  it("błąd akcji → FAILED; próba generalna → SIMULATED", () => {
    expect(climbLadder({ actuated: false, actuateError: "offline", now: NOW }).state).toBe("FAILED");
    expect(climbLadder({ actuated: true, rehearsal: true, expect: { led: "on" }, readback: { led: "on" }, now: NOW }).state).toBe("SIMULATED");
  });
});

describe("Sztafeta Misji — telefon → EXE → urządzenie", () => {
  it("pełny przebieg domyka misję: 3/3 CONFIRMED, dioda faktycznie zapalona", async () => {
    const dev = new DeviceEmulator({ name: "esp32", initial: { led: "off" } });
    const st0 = initMissionState(mission(relaySteps()));
    const { state, ledger } = await runMission(st0, [], mixedExecutor(dev), { now: NOW });

    expect(state.status).toBe("done");
    expect(missionProgress(state)).toEqual({ confirmed: 3, total: 3 });
    // Dowód FIZYCZNEGO skutku (odczyt z urządzenia), nie deklaracja:
    expect(dev.snapshot().led).toBe("on");
    // Rejestr dowodów: kwit za każdy krok, jeden traceId od słowa do diody.
    const story = evidenceForMission(ledger, "m1");
    expect(story).toHaveLength(3);
    expect(story.every((e) => e.traceId === "trace:m1")).toBe(true);
    expect(story[2].state).toBe("CONFIRMED");
  });

  it("urządzenie NIE zmienia stanu (ACK bez skutku) → krok ATTEMPTED, misja PAUZUJE", async () => {
    // Emulator, który potwierdza ACK, ale nie zmienia rejestru (symulacja zepsutego aktuatora):
    const brokenDev = {
      async call(name: string) {
        if (name === "read_state") return { content: [{ type: "text" as const, text: JSON.stringify({ led: "off" }) }] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ ack: true }) }] }; // ACK, ale led zostaje off
      },
    };
    const steps: MissionStep[] = [
      { id: "s1", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c1" },
    ];
    const { state } = await runMission(initMissionState(mission(steps)), [], deviceExecutor(brokenDev), { now: NOW });
    expect(state.results.s1.outcome.state).toBe("ATTEMPTED");
    expect(state.status).toBe("paused"); // brak dowodu skutku → nie udajemy sukcesu
  });
});

describe("Idempotencja i bezpieczne wznowienie (wyślij-raz)", () => {
  it("ponowny bieg NIE wykonuje ponownie potwierdzonych kroków (zero podwójnych akcji)", async () => {
    const dev = new DeviceEmulator({ name: "esp32", initial: { led: "off" } });
    const exec = mixedExecutor(dev);
    const st0 = initMissionState(mission(relaySteps()));

    const r1 = await runMission(st0, [], exec, { now: NOW });
    expect(r1.state.status).toBe("done");
    const actuationsAfterFirst = dev.actuations;

    // Drugi przebieg na tym samym stanie i rejestrze — nic nie powinno ruszyć urządzenia.
    const r2 = await runMission(r1.state, r1.ledger, exec, { now: NOW + 1000 });
    expect(r2.state.status).toBe("done");
    expect(dev.actuations).toBe(actuationsAfterFirst); // wyślij-raz: brak drugiej akcji
    expect(evidenceForMission(r2.ledger, "m1")).toHaveLength(3); // brak duplikatów kwitów
  });

  it("wznowienie po restarcie (świeży stan, zachowany rejestr) pomija już potwierdzone correlationId", async () => {
    const dev = new DeviceEmulator({ name: "esp32", initial: { led: "off" } });
    const exec = mixedExecutor(dev);
    const r1 = await runMission(initMissionState(mission(relaySteps())), [], exec, { now: NOW });
    const savedLedger = r1.ledger;
    expect(isCorrelationConfirmed(savedLedger, "c3")).toBe(true);

    // „Restart": stan pamięci znika, ale rejestr dowodów przetrwał (trwałość).
    const fresh = initMissionState(mission(relaySteps()));
    const actBefore = dev.actuations;
    const r2 = await runMission(fresh, savedLedger, exec, { now: NOW + 5000 });
    expect(r2.state.status).toBe("done");
    expect(dev.actuations).toBe(actBefore); // nic nie wykonano ponownie
  });
});

describe("Test wyrwanej wtyczki — ciągłość po awarii bez restartu i bez podwójnych działań", () => {
  it("urządzenie pada w połowie → misja PAUZUJE; po powrocie wznawia i domyka bez dubli", async () => {
    const dev = new DeviceEmulator({ name: "esp32", initial: { led: "off", fan: "off" } });
    const exec = mixedExecutor(dev);
    const steps: MissionStep[] = [
      { id: "s1", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: "c1" },
      { id: "s2", node: "device", capability: "set_state", args: { key: "fan", value: "on" }, expect: { fan: "on" }, correlationId: "c2" },
    ];

    // „Wyrwana wtyczka" DOKŁADNIE między krokiem 1 a 2, w jednym przebiegu: executor
    // wykonuje s1 normalnie, a tuż przed s2 przełącza urządzenie w offline.
    const pullPlugExec: NodeExecutor = async (step) => {
      if (step.id === "s2" && dev.online) dev.setOnline(false); // wtyczka wypada przed s2
      return exec(step);
    };
    const r1 = await runMission(initMissionState(mission(steps)), [], pullPlugExec, { now: NOW });
    expect(r1.state.results.s1.outcome.state).toBe("CONFIRMED"); // krok 1 zdążył
    expect(r1.state.results.s2.outcome.state).toBe("FAILED"); // krok 2 padł na offline
    expect(r1.state.status).toBe("paused"); // outbound NIE ponawiany automatycznie
    const ledAfterFail = dev.actuations;

    // Wtyczka wraca — wznów. s1 pominięty (wyślij-raz), s2 domknięty. Zero podwójnej akcji na s1.
    dev.setOnline(true);
    const r2 = await runMission(r1.state, r1.ledger, exec, { now: NOW + 2000 });
    expect(r2.state.status).toBe("done");
    expect(dev.snapshot()).toEqual({ led: "on", fan: "on" });
    // s1 nie był wykonany ponownie mimo wznowienia — doszło tylko s2:
    expect(dev.actuations).toBe(ledAfterFail + 1);
  });
});

describe("Karta Przekazania — twarda granica STOP zamiast cichego wykonania", () => {
  it("krok płatności NIE wykonuje się autonomicznie → status awaiting_human + Karta", async () => {
    const dev = new DeviceEmulator();
    const steps: MissionStep[] = [
      { id: "s1", node: "phone", capability: "prepare", correlationId: "c1", expect: { ready: true } },
      { id: "s2", node: "exe", capability: "pay_invoice", correlationId: "c2", hardStop: "payment", expect: { paid: true } },
    ];
    const { state } = await runMission(initMissionState(mission(steps)), [], mixedExecutor(dev), { now: NOW });
    expect(state.status).toBe("awaiting_human");
    expect(state.pendingHandoff?.kind).toBe("payment");
    expect(state.pendingHandoff?.stepId).toBe("s2");
    expect(state.pendingHandoff?.prompt).toMatch(/Płatność/);
    expect(state.results.s2).toBeUndefined(); // krok STOP NIE został wykonany
  });

  it("po zatwierdzeniu przez człowieka (approvedStops) krok STOP się wykonuje", async () => {
    const dev = new DeviceEmulator();
    const steps: MissionStep[] = [
      { id: "s1", node: "exe", capability: "pay_invoice", correlationId: "c1", hardStop: "payment", expect: { paid: true } },
    ];
    const exec: NodeExecutor = async (step) => ({ actuated: true, readback: step.expect });
    const st0 = initMissionState(mission(steps));
    const r1 = await runMission(st0, [], exec, { now: NOW });
    expect(r1.state.status).toBe("awaiting_human");

    const r2 = await runMission(r1.state, r1.ledger, exec, { now: NOW + 1, approvedStops: new Set(["s1"]) });
    expect(r2.state.status).toBe("done");
    expect(r2.state.results.s1.outcome.state).toBe("CONFIRMED");
  });

  it("makeHandoff/isHardStop: karta ma przyjazny opis i właściwy węzeł", () => {
    const step: MissionStep = { id: "x", node: "exe", capability: "publish_post", correlationId: "c", hardStop: "publish" };
    expect(isHardStop(step)).toBe(true);
    const card = makeHandoff(mission([step]), step, NOW);
    expect(card.fromNode).toBe("exe");
    expect(card.kind).toBe("publish");
    expect(card.prompt).toMatch(/komputerze/);
    expect(card.prompt).toMatch(/Publikacja/);
  });
});

describe("Rejestr Dowodów — jeden kwit na fakt, łańcuch traceId, idempotencja", () => {
  it("appendEvidence nie dubluje tego samego faktu, ale dopisuje zmianę stanu", () => {
    const m = mission(relaySteps());
    let led: EvidenceEntry[] = [];
    const attempted = { stepId: "s3", node: "device" as const, outcome: { state: "ATTEMPTED" as const, evidence: {} }, readback: { led: "off" } };
    led = appendEvidence(led, m, attempted, "c3", "set_state", NOW);
    const same = appendEvidence(led, m, attempted, "c3", "set_state", NOW);
    expect(same).toBe(led); // ten sam fakt → ta sama referencja (idempotencja)

    const confirmedR = { stepId: "s3", node: "device" as const, outcome: { state: "CONFIRMED" as const, evidence: {} }, readback: { led: "on" } };
    const grown = appendEvidence(led, m, confirmedR, "c3", "set_state", NOW + 1);
    expect(grown).not.toBe(led); // zmiana stanu = nowy, prawdziwy fakt w łańcuchu
    expect(grown).toHaveLength(2);
  });

  it("evidenceStory czyta łańcuch po ludzku (do odtworzenia głosem po katastrofie)", async () => {
    const dev = new DeviceEmulator({ initial: { led: "off" } });
    const { ledger } = await runMission(initMissionState(mission(relaySteps())), [], mixedExecutor(dev), { now: NOW });
    const story = evidenceStory(ledger, "m1");
    expect(story).toHaveLength(3);
    expect(story[0]).toMatch(/telefon/);
    expect(story[1]).toMatch(/komputer/);
    expect(story[2]).toMatch(/urządzenie · set_state · CONFIRMED/);
  });
});

describe("Próba generalna (rehearsal) — nic nie wychodzi na zewnątrz", () => {
  it("rehearsal daje SIMULATED i NIE rusza urządzenia", async () => {
    const dev = new DeviceEmulator({ initial: { led: "off" } });
    const { state } = await runMission(initMissionState(mission(relaySteps())), [], mixedExecutor(dev), { now: NOW, rehearsal: true });
    expect(dev.actuations).toBe(0); // zero akcji fizycznych
    expect(dev.snapshot().led).toBe("off");
    expect(state.results.s3.outcome.state).toBe("SIMULATED");
  });
});
