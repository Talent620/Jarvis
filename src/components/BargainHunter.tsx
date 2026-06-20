import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { useStore } from "../hooks/useStore";
import { copyWithToast, toast } from "../lib/toast";
import { resolveProvider } from "../lib/brain";
import { findBargains, rankOffers, dealFlag, marketLinks, type BargainResult, type Offer, type DealFlag } from "../lib/bargain";
import { addWatch, removeWatch, setTarget, recordObservation, findWatch, priceTrend, sparkline } from "../lib/bargainWatch";
import type { WatchedItem } from "../types";

// Łowca Okazji — wpisz przedmiot (nazwa, model lub numer części), a JARVIS znajdzie
// go NAJTANIEJ: osobno najtańszy NOWY i najtańszy UŻYWANY, z medianą ceny i ostrzeżeniem
// o podejrzanie tanich ofertach. Zawsze daje też gotowe linki „od najtańszych" do OLX,
// Vinted, eBay, Allegro, Amazon, Ceneo i Google Zakupów.

const FLAG: Record<DealFlag, { icon: string; label: string; color: string } | null> = {
  scam: { icon: "⚠", label: "Podejrzanie tanio — uważaj na oszustwo", color: "#e0584f" },
  deal: { icon: "🔥", label: "Okazja", color: "#58e08a" },
  high: { icon: "↑", label: "Drogo", color: "#e0a558" },
  fair: null,
};

function money(o: { price: number; currency: string }): string {
  return `${o.price.toLocaleString("pl-PL")} ${o.currency}`;
}

// Mini-wykres + trend ceny dla obserwowanego przedmiotu.
function WatchTrend({ item }: { item: WatchedItem }) {
  const trend = priceTrend(item.history);
  if (!trend || trend.points < 2) return null;
  const pts = sparkline((item.history || []).map((h) => h.price), 84, 26);
  const up = trend.dir === "up";
  const color = trend.dir === "down" ? "var(--ok, #58e08a)" : up ? "#e0584f" : "var(--text-dim)";
  const arrow = trend.dir === "down" ? "📉" : up ? "📈" : "→";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
      <svg width="84" height="26" viewBox="0 0 84 26" preserveAspectRatio="none" style={{ flexShrink: 0 }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 12, color }}>
        {arrow} {trend.changePct > 0 ? "+" : ""}{trend.changePct}% · {trend.points} sprawdzeń
      </span>
    </div>
  );
}

