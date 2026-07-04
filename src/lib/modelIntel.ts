// === Poziom inteligencji modeli (IQ%) — orientacyjna ocena na bazie wiedzy do I 2026 ===
// 100% = najlepszy znany światu agent/API (czołówka frontier). To NIE jest oficjalny,
// zmierzony jednym testem wskaźnik — żaden taki nie istnieje. To zgrubne, uczciwe
// pozycjonowanie względem siebie (rozumowanie + agentyka + kod + wiedza), żeby od razu
// było widać „czego używam i ile to warte". Dla każdego: opis oficjalny + potoczny.

export interface ModelIntel {
  iq: number; // 0–100 (100 = światowa czołówka)
  official: string; // krótko, rzeczowo
  casual: string; // krótko, po ludzku
}

// Dokładne wpisy dla modeli z katalogu (registry). Klucz = id modelu.
const EXACT: Record<string, ModelIntel> = {
  // Anthropic
  "claude-opus-4-8": { iq: 99, official: "Frontier: szczyt rozumowania, agentyki i kodu; czołówka światowych benchmarków.", casual: "Najmądrzejszy z całej stawki. Bierz, gdy zależy Ci na jakości." },
  "claude-sonnet-4-6": { iq: 94, official: "Bardzo mocny model ogólny — świetny stosunek jakości do szybkości.", casual: "Prawie tak bystry jak Opus, a szybszy. Złoty środek." },
  "claude-haiku-4-5": { iq: 86, official: "Lekki, niskolatencyjny; mocny jak na swoją klasę szybkości.", casual: "Błyskawiczny pomocnik do prostszych rzeczy." },
  // Google Gemini
  "gemini-2.5-pro": { iq: 96, official: "Frontier Google: długi kontekst, mocne rozumowanie i multimodalność.", casual: "Najmocniejszy Gemini. Świetny do trudnych, długich zadań." },
  "gemini-2.5-flash": { iq: 88, official: "Czołówka tool-callingu, szybki, hojny darmowy limit.", casual: "Najlepszy za darmo: szybki i dobrze odpala narzędzia." },
  "gemini-2.5-flash-lite": { iq: 80, official: "Najszybszy wariant Flash; do lekkich, masowych zadań.", casual: "Turbo-szybki do prostych rzeczy." },
  "gemini-2.0-flash": { iq: 82, official: "Solidny, szybki multimodalny model poprzedniej generacji.", casual: "Pewny i szybki, dobry do codziennych zadań." },
  // Groq (modele open na błyskawicznym hoście)
  "moonshotai/kimi-k2-instruct": { iq: 87, official: "Mocne rozumowanie i kod (MoE); czołówka modeli otwartych.", casual: "Bardzo bystry open-source. Dobry do kodu i analiz." },
  "meta-llama/llama-4-scout-17b-16e-instruct": { iq: 81, official: "Multimodalny Llama 4 (MoE), szybki, długi kontekst.", casual: "Nowy Llama — szybki i widzi obrazy." },
  "openai/gpt-oss-120b": { iq: 85, official: "Otwarty model dużej skali; mocne ogólne zdolności.", casual: "Duży otwarty model — solidny do wszystkiego." },
  "llama-3.3-70b-versatile": { iq: 78, official: "Dojrzały Llama 70B; równy, wszechstronny.", casual: "Sprawdzony 70B. Pewniak za darmo." },
  "llama-3.1-8b-instant": { iq: 62, official: "Mały, bardzo szybki; do prostych zadań.", casual: "Malutki i szybki — do łatwizny." },
  "qwen/qwen3-32b": { iq: 80, official: "Qwen3 — mocne rozumowanie i wielojęzyczność.", casual: "Dobry, wszechstronny model open." },
  // OpenRouter (wybrane)
  "deepseek/deepseek-chat-v3-0324:free": { iq: 88, official: "DeepSeek V3 — czołówka modeli otwartych w rozumowaniu i kodzie.", casual: "Bardzo mocny i darmowy. Świetny do kodu." },
  "meta-llama/llama-3.1-405b-instruct": { iq: 86, official: "Największy Llama 3.1; mocne zdolności ogólne.", casual: "Gigant Llama — dużo wiedzy i rozumu." },
  "qwen/qwen-2.5-72b-instruct:free": { iq: 82, official: "Qwen 2.5 72B — silny wielojęzyczny model.", casual: "Solidny darmowy 72B." },
  "cognitivecomputations/dolphin3.0-mistral-24b:free": { iq: 71, official: "Dostrojony Mistral 24B bez filtrów treści.", casual: "Otwarty, bez cenzury. Średnia półka." },
  // Mistral
  "mistral-large-latest": { iq: 85, official: "Flagowiec Mistral; mocne rozumowanie, wielojęzyczność.", casual: "Najmocniejszy Mistral. Europejska czołówka." },
  "mistral-small-latest": { iq: 74, official: "Lekki, tani, szybki; do codziennych zadań.", casual: "Zwinny i darmowy. Do bieżączki." },
  "pixtral-12b-2409": { iq: 70, official: "Multimodalny (wizja) model Mistral 12B.", casual: "Widzi obrazy. Lekki." },
  // Cohere
  "command-a-03-2025": { iq: 84, official: "Najmocniejszy Command; nastawiony na agentów i RAG.", casual: "Topowy Cohere. Mocny w narzędziach i firmie." },
  "command-r-plus-08-2024": { iq: 80, official: "Mocny model RAG/tool-use klasy korporacyjnej.", casual: "Dobry do wyszukiwania i narzędzi." },
};

