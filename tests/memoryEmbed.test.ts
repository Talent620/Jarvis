// @vitest-environment jsdom
import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";

// Mock lokalnego embeddera — sterujemy nim w testach.
vi.mock("../src/lib/localEmbed", () => ({
  embedLocal: vi.fn(),
  localEmbedUsable: vi.fn(() => false),
  LOCAL_EMBED_TAG: "local:mml12",
}));

import { embedLocal, localEmbedUsable } from "../src/lib/localEmbed";
import { ensureIndexed, prepareMemoryContext, memoryBlock, rememberFact } from "../src/lib/memory";
import { store } from "../src/lib/store";

const mockEmbedLocal = embedLocal as unknown as ReturnType<typeof vi.fn>;
const mockUsable = localEmbedUsable as unknown as ReturnType<typeof vi.fn>;

// rememberFact uruchamia ensureIndexed() w tle — poczekaj aż wektor (i tag) się ustawi.
async function waitTag(key: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (store.data.memory.find((m) => m.key === key)?.embModel) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

function cloudFetchOk() {
  // Gemini embedContent → 768-wymiarowy wektor.
  return vi.fn(async () => ({ ok: true, json: async () => ({ embedding: { values: Array(768).fill(0.02) } }) }));
}

beforeEach(() => {
  store.setData((d) => { d.memory = []; });
  store.setSettings({ keys: { ...store.settings.keys, gemini: "k-test" }, localEmbeddings: false, proxyUrl: "", onDeviceOnly: false });
  mockEmbedLocal.mockReset();
  mockUsable.mockReset();
  mockUsable.mockReturnValue(false);
});

afterEach(() => vi.unstubAllGlobals());

describe("memory — embeddingi on-device z fallbackiem do chmury", () => {
  it.each(["client-key", "server-key"])("on-device retains local facts without HTTP embedding via %s", async (credentials) => {
    store.setSettings({
      onDeviceOnly: true,
      proxyUrl: credentials === "server-key" ? "https://bff.example" : "",
      keys: { ...store.settings.keys, gemini: credentials === "client-key" ? "k-test" : "" },
    });
    store.setData((data) => { data.memory = [{ id: "private", key: "miasto", value: "Kraków", createdAt: Date.now() }]; });
    const fetcher = cloudFetchOk();
    vi.stubGlobal("fetch", fetcher);

    await ensureIndexed();
    await prepareMemoryContext("W jakim mieście mieszkam?");
    expect(fetcher).not.toHaveBeenCalled();
    expect(memoryBlock()).toContain("Kraków");
    expect(store.data.memory[0].embedding).toBeUndefined();
  });

  it("does not send personal facts to cloud when a local embedder fails in on-device mode", async () => {
    store.setSettings({ onDeviceOnly: true, localEmbeddings: true, proxyUrl: "https://bff.example" });
    mockUsable.mockReturnValue(true);
    mockEmbedLocal.mockResolvedValue(null);
    store.setData((data) => { data.memory = [{ id: "private", key: "miasto", value: "Kraków", createdAt: Date.now() }]; });
    const fetcher = cloudFetchOk();
    vi.stubGlobal("fetch", fetcher);

    await ensureIndexed();
    expect(mockEmbedLocal).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.data.memory[0].value).toBe("Kraków");
  });

  it("preferuje on-device, gdy włączone i użyteczne (tag local)", async () => {
    store.setSettings({ localEmbeddings: true });
    mockUsable.mockReturnValue(true);
    mockEmbedLocal.mockResolvedValue([Array(384).fill(0.01)]);

    rememberFact("imię", "Marcin");
    await waitTag("imię");

    const f = store.data.memory.find((m) => m.key === "imię")!;
    expect(f.embModel).toBe("local:mml12");
    expect(f.embedding).toHaveLength(384);
    expect(mockEmbedLocal).toHaveBeenCalled();
  });

  it("spada do chmury, gdy lokalny zwróci null (tag cloud, wymiar 768)", async () => {
    store.setSettings({ localEmbeddings: true });
    mockUsable.mockReturnValue(true);
    mockEmbedLocal.mockResolvedValue(null); // lokal nieudany
    vi.stubGlobal("fetch", cloudFetchOk());

    rememberFact("auto", "Tesla");
    await waitTag("auto");

    const f = store.data.memory.find((m) => m.key === "auto")!;
    expect(f.embModel).toBe("cloud:gemini-004");
    expect(f.embedding).toHaveLength(768);
    vi.unstubAllGlobals();
  });

  it("używa chmury, gdy on-device wyłączone (nie woła lokalnego)", async () => {
    store.setSettings({ localEmbeddings: false });
    mockUsable.mockReturnValue(true); // użyteczne, ale wyłączone ustawieniem
    vi.stubGlobal("fetch", cloudFetchOk());

    rememberFact("miasto", "Kraków");
    await waitTag("miasto");

    const f = store.data.memory.find((m) => m.key === "miasto")!;
    expect(f.embModel).toBe("cloud:gemini-004");
    expect(mockEmbedLocal).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
