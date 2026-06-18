import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  embedLocal,
  localEmbedSupported,
  localEmbedUsable,
  __setEmbedWorkerFactory,
  __resetLocalEmbedForTests,
  LOCAL_EMBED_DIM,
} from "../src/lib/localEmbed";

// Atrapa Web Workera (w node nie ma web-Workera) — symuluje pipeline embeddingowy.
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  mode: "ok" | "error" | "silent";
  constructor(mode: "ok" | "error" | "silent") { this.mode = mode; }
  postMessage(m: { type: string; id: number; texts: string[] }) {
    if (m.type !== "embed") return;
    setTimeout(() => {
      if (this.mode === "silent") return; // nigdy nie odpowiada → test timeoutu
      this.onmessage?.({ data: { type: "ready" } });
      if (this.mode === "error") {
        this.onmessage?.({ data: { type: "error", id: m.id, message: "boom" } });
      } else {
        const vectors = m.texts.map(() => Array.from({ length: LOCAL_EMBED_DIM }, () => 0.01));
        this.onmessage?.({ data: { type: "result", id: m.id, vectors } });
      }
    }, 0);
  }
  terminate() {}
}

beforeEach(() => {
  // Udostępnij globalny Worker, by localEmbedSupported() było true.
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  __resetLocalEmbedForTests();
});
afterEach(() => {
  __setEmbedWorkerFactory(null);
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
});

describe("localEmbed — capability-check", () => {
  it("supported, gdy istnieje Worker", () => {
    expect(localEmbedSupported()).toBe(true);
  });
});

describe("localEmbed — liczenie wektorów", () => {
  it("zwraca wektory o właściwym wymiarze (roundtrip przez worker)", async () => {
    __setEmbedWorkerFactory(() => new FakeWorker("ok"));
    const out = await embedLocal(["cześć", "świat"]);
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(2);
    expect(out![0]).toHaveLength(LOCAL_EMBED_DIM);
  });

  it("twardy błąd workera → null i lokal staje się nieużyteczny", async () => {
    __setEmbedWorkerFactory(() => new FakeWorker("error"));
    const out = await embedLocal(["x"]);
    expect(out).toBeNull();
    expect(localEmbedUsable()).toBe(false); // po błędzie nie próbujemy lokalnie (fallback do chmury)
  });

  it("brak odpowiedzi → timeout zwraca null (nie blokuje)", async () => {
    __setEmbedWorkerFactory(() => new FakeWorker("silent"));
    const out = await embedLocal(["x"], 30);
    expect(out).toBeNull();
  });

  it("pusta lista → null bez wołania workera", async () => {
    __setEmbedWorkerFactory(() => new FakeWorker("ok"));
    expect(await embedLocal([])).toBeNull();
  });
});