// Dopasowanie zgrubne po nazwie, gdy modelu nie ma w EXACT (np. lokalne/Ollama/nowe).
function fuzzy(model: string): ModelIntel {
  const m = model.toLowerCase();
  const mk = (iq: number, official: string, casual: string): ModelIntel => ({ iq, official, casual });
  if (/opus/.test(m)) return mk(98, "Frontier — najwyższa półka rozumowania.", "Najmądrzejszy.");
  if (/sonnet/.test(m)) return mk(93, "Bardzo mocny ogólny model.", "Bystry i szybki.");
  if (/haiku/.test(m)) return mk(85, "Lekki i szybki, mocny w swojej klasie.", "Szybki pomocnik.");
  if (/gemini.*pro/.test(m)) return mk(95, "Frontier Google.", "Najmocniejszy Gemini.");
  if (/gemini/.test(m)) return mk(85, "Szybki multimodalny model Google.", "Szybki Gemini.");
  if (/deepseek/.test(m)) return mk(87, "Czołówka modeli otwartych.", "Mocny, świetny do kodu.");
  if (/kimi|k2/.test(m)) return mk(86, "Mocne rozumowanie i kod.", "Bardzo bystry open.");
  if (/405b/.test(m)) return mk(86, "Bardzo duży model — szeroka wiedza.", "Gigant.");
  if (/70b|72b/.test(m)) return mk(78, "Dojrzały model dużej klasy.", "Solidny pewniak.");
  if (/gpt-oss|120b/.test(m)) return mk(84, "Duży otwarty model ogólny.", "Mocny open.");
  if (/qwen/.test(m)) return mk(79, "Wielojęzyczny model z mocnym rozumowaniem.", "Wszechstronny open.");
  if (/mistral|mixtral|nemo/.test(m)) return mk(73, "Sprawny europejski model.", "Zwinny.");
  if (/command|cohere/.test(m)) return mk(80, "Model nastawiony na agentów i RAG.", "Dobry w narzędziach.");
  if (/dolphin|uncensored|abliterated/.test(m)) return mk(70, "Otwarty model bez filtrów treści.", "Bez cenzury, średnia półka.");
  if (/llama/.test(m)) return mk(72, "Otwarty model Meta.", "Solidny open-source.");
  if (/(^|\D)(1\.5|2|3|4)b(\D|$)/.test(m) || /mini|tiny|small/.test(m)) return mk(60, "Mały, szybki model.", "Lekki — do prostych rzeczy.");
  return mk(70, "Model ogólnego przeznaczenia.", "Da radę w większości zadań.");
}

/** Ocena modelu (zawsze coś zwróci — z dokładnej tabeli albo zgrubnie po nazwie). */
export function intelForModel(model: string): ModelIntel {
  if (!model || model === "auto") return { iq: 0, official: "", casual: "" };
  return EXACT[model] ?? fuzzy(model);
}

/** Kolor „dymka" wg poziomu: wysokie = zielone, średnie = cyjan, niskie = bursztyn. */
export function intelColor(iq: number): string {
  if (iq >= 90) return "#2fbf71"; // zielony — światowa czołówka
  if (iq >= 78) return "#28c0c8"; // cyjan — mocny
  if (iq >= 65) return "#d8a93a"; // bursztyn — przyzwoity
  return "#c77b54"; // łagodny pomarańcz — podstawowy
}