export default function BargainHunter({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BargainResult | null>(null);
  const ready = !!resolveProvider();

  // Podgląd linków na żywo (zanim odpalimy AI) — działa bez klucza.
  const liveLinks = useMemo(() => marketLinks(query), [query]);

  const ranked = useMemo(() => (res ? rankOffers(res.offers) : null), [res]);
  const watches = data.bargainWatch || [];
  const watched = !!query.trim() && !!findWatch(query);

  const search = async (q0?: string) => {
    const q = (q0 ?? query).trim();
    if (!q || busy) return;
    if (q0 != null) setQuery(q0);
    setBusy(true);
    setRes(null);
    try {
      const r = await findBargains(q);
      setRes(r);
      // Jeśli przedmiot jest obserwowany — zapisz cenę i powiedz, czy staniało.
      const best = rankOffers(r.offers).sorted[0];
      if (best) {
        const obs = recordObservation(q, best.price, r.currency);
        if (obs?.hitTarget) toast(`🎯 Cel osiągnięty: „${q}" za ${best.price.toLocaleString("pl-PL")} ${r.currency}!`);
        else if (obs?.change.dir === "down") toast(`▼ „${q}" staniało o ${Math.abs(obs.change.pct)}% od ostatniego sprawdzenia`);
        else if (obs?.change.dir === "up") toast(`▲ „${q}" podrożało o ${obs.change.pct}%`);
      }
    } finally {
      setBusy(false);
    }
  };

  const watch = () => {
    const q = query.trim();
    if (!q) return;
    addWatch(q, ranked?.sorted[0]?.price, res?.currency);
    toast(`⭐ Obserwuję „${q}" — przy kolejnym sprawdzeniu powiem, czy staniało`);
  };

  const links = res?.links?.length ? res.links : liveLinks;
  const used = links.filter((l) => l.kind === "used");
  const fresh = links.filter((l) => l.kind === "new");
  const allk = links.filter((l) => l.kind === "all");

  const OfferRow = ({ o, med, highlight }: { o: Offer; med: number; highlight?: string }) => {
    const f = FLAG[dealFlag(o.price, med)];
    return (
      <div className="journal-card" style={{ padding: "10px 12px", borderLeft: `3px solid ${highlight || (o.condition === "used" ? "var(--gold)" : "var(--cyan)")}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 18 }}>{money(o)}</span>
          <span className="muted" style={{ fontSize: 11 }}>{o.condition === "used" ? "🔁 używane" : "✨ nowe"} · {o.source}</span>
        </div>
        <div style={{ fontSize: 14, marginTop: 2 }}>{o.title}</div>
        {f && <div style={{ fontSize: 12, color: f.color, marginTop: 3 }}>{f.icon} {f.label}</div>}
        {o.note && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{o.note}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <a className="chip" href={o.url} target="_blank" rel="noopener">🔗 Otwórz ofertę</a>
          <button className="chip" onClick={() => copyWithToast(o.url)}>📋 Kopiuj link</button>
        </div>
      </div>
    );
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🏷 Łowca Okazji — znajdź najtaniej</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Wpisz przedmiot, model albo numer części (np. „lampa do golfa", „iPhone 13 128GB", „Bosch GBH 2-26").
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="Co chcesz kupić najtaniej?"
              autoFocus
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 12px", fontSize: 16 }}
            />
            <button className="btn primary" style={{ minWidth: 96 }} onClick={() => search()} disabled={busy || !query.trim()}>
              {busy ? "Szukam…" : "🔍 Szukaj"}
            </button>
          </div>

          {/* Obserwowanie ceny + szybkie powtórki wcześniejszych wyszukiwań */}
          {query.trim() && (
            <button
              className="chip"
              style={{ marginTop: 8, borderColor: watched ? "var(--ok, #58e08a)" : undefined }}
              onClick={watch}
              disabled={watched}
            >
              {watched ? "⭐ Obserwowane ✓" : "⭐ Obserwuj cenę"}
            </button>
          )}
          {watches.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>⭐ Obserwowane — dotknij, by sprawdzić ponownie</div>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {watches.map((w) => (
                  <span key={w.id} className="chip" onClick={() => search(w.query)}>
                    {w.query}{w.bestPrice ? ` · od ${w.bestPrice.toLocaleString("pl-PL")} ${w.bestCurrency || "PLN"}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {busy && <p className="muted" style={{ textAlign: "center", fontSize: 14, marginTop: 10 }}>🌐 Przeszukuję serwisy i porównuję ceny…</p>}

          {/* Najlepsze typy: najtaniej nowy + najtaniej używany */}
          {ranked && (ranked.cheapestUsed || ranked.cheapestNew) && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: "4px 0 8px", fontSize: 15 }}>🏆 Najtańsze trafienia{res?.normalized ? ` — ${res.normalized}` : ""}</h3>
              {ranked.cheapestUsed && <div style={{ marginBottom: 8 }}><div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>Najtaniej używane</div><OfferRow o={ranked.cheapestUsed} med={ranked.median} highlight="var(--gold)" /></div>}
              {ranked.cheapestNew && <div><div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>Najtaniej nowe</div><OfferRow o={ranked.cheapestNew} med={ranked.median} highlight="var(--cyan)" /></div>}
              {ranked.median > 0 && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Mediana ceny w wynikach: <b>{ranked.median.toLocaleString("pl-PL")} {res?.currency || "PLN"}</b> — oferty mocno poniżej oznaczam ⚠ (ryzyko oszustwa).</p>}
            </div>
          )}

          {/* Pełna lista posortowana od najtańszych */}
          {ranked && ranked.sorted.length > 0 && (
            <details style={{ marginTop: 10 }} open>
              <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Wszystkie znalezione oferty ({ranked.sorted.length}) — od najtańszych</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {ranked.sorted.map((o, i) => <OfferRow key={o.url + i} o={o} med={ranked.median} />)}
              </div>
            </details>
          )}

          {res?.tips && res.tips.length > 0 && (
            <div className="journal-card" style={{ marginTop: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💡 Rady zakupowe</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {res.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {res?.error && <p style={{ color: "#e08558", fontSize: 13, marginTop: 8 }}>⚠ {res.error}</p>}
          {res && !res.error && res.offers.length === 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {res.note === "no-ai"
                ? "💡 Bez klucza AI pokazuję gotowe linki „od najtańszych” poniżej. Dodaj klucz w ⚙ → AI, by JARVIS sam zebrał i porównał oferty."
                : res.note === "no-search"
                ? "💡 Włącz realne wyszukiwanie, by JARVIS znajdował konkretne oferty z prawdziwymi linkami: dodaj klucz Tavily (⚙ → Research) albo użyj modelu Claude. Na razie skorzystaj z linków poniżej."
                : "Nie udało się zebrać konkretnych ofert — skorzystaj z linków poniżej (każdy posortowany od najtańszych)."}
            </p>
          )}

          {/* Gotowe linki „od najtańszych" — zawsze dostępne */}
          {links.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3 style={{ margin: "4px 0 6px", fontSize: 14 }}>🔗 Szukaj sam — posortowane od najtańszych</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Używane</div>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {used.map((l) => <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener">{l.icon} {l.name}</a>)}
              </div>
              <div className="muted" style={{ fontSize: 12, margin: "8px 0 4px" }}>Nowe</div>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {fresh.map((l) => <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener">{l.icon} {l.name}</a>)}
              </div>
              <div className="muted" style={{ fontSize: 12, margin: "8px 0 4px" }}>Zagranica i porównywarki — często taniej</div>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {allk.map((l) => <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener">{l.icon} {l.name}</a>)}
              </div>
            </div>
          )}

          {/* Zarządzanie obserwowanymi — rekord ceny, próg „cel", usuwanie */}
          {watches.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>⭐ Obserwowane przedmioty ({watches.length})</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {watches.map((w) => {
                  const hit = !!(w.targetPrice && w.bestPrice && w.bestPrice <= w.targetPrice);
                  return (
                    <div key={w.id} className="journal-card" style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <button className="chip" onClick={() => search(w.query)}>🔍 {w.query}</button>
                        <button className="chip" onClick={() => removeWatch(w.id)} title="Przestań obserwować">✕</button>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 6 }}>
                        {w.bestPrice ? <>Najniższa widziana: <b>{w.bestPrice.toLocaleString("pl-PL")} {w.bestCurrency || "PLN"}</b></> : "Brak ceny — sprawdź ponownie"}
                        {hit && <span style={{ color: "var(--ok, #58e08a)", marginLeft: 8 }}>🎯 cel osiągnięty</span>}
                      </div>
                      <WatchTrend item={w} />
                      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 13 }}>
                        🎯 Cel (alert poniżej):
                        <input
                          type="number"
                          defaultValue={w.targetPrice ?? ""}
                          placeholder="np. 200"
                          onBlur={(e) => setTarget(w.id, Number(e.target.value) || 0)}
                          style={{ width: 90, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 6px" }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {!ready && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>💡 Inteligentne porównanie używa mózgu AI z wyszukiwaniem w sieci — wklej klucz w ⚙ → AI. Linki powyżej działają bez klucza.</p>}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
