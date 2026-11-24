import { describe, it, expect } from "vitest";
import {
  PROFILES, PROFILE_LIST, VISION_ROUTABLE, FREE_TIER_PROVIDERS, FREE_RECOMMENDED, isKeylessProvider,
  providerCandidatesByPrefix, costClassOf, budgetPriceFor, CONSERVATIVE_PRICE, MODEL_PRICING, modelHasVisionHeuristic,
} from "../src/lib/autocore/catalog";
import { PROVIDERS, PROVIDER_LIST, detectProvider, emptyKeys } from "../src/lib/providers/registry";
import { FREE_PROVIDERS } from "../src/lib/freeMode";
import { FREE_RANK } from "../src/lib/brainAdvisor";
import { DEFAULT_PRICING } from "../src/lib/usageTelemetry";
import { tierOf, GROQ_SCOUT, GROQ_KIMI } from "../src/lib/modelRouter";

describe("AUTOCORE katalog — jedno źródło prawdy", () => {
  it("każdy dostawca z registry ma profil i odwrotnie (brak konkurencyjnych list)", () => {
    expect(PROFILE_LIST.map((p) => p.id).sort()).toEqual(PROVIDER_LIST.map((p) => p.id).sort());
    expect(Object.keys(emptyKeys).sort()).toEqual(PROVIDER_LIST.map((p) => p.id).sort());
  });

  it("modele per zadanie istnieją w katalogu modeli dostawcy (albo null = domyślny)", () => {
    for (const p of PROFILE_LIST) {
      if (p.id === "ollama") continue; // Ollama: modele wykrywane z /api/tags, katalog to podpowiedzi
      const ids = new Set(PROVIDERS[p.id].models.map((m) => m.id));
      for (const m of Object.values(p.taskModels)) if (m) expect(ids.has(m), `${p.id}:${m}`).toBe(true);
    }
  });

  it("zachowuje dotychczasowe zbiory: wizja, darmowe, bez klucza, tier", () => {
    expect([...VISION_ROUTABLE].sort()).toEqual(["anthropic", "gemini", "github", "mistral", "openrouter"]);
    expect([...FREE_TIER_PROVIDERS].sort()).toEqual(
      ["cerebras", "cohere", "gemini", "groq", "mistral", "modal", "nvidia", "ollama", "openrouter", "webllm"],
    );
    expect(FREE_PROVIDERS).toBe(FREE_TIER_PROVIDERS);
    expect(PROFILE_LIST.filter((p) => isKeylessProvider(p.id)).map((p) => p.id).sort()).toEqual(["ollama", "webllm"]);
    expect(tierOf("ollama")).toBe("reflex");
    expect(tierOf("gemini")).toBe("cortex");
    expect(GROQ_SCOUT).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
    expect(GROQ_KIMI).toBe("moonshotai/kimi-k2-instruct");
  });

  it("doradca darmowy (FREE_RANK) jest spójny z katalogiem: ta sama kolejność, tylko darmowi, modele istnieją", () => {
    expect(FREE_RANK.map((r) => r.id)).toEqual(FREE_RECOMMENDED);
    for (const r of FREE_RANK) {
      expect(FREE_TIER_PROVIDERS.has(r.id)).toBe(true);
      expect(PROVIDERS[r.id].models.some((m) => m.id === r.model), r.model).toBe(true);
    }
  });

  it("detectProvider zachowuje dotychczasowe prefiksy", () => {
    const cases: [string, string | null][] = [
      ["jvllm_x", "modal"], ["modal_vllm_x", "modal"], ["sk-ant-x", "anthropic"], ["sk-or-v1-x", "openrouter"],
      ["csk-x", "cerebras"], ["gsk_x", "groq"], ["nvapi-x", "nvidia"], ["AIzaX", "gemini"],
      ["ghp_x", "github"], ["gho_x", "github"], ["ghs_x", "github"], ["ghr_x", "github"], ["ghu_x", "github"],
      ["github_pat_x", "github"], ["ghx_x", null], ["", null], ["random", null],
    ];
    for (const [k, want] of cases) expect(detectProvider(k), k).toBe(want);
    expect(providerCandidatesByPrefix("  gsk_abc ")).toEqual(["groq"]);
  });

  it("cennik ma jedno źródło", () => {
    expect(DEFAULT_PRICING).toBe(MODEL_PRICING);
  });
});

describe("AUTOCORE klasy kosztu i wycena do budżetu", () => {
  it("lokalni = local; OpenRouter bez :free = paid; :free bez weryfikacji = freemium; zweryfikowany = free", () => {
    expect(costClassOf("ollama", "x")).toBe("local");
    expect(costClassOf("openrouter", "meta-llama/llama-3.1-405b-instruct")).toBe("paid");
    expect(costClassOf("openrouter", "meta-llama/llama-3.3-70b-instruct:free")).toBe("freemium");
    expect(costClassOf("openrouter", "x:free", () => true)).toBe("free");
    expect(costClassOf("modal", PROVIDERS.modal.defaultModel)).toBe("credit");
    expect(costClassOf("anthropic", "claude-haiku-4-5")).toBe("paid");
  });
  it("płatny model bez cennika NIE jest wyceniany na 0 (ostrożny szacunek)", () => {
    const r = budgetPriceFor("anthropic", "claude-nieznany-9");
    expect(r.price).toEqual(CONSERVATIVE_PRICE);
    expect(r.estimated).toBe(true);
    expect(budgetPriceFor("openrouter", "some/paid-model").price).toEqual(CONSERVATIVE_PRICE);
  });
  it("znany cennik i nadpisania wygrywają; lokalny = 0 dokładnie", () => {
    expect(budgetPriceFor("anthropic", "claude-haiku-4-5")).toEqual({ price: { in: 1, out: 5 }, estimated: false });
    expect(budgetPriceFor("anthropic", "claude-haiku-4-5", { "claude-haiku-4-5": { in: 2, out: 2 } }).price).toEqual({ in: 2, out: 2 });
    expect(budgetPriceFor("ollama", "qwen3:1.7b")).toEqual({ price: { in: 0, out: 0 }, estimated: false });
  });
  it("heurystyka wizji z nazwy modelu", () => {
    expect(modelHasVisionHeuristic("pixtral-12b-2409")).toBe(true);
    expect(modelHasVisionHeuristic("gemma3:4b-it-qat")).toBe(true);
    expect(modelHasVisionHeuristic("llama-3.3-70b")).toBe(false);
    expect(PROFILES.modal.discovery?.wakesPaidCompute).toBe(true);
  });
});
