// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { runTool, toolDefs } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";
import { clearMissionLog } from "../src/lib/horizon/missionLog";
import { resetDemoEmulator, demoEmulator } from "../src/lib/horizon/demoMission";

// Sztafeta widoczna w produkcie: pokaz i status przez PRAWDZIWE narzędzia czatu/głosu
// (runTool = bramka zgód + audyt), na prawdziwych silnikach — bez atrap.

beforeEach(() => {
  clearMissionLog();
  resetDemoEmulator();
});

describe("mission_demo / mission_status — narzędzia czatu/głosu", () => {
  it("oba narzędzia są zarejestrowane i sklasyfikowane (status=read, demo=write, nic outbound)", () => {
    expect(toolDefs.some((d) => d.name === "mission_demo")).toBe(true);
    expect(toolDefs.some((d) => d.name === "mission_status")).toBe(true);
    expect(riskOf("mission_status")).toBe("read");
    expect(riskOf("mission_demo")).toBe("write"); // lokalny dziennik + emulator w pamięci
  });

  it("mission_demo: awaria → pauza → wznowienie bez dubli; CONFIRMED z odczytu zwrotnego", async () => {
    const out = await runTool("mission_demo", {});
    // Uczciwość: jawna symulacja sprzętu.
    expect(out).toMatch(/EMULATOR/i);
    expect(out).toMatch(/symulacja sprzętu/i);
    // Dwa akty: pauza po usterce i domknięcie bez powtórzeń.
    expect(out).toMatch(/PAUZOWAŁA/);
    expect(out).toMatch(/3\/3/);
    expect(out).toMatch(/NIE powtórzyły się/);
    // Dowód fizycznego skutku w treści (odczyt zwrotny) + łańcuch dowodów.
    expect(out).toMatch(/led=on/);
    expect(out).toMatch(/alarm=armed/);
    expect(out).toMatch(/urządzenie · set_state · CONFIRMED/);
    // Realny stan emulatora zgadza się z raportem (nie sam tekst).
    expect(demoEmulator().snapshot()).toEqual({ led: "on", alarm: "armed" });
  });

  it("mission_status: pusty dziennik mówi prawdę; po pokazie pokazuje misję z dowodami", async () => {
    const empty = await runTool("mission_status", {});
    expect(empty).toMatch(/Brak misji/);

    await runTool("mission_demo", {});
    const status = await runTool("mission_status", {});
    expect(status).toMatch(/Pokaz Sztafety/);
    expect(status).toMatch(/✅ domknięta/);
    expect(status).toMatch(/3\/3 kroków potwierdzonych/);
    expect(status).toMatch(/odczyty zwrotne/);
    expect(status).toMatch(/emulator/i);
  });

  it("drugi pokaz to NOWA misja — dziennik trzyma obie, bez mieszania dowodów", async () => {
    await runTool("mission_demo", {});
    await runTool("mission_demo", {});
    const status = await runTool("mission_status", {});
    // Dwie misje w statusie (obie domknięte).
    const doneCount = (status.match(/✅ domknięta/g) || []).length;
    expect(doneCount).toBe(2);
  });
});
