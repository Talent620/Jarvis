// Realne wyszukiwanie w sieci (Tavily) — wspólny silnik dla Łowcy Okazji i innych funkcji,
// które potrzebują PRAWDZIWYCH wyników (nie zmyślonych przez model). Czyste funkcje pomocnicze
// (grounding) są testowalne; samo zapytanie sieciowe jest cienkie i odporne na błędy.
import { store } from "./store";
import { fetchTimeout, appTokenHeader } from "./http";

export interface SearchHit { title: string; url: string; content: string }

/** Czy mamy realne wyszukiwanie w sieci? Klucz Tavily LUB skonfigurowany BFF (klucz po stronie serwera). */
export function hasWebSearch(): boolean {
  return !!(store.settings.tavilyApiKey?.trim() || store.settings.proxyUrl?.trim());
}

/** Pure: znormalizuj wyniki Tavily do trafień (tytuł/URL/treść), tylko http(s), bez duplikatów URL. */
function mapResults(arr: unknown): SearchHit[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of arr as { title?: string; url?: string; content?: string }[]) {
    const url = String(r?.url || "");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue; // odsiej nie-http i powtórki domen/URLi
    seen.add(url);
    out.push({ title: String(r?.title || url), url, content: String(r?.content || "") });
  }
  return out;
}

/**
 * Realne wyszukiwanie → lista trafień. Najpierw przez BFF (`/v1/search`) gdy jest proxy: to działa na
 * telefonie/web (api.tavily.com bywa blokowane CORS-em) i pozwala trzymać klucz po stronie serwera.
 * Gdy proxy nie ma albo zwróci pusto — wywołanie bezpośrednie kluczem użytkownika (desktop/Electron).
 * Pusta lista przy braku konfiguracji/błędzie (graceful).
 */
export async function tavilySearch(query: string, opts: { maxResults?: number; depth?: "basic" | "advanced" } = {}): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const s = store.settings;
  const max = opts.maxResults ?? 8;
  const proxy = s.proxyUrl?.trim();
  // 1) Przez BFF — bez problemów z CORS, klucz Tavily po stronie serwera (env TAVILY_API_KEY).
  if (proxy) {
    try {
      const res = await fetchTimeout(
        `${proxy.replace(/\/$/, "")}/v1/search`,
        { method: "POST", headers: { "content-type": "application/json", ...appTokenHeader() }, body: JSON.stringify({ query, max_results: max }) },
        12000,
      );
      const data = await res.json().catch(() => null);
      const hits = mapResults(data?.results);
      if (hits.length) return hits;
    } catch {
      /* spróbuj bezpośrednio niżej */
    }
  }
  // 2) Bezpośrednio do Tavily kluczem użytkownika (np. desktop/Electron — bez ograniczeń CORS).
  const key = s.tavilyApiKey?.trim();
  if (!key) return [];
  try {
    const res = await fetchTimeout(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: max, include_answer: false, search_depth: opts.depth ?? "advanced" }),
      },
      12000,
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return [];
    return mapResults(data.results);
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
