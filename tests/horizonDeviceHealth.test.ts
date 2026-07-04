// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordHeartbeat,
  nodeHealth,
  fleetReport,
  anyDead,
  fleetStory,
  DEFAULT_THRESHOLDS,
  type HeartbeatState,
} from "../src/lib/horizon/deviceHealth";
import { runTool } from "../src/lib/tools";
import { clearMissionLog } from "../src/lib/horizon/missionLog";
import { resetDemoEmulator } from "../src/lib/horizon/demoMission";
import { resetHeartbeats } from "../src/lib/horizon/deviceHealthStore";

// Strażnik węzłów: klasyfikacja zdrowia z czasu od heartbeatu; wykrycie martwego
// węzła NIE wywołuje akcji — tylko raportuje (zasada bezpieczeństwa).

const NOW = 1_700_000_000_000;
const empty = (): HeartbeatState => ({ lastSeen: {} });

describe("nodeHealth — klasyfikacja z czasu od sygnału", () => {
  it("nigdy nie widziany → unknown", () => {
    expect(nodeHealth(empty(), "exe", NOW)).toBe("unknown");
  });
  it("świeży → healthy; starszy niż warn → delayed; > dead → dead", () => {
    const s = recordHeartbeat(empty(), "exe", NOW);
    expect(nodeHealth(s, "exe", NOW + 1000)).toBe("healthy");
    expect(nodeHealth(s, "exe", NOW + DEFAULT_THRESHOLDS.warnMs + 1)).toBe("delayed");
    expect(nodeHealth(s, "exe", NOW + DEFAULT_THRESHOLDS.deadMs + 1)).toBe("dead");
  });
  it("recordHeartbeat jest niemutujący (nowy obiekt)", () => {
    const s0 = empty();
    const s1 = recordHeartbeat(s0, "phone", NOW);
    expect(s0.lastSeen.phone).toBeUndefined();
    expect(s1.lastSeen.phone).toBe(NOW);
  });
});

describe("fleetReport / anyDead / fleetStory", () => {
  it("stała kolejność telefon→exe→device; wiek w ms albo null", () => {
    const s = recordHeartbeat(empty(), "device", NOW);
    const rep = fleetReport(s, NOW + 5000);
    expect(rep.map((r) => r.node)).toEqual(["phone", "exe", "device"]);
    expect(rep.find((r) => r.node === "phone")!.ageMs).toBeNull();
    expect(rep.find((r) => r.node === "device")!.ageMs).toBe(5000);
  });
  it("anyDead: true tylko gdy któryś przekroczył deadMs", () => {
    const s = recordHeartbeat(empty(), "exe", NOW);
    expect(anyDead(s, NOW + 1000)).toBe(false);
    expect(anyDead(s, NOW + DEFAULT_THRESHOLDS.deadMs + 1)).toBe(true);
  });
  it("fleetStory przy martwym węźle mówi WPROST o wstrzymaniu i braku ponowień", () => {
    const s = recordHeartbeat(empty(), "device", NOW);
    const story = fleetStory(s, NOW + DEFAULT_THRESHOLDS.deadMs + 1);
    expect(story).toMatch(/MARTWY/);
    expect(story).toMatch(/wstrzymać/);
    expect(story).toMatch(/nie ponawiam sam/);
  });
  it("fleetStory zdrowej floty NIE straszy", () => {
    const s = recordHeartbeat(recordHeartbeat(empty(), "phone", NOW), "device", NOW);
    const story = fleetStory(s, NOW + 1000);
    expect(story).toMatch(/w porządku/);
    expect(story).not.toMatch(/MARTWY/);
  });
});

describe("integracja: pokaz misji bije heartbeaty; mission_devices je widzi", () => {
  beforeEach(() => {
    clearMissionLog();
    resetDemoEmulator();
    resetHeartbeats();
  });

  it("przed pokazem flota nieznana; po pokazie telefon i urządzenie żyją", async () => {
    const before = await runTool("mission_devices", {});
    expect(before).toMatch(/nieznany/); // żaden węzeł nie bił jeszcze sygnału

    await runTool("mission_demo", {}); // CONFIRMED na telefonie i urządzeniu → heartbeaty
    const after = await runTool("mission_devices", {});
    expect(after).toMatch(/telefon: ✅ zdrowy/);
    expect(after).toMatch(/urządzenie: ✅ zdrowy/);
    expect(after).toMatch(/w porządku/);
  });
});
