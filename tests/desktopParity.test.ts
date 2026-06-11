// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { desktopNotify, isDesktop } from "../src/lib/desktop";

// Parytet desktopu: notify() i otwieranie protokołów korzystają z mostka
// jarvisDesktop, gdy jest (.exe), i degradują się bezpiecznie, gdy go nie ma.
describe("most desktopowy (.exe) — parytet powiadomień/akcji", () => {
  afterEach(() => {
    delete (window as any).jarvisDesktop;
  });

  it("bez mostka: isDesktop=false, desktopNotify=false (web fallback wyżej)", async () => {
    expect(isDesktop()).toBe(false);
    expect(await desktopNotify("T", "B")).toBe(false);
  });

  it("z mostkiem: desktopNotify woła natywne powiadomienie i zwraca true", async () => {
    const notify = vi.fn(() => Promise.resolve("ok"));
    (window as any).jarvisDesktop = { notify };
    expect(isDesktop()).toBe(true);
    expect(await desktopNotify("JARVIS", "Minutnik")).toBe(true);
    expect(notify).toHaveBeenCalledWith("JARVIS", "Minutnik");
  });

  it("awaria natywnego powiadomienia → false (spada do web), bez wyjątku", async () => {
    (window as any).jarvisDesktop = { notify: () => Promise.reject(new Error("x")) };
    expect(await desktopNotify("T", "B")).toBe(false);
  });

  it("starszy .exe bez notify w moście → false (kompatybilność wstecz)", async () => {
    (window as any).jarvisDesktop = { open: () => Promise.resolve("ok") };
    expect(await desktopNotify("T", "B")).toBe(false);
  });
});
