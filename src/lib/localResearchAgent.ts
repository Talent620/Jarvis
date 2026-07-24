import { store } from "./store";
import { tavilySearch, type SearchHit } from "./research";
import { PROVIDERS } from "./providers/registry";

export interface ResearchAgentResult {
  report: string;
  sources: SearchHit[];
  model: string;
}

export interface HardwareSnapshot {
  platform: string;
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string;
  vramGb: number;
}

export interface LocalAgentRecommendation {
  model: string;
  context: number;
  tier: "light" | "balanced" | "strong";
  reason: string;
}

/** Dobór zachowawczy: model i jego KV cache muszą zostawić zapas dla systemu i interfejsu. */
export function recommendLocalResearchAgent(hw: HardwareSnapshot): LocalAgentRecommendation {
  const knownFourGb = /1050\s*ti|1650|rx\s*570|rx\s*580/i.test(hw.gpu);
  const vram = hw.vramGb || (knownFourGb ? 4 : 0);
  if (vram >= 8 && hw.ramGb >= 24) {
    return { model: "qwen3.5:9b", context: 8192, tier: "strong", reason: "8+ GB VRAM i 24+ GB RAM: większy model agentowy z bezpiecznym kontekstem 8K." };
  }
  if ((vram >= 3.5 || knownFourGb) && hw.ramGb >= 12) {
    return { model: "qwen3.5:4b", context: 4096, tier: "balanced", reason: "Najlepszy balans dla 4 GB VRAM: narzędzia, język polski i research bez ciężkiego przelewania na CPU." };
  }
  return { model: "qwen3:1.7b", context: 4096, tier: "light", reason: "Lekki model utrzymuje płynną pracę przy małej pamięci GPU lub RAM." };
}

export async function runLocalResearchAgent(query: string): Promise<ResearchAgentResult> {
  const q = query.trim();
  if (!q) throw new Error("Podaj temat researchu.");
  if (!store.settings.ollamaUrl?.trim()) throw new Error("Najpierw połącz lokalną Ollamę w Ustawienia → AI.");
  const sources = await tavilySearch(q, { maxResults: 8, depth: "advanced" });
  if (!sources.length) throw new Error("Brak źródeł. Dodaj klucz Tavily lub skonfiguruj backend wyszukiwania w Ustawienia → Research.");

  const model = store.settings.ollamaModelComplex?.trim() || "qwen3.5:4b";
  const evidence = sources.map((hit, index) =>
    `[${index + 1}] ${hit.title}\n${hit.content.slice(0, 1200)}\n${hit.url}`,
  ).join("\n\n");
  const reply = await PROVIDERS.ollama.impl({
    apiKey: "local",
    model,
    proxyUrl: undefined,
    webSearch: false,
    tools: [],
    system: [
      "Jesteś lokalnym agentem researchowym JARVISA.",
      "Odpowiadaj po polsku, konkretnie i tylko na podstawie dostarczonych źródeł.",
      "Oddziel fakty od wniosków. Każde ważne twierdzenie oznacz numerem źródła [1], [2].",
      "Na końcu dodaj: Wniosek, Ryzyka/niepewności oraz Źródła z pełnymi URL.",
      "Nie wymyślaj danych ani linków. Gdy źródła są sprzeczne, pokaż sprzeczność.",
    ].join(" "),
    history: [{ role: "user", content: `Temat: ${q}\n\nMateriały źródłowe:\n${evidence}` }],
  });
  return { report: reply.text.trim(), sources, model };
}
