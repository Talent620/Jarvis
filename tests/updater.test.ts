import { describe, it, expect } from "vitest";
import { isNewer, downloadUrl } from "../src/lib/updater";

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
