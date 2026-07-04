import { describe, it, expect } from "vitest";
import { isNewer, downloadUrl, humanizeUpdateError, downloadLinks } from "../src/lib/updater";

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

describe("updater — downloadLinks (aktualne wersje do pobrania)", () => {
  it("zwraca 3 platformy z właściwymi linkami GitHub", () => {
    const links = downloadLinks("windows");
    expect(links.map((l) => l.plat)).toEqual(["windows", "android", "ios"]);
    expect(links.find((l) => l.plat === "windows")!.url).toMatch(/releases\/download\/latest\/JARVIS\.exe$/);
    expect(links.find((l) => l.plat === "android")!.url).toMatch(/releases\/download\/latest\/jarvis\.apk$/);
    expect(links.find((l) => l.plat === "ios")!.url).toMatch(/releases\/latest$/);
  });
  it("podświetla bieżącą platformę; web traktuje jak Windows", () => {
    expect(downloadLinks("android").find((l) => l.current)!.plat).toBe("android");
    expect(downloadLinks("ios").find((l) => l.current)!.plat).toBe("ios");
    expect(downloadLinks("web").find((l) => l.current)!.plat).toBe("windows");
    // dokładnie jedna platforma oznaczona jako bieżąca
    expect(downloadLinks("windows").filter((l) => l.current)).toHaveLength(1);
  });
});
