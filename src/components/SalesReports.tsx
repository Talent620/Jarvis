import { useMemo, useState } from "react";
import { useStore } from "../hooks/useStore";
import { leadFunnel, segmentReport, monthlyOutcomes, pct, type SegmentDim } from "../lib/salesReports";
import { formatZl } from "../lib/salesCockpit";

// 📊 Raporty sprzedaży — lejek konwersji, skuteczność segmentów, wygrane/przychód w czasie.
// Cała matematyka w salesReports (pure). Liczone z leadów + finansów; puste pola uczciwie „—".
const DIMS: { id: SegmentDim; label: string }[] = [
  { id: "niche", label: "🏷 Nisza" },
  { id: "location", label: "📍 Miasto" },
  { id: "origin", label: "🔗 Źródło" },
];

export default function SalesReports() {
  const { data } = useStore();
  const leads = useMemo(() => data.leads || [], [data.leads]);
  const [dim, setDim] = useState<SegmentDim>("niche");
  const funnel = useMemo(() => leadFunnel(leads), [leads]);
  const segments = useMemo(() => segmentReport(leads, dim).slice(0, 8), [leads, dim]);
  const months = useMemo(() => monthlyOutcomes(leads, data.financeProjects, Date.now(), 6), [leads, data.financeProjects]);
  const maxRevenue = Math.max(1, ...months.map((m) => m.revenue));

  if (leads.length === 0) {
    return <div className="panel-body"><p className="muted" style={{ padding: "12px 4px", fontSize: 13 }}>Brak leadów — raporty pojawią się, gdy zbierzesz klientów. Znajdź firmy w „🧲 Nowe znalezione”.</p></div>;
  }

  const funnelBar = (label: string, value: number, of: number, color: string) => {
    const w = of > 0 ? Math.round((value / of) * 100) : 0;
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
          <span>{label}</span><span className="muted">{value}{of !== value ? ` / ${of}` : ""}</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "var(--line, rgba(128,128,128,.2))", overflow: "hidden" }}>
          <div style={{ width: `${w}%`, height: "100%", background: color, transition: "width .3s" }} />
        </div>
      </div>
    );
  };

  return (
    <div className="panel-body">
      {/* 1. Lejek konwersji */}
      <h3 style={{ marginTop: 4 }}>🫗 Lejek konwersji</h3>
      <div className="journal-card" style={{ padding: "10px 12px" }}>
        {funnelBar("Wszyscy", funnel.total, funnel.total, "var(--text-dim)")}
        {funnelBar("Zaczepieni", funnel.engaged, funnel.total, "var(--cyan, #6ce7ff)")}
        {funnelBar("Z ofertą", funnel.offered, funnel.total, "var(--gold)")}
        {funnelBar("Wygrani", funnel.won, funnel.total, "var(--ok, #58e08a)")}
        <div className="muted" style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>Zaczepienie: {pct(funnel.engageRate)}</span>
          <span>Oferta: {pct(funnel.offerRate)}</span>
          <span>Domknięcie: {pct(funnel.closeRate)}</span>
          <span>Skuteczność: {pct(funnel.winRate)}</span>
        </div>
      </div>

      {/* 2. Skuteczność segmentów */}
      <h3 style={{ marginTop: 14 }}>🎯 Co konwertuje</h3>
      <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {DIMS.map((d) => (
          <button key={d.id} className={`chip ${dim === d.id ? "on" : ""}`} style={{ fontSize: 12 }} onClick={() => setDim(d.id)}>{d.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {segments.map((s) => (
          <div key={s.key} className="journal-card" style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.key}</div>
              <div className="muted" style={{ fontSize: 11 }}>{s.count} leadów · {s.won} wygranych{s.wonValue > 0 ? ` · ${formatZl(s.wonValue)}` : ""}</div>
            </div>
            <div style={{ fontSize: 15, fontFamily: "Orbitron", flexShrink: 0, color: s.winRate != null && s.winRate >= 0.3 ? "var(--ok, #58e08a)" : "var(--text-dim)" }}>{pct(s.winRate)}</div>
          </div>
        ))}
      </div>

      {/* 3. Wygrane/przegrane + przychód w czasie */}
      <h3 style={{ marginTop: 14 }}>📅 Ostatnie 6 miesięcy</h3>
      <div className="journal-card" style={{ padding: "10px 12px" }}>
        {months.map((m) => (
          <div key={m.ym} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
              <span>{m.label}</span>
              <span className="muted">✅ {m.won} · ❌ {m.lost}{m.revenue > 0 ? ` · 💰 ${formatZl(m.revenue)}` : ""}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "var(--line, rgba(128,128,128,.15))", overflow: "hidden" }}>
              <div style={{ width: `${Math.round((m.revenue / maxRevenue) * 100)}%`, height: "100%", background: "var(--gold)" }} />
            </div>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Przychód liczony z realnych wpłat (💰 Finanse) — nie z prognoz.</div>
      </div>
    </div>
  );
}
