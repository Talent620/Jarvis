// Realne wyszukiwanie w sieci (Tavily) — wspólny silnik dla Łowcy Okazji i innych funkcji,
// które potrzebują PRAWDZIWYCH wyników (nie zmyślonych przez model). Czyste funkcje pomocnicze
// (grounding) są testowalne; samo zapytanie sieciowe jest cienkie i odporne na błędy.
import { store } from "./store";
import { fetchTimeout } from "./http";

export interface SearchHit { title: string; url: string; content: string }

/** Czy mamy realne wyszukiwanie w sieci (klucz Tavily)? */
export function hasWebSearch(): boolean {
  return !!store.settings.tavilyApiKey?.trim();
}

/** Realne wyszukiwanie przez Tavily → lista trafień (tytuł, URL, treść). Pusta lista przy braku klucza/błędzie. */
export async function tavilySearch(query: string, opts: { maxResults?: number; depth?: "basic" | "advanced" } = {}): Promise<SearchHit[]> {
  const key = store.settings.tavilyApiKey?.trim();
  if (!key || !query.trim()) return [];
  try {
    const res = await fetchTimeout(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: opts.maxResults ?? 8, include_answer: false, search_depth: opts.depth ?? "advanced" }),
      },
      12000,
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !Array.isArray(data.results)) return [];
    return data.results
      .map((r: { title?: string; url?: string; content?: string }) => ({ title: String(r.title || r.url || ""), url: String(r.url || ""), content: String(r.content || "") }))
      .filter((h: SearchHit) => /^https?:\/\//i.test(h.url));
  } catch {
    return [];
  }
}

/** Pure: blok „REALNE WYNIKI" do wstrzyknięcia w prompt, by model wyłuskał oferty z prawdziwych danych. */
export function groundingBlock(hits: SearchHit[], max = 10): string {
  if (!hits.length) return "";
  const lines = hits.slice(0, max).map((h, i) => `[${i + 1}] ${h.title}\n${h.content.slice(0, 280)}\n${h.url}`);
  return "\n\nREALNE WYNIKI WYSZUKIWANIA (korzystaj z tych danych i URLi — NIE wymyślaj linków ani cen):\n" + lines.join("\n\n");
}
