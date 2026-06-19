// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock warstwy STT on-device — sterujemy nią w testach.
vi.mock("../src/lib/localWhisper", () => ({
  transcribeLocal: vi.fn(),
  localSttUsable: vi.fn(() => false),
}));

import { transcribeLocal, localSttUsable } from "../src/lib/localWhisper";
import { transcribeAudio } from "../src/lib/transcribe";
import { store } from "../src/lib/store";

const mockLocal = transcribeLocal as unknown as ReturnType<typeof vi.fn>;
const mockUsable = localSttUsable as unknown as ReturnType<typeof vi.fn>;

const fakeBlob = () => new Blob(["audio"], { type: "audio/webm" });

beforeEach(() => {
  mockLocal.mockReset();
  mockUsable.mockReset();
  mockUsable.mockReturnValue(false);
  store.setSettings({ localStt: false, keys: { ...store.settings.keys, groq: "gsk_test" } });
});

describe("transcribeAudio — preferencja on-device + fallback do Groq", () => {
  it("używa on-device, gdy włączone i użyteczne (bez chmury)", async () => {
    store.setSettings({ localStt: true });
    mockUsable.mockReturnValue(true);
    mockLocal.mockResolvedValue("transkrypcja lokalna");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await transcribeAudio(fakeBlob(), "pl");
    expect(r).toEqual({ text: "transkrypcja lokalna" });
    expect(fetchSpy).not.toHaveBeenCalled(); // nie dotykamy chmury
    vi.unstubAllGlobals();
  });

  it("gdy on-device zwróci null → fallback do Groq", async () => {
    store.setSettings({ localStt: true });
    mockUsable.mockReturnValue(true);
    mockLocal.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "z Groq" }) })));

    const r = await transcribeAudio(fakeBlob(), "pl");
    expect(r).toEqual({ text: "z Groq" });
    vi.unstubAllGlobals();
  });

  it("gdy on-device wyłączone → od razu Groq (bez wołania lokalnego)", async () => {
    store.setSettings({ localStt: false });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "z Groq" }) })));

    const r = await transcribeAudio(fakeBlob(), "pl");
    expect(r).toEqual({ text: "z Groq" });
    expect(mockLocal).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
