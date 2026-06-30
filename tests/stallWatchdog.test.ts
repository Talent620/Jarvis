import { describe, it, expect, vi, afterEach } from "vitest";
import { makeStallWatchdog } from "../src/lib/brain";

afterEach(() => { vi.useRealTimers(); });

describe("brain — stall watchdog (szybki failover przy zaciętym dostawcy)", () => {
  it("strumień bez pierwszego tokenu → odrzuca po firstMs (przełącz mózg)", async () => {
    vi.useFakeTimers();
    const wd = makeStallWatchdog(() => false, () => false, true, 100, 1000);
    const p = expect(wd.promise).rejects.toThrow(/milczy|nie odpowiada/);
    await vi.advanceTimersByTimeAsync(120);
    await p;
  });

  it("gdy dostawca zaczął odpowiadać (progressed) — NIE odrzuca po firstMs", async () => {
    vi.useFakeTimers();
    let done = false;
    const wd = makeStallWatchdog(() => false, () => true, true, 100, 100000);
    wd.promise.catch(() => { done = true; });
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false); // pierwszy token był → brak odrzucenia
    wd.cancel();
  });

  it("twardy limit: nawet ze strumieniem, całość za długo → odrzuca po hardMs", async () => {
    vi.useFakeTimers();
    const wd = makeStallWatchdog(() => false, () => true, true, 100, 500);
    const p = expect(wd.promise).rejects.toThrow(/nie odpowiada/);
    await vi.advanceTimersByTimeAsync(600);
    await p;
  });

  it("settled=true (próba się udała) → nigdy nie odrzuca", async () => {
    vi.useFakeTimers();
    let rejected = false;
    const wd = makeStallWatchdog(() => true, () => false, true, 100, 200);
    wd.promise.catch(() => { rejected = true; });
    await vi.advanceTimersByTimeAsync(500);
    expect(rejected).toBe(false);
  });

  it("cancel() czyści timery — brak odrzucenia po wygranej próbie", async () => {
    vi.useFakeTimers();
    let rejected = false;
    const wd = makeStallWatchdog(() => false, () => false, true, 100, 200);
    wd.promise.catch(() => { rejected = true; });
    wd.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(rejected).toBe(false);
  });

  it("dostawca bez strumienia (hasStream=false) — pilnuje tylko twardego limitu", async () => {
    vi.useFakeTimers();
    let rejected = false;
    const wd = makeStallWatchdog(() => false, () => false, false, 100, 1000);
    wd.promise.catch(() => { rejected = true; });
    await vi.advanceTimersByTimeAsync(300); // minęło firstMs, ale brak strumienia → nie odrzuca
    expect(rejected).toBe(false);
    wd.cancel();
  });
});
