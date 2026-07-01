// === Adaptacyjne 3D trafia do KODU strony (web3dGeneration) — testy ===
// DoD: web3dPolicy ma produkcyjny import, a rozstrzygnięta polityka trafia do generatora — nie tylko
// test obiektu policy. Mockujemy model i sprawdzamy dyrektywy 3D w prompcie generateSite dla realnego
// urządzenia (REAL: WebGL + poster + lazy + fallback) i dla S9 (CSS 2.5D, jawnie NIE realne 3D).
import { describe, it, expect, vi } from "vitest";

const { askSpy } = vi.hoisted(() => ({ askSpy: vi.fn(async () => "<!DOCTYPE html><html><head><title>x</title></head><body><h1>x</h1></body></html>") }));
vi.mock("../src/lib/brain", async (orig) => ({ ...(await orig() as object), askModel: askSpy }));

import { generateSite } from "../src/lib/webgen";
import { resolve3D, threeDInstruction, type DeviceCaps } from "../src/lib/web3dPolicy";

const strong: DeviceCaps = { webgl: true, deviceMemoryGB: 8, hardwareConcurrency: 8, reducedMotion: false, saveData: false, lowEndPhone: false };
const s9: DeviceCaps = { webgl: true, deviceMemoryGB: 3, hardwareConcurrency: 4, reducedMotion: false, saveData: false, lowEndPhone: true };

async function promptFor(caps: DeviceCaps): Promise<string> {
  askSpy.mockClear();
  await generateSite("zbuduj stronę", undefined, "auto", "auto", undefined, resolve3D("REAL_3D", caps));
  return askSpy.mock.calls[0][0].history[0].content as string;
}

describe("web3dPolicy → generateSite (dyrektywy 3D w prompcie)", () => {
  it("REAL_3D na mocnym urządzeniu → realny WebGL: canvas, poster, lazy, fallback", async () => {
    const p = await promptFor(strong);
    expect(p).toMatch(/REALNE 3D w <canvas>/);
    expect(p).toMatch(/POSTER/);
    expect(p).toMatch(/LENIWIE/);
    expect(p).toMatch(/FALLBACK/);
  });

  it("REAL_3D na S9 → schodzi do CSS 2.5D, JAWNIE nie realne 3D (parallax nie udaje 3D)", async () => {
    const p = await promptFor(s9);
    expect(p).toMatch(/CSS 2\.5D/);
    expect(p).toMatch(/NIE jest realne 3D/);
    expect(p).not.toMatch(/REALNE 3D w <canvas>/);
  });

  it("bez rozstrzygniętej polityki → brak bloku 3D w prompcie", async () => {
    askSpy.mockClear();
    await generateSite("zbuduj stronę", undefined, "auto", "auto");
    const p = askSpy.mock.calls[0][0].history[0].content as string;
    expect(p).not.toMatch(/REALNE 3D w <canvas>/);
    expect(p).not.toMatch(/CSS 2\.5D/);
  });
});

describe("threeDInstruction — CSS nie jest nazywane realnym 3D", () => {
  it("effective css → oznaczone jako NIE realne 3D; effective real → WebGL", () => {
    expect(threeDInstruction(resolve3D("CSS_3D", strong))).toMatch(/NIE jest realne 3D/);
    expect(threeDInstruction(resolve3D("REAL_3D", strong))).toMatch(/REALNE 3D w <canvas>/);
    expect(threeDInstruction(resolve3D("OFF", strong))).toMatch(/BEZ efektów 3D/);
  });
});
