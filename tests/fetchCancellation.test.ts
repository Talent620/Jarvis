import { afterEach, expect, it, vi } from "vitest";
import { fetchTimeout } from "../src/lib/http";
afterEach(() => vi.unstubAllGlobals());
it("przenosi sygnał STOP do transportu również po odebraniu nagłówków", async () => {
  let transportSignal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { transportSignal = init.signal; return new Response("OK"); }));
  const controller = new AbortController();
  await fetchTimeout("http://fixture", { signal: controller.signal }, 30);
  expect(transportSignal.aborted).toBe(false);
  controller.abort();
  expect(transportSignal.aborted).toBe(true);
});
it("nie rozpoczyna użytecznej odpowiedzi z wcześniej anulowanym sygnałem", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { if (init.signal.aborted) throw new DOMException("stop", "AbortError"); return new Response("bad"); }));
  const controller = new AbortController(); controller.abort();
  await expect(fetchTimeout("http://fixture", { signal: controller.signal }, 30)).rejects.toMatchObject({ name: "AbortError" });
});
