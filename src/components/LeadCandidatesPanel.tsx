// === Lista kandydatów leadów — wyszukiwanie ≠ zaśmiecanie CRM ===
// Samo szukanie NIC nie zapisuje. Pokazujemy kandydatów (pewność, źródło, kontaktowalność, dowody,
// ostrzeżenia jakości, znacznik PRZYKŁAD) do zaznaczenia. Do bazy trafiają dopiero zaznaczeni
// (Importuj). Dodatkowo per-karta: Odrzuć, Otwórz źródło, Zbuduj demo. Marcin kontroluje jakość bazy.

import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { store, uid } from "../lib/store";
import { toast } from "../lib/toast";
import { safeOpenExternal } from "../lib/glinks";
import { discoverCandidates } from "../lib/leads";
import { importCandidates, type LeadCandidate } from "../lib/leadCandidates";
import { describeLeadSources, sourceBadge } from "../lib/leadSources";
import { scoreLead, signalsFromCandidate, type IcpScore } from "../lib/leadScoring";
import { buildGrowthContext, type GrowthContext } from "../lib/growthContext";
import type { Lead } from "../types";

// Etykiety „najlepszej następnej akcji" (bestNextAction) — po polsku, pod przycisk/podpowiedź.
const NEXT_ACTION_LABEL: Record<IcpScore["bestNextAction"], string> = {
  research: "🔍 Dozbieraj dane",
  call: "📞 Zadzwoń",
  demo: "🌐 Pokaż demo",
  offer: "✉ Wyślij ofertę",
  reject: "🚫 Odpuść",
};

