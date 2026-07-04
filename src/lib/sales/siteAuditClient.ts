// === Pobieranie strony leada do audytu — przez BFF (omija CORS na telefonie) ===
// Naprawia kluczowy błąd: `auditSite` pobierał HTML bezpośrednio, więc na telefonie CORS
// blokował audyt i „słabe punkty" były puste. Tu: gdy jest BFF (proxyUrl) — przez worker
// (`/v1/site-audit`, SSRF-safe); inaczej bezpośrednio (desktop/Electron). Cache + retry + timeout.
import { fetchTimeout, appTokenHeader } from "../http";
import { store } from "../store";

export interface AuditFetch { ok: boolean; html?: string; finalUrl?: string; status?: number; error?: string }

const CACHE = new Map<string, { at: number; data: AuditFetch }>();
const TTL_MS = 30 * 60_000; // ten sam lead nie jest pobierany w kółko

export function normalizeUrl(u: string): string {
  const s = (u || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

async function viaBff(proxy: string, url: string): Promise<AuditFetch> {
  let lastErr = "BFF nie odpowiedział";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchTimeout(
        `${proxy.replace(/\/$/, "")}/v1/site-audit`,
        { method: "POST", headers: { "content-type": "application/json", ...appTokenHeader() }, body: JSON.stringify({ url }) },
        15000,
      );
      const d = await r.json().catch(() => null);
      if (r.ok && d) return { ok: !!d.ok, html: d.html, finalUrl: d.finalUrl, status: d.status, error: d.error };
      lastErr = (d && d.error) || `BFF HTTP ${r.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastErr };
}

async function direct(url: string): Promise<AuditFetch> {
  try {
    const r = await fetchTimeout(url, { redirect: "follow" }, 12000);
    const html = await r.text();
    return { ok: r.ok, html, finalUrl: r.url || url, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Pobierz HTML strony do audytu — preferuje BFF (działa na telefonie), z cache i ponowieniem. */
export async function fetchSiteHtml(rawUrl: string): Promise<AuditFetch> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, error: "Pusty URL." };
  const c = CACHE.get(url);
  if (c && Date.now() - c.at < TTL_MS) return c.data;
  const proxy = store.settings.proxyUrl?.trim();
  let data = proxy ? await viaBff(proxy, url) : await direct(url);
  // Gdy BFF padł, a jesteśmy na desktopie/web bez CORS — spróbuj jeszcze bezpośrednio.
  if (!data.ok && proxy) {
    const fallback = await direct(url);
    if (fallback.ok) data = fallback;
  }
  CACHE.set(url, { at: Date.now(), data });
  return data;
}

/** Wyczyść cache audytu (np. po ręcznym odświeżeniu leada). */
export function clearAuditCache(): void {
  CACHE.clear();
}
