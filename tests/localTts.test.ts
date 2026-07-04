import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  synthLocal,
  localTtsSupported,
  localTtsUsable,
  __setTtsWorkerFactory,
  __resetTtsForTests,
} from "../src/lib/localTts";

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  mode: "ok" | "error" | "silent";
  constructor(mode: "ok" | "error" | "silent") { this.mode = mode; }
  postMessage(m: { type: string; id: number }) {
    if (m.type !== "tts") return;
    setTimeout(() => {
      if (this.mode === "silent") return;
      if (this.mode === "error") this.onmessage?.({ data: { type: "error", id: m.id, message: "boom" } });
      else this.onmessage?.({ data: { type: "result", id: m.id, wav: new ArrayBuffer(64) } });
    }, 0);
  }
  terminate() {}
}

beforeEach(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  __resetTtsForTests();
});
afterEach(() => {
  __setTtsWorkerFactory(null);
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
});

describe("localTts — synteza on-device", () => {
  it("supported, gdy jest Worker", () => {
    expect(localTtsSupported()).toBe(true);
  });

  it("zwraca Blob WAV (roundtrip)", async () => {
    __setTtsWorkerFactory(() => new FakeWorker("ok"));
    const blob = await synthLocal("cześć");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("audio/wav");
    expect(blob!.size).toBe(64);
  });

  it("twardy błąd → null i localTtsUsable=false", async () => {
    __setTtsWorkerFactory(() => new FakeWorker("error"));
    expect(await synthLocal("x")).toBeNull();
    expect(localTtsUsable()).toBe(false);
  });

  it("timeout → null", async () => {
    __setTtsWorkerFactory(() => new FakeWorker("silent"));
    expect(await synthLocal("x", "af_heart", 30)).toBeNull();
  });

  it("pusty tekst → null bez workera", async () => {
    __setTtsWorkerFactory(() => new FakeWorker("ok"));
    expect(await synthLocal("  ")).toBeNull();
  });
});
