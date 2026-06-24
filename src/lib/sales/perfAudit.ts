// === Audyt wydajności strony (Google PageSpeed Insights przez BFF) ===
// To ma być GŁÓWNY argument sprzedażowy: twarde, mierzalne fakty o szybkości i jakości strony
// leada, przełożone na język biznesu („wolniej = mniej zapytań"). Pobranie przez BFF (klucz po
// stronie serwera, bez CORS); formatowanie argumentu jest CZYSTE i testowalne.
import { fetchTimeout, appTokenHeader } from "../http";
import { store } from "../store";

export interface Vitals {
  strategy?: string;
  finalUrl?: string;
  scores: { performance: number | null; accessibility: number | null; seo: number | null; bestPractices: number | null };
  lab: { lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null; ttfbMs: number | null };
  field: { lcpMs: number | null; cls: number | null; inpMs: number | null };
}

export interface PerfResult { ok: boolean; vitals?: Vitals; error?: string }

const sec = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");

/** Pobierz metryki wydajności przez BFF. Wymaga skonfigurowanego proxy (PageSpeed serwerowo). */
export async function runPerfAudit(rawUrl: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PerfResult> {
  const proxy = store.settings.proxyUrl?.trim();
  if (!proxy) return { ok: false, error: "Audyt wydajności wymaga skonfigurowanego serwera (BFF) w ⚙ → Sieć." };
  const url = (rawUrl || "").trim();
  if (!url) return { ok: false, error: "Pusty URL." };
  try {
    const r = await fetchTimeout(
      `${proxy.replace(/\/$/, "")}/v1/pagespeed`,
      { method: "POST", headers: { "content-type": "application/json", ...appTokenHeader() }, body: JSON.stringify({ url, strategy }) },
      35000,
    );
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || d.ok === false) return { ok: false, error: (d && d.error) || `PageSpeed HTTP ${r.status}` };
    return { ok: true, vitals: { strategy: d.strategy, finalUrl: d.finalUrl, scores: d.scores, lab: d.lab, field: d.field } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pure: lista twardych argumentów sprzedażowych z metryk (max 5, język korzyści). */
export function perfArgument(v: Vitals): string[] {
  const out: string[] = [];
  const perf = v.scores.performance;
  const lcp = v.field.lcpMs ?? v.lab.lcpMs; // realni użytkownicy (CrUX) > laboratorium
  const cls = v.lab.cls; // surowy wskaźnik 0–1 (pole CrUX jest skalowane ×100)
  const inp = v.field.inpMs;
  const ttfb = v.lab.ttfbMs;

  if (perf != null && perf < 50) out.push(`Wynik wydajności tylko ${perf}/100 — Google spycha wolne strony niżej, więc klienci trafiają do konkurencji.`);
  else if (perf != null && perf < 80) out.push(`Wydajność ${perf}/100 — jest sporo do poprawy; szybsza strona to wyższa pozycja i więcej wejść.`);
  if (lcp != null && lcp > 2500) out.push(`Główna treść pokazuje się dopiero po ${sec(lcp)} s (dobry wynik to poniżej 2,5 s) — każda sekunda opóźnienia to ok. 7% mniej zapytań.`);
  if (cls != null && cls > 0.1) out.push(`Strona „skacze" podczas ładowania (CLS ${cls.toFixed(2)}) — przyciski uciekają spod palca, co irytuje i obniża zaufanie.`);
  if (inp != null && inp > 200) out.push(`Reakcja na kliknięcie zajmuje ${Math.round(inp)} ms — strona sprawia wrażenie zacinającej się.`);
  if (ttfb != null && ttfb > 800) out.push(`Serwer odpowiada wolno (${Math.round(ttfb)} ms) — sam start strony jest opóźniony.`);
  if (v.scores.seo != null && v.scores.seo < 80) out.push(`SEO ${v.scores.seo}/100 — przez to firmę trudniej znaleźć w Google.`);
  if (v.scores.accessibility != null && v.scores.accessibility < 80) out.push(`Dostępność ${v.scores.accessibility}/100 — część klientów (np. na telefonie) ma problem z obsługą.`);
  return out.slice(0, 5);
}

/** Pure: jednozdaniowa ocena wydajności do nagłówka. */
export function perfVerdict(perf: number | null): { emoji: string; label: string } {
  if (perf == null) return { emoji: "❔", label: "brak danych" };
  if (perf >= 90) return { emoji: "🟢", label: "szybka" };
  if (perf >= 50) return { emoji: "🟡", label: "do poprawy" };
  return { emoji: "🔴", label: "wolna (mocny argument)" };
}