export default function LeadCandidatesPanel({ onClose, onWeb }: { onClose: () => void; onWeb?: (ctx: GrowthContext) => void }) {
  useEscape(onClose);
  const [niche, setNiche] = useState(store.settings.prospectNiche || "");
  const [city, setCity] = useState(store.settings.prospectLocation || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [candidates, setCandidates] = useState<LeadCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ICP score (wyjaśnialny) rządzi KOLEJNOŚCIĄ: najlepsi kandydaci na górze. Uwzględnia
  // provenance (źródło) i politykę kontaktu; wagi douczane wyłącznie z potwierdzonych wyników.
  const ranked = useMemo(() => {
    const now = Date.now();
    return candidates
      .map((c) => ({ c, icp: scoreLead(signalsFromCandidate(c, now), store.data.scoringWeights) }))
      .sort((a, b) => b.icp.score - a.icp.score);
  }, [candidates]);

  const search = async () => {
    setBusy(true); setMsg("🔎 Szukam kandydatów (bez zapisu do CRM)…"); setCandidates([]); setSelected(new Set());
    try {
      const r = await discoverCandidates({ niche: niche.trim() || undefined, location: city.trim() || undefined });
      if (r.error) { setMsg(r.error); return; }
      setCandidates(r.candidates);
      setMsg(r.candidates.length ? `Znalazłem ${r.candidates.length} kandydatów w ${r.city}. Zaznacz i zaimportuj tych, których chcesz.` : `Brak kandydatów w ${r.city}. Spróbuj inną niszę/miasto.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Błąd wyszukiwania.");
    } finally { setBusy(false); }
  };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const importSelected = () => {
    const pick = candidates.filter((c) => selected.has(c.id));
    if (!pick.length) { toast("Zaznacz najpierw kandydatów do importu."); return; }
    const added = importCandidates(store.data.leads, pick, { now: Date.now(), makeId: () => uid() });
    if (added.length) store.setData((d) => { d.leads.push(...added); });
    toast(`✅ Zaimportowano ${added.length} z ${pick.length} zaznaczonych (reszta to duplikaty).`);
    // Zaimportowanych usuń z listy kandydatów (i z zaznaczenia).
    const addedNames = new Set(added.map((l) => (l.company || "").toLowerCase()));
    setCandidates((cs) => cs.filter((c) => !pick.includes(c) || !addedNames.has(c.company.toLowerCase())));
    setSelected(new Set());
  };

  const reject = (c: LeadCandidate) => setCandidates((cs) => cs.filter((x) => x.id !== c.id));

  const buildDemo = (c: LeadCandidate) => {
    if (!onWeb) { toast("Kreator stron niedostępny w tym widoku."); return; }
    // Demo bez zapisu do CRM — kontekst wprost z kandydata.
    const tempLead: Lead = { id: c.id, company: c.company, url: c.url, email: c.email, contact: c.email || c.phone, address: c.address, niche: c.niche, status: "new", createdAt: Date.now(), updatedAt: Date.now() };
    onWeb(buildGrowthContext(tempLead));
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🧲 Kandydaci leadów</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Samo wyszukanie <b>nie</b> dodaje nic do bazy. Zaznacz kandydatów i kliknij „Importuj zaznaczone”.
          </p>
          {/* Uczciwy status źródeł: live / niedostępne / przykładowe — bez udawania, że coś działa. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {describeLeadSources({
              online: typeof navigator === "undefined" ? true : navigator.onLine,
              tavilyKey: store.settings.tavilyApiKey,
              googlePlacesKey: store.settings.keys?.googlePlaces,
            }).map((s) => (
              <span key={s.id} className="chip" style={{ fontSize: 11, opacity: s.status === "unavailable" ? 0.55 : 1 }} title={s.note}>
                {sourceBadge(s)}
              </span>
            ))}
          </div>
          <div className="field hunt-fields">
            <input value={niche} placeholder="Nisza — opcjonalnie (np. fryzjer)" onChange={(e) => setNiche(e.target.value)} />
            <input value={city} placeholder="Miasto — opcjonalnie (📍 lub auto)" onChange={(e) => setCity(e.target.value)} />
          </div>
          <button className="btn primary" style={{ width: "100%", minHeight: 44 }} disabled={busy} onClick={() => void search()}>
            {busy ? "🔎 Szukam…" : "🔎 Szukaj kandydatów"}
          </button>
          {msg && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{msg}</p>}

          {candidates.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
              <button className="btn" style={{ width: "auto", marginTop: 0, padding: "8px 12px", minHeight: 44 }} onClick={importSelected} disabled={selected.size === 0}>
                ⬇ Importuj zaznaczone ({selected.size})
              </button>
              <span className="muted" style={{ fontSize: 12 }}>{candidates.length} kandydatów</span>
            </div>
          )}

          {ranked.map(({ c, icp }) => (
            <div key={c.id} style={{ border: "1px solid var(--line, #234)", borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} style={{ minWidth: 20, minHeight: 20 }} />
                {/* ICP score — kolor sygnalizuje jakość (zielony ≥65, złoty ≥40, szary niżej). */}
                <span title={`ICP score ${icp.score}/100 · pewność ${Math.round(icp.confidence * 100)}%`}
                  style={{ fontFamily: "Orbitron, monospace", fontSize: 13, fontWeight: 700, minWidth: 34, textAlign: "center",
                    color: icp.score >= 65 ? "var(--ok, #58e08a)" : icp.score >= 40 ? "var(--gold, #d9a400)" : "var(--text-dim, #8aa)" }}>
                  {icp.score}
                </span>
                <strong style={{ fontSize: 14 }}>{c.company}</strong>
                {c.isSample && <span style={{ fontSize: 11, color: "var(--gold, #d9a400)" }}>PRZYKŁAD</span>}
              </label>
              <div className="muted" style={{ fontSize: 12 }}>
                Pewność: {Math.round(c.confidence * 100)}% · Kontakt: {c.contactability} · Źródło: {c.source}
              </div>
              {/* Wyjaśnialny ICP: następna akcja + 3 powody + brakujące dowody — nie „czarna skrzynka". */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chip" style={{ fontSize: 11, borderColor: "var(--cyan, #6ce7ff)" }}>{NEXT_ACTION_LABEL[icp.bestNextAction]}</span>
                {icp.topReasons.map((r, i) => <span key={i} className="chip" style={{ fontSize: 11 }}>✓ {r}</span>)}
              </div>
              {icp.missingEvidence.length > 0 && (
                <div className="muted" style={{ fontSize: 11 }}>Brakuje: {icp.missingEvidence.join(" · ")}</div>
              )}
              {c.evidence.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {c.evidence.map((ev, i) => <span key={i} className="chip" style={{ fontSize: 11 }}>{ev}</span>)}
                </div>
              )}
              {c.qualityWarnings.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--gold, #d9a400)" }}>⚠ {c.qualityWarnings.join(" · ")}</div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                {c.sourceUrl && (
                  <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 12, minHeight: 40 }} onClick={() => safeOpenExternal(c.sourceUrl!)}>Otwórz źródło</button>
                )}
                {onWeb && (
                  <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 12, minHeight: 40 }} onClick={() => buildDemo(c)}>Zbuduj demo</button>
                )}
                <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 12, minHeight: 40 }} onClick={() => reject(c)}>Odrzuć</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
