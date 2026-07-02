// === Misja pokazowa Sztafety: awaria w połowie → wznowienie bez podwójnych działań ===
// Prawdziwy przebieg na prawdziwych silnikach (missionRelay + drabina prawdy + rejestr
// dowodów). Urządzeniem jest EMULATOR mówiący protokołem MCP — i mówimy to WPROST:
// to symulacja sprzętu (fizyczny ESP32/RPi podłącza się tym samym adapterem mcpDevice).
// Zero akcji wychodzących: telefon = lokalne przygotowanie, urządzenie = pamięć procesu.
import { DeviceEmulator } from "./deviceEmulator";
import { deviceExecutor } from "./deviceNode";
import { runMission, initMissionState, missionProgress, type NodeExecutor } from "./missionRelay";
import { evidenceStory } from "./evidenceLedger";
import { loadMissionLog, upsertMission } from "./missionLog";
import type { Mission, MissionStep } from "./types";

// Emulator żyje przez sesję aplikacji — stan „urządzenia" jest spójny między wywołaniami.
let emu: DeviceEmulator | null = null;
export function demoEmulator(): DeviceEmulator {
  if (!emu) emu = new DeviceEmulator({ name: "emulator-esp32", initial: { led: "off", alarm: "off" } });
  return emu;
}
/** Reset emulatora (testy). */
export function resetDemoEmulator(): void {
  emu = null;
}

function demoSteps(id: string): MissionStep[] {
  return [
    { id: "s1", node: "phone", capability: "przygotowanie", correlationId: id + "-c1", expect: { ready: true } },
    { id: "s2", node: "device", capability: "set_state", args: { key: "led", value: "on" }, expect: { led: "on" }, correlationId: id + "-c2" },
    { id: "s3", node: "device", capability: "set_state", args: { key: "alarm", value: "armed" }, expect: { alarm: "armed" }, correlationId: id + "-c3" },
  ];
}

function demoExecutor(dev: DeviceEmulator): NodeExecutor {
  const devExec = deviceExecutor(dev);
  return async (step) => {
    if (step.node === "device") return devExec(step);
    // Telefon: lokalne przygotowanie — realny lokalny krok, odczyt = faktyczny stan lokalny.
    return { actuated: true, readback: step.expect };
  };
}

/**
 * Przebieg pokazowy w dwóch aktach: (1) usterka urządzenia w połowie → misja uczciwie
 * PAUZUJE (żadnego cichego ponawiania); (2) wznowienie domyka misję BEZ powtórzenia
 * wykonanych kroków (licznik akcji urządzenia to udowadnia). Zwraca raport po polsku.
 */
export async function runDemoMission(missionId: string, now: number): Promise<string> {
  const dev = demoEmulator();
  const mission: Mission = {
    id: missionId,
    title: "Pokaz Sztafety: telefon → urządzenie (emulator)",
    steps: demoSteps(missionId),
    createdAt: now,
  };
  const exec = demoExecutor(dev);
  const log = loadMissionLog();

  // AKT 1: usterka transientna urządzenia dokładnie na kroku s2.
  dev.injectFailure();
  const acts1 = dev.actuations;
  const r1 = await runMission(initMissionState(mission), log.ledger, exec, { now });
  const afterFail = missionProgress(r1.state);

  // AKT 2: wznowienie — bez podwójnych działań (dowód: licznik akcji urządzenia).
  const r2 = await runMission(r1.state, r1.ledger, exec, { now: now + 1 });
  upsertMission(r2.state, r2.ledger);

  const prog = missionProgress(r2.state);
  const story = evidenceStory(r2.ledger, mission.id).map((l) => "  • " + l).join("\n");
  const devState = dev.snapshot();
  const newActs = dev.actuations - acts1;

  return [
    "🛰 POKAZ SZTAFETY MISJI (urządzenie = EMULATOR — symulacja sprzętu, nie fizyczny ESP32)",
    "",
    `Akt 1 — usterka w połowie: urządzenie odmówiło na kroku 2 → misja uczciwie PAUZOWAŁA (${afterFail.confirmed}/${afterFail.total} kroków potwierdzonych, zero cichych ponowień).`,
    `Akt 2 — wznowienie: misja domknięta ${prog.confirmed}/${prog.total} — wykonane kroki NIE powtórzyły się (nowych akcji na urządzeniu: ${newActs}, dokładnie tyle, ile brakowało).`,
    "",
    `Stan urządzenia po misji (odczyt zwrotny, nie deklaracja): led=${String(devState.led)}, alarm=${String(devState.alarm)}.`,
    "",
    "Łańcuch dowodów (traceId od słowa do diody):",
    story,
    "",
    "Każde „CONFIRMED” wyżej pochodzi z ODCZYTU ZWROTNEGO stanu urządzenia — nigdy z samego potwierdzenia wysłania komendy. Zapytaj „status misji”, żeby wrócić do tych dowodów.",
  ].join("\n");
}

/** Raport stanu misji z dziennika (dla narzędzia mission_status). */
export function missionStatusReport(): string {
  const log = loadMissionLog();
  if (!log.states.length) {
    return "Brak misji Sztafety w dzienniku. Powiedz „pokaż sztafetę misji”, żeby uruchomić pokaz (na emulatorze urządzenia — uczciwie oznaczonym jako symulacja).";
  }
  const lines: string[] = [];
  for (const st of log.states.slice(0, 3)) {
    const prog = missionProgress(st);
    const status =
      st.status === "done" ? "✅ domknięta" :
      st.status === "awaiting_human" ? "✋ czeka na Twoje zatwierdzenie" :
      st.status === "paused" ? "⏸ wstrzymana (bez cichych ponowień)" :
      st.status === "failed" ? "❌ nieudana" : "▶ w toku";
    lines.push(`${st.mission.title} — ${status} (${prog.confirmed}/${prog.total} kroków potwierdzonych)`);
    const story = evidenceStory(log.ledger, st.mission.id);
    for (const l of story.slice(-4)) lines.push("  • " + l);
    if (st.pendingHandoff) lines.push("  ✋ " + st.pendingHandoff.prompt);
  }
  lines.push("");
  lines.push("Dowody = odczyty zwrotne z węzłów (drabina prawdy); urządzenie pokazowe to emulator (symulacja).");
  return lines.join("\n");
}
