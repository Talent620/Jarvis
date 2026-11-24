import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveBackAction, shouldExitOnBack, DOUBLE_BACK_WINDOW_MS, type AndroidBackState } from "../src/lib/androidNative";

const noneOpen: AndroidBackState = {
  showCmd: false,
  hasConsent: false,
  showRelicense: false,
  showVoice: false,
  showLive: false,
  showHud: false,
  showBoss: false,
  showNotifs: false,
  hasRouteScreen: false,
  isBusy: false,
};

describe("Android native UX — sprzętowy przycisk Wstecz (LIFO) i potwierdzenie wyjścia", () => {
  it("zamyka overlaye w ścisłej kolejności priorytetów LIFO zamiast wychodzić z aplikacji", () => {
    expect(resolveBackAction({ ...noneOpen, showCmd: true, hasRouteScreen: true })).toBe("close_cmd");
    expect(resolveBackAction({ ...noneOpen, hasConsent: true, showVoice: true })).toBe("deny_consent");
    expect(resolveBackAction({ ...noneOpen, showVoice: true, hasRouteScreen: true })).toBe("close_voice");
    expect(resolveBackAction({ ...noneOpen, showLive: true, hasRouteScreen: true })).toBe("close_live");
    expect(resolveBackAction({ ...noneOpen, hasRouteScreen: true, isBusy: true })).toBe("route_back");
    expect(resolveBackAction({ ...noneOpen, isBusy: true })).toBe("stop_generation");
    expect(resolveBackAction(noneOpen)).toBe("confirm_exit");
  });

  it("wymaga podwójnego naciśnięcia Wstecz w oknie 2 s przed minimalizacją", () => {
    const t0 = 10_000;
    expect(shouldExitOnBack(0, t0)).toBe(false);
    expect(shouldExitOnBack(t0, t0 + 500)).toBe(true);
    expect(shouldExitOnBack(t0, t0 + DOUBLE_BACK_WINDOW_MS)).toBe(true);
    expect(shouldExitOnBack(t0, t0 + DOUBLE_BACK_WINDOW_MS + 1)).toBe(false);
  });
});

describe("Android Java plugins — inwarianty NativeTtsPlugin i WakeWordService", () => {
  it("NativeTtsPlugin używa UtteranceProgressListener i USAGE_ASSISTANT (brak natychmiastowego resolve przed końcem mowy)", () => {
    const java = readFileSync(
      new URL("../android/app/src/main/java/net/serwer256/jarvis/NativeTtsPlugin.java", import.meta.url),
      "utf8",
    );
    expect(java).toContain("UtteranceProgressListener");
    expect(java).toContain("USAGE_ASSISTANT");
    expect(java).toContain("CONTENT_TYPE_SPEECH");
    expect(java).toContain("resolveActiveNow()");
  });

  it("WakeWordService ma backoff błędów, strażnika uprawnień i czyści handler w onDestroy", () => {
    const java = readFileSync(
      new URL("../android/app/src/main/java/net/serwer256/jarvis/WakeWordService.java", import.meta.url),
      "utf8",
    );
    expect(java).toContain("ERROR_INSUFFICIENT_PERMISSIONS");
    expect(java).toContain("consecutiveErrors");
    expect(java).toContain("handler.removeCallbacksAndMessages(null)");
  });
});
