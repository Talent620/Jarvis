// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  aiAgent, voiceAgent, imageAgent, performanceAgent, updateAgent, integrationAgent,
  runAgents, aggregateHealth, collectRecs, formatScanReport, type ScanContext,
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
    voices: over.voices ?? [{ name: "pl-pl-x-oda-network", lang: "pl-PL", quality: 400, network: true }],
    voicePinnedExists: over.voicePinnedExists ?? true,
    ttsErrors: over.ttsErrors ?? 0,
    providerErrors: over.providerErrors ?? 0,
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
  it("limity API + dostępny model lokalny → rekomendacja przełączenia na lokalny", () => {
    const r = aiAgent(ctx({ providerErrors: 5, ollama: { configured: true, ok: true, models: ["qwen3:4b"] } }));
    expect(r.recs.some((x) => x.key === "goLocal")).toBe(true);
  });
  it("limity API bez modelu lokalnego → porada o kluczach/Ollamie (bez auto-akcji)", () => {
    const r = aiAgent(ctx({ providerErrors: 5, ollama: { configured: false, ok: false, models: [] } }));
    expect(r.recs.some((x) => /klucze|limity/i.test(x.label))).toBe(true);
  });
});

describe("Voice Agent — Voice Guardian", () => {
  it("mowa wyłączona → ostrzeżenie + Napraw głos", () => {
    const r = voiceAgent(ctx({ s: { speak: false } as never }));
    expect(r.recs.some((x) => x.key === "fixVoice")).toBe(true);
  });
  it("stały głos (voicePinned) z istniejącym głosem → ok", () => {
    const r = voiceAgent(ctx({ s: { speak: true, voiceSystemPl: true, voicePinned: true, voiceName: "pl-pl-x-oda-network" } as never }));
    expect(r.state).toBe("ok");
    expect(r.summary).toMatch(/Stały głos/);
  });
  it("przypięty głos zniknął → problem + rekomendacja przypnij najlepszy", () => {
    const r = voiceAgent(ctx({ s: { speak: true, voiceName: "pl-pl-x-stary" } as never, voicePinnedExists: false }));
    expect(r.state).toBe("problem");
    expect(r.recs.some((x) => x.key === "pinVoice")).toBe(true);
  });
  it("głos nieprzypięty (Auto) → ostrzeżenie + zaproponuj przypięcie", () => {
    const r = voiceAgent(ctx({ s: { speak: true, voiceName: "", voiceSystemPl: true } as never }));
    expect(r.recs.some((x) => x.key === "pinVoice")).toBe(true);
  });
  it("błędy TTS w sesji są raportowane", () => {
    const r = voiceAgent(ctx({ s: { speak: true, voiceName: "pl-pl-x-oda-network" } as never, ttsErrors: 4 }));
    expect(r.findings.some((f) => /błędy/i.test(f.text))).toBe(true);
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
  it("tryb mądry (wolny) → rekomendacja Szybciej z pełnym opisem (problem/przyczyna/wpływ)", () => {
    const r = performanceAgent(ctx({ s: { ollamaNoThink: false } as never }));
    const fast = r.recs.find((x) => x.key === "faster");
    expect(fast).toBeTruthy();
    expect(fast!.problem && fast!.cause && fast!.impact).toBeTruthy();
  });
  it("daje rekomendacje jakości/swobody/zasobów wg stanu", () => {
    const r = performanceAgent(ctx({ s: { ollamaNoThink: true, unfilteredLocal: false, localRefine: true } as never, ollama: { configured: true, ok: true, models: ["gemma3:4b"] } }));
    const labels = r.recs.map((x) => x.label).join(" ");
    expect(labels).toMatch(/swobodne|zasoby|jakość/i);
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
  it("formatScanReport zawiera wynik, agentów i zalecenia", () => {
    const reports = runAgents(ctx({ ollama: { configured: false, ok: false, models: [] }, cloudProviders: [], s: { provider: "auto" } as never }));
    const txt = formatScanReport({ reports, health: aggregateHealth(reports), recs: collectRecs(reports) });
    expect(txt).toMatch(/Raport Strażnika/);
    expect(txt).toMatch(/Stan ogólny: \d+\/100/);
    expect(txt).toMatch(/Inteligencja \(AI\)/);
    expect(txt).toMatch(/Zalecenia:/);
  });
});
