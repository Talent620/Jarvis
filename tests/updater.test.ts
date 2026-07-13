import { describe, it, expect } from "vitest";
import { isNewer, isNewerLegacyAsset, downloadUrl, formatUpdateSize, humanizeUpdateError, platformLabel } from "../src/lib/updater";

describe("updater — isNewer", () => {
  it("wydanie nowsze o >1 min → true", () => {
    expect(isNewer("2026-06-20 00:00", "2026-06-20T00:05:00Z")).toBe(true);
  });
  it("wydanie starsze → false", () => {
    expect(isNewer("2026-06-20 00:10", "2026-06-20T00:00:00Z")).toBe(false);
  });
  it("ta sama minuta (margines) → false", () => {
    expect(isNewer("2026-06-20 00:00", "2026-06-20T00:00:30Z")).toBe(false);
  });
  it("puste/niepoprawne → false (bezpiecznie)", () => {
    expect(isNewer("", "2026-06-20T00:00:00Z")).toBe(false);
    expect(isNewer("2026-06-20 00:00", "")).toBe(false);
    expect(isNewer("xxx", "yyy")).toBe(false);
  });
});

describe("updater — downloadUrl", () => {
  it("buduje link do assetu wg platformy", () => {
    expect(downloadUrl("android")).toMatch(/releases\/download\/latest\/jarvis\.apk$/);
    expect(downloadUrl("windows")).toMatch(/JARVIS\.exe$/);
  });
  it("iOS → strona wydań (brak instalowalnego pliku, instalacja przez App Store/sideload)", () => {
    expect(downloadUrl("ios")).toMatch(/releases\/latest$/);
    expect(downloadUrl("ios")).not.toMatch(/\.ipa/);
  });
});

describe("updater — humanizeUpdateError", () => {
  it("abort/timeout → czytelny komunikat o czasie odpowiedzi", () => {
    expect(humanizeUpdateError("signal is aborted without reason")).toMatch(/nie odpowiedział na czas/i);
    expect(humanizeUpdateError("The operation timed out")).toMatch(/nie odpowiedział na czas/i);
  });
  it("brak sieci → komunikat o internecie", () => {
    expect(humanizeUpdateError("Failed to fetch")).toMatch(/internet|niedostępny/i);
    expect(humanizeUpdateError("NetworkError when attempting to fetch")).toMatch(/internet|niedostępny/i);
  });
  it("inny błąd → zachowuje treść", () => {
    expect(humanizeUpdateError("coś dziwnego")).toMatch(/coś dziwnego/);
  });
});

describe("updater — zgodność ze starszym wydaniem bez manifestu platformy", () => {
  it("nie uznaje czasu uploadu tego samego buildu za nową wersję", () => {
    expect(isNewerLegacyAsset("2026-07-04 09:26", "2026-07-04T09:27:50Z")).toBe(false);
  });

  it("wykrywa realnie późniejsze wydanie", () => {
    expect(isNewerLegacyAsset("2026-07-04 09:26", "2026-07-04T10:00:00Z")).toBe(true);
  });
});

describe("updater — czytelny status", () => {
  it("pokazuje platformę po ludzku", () => {
    expect(platformLabel("windows")).toBe("Windows");
    expect(platformLabel("android")).toBe("Android");
    expect(platformLabel("ios")).toMatch(/iPhone/);
    expect(platformLabel("web")).toMatch(/PWA/);
  });

  it("formatuje rozmiar aktualizacji bez technicznego szumu", () => {
    expect(formatUpdateSize()).toBe("");
    expect(formatUpdateSize(1500)).toBe("1 KB");
    expect(formatUpdateSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatUpdateSize(24 * 1024 * 1024)).toBe("24 MB");
  });
});
