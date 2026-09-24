import { it, expect } from "vitest";
import { Kernel } from "../../src/lib/runtime/kernel";
import { JarvisRuntime } from "../../src/lib/runtime/lanes/runtime";
import { MemoryBrowser } from "../helpers/memoryBrowser";

// Regression: with a zero-latency environment several commands share one millisecond, and
// recency ties used to pick the stale video list, so "zaznacz pierwsze cztery litery" failed
// about once in twelve runs. Ties are now broken by the registry's event order.
it("200 back-to-back runs of steps 1-7 on a zero-latency environment all copy 'Łódź'", async () => {
  const bad: string[] = [];
  for (let i = 0; i < 200; i++) {
    const env = new MemoryBrowser();
    const rt = new JarvisRuntime({ kernel: new Kernel(), env, session: { youtubeUrl: "http://yt.test/" } });
    await rt.start();
    for (const t of ["Jarvis, uruchom przeglądarkę.", "Wejdź na YouTube.", "Otwórz pierwszy film.", "Zjedź trochę niżej.", "Znajdź komentarze.", "Pierwszy komentarz.", "Zaznacz pierwsze cztery litery.", "Skopiuj."]) rt.onText(t);
    await rt.idle();
    if (env.clipboard !== "Łódź") bad.push(`${i}: ${rt.turns.map((t) => t.result?.truth).join(",")}`);
  }
  expect(bad).toEqual([]);
});
