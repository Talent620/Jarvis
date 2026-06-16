import { describe, it, expect, beforeEach } from "vitest";
import { computeFitness } from "../src/lib/fitness";
import { store } from "../src/lib/store";

// Czysty „goły" stan: zero kluczy, zero integracji, wyłączone domyślnie-włączone tryby.
function resetAll() {
  store.setSettings({
    keys: { anthropic: "", gemini: "", groq: "", cerebras: "", mistral: "", openrouter: "", nvidia: "", github: "" },
    ollamaUrl: "", smtpUser: "", smtpPass: "", syncUrl: "", syncToken: "",
    tavilyApiKey: "", webSearch: false, falApiKey: "", studioKeys: "",
    n8nUrl: "", homeAssistantUrl: "", homeAssistantToken: "",
    elevenLabsApiKey: "", fishAudioApiKey: "",
    deepThink: false, councilMode: false, expertKnowledge: false,
    geminiTts: false, wakeWord: false, backgroundWake: false, speak: false,
    voiceLock: false, voiceProfile: [], salesAutopilot: false, autoProspect: false,
    proactiveAgent: false, dailyBriefing: false,
    profile: {} as never,
  });
}

beforeEach(resetAll);

describe("computeFitness — wagowany wskaźnik sprawności", () => {
  it("goły stan: niski procent i wyłączony mózg AI", () => {
    const r = computeFitness();
    expect(r.percent).toBeLessThan(15);
    expect(r.items.find((i) => i.id === "ai_brain")?.enabled).toBe(false);
    expect(r.level).toBe("Podstawowy");
  });

  it("gainPct wszystkich funkcji sumuje się do ~100%", () => {
    const r = computeFitness();
    const sum = r.items.reduce((a, i) => a + i.gainPct, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it("klucz AI to największy pojedynczy skok sprawności", () => {
    const base = computeFitness().percent;
    store.setSettings({ keys: { ...store.settings.keys, gemini: "AIza-test" } });
    const after = computeFitness();
    expect(after.percent).toBeGreaterThan(base);
    expect(after.items.find((i) => i.id === "ai_brain")?.enabled).toBe(true);
    // ai_brain ma najwyższą wagę — jego gainPct jest największy ze wszystkich.
    const gains = after.items.map((i) => i.gainPct);
    const brainGain = after.items.find((i) => i.id === "ai_brain")!.gainPct;
    expect(brainGain).toBe(Math.max(...gains));
  });

  it("drugi dostawca odblokowuje zapasowy mózg (failover)", () => {
    store.setSettings({ keys: { ...store.settings.keys, gemini: "AIza-x" } });
    expect(computeFitness().items.find((i) => i.id === "ai_backup")?.enabled).toBe(false);
    store.setSettings({ keys: { ...store.settings.keys, groq: "gsk_y" } });
    expect(computeFitness().items.find((i) => i.id === "ai_backup")?.enabled).toBe(true);
  });

  it("poczta liczy się dopiero, gdy są OBA pola (adres + hasło)", () => {
    store.setSettings({ smtpUser: "a@gmail.com", smtpPass: "" });
    expect(computeFitness().items.find((i) => i.id === "mail")?.enabled).toBe(false);
    store.setSettings({ smtpPass: "xxxxyyyyzzzz0000" });
    expect(computeFitness().items.find((i) => i.id === "mail")?.enabled).toBe(true);
  });

  it("backend odblokowuje sync + Gmail + Kalendarz jako jedną pozycję", () => {
    store.setSettings({ syncUrl: "https://b.example", syncToken: "tok" });
    expect(computeFitness().items.find((i) => i.id === "backend")?.enabled).toBe(true);
  });

  it("topMissing: brakujące posortowane wg największego zysku", () => {
    const r = computeFitness();
    expect(r.topMissing.length).toBeGreaterThan(0);
    for (let i = 1; i < r.topMissing.length; i++) {
      expect(r.topMissing[i - 1].weight).toBeGreaterThanOrEqual(r.topMissing[i].weight);
    }
    // ai_brain (waga 22) musi być na szczycie braków w gołym stanie.
    expect(r.topMissing[0].id).toBe("ai_brain");
  });

  it("kategorie sumują się i mają sensowne procenty", () => {
    const r = computeFitness();
    expect(r.categories.length).toBeGreaterThan(4);
    for (const c of r.categories) {
      expect(c.percent).toBeGreaterThanOrEqual(0);
      expect(c.percent).toBeLessThanOrEqual(100);
      expect(c.total).toBeGreaterThan(0);
    }
  });

  it("im więcej skonfigurowane, tym wyższy procent (monotonicznie)", () => {
    const p0 = computeFitness().percent;
    store.setSettings({ keys: { ...store.settings.keys, anthropic: "sk-ant-x" } });
    const p1 = computeFitness().percent;
    store.setSettings({ smtpUser: "a@b.pl", smtpPass: "haslohaslohaslo1" });
    const p2 = computeFitness().percent;
    store.setSettings({ tavilyApiKey: "tvly-x", webSearch: true });
    const p3 = computeFitness().percent;
    expect(p1).toBeGreaterThan(p0);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });
});
