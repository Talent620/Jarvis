import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chatLocal,
  webllmSupported,
  webllmUsable,
  __setWebllmWorkerFactory,
  __resetWebllmForTests,
} from "../src/lib/webllm";

// Atrapa workera WebLLM — symuluje silnik MLC.
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  mode: "ok" | "error" | "silent";
  constructor(mode: "ok" | "error" | "silent") { this.mode = mode; }
  postMessage(m: { type: string; id: number }) {
    if (m.type !== "chat") return;
    setTimeout(() => {
      if (this.mode === "silent") return;
      this.onmessage?.({ data: { type: "progress", pct: 50, text: "pobieranie" } });
      this.onmessage?.({ data: { type: "ready", model: "x" } });
      if (this.mode === "error") this.onmessage?.({ data: { type: "error", id: m.id, message: "boom" } });
      else this.onmessage?.({ data: { type: "result", id: m.id, text: "odpowiedź on-device" } });
    }, 0);
  }
  terminate() {}
}

beforeEach(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  // navigator w node bywa read-only — dokładamy tylko właściwość gpu (WebGPU obecne).
  if (typeof navigator === "undefined") {
    (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
  } else {
    try { Object.defineProperty(navigator, "gpu", { value: {}, configurable: true }); } catch { /* ignore */ }
  }
  __resetWebllmForTests();
});
afterEach(() => {
  __setWebllmWorkerFactory(null);
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
  try { delete (navigator as unknown as { gpu?: unknown }).gpu; } catch { /* ignore */ }
});

describe("webllm manager — capability + roundtrip", () => {
  it("webllmSupported true przy Worker + WebGPU", () => {
    expect(webllmSupported()).toBe(true);
  });

  it("zwraca tekst z workera (roundtrip)", async () => {
    __setWebllmWorkerFactory(() => new FakeWorker("ok"));
    const out = await chatLocal("model-x", [{ role: "user", content: "cześć" }]);
    expect(out).toBe("odpowiedź on-device");
  });

  it("twardy błąd → null i webllmUsable=false (fallback do chmury)", async () => {
    __setWebllmWorkerFactory(() => new FakeWorker("error"));
    const out = await chatLocal("model-x", [{ role: "user", content: "x" }]);
    expect(out).toBeNull();
    expect(webllmUsable()).toBe(false);
  });

  it("brak odpowiedzi → timeout zwraca null", async () => {
    __setWebllmWorkerFactory(() => new FakeWorker("silent"));
    const out = await chatLocal("model-x", [{ role: "user", content: "x" }], { timeoutMs: 30 });
    expect(out).toBeNull();
  });
});
