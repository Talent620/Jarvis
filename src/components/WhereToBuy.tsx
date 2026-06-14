import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast } from "../lib/toast";
import { resolveProvider } from "../lib/brain";
import { findPlaces, rankPlaces, mapLinks, myCoords, type PlacesResult, type Place, type Coords } from "../lib/places";

// Gdzie kupię w pobliżu — wpisujesz, czego potrzebujesz, a JARVIS pokazuje MIEJSCA:
// najbliżej oraz „taniej, ale dalej". Zawsze daje też linki do map i wyszukiwarki.

function dist(p: Place): string {
  return p.distanceKm != null ? `${p.distanceKm.toLocaleString("pl-PL")} km` : "";
}
function price(p: Place): string {
  return p.price != null ? `${p.price.toLocaleString("pl-PL")} ${p.currency || "PLN"}` : "";
}

export default function WhereToBuy({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [res, setRes] = useState<PlacesResult | null>(null);
  const ready = !!resolveProvider();

  const liveLinks = useMemo(() => mapLinks(query, place, coords || undefined), [query, place, coords]);
  const ranked = useMemo(() => (res ? rankPlaces(res.places) : null), [res]);
  const links = res?.links?.length ? res.links : liveLinks;

  const locate = async () => {
    setLocating(true);
    const c = await myCoords();
    setLocating(false);
    if (c) { setCoords(c); toast("📍 Ustaliłem Twoją okolicę"); }
    else toast("Nie udało się pobrać lokalizacji — wpisz miasto ręcznie");
  };

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setRes(null);
    try {
      setRes(await findPlaces(q, place, coords || undefined));
    } finally {
      setBusy(false);
    }
  };

  const PlaceCard = ({ p, badge, color }: { p: Place; badge?: string; color?: string }) => (
    <div className="journal-card" style={{ padding: "10px 12px", borderLeft: `3px solid ${color || "var(--line)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{p.name}</span>
        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{[dist(p), price(p)].filter(Boolean).join(" · ")}</span>
      </div>
      {badge && <div style={{ fontSize: 12, color: color || "var(--text-dim)", marginTop: 2 }}>{badge}</div>}
      {p.address && <div style={{ fontSize: 13, marginTop: 2 }}>📍 {p.address}</div>}
      {(p.hours || p.phone) && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{[p.hours && `🕘 ${p.hours}`, p.phone && `☎ ${p.phone}`].filter(Boolean).join(" · ")}</div>}
      {p.note && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.note}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <a className="chip" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || ""}`)}`} target="_blank" rel="noopener">🗺 Trasa</a>
        {p.url && <a className="chip" href={p.url} target="_blank" rel="noopener">🔗 Strona</a>}
        {p.phone && <a className="chip" href={`tel:${p.phone.replace(/\s+/g, "")}`}>☎ Zadzwoń</a>}
        <button className="chip" onClick={() => copyWithToast(p.address || p.name)}>📋 Kopiuj</button>
      </div>
    </div>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📍 Gdzie kupię w pobliżu</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Napisz, czego potrzebujesz — JARVIS podpowie, gdzie to kupisz: najbliżej oraz taniej (choć dalej).
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="Czego potrzebujesz? (np. „wiertarka”, „opona 205/55 R16”)"
              autoFocus
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 12px", fontSize: 16 }}
            />
            <button className="btn primary" style={{ minWidth: 96 }} onClick={search} disabled={busy || !query.trim()}>
              {busy ? "Szukam…" : "🔍 Szukaj"}
            </button>
          </div>

          {/* Lokalizacja: wpisz miasto albo użyj GPS */}
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <input
              value={place}
              onChange={(e) => { setPlace(e.target.value); if (e.target.value.trim()) setCoords(null); }}
              placeholder="Miasto / adres (opcjonalnie)"
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            />
            <button className="chip" onClick={locate} disabled={locating} style={{ borderColor: coords ? "var(--ok, #58e08a)" : undefined }}>
              {locating ? "📍…" : coords ? "📍 Okolica ✓" : "📍 Moja lokalizacja"}
            </button>
          </div>

          {busy && <p className="muted" style={{ textAlign: "center", fontSize: 14, marginTop: 10 }}>🌐 Szukam miejsc w okolicy…</p>}

          {/* Kompromis: najbliżej vs taniej, ale dalej */}
          {ranked && (ranked.nearest || ranked.cheaperFar) && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: "4px 0 8px", fontSize: 15 }}>🎯 Najlepszy wybór{res?.place ? ` — ${res.place}` : ""}</h3>
              {ranked.nearest && <div style={{ marginBottom: 8 }}><PlaceCard p={ranked.nearest} badge="📍 Najbliżej" color="var(--cyan)" /></div>}
              {ranked.cheaperFar && (
                <div><PlaceCard p={ranked.cheaperFar} badge={`💰 Taniej, ale dalej${ranked.nearest?.price && ranked.cheaperFar.price ? ` — oszczędzasz ${(ranked.nearest.price - ranked.cheaperFar.price).toLocaleString("pl-PL")} ${ranked.cheaperFar.currency || "PLN"}` : ""}`} color="var(--gold)" /></div>
              )}
            </div>
          )}

          {/* Pełna lista wg odległości */}
          {ranked && ranked.byDistance.length > 0 && (
            <details style={{ marginTop: 10 }} open>
              <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600 }}>Wszystkie miejsca ({ranked.byDistance.length}) — od najbliższych</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {ranked.byDistance.map((p, i) => <PlaceCard key={p.name + i} p={p} />)}
              </div>
            </details>
          )}

          {res?.tips && res.tips.length > 0 && (
            <div className="journal-card" style={{ marginTop: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💡 Wskazówki</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {res.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}

          {res?.error && <p style={{ color: "#e08558", fontSize: 13, marginTop: 8 }}>⚠ {res.error}</p>}
          {res && !res.error && res.places.length === 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {res.note === "no-ai"
                ? "💡 Bez klucza AI pokazuję linki do map poniżej. Dodaj klucz w ⚙ → AI, by JARVIS sam wskazał konkretne sklepy z odległością i ceną."
                : "Nie zebrałem konkretnych miejsc — skorzystaj z map i wyszukiwarki poniżej."}
            </p>
          )}

          {/* Linki do map — zawsze dostępne */}
          {links.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3 style={{ margin: "4px 0 6px", fontSize: 14 }}>🗺 Otwórz w mapach / wyszukiwarce</h3>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {links.map((l) => <a key={l.name} className="chip" href={l.url} target="_blank" rel="noopener">{l.icon} {l.name}</a>)}
              </div>
            </div>
          )}

          {!ready && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>💡 Inteligentne wskazania używają mózgu AI z wyszukiwaniem w sieci — wklej klucz w ⚙ → AI. Mapy powyżej działają bez klucza.</p>}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
