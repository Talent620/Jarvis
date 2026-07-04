// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parsePullLine, pullOllamaModel } from "../src/lib/ollamaPull";
import { store } from "../src/lib/store";

beforeEach(() => {
  store.setSettings({ ollamaUrl: "" });
  vi.unstubAllGlobals();
});

describe("ollamaPull — parsePullLine (czysta)", () => {
  it("status bez rozmiaru → bez procentu", () => {
    expect(parsePullLine('{"status":"pulling manifest"}')).toEqual({ status: "pulling manifest", percent: undefined });
  });
  it("downloading z total/completed → procent", () => {
    expect(parsePullLine('{"status":"downloading","total":200,"completed":50}')).toEqual({ status: "downloading", percent: 25 });
  });
  it("total=0 → bez dzielenia przez zero", () => {
    expect(parsePullLine('{"status":"x","total":0,"completed":0}')).toEqual({ status: "x", percent: undefined });
  });
  it("błąd z Ollamy → status błędu + pole error", () => {
    expect(parsePullLine('{"error":"model not found"}')).toEqual({ status: "błąd: model not found", error: "model not found" });
  });
  it("pusta/niepoprawna linia → null", () => {
    expect(parsePullLine("")).toBeNull();
    expect(parsePullLine("   ")).toBeNull();
    expect(parsePullLine("nie-json")).toBeNull();
  });
});

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe("ollamaPull — pullOllamaModel (walidacja)", () => {
  it("brak adresu → błąd, nie strzela fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await pullOllamaModel("qwen3.5:4b", () => {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/adresu Ollamy/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pusta nazwa modelu → błąd", async () => {
    const r = await pullOllamaModel("   ", () => {}, "http://localhost:11434");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nazwę modelu/);
  });
});

describe("ollamaPull — pullOllamaModel (strumień)", () => {
  it("parsuje NDJSON, raportuje postęp i kończy sukcesem", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        '{"status":"pulling manifest"}\n{"status":"downloading","total":100,"completed":40}\n',
        '{"status":"downloading","total":100,"completed":100}\n{"status":"success"}\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const seen: string[] = [];
    const r = await pullOllamaModel("qwen3.5:4b", (p) => seen.push(`${p.status}:${p.percent ?? ""}`), "http://localhost:11434/");
    expect(r.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:11434/api/pull"); // trailing slash znormalizowany
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ model: "qwen3.5:4b", stream: true });

    expect(seen).toContain("downloading:40");
    expect(seen).toContain("downloading:100");
    expect(seen[seen.length - 1]).toBe("success:");
  });

  it("błąd w strumieniu (zła nazwa) → ok:false z komunikatem", async () => {
    vi.stubGlobal("fetch", async () => streamResponse(['{"error":"file does not exist"}\n']));
    const r = await pullOllamaModel("nie-ma-takiego", () => {}, "http://localhost:11434");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("file does not exist");
  });

  it("HTTP błąd → ok:false", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const r = await pullOllamaModel("x", () => {}, "http://localhost:11434");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 500/);
  });
});
