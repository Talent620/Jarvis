import { useMemo, useState } from "react";
import { store, uid } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { draftOffer } from "../lib/offer";
import type { Lead, LeadStatus } from "../types";

const STATUS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "new", label: "Nowy", color: "var(--cyan)" },
  { id: "contacted", label: "Kontakt", color: "#9b8cff" },
  { id: "offer", label: "Oferta", color: "var(--gold)" },
  { id: "won", label: "Klient ✅", color: "var(--ok, #58e08a)" },
  { id: "lost", label: "Odrzucony", color: "var(--text-dim)" },
];

export default function SalesDashboard({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const leads = data.leads || [];
  const [filter, setFilter] = useState<LeadStatus | "all">("all");
  const [form, setForm] = useState({ company: "", contact: "", value: "" });
  const [drafting, setDrafting] = useState<string>("");

  const writeOffer = async (l: Lead) => {
    setDrafting(l.id);
    const offer = await draftOffer(l);
    setDrafting("");
    if (offer)
      store.setData((d) => {
        const x = d.leads.find((y) => y.id === l.id);
        if (x) { x.offer = offer; if (x.status === "new") x.status = "offer"; x.updatedAt = Date.now(); }
      });
  };
  const sendOffer = (l: Lead) => {
    const subject = (l.offer || "").match(/Temat:\s*(.+)/i)?.[1]?.trim() || `Oferta dla ${l.company}`;
    const body = (l.offer || "").replace(/Temat:\s*.+\n?/i, "").trim();
    const to = l.contact && l.contact.includes("@") ? l.contact : "";
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  const setStatus = (id: string, status: LeadStatus) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) {
        l.status = status;
        l.updatedAt = Date.now();
      }
    });
  const setField = (id: string, patch: Partial<Lead>) =>
    store.setData((d) => {
      const l = d.leads.find((x) => x.id === id);
      if (l) Object.assign(l, patch, { updatedAt: Date.now() });
    });
  const del = (id: string) => store.setData((d) => { d.leads = d.leads.filter((x) => x.id !== id); });

  const add = () => {
    const c = form.company.trim();
    if (!c) return;
    store.setData((d) =>
      d.leads.unshift({ id: uid(), company: c, contact: form.contact.trim() || undefined, value: Number(form.value) || undefined, status: "new", createdAt: Date.now(), updatedAt: Date.now() }),
    );
    setForm({ company: "", contact: "", value: "" });
  };

  const stats = useMemo(() => {
    const won = leads.filter((l) => l.status === "won");
    const pipeline = leads.filter((l) => l.status !== "lost" && l.status !== "won");
    return {
      total: leads.length,
      won: won.length,
      earned: won.reduce((s, l) => s + (l.value || 0), 0),
      potential: pipeline.reduce((s, l) => s + (l.value || 0), 0),
    };
  }, [leads]);

  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const copy = (t?: string) => t && navigator.clipboard?.writeText(t).catch(() => {});

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📈 Pulpit Sprzedaży</h2>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--gold)" }}>{stats.potential} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>potencjał w toku</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 22, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{stats.earned} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>zarobione ({stats.won})</div>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 13 }}>
            Powiedz JARVIS-owi: <b>„znajdź leady: [nisza] w [miasto] i zapisz je"</b> — sam wypełni ten pulpit.
            Dla wybranej firmy: <b>⋯ → 🌐 Kreator stron</b> zbuduje demo, a JARVIS napisze ofertę.
          </p>

          <div className="chips" style={{ flexWrap: "wrap", margin: "4px 0 8px" }}>
            <span className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")} style={{ cursor: "pointer" }}>wszystkie ({leads.length})</span>
            {STATUS.map((s) => (
              <span key={s.id} className={`chip ${filter === s.id ? "on" : ""}`} onClick={() => setFilter(s.id)} style={{ cursor: "pointer" }}>
                {s.label} ({leads.filter((l) => l.status === s.id).length})
              </span>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>Brak leadów. Poproś JARVIS-a, by je znalazł i zapisał.</p>
          ) : (
            shown.map((l) => (
              <div key={l.id} className="journal-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <b>{l.company}</b>
                  <span className="x" style={{ cursor: "pointer" }} onClick={() => del(l.id)}>✕</span>
                </div>
                {(l.niche || l.location) && <div className="muted" style={{ fontSize: 12 }}>{[l.niche, l.location].filter(Boolean).join(" · ")}</div>}
                {l.note && <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{l.note}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <select
                    value={l.status}
                    onChange={(e) => setStatus(l.id, e.target.value as LeadStatus)}
                    style={{ width: "auto", padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <input
                    type="number"
                    value={l.value ?? ""}
                    placeholder="zł"
                    onChange={(e) => setField(l.id, { value: Number(e.target.value) || undefined })}
                    style={{ width: 70, padding: "4px 8px", borderRadius: 8, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", fontSize: 13 }}
                  />
                  {l.url && <button className="chip" onClick={() => window.open(l.url, "_blank", "noopener")}>🌐 WWW</button>}
                  {l.contact && <button className="chip" onClick={() => copy(l.contact)}>📋 Kontakt</button>}
                  <button className="chip" onClick={() => writeOffer(l)} disabled={drafting === l.id}>
                    {drafting === l.id ? "✍ Piszę…" : l.offer ? "✍ Napisz ponownie" : "✍ Szkic oferty"}
                  </button>
                </div>
                {l.offer && (
                  <div style={{ marginTop: 8, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
                    <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{l.offer}</p>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="chip" onClick={() => copy(l.offer)}>📋 Kopiuj ofertę</button>
                      <button className="chip" onClick={() => sendOffer(l)}>📧 Wyślij</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <h3 style={{ marginTop: 14 }}>➕ Dodaj ręcznie</h3>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input value={form.company} placeholder="Firma" onChange={(e) => setForm({ ...form, company: e.target.value })} style={{ flex: 2 }} />
            <input type="number" value={form.value} placeholder="zł" onChange={(e) => setForm({ ...form, value: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div className="field"><input value={form.contact} placeholder="Kontakt (e-mail/tel.)" onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
          <button className="btn primary" onClick={add}>💾 Dodaj lead</button>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
