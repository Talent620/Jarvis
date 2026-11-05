// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, downloadUrl, platform, platformLabel } from "../src/lib/updater";

afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop; });

describe("aktualizacja Linux", () => {
  it("rozpoznaje Electron Linux, a nie Windows", () => {
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { platform: "linux" };
    expect(platform()).toBe("linux");
    expect(platformLabel(platform())).toBe("Linux");
    expect(downloadUrl()).toMatch(/JARVIS\.AppImage$/);
  });
  it("nie uznaje wydania bez pakietu Linuksa za aktualne", async () => {
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { platform: "linux" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ assets: [{ name: "JARVIS.exe" }] }))));
    expect(await checkForUpdate()).toEqual({ error: "W wydaniu nie ma jeszcze aktualizacji dla Linuksa." });
  });
  it("wybiera manifest i instalator Linuksa z wydania", async () => {
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { platform: "linux" };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("linux.json")) return new Response(JSON.stringify({ iso: "2099-01-01T00:00:00Z" }));
      return new Response(JSON.stringify({ assets: [
        { name: "JARVIS.exe", browser_download_url: "https://example.test/JARVIS.exe" },
        { name: "JARVIS.AppImage", browser_download_url: "https://example.test/JARVIS.AppImage", size: 123 },
        { name: "linux.json", browser_download_url: "https://example.test/linux.json" },
      ] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkForUpdate();
    expect(result).toMatchObject({ platform: "linux", assetAvailable: true, verifiedBuild: true, url: "https://example.test/JARVIS.AppImage", size: 123 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
