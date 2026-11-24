// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, beforeEach } from "vitest";
import { OmniPilotHud } from "../src/components/OmniPilotHud";
import {
  resetOmniPilotState,
  visualLocateAndAct,
  type OmniActuator,
} from "../src/lib/omniPilot";

const mockActuator: Partial<OmniActuator> = {
  isDesktop: () => true,
  captureScreenDetailed: async () => ({
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    mediaType: "image/png",
    width: 1440,
    height: 810,
    screenWidth: 1920,
    screenHeight: 1080,
    cursorX: 10,
    cursorY: 10,
  }),
  moveCursor: async () => ({ ok: true, x: 480, y: 540, message: "OK" }),
  mouseAction: async () => ({ ok: true, message: "Kliknięto." }),
  abortHardware: async () => {},
  sleep: async () => {},
};

describe("OMNI-PILOT · Warstwa 5: OmniPilotHud UI", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetOmniPilotState();
  });

  it("renderuje podgląd z retikulą (25%, 50%), obsługuje potwierdzenie RiskGuard i zamykanie", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(createElement(OmniPilotHud)));

    // Gdy idle — HUD niewidoczny
    expect(div.querySelector(".omni-hud")).toBeNull();

    // Start operacji wymagającej potwierdzenia RiskGuard (payment)
    let pending!: ReturnType<typeof visualLocateAndAct>;
    await act(async () => {
      pending = visualLocateAndAct("przycisk Zapłać", "click", {
        actuator: mockActuator,
        askVision: async () => '{"found":true,"x":250,"y":500,"label":"Zapłać teraz","confidence":0.93,"risk":"payment"}',
      });
      await new Promise((r) => setTimeout(r, 15));
    });

    const reticle = div.querySelector<HTMLElement>(".omni-reticle");
    expect(reticle).not.toBeNull();
    expect(reticle!.style.left).toBe("25%");
    expect(reticle!.style.top).toBe("50%");
    expect(div.textContent).toContain("Zapłać teraz · 93%");

    const allowBtn = div.querySelector<HTMLButtonElement>(".omni-btn-allow");
    expect(allowBtn).not.toBeNull();
    await act(async () => {
      allowBtn!.click();
      await pending;
    });

    const res = await pending;
    expect(res.ok).toBe(true);
    expect(div.textContent).toContain("WYKONANO");

    // Zamknięcie panelu po ukończeniu
    const closeBtn = div.querySelector<HTMLButtonElement>(".omni-close-btn");
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn!.click());
    expect(div.querySelector(".omni-hud")).toBeNull();

    act(() => root.unmount());
    div.remove();
  });

  it("renderuje Dual-Track Strażnika Ekranu w tle oraz przyciski decyzji po wykryciu celu", async () => {
    const {
      resetOmniSentinel,
      startOmniSentinel,
      runSentinelTick,
      getSentinelState,
    } = await import("../src/lib/omniSentinel");
    resetOmniSentinel();

    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    act(() => root.render(createElement(OmniPilotHud)));

    await act(async () => {
      startOmniSentinel({
        condition: "zielony przycisk Gotowe",
        intervalMs: 30000,
        maxChecks: 5,
        actuator: {
          isDesktop: () => true,
          captureScreenDetailed: async () => ({
            data: "FRAME_SENTINEL_TEST",
            mediaType: "image/png",
            width: 1440,
            height: 810,
            screenWidth: 1920,
            screenHeight: 1080,
            cursorX: 0,
            cursorY: 0,
          }),
          moveCursor: async () => ({ ok: true, x: 960, y: 540, message: "OK" }),
          mouseAction: async () => ({ ok: true, message: "OK" }),
        },
        askVision: async () =>
          '{"matched":true,"xNorm":500,"yNorm":500,"label":"Gotowe","confidence":0.95,"risk":"none","question":"Widzę Gotowe — kliknąć?"}',
      });
      await runSentinelTick();
    });

    expect(div.textContent).toContain("STRAŻNIK · DECYZJA");
    expect(div.textContent).toContain("Widzę Gotowe — kliknąć?");
    const btns = Array.from(div.querySelectorAll<HTMLButtonElement>(".omni-sentinel-actions button"));
    expect(btns.length).toBe(4);

    // Kliknij "▶ Dalej" → wraca do watching
    await act(async () => {
      btns[2].click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getSentinelState().status).toBe("watching");

    act(() => {
      resetOmniSentinel();
      root.unmount();
    });
    div.remove();
  });
});
