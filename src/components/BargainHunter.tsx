import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast } from "../lib/toast";
import { resolveProvider } from "../lib/brain";
import { findBargains, rankOffers, dealFlag, marketLinks, type BargainResult, type Offer, type DealFlag } from "../lib/bargain";

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

export default function BargainHunter({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BargainResult | null>(null);
  const ready = !!resolveProvider();

  // Podgląd linków na żywo (zanim odpalimy AI) — działa bez klucza.
  const liveLinks = useMemo(() => marketLinks(query), [query]);

  const ranked = useMemo(() => (res ? rankOffers(res.offers) : null), [res]);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setRes(null);
    try {
      setRes(await findBargains(q));
    } finally {
      setBusy(false);
    }
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
            <button className="btn primary" style={{ minWidth: 96 }} onClick={search} disabled={busy || !query.trim()}>
              {busy ? "Szukam…" : "🔍 Szukaj"}
            </button>
          </div>

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
                {allk.map((l) => <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener">{l.icon} {l.name}</a>)}
              </div>
            </div>
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
