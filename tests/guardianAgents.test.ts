// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  aiAgent, voiceAgent, imageAgent, performanceAgent, updateAgent, integrationAgent,
  runAgents, aggregateHealth, collectRecs, type ScanContext,
} from "../src/lib/guardianAgents";
import { store } from "../src/lib/store";

function ctx(over: Partial<ScanContext> = {}): ScanContext {
  return {
    s: { ...store.settings, ...(over.s || {}) },
    ollama: { configured: true, ok: true, models: ["qwen3:4b", "gemma3:4b"], ...(over.ollama || {}) },
    sd: { configured: false, ok: false, models: [], ...(over.sd || {}) },
    reliability: { total: 0, errors: 0, warns: 0, byScope: {}, ...(over.reliability || {}) },
    update: over.update ?? null,
    cloudProviders: over.cloudProviders ?? ["gemini"],
  };
}

describe("AI Agent", () => {
  it("brak mózgu → problem + rekomendacja Napraw wszystko", () => {
    const r = aiAgent(ctx({ ollama: { configured: false, ok: false, models: [] }, cloudProviders: [] , s: { provider: "auto" } as never }));
    expect(r.state).toBe("problem");
    expect(r.recs.some((x) => x.key === "fixAll")).toBe(true);
    expect(r.score).toBeLessThan(60);
  });
  it("Ollama bez modelu reasoning → ostrzeżenie + rekomendacja Mądrzej", () => {
    const r = aiAgent(ctx({ ollama: { configured: true, ok: true, models: ["gemma3:4b"] } }));
    expect(r.findings.some((f) => /reasoning/i.test(f.text))).toBe(true);
    expect(r.recs.some((x) => x.key === "smarter")).toBe(true);
  });
  it("Ollama z qwen3 (reasoning) → brak ostrzeżenia o reasoning", () => {
    const r = aiAgent(ctx({ ollama: { configured: true, ok: true, models: ["qwen3:4b"] } }));
    expect(r.findings.some((f) => /reasoning/i.test(f.text))).toBe(false);
  });
});

describe("Voice Agent", () => {
  it("mowa wyłączona → ostrzeżenie + Napraw głos", () => {
    const r = voiceAgent(ctx({ s: { speak: false } as never }));
    expect(r.recs.some((x) => x.key === "fixVoice")).toBe(true);
  });
  it("mowa + polski systemowy → ok", () => {
    const r = voiceAgent(ctx({ s: { speak: true, voiceSystemPl: true, voiceName: "pl-pl-x-oda-network" } as never }));
    expect(r.state).toBe("ok");
  });
});

describe("Image Agent", () => {
  it("nieskonfigurowane → off, ale nie obniża zdrowia", () => {
    const r = imageAgent(ctx({ sd: { configured: false, ok: false, models: [] } }));
    expect(r.state).toBe("off");
    expect(r.score).toBe(100);
  });
  it("serwer nieosiągalny → ostrzeżenie", () => {
    const r = imageAgent(ctx({ sd: { configured: true, ok: false, models: [] } }));
    expect(r.state).toBe("warn");
  });
});

describe("Performance Agent", () => {
  it("tryb mądry (wolny) → rekomendacja Szybciej", () => {
    const r = performanceAgent(ctx({ s: { ollamaNoThink: false } as never }));
    expect(r.recs.some((x) => x.key === "faster")).toBe(true);
  });
  it("niska skuteczność operacji obniża wynik", () => {
    const r = performanceAgent(ctx({ reliability: { total: 10, errors: 4, warns: 0, byScope: {}, successRate: 0.5, latencyP50: 400, latencyP95: 1200 } }));
    expect(r.score).toBeLessThan(100);
  });
});

describe("Update Agent", () => {
  it("nowsza wersja → rekomendacja Aktualizuj", () => {
    const r = updateAgent(ctx({ update: { current: "2026-01-01", latest: "2026-06-01", newer: true } }));
    expect(r.recs.some((x) => x.key === "update")).toBe(true);
  });
  it("aktualne → ok", () => {
    const r = updateAgent(ctx({ update: { current: "2026-06-01", latest: "2026-06-01", newer: false } }));
    expect(r.state).toBe("ok");
  });
});

describe("Guardian Core — agregacja", () => {
  it("zdrowy system → wysoki wynik (A)", () => {
    const reports = runAgents(ctx({ s: { speak: true, voiceSystemPl: true, voiceName: "x", ollamaNoThink: true } as never }));
    const h = aggregateHealth(reports);
    expect(h.score).toBeGreaterThanOrEqual(80);
    expect(["A", "B"]).toContain(h.grade);
  });
  it("brak mózgu mocno obniża zdrowie", () => {
    const reports = runAgents(ctx({ ollama: { configured: false, ok: false, models: [] }, cloudProviders: [], s: { provider: "auto" } as never }));
    const h = aggregateHealth(reports);
    expect(h.score).toBeLessThan(80);
  });
  it("collectRecs deduplikuje i stawia problemy na początku", () => {
    const reports = runAgents(ctx({ ollama: { configured: false, ok: false, models: [] }, cloudProviders: [], s: { provider: "auto", speak: false } as never }));
    const recs = collectRecs(reports);
    const keys = recs.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.filter(Boolean).length); // bez duplikatów kluczy
    expect(recs[0].key).toBe("fixAll"); // problem AI najwyżej
  });
});
