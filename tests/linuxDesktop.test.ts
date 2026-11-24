import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  linuxPower,
  linuxVolume,
  linuxMedia,
  detectLinuxGpu,
  readLinuxDistro,
  linuxDiagnostics,
  clampWindowBounds,
} = require("../electron/linux-system.cjs");

type FakeResult = { ok: boolean; code: number | string; stdout: string; stderr: string };

function makeRunner(map: Record<string, FakeResult>) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<FakeResult> => {
    const key = `${cmd} ${args.join(" ")}`.trim();
    calls.push(key);
    if (map[key]) return map[key];
    if (map[cmd]) return map[cmd];
    return { ok: false, code: "ENOENT", stdout: "", stderr: "not found" };
  };
  return { run, calls };
}

describe("Linux desktop system control (electron/linux-system.cjs)", () => {
  it("linuxPower używa łańcucha fallback bez powłoki i odrzuca nieznane akcje", async () => {
    const { run, calls } = makeRunner({
      "xdg-screensaver lock": { ok: true, code: 0, stdout: "", stderr: "" },
      "systemctl suspend": { ok: true, code: 0, stdout: "", stderr: "" },
    });
    expect(await linuxPower("lock", { run })).toBe("ok");
    expect(calls).toEqual(["loginctl lock-session", "xdg-screensaver lock"]);
    expect(await linuxPower("sleep", { run })).toBe("ok");
    expect(await linuxPower("rm -rf /", { run })).toBe("err:unknown");
  });

  it("linuxVolume wspiera PipeWire (wpctl), spada do PulseAudio (pactl) i obsługuje set:<pct>", async () => {
    const { run, calls } = makeRunner({
      "pactl set-sink-volume @DEFAULT_SINK@ +5%": { ok: true, code: 0, stdout: "", stderr: "" },
      "pactl set-sink-volume @DEFAULT_SINK@ 100%": { ok: true, code: 0, stdout: "", stderr: "" },
    });
    expect(await linuxVolume("up", { run })).toBe("ok");
    expect(calls).toEqual([
      "wpctl set-volume -l 1.5 @DEFAULT_AUDIO_SINK@ 5%+",
      "pactl set-sink-volume @DEFAULT_SINK@ +5%",
    ]);
    // Wartość ponad 100% jest bezpiecznie ograniczana do 100%
    expect(await linuxVolume("set:180", { run })).toBe("ok");
    expect(await linuxVolume("bogus", { run })).toBe("err:unknown");
  });

  it("linuxMedia używa playerctl i odrzuca nieznane akcje", async () => {
    const { run, calls } = makeRunner({
      "playerctl play-pause": { ok: true, code: 0, stdout: "", stderr: "" },
      "playerctl previous": { ok: true, code: 0, stdout: "", stderr: "" },
    });
    expect(await linuxMedia("playpause", { run })).toBe("ok");
    expect(await linuxMedia("prev", { run })).toBe("ok");
    expect(calls).toEqual(["playerctl play-pause", "playerctl previous"]);
    expect(await linuxMedia("explode", { run })).toBe("err:unknown");
  });

  it("detectLinuxGpu rozpoznaje NVIDIA VRAM z nvidia-smi i AMD VRAM z sysfs", async () => {
    const nv = makeRunner({
      "nvidia-smi": { ok: true, code: 0, stdout: "NVIDIA GeForce RTX 4060, 8188\n", stderr: "" },
    });
    expect(await detectLinuxGpu({ run: nv.run })).toEqual({ gpu: "NVIDIA GeForce RTX 4060", vramGb: 8 });

    const amd = makeRunner({});
    const resAmd = await detectLinuxGpu({
      run: amd.run,
      readdir: () => ["card0", "renderD128"],
      readFile: () => String(12 * 1073741824),
    });
    expect(resAmd).toEqual({ gpu: "DRM card0", vramGb: 12 });
  });

  it("linuxDiagnostics (W1) uczciwie zwraca available/missing/disabled i nie udaje aktywnego Dockera bez demona", async () => {
    const { run } = makeRunner({
      "wpctl --version": { ok: true, code: 0, stdout: "0.4.17", stderr: "" },
      "docker --version": { ok: true, code: 0, stdout: "Docker version 27.0", stderr: "" },
      "docker info --format {{.ServerVersion}}": { ok: false, code: 1, stdout: "", stderr: "Cannot connect" },
      "ollama --version": { ok: true, code: 0, stdout: "ollama version 0.6.0", stderr: "" },
    });
    const diag = await linuxDiagnostics({
      run,
      env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
      readFile: () => 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\n',
      readdir: () => [],
    });
    expect(diag.distro).toBe("Ubuntu 24.04.1 LTS");
    expect(diag.sessionType).toBe("wayland");
    const byId = Object.fromEntries(diag.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.audio.status).toBe("available");
    expect(byId.x11Input.status).toBe("disabled");
    expect(byId.docker.status).toBe("disabled"); // CLI jest, demon nie działa!
    expect(byId.ollama.status).toBe("available");
    expect(byId.media.status).toBe("missing");
    expect(byId.media.fixHint).toContain("playerctl");
  });

  it("readLinuxDistro parsuje PRETTY_NAME i degraduje do Linux", () => {
    expect(readLinuxDistro(() => 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04 LTS"')).toBe("Ubuntu 24.04 LTS");
    expect(readLinuxDistro(() => { throw new Error("nope"); })).toBe("Linux");
  });

  it("clampWindowBounds usuwa zapisane współrzędne poza odłączonym monitorem", () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
    expect(clampWindowBounds({ x: 100, y: 100, width: 1000, height: 700 }, displays)).toEqual({
      x: 100, y: 100, width: 1000, height: 700,
    });
    // Odłączony monitor po prawej (x: 2500) → wycentruj (bez x/y)
    expect(clampWindowBounds({ x: 2500, y: 100, width: 1000, height: 700 }, displays)).toEqual({
      width: 1000, height: 700,
    });
  });
});
