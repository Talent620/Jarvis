// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock lokalnego embeddera — sterujemy nim w testach.
vi.mock("../src/lib/localEmbed", () => ({
  embedLocal: vi.fn(),
  localEmbedUsable: vi.fn(() => false),
  LOCAL_EMBED_TAG: "local:mml12",
}));

import { embedLocal, localEmbedUsable } from "../src/lib/localEmbed";
import { rememberFact } from "../src/lib/memory";
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
  store.setSettings({ keys: { ...store.settings.keys, gemini: "k-test" }, localEmbeddings: false, proxyUrl: "" });
  mockEmbedLocal.mockReset();
  mockUsable.mockReset();
  mockUsable.mockReturnValue(false);
});

describe("memory — embeddingi on-device z fallbackiem do chmury", () => {
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
