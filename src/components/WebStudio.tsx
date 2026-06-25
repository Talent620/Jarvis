import { useState } from "react";
import { generateSite, improveSite, auditSite, analyzeBusiness, buildStrategySeed, SECTION_PRESETS, buildClientBrief, clientHandoverMessage, estimateQuote, formatQuote, marketRanges, quotePackages, formatPackages, type SiteKind, type SiteStyle, type SiteAudit, type ClientBrief, type Quote, type QuotePackage } from "../lib/webgen";
import { conversionAudit, conversionFixInstruction } from "../lib/conversionAi";
import { assessSeo, seoFixInstruction } from "../lib/seoPreview";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast, toast } from "../lib/toast";
import { listSiteProjects, saveSiteProject, renameSiteProject, removeSiteProject, exportSiteProject, importSiteProject } from "../lib/siteProjects";
import type { SiteProject } from "../types";
import Guide from "./Guide";

const KINDS: { id: SiteKind; label: string }[] = [
  { id: "auto", label: "✨ Auto" },
  { id: "sklep", label: "🛒 Sklep" },
  { id: "landing", label: "🚀 Landing" },
  { id: "firma", label: "🏢 Firma" },
  { id: "portfolio", label: "🎨 Portfolio" },
  { id: "saas", label: "🧩 SaaS" },
  { id: "blog", label: "📝 Blog" },
];

// Niesztampowe style — żeby strona nie wyglądała jak „kolejny szablon".
const STYLES: { id: SiteStyle; label: string }[] = [
  { id: "auto", label: "✨ Auto" },
  { id: "editorial", label: "📰 Edytorial" },
  { id: "brutalist", label: "🧱 Brutalizm" },
  { id: "glass", label: "🫧 Glass" },
  { id: "neon", label: "🌃 Neon" },
  { id: "retro", label: "📼 Retro Y2K" },
  { id: "organic", label: "🌿 Organiczny" },
  { id: "swiss", label: "🔲 Swiss" },
  { id: "luxury", label: "👑 Luxury" },
  // Systemy projektowe klasy światowej (AI Design Engine):
  { id: "apple", label: "🍎 Apple" },
  { id: "stripe", label: "💳 Stripe" },
  { id: "linear", label: "📐 Linear" },
  { id: "notion", label: "📝 Notion" },
  { id: "tesla", label: "🚗 Tesla" },
  { id: "airbnb", label: "🏠 Airbnb" },
  { id: "openai", label: "⚪ OpenAI" },
  { id: "saas", label: "📊 SaaS" },
  { id: "enterprise", label: "🏛 Enterprise" },
  { id: "cyberpunk", label: "🌐 Cyberpunk" },
  { id: "minimal", label: "⬜ Minimal" },
];

const IDEAS: Record<string, string[]> = {
  sklep: [
    "Sklep z kawą speciality — produkty z cenami, koszyk, subskrypcja, ciemny elegancki motyw",
    "Sklep z odzieżą streetwear — siatka produktów, koszyk, bestsellery, newsletter, nowoczesny look",
    "Sklep z suplementami — karty produktów, koszyk, opinie, pasek dostawa/zwroty, energiczny styl",
  ],
  inne: [
    "Landing aplikacji SaaS — hero z CTA, funkcje, cennik, opinie, FAQ, ciemny motyw premium",
    "Strona firmy budowlanej — usługi, realizacje, zespół, kontakt, mocna typografia",
    "Portfolio fotografa — galeria z hover, o mnie, kontakt, minimalizm",
    "Strona kawiarni — menu, galeria, godziny, mapa, ciepłe kolory",
  ],
};

export default function WebStudio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<SiteKind>("auto");
  const [style, setStyle] = useState<SiteStyle>("auto");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"preview" | "code">("preview");
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState<ClientBrief>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [packages, setPackages] = useState<QuotePackage[] | null>(null);
  const [audit, setAudit] = useState<SiteAudit | null>(null); // ocena jakości wygenerowanej strony
  const [strategy, setStrategy] = useState(""); // ETAP 11 — strategia biznesowa przed budową
  // 💾 Projekty stron — zapis/wczytanie/wersje
  const [projId, setProjId] = useState<string | null>(null); // aktywny projekt (upsert)
  const [projName, setProjName] = useState("");
  const [projs, setProjs] = useState<SiteProject[]>(listSiteProjects());
  const refreshProjs = () => setProjs(listSiteProjects());
  const saveProject = () => {
    if (!html) { toast("Najpierw zbuduj stronę."); return; }
    const rec = saveSiteProject({ id: projId || undefined, name: projName || `Projekt ${new Date().toLocaleDateString("pl-PL")}`, prompt, kind, style, html, brief });
    setProjId(rec.id); setProjName(rec.name); refreshProjs();
    toast(`💾 Zapisano „${rec.name}" (wersji: ${rec.versions?.length || 1}).`);
  };
  const saveAsNew = () => {
    if (!html) { toast("Najpierw zbuduj stronę."); return; }
    const rec = saveSiteProject({ name: (projName ? `${projName} (kopia)` : "Nowy projekt"), prompt, kind, style, html, brief });
    setProjId(rec.id); setProjName(rec.name); refreshProjs();
    toast(`💾 Zapisano jako nowy: „${rec.name}".`);
  };
  const loadProject = (p: SiteProject) => {
    setHtml(p.html); setPrompt(p.prompt || ""); setKind((p.kind as SiteKind) || "auto"); setStyle((p.style as SiteStyle) || "auto");
    if (p.brief && typeof p.brief === "object") setBrief(p.brief as ClientBrief);
    setProjId(p.id); setProjName(p.name); setAudit(auditSite(p.html)); setView("preview"); setErr("");
    toast(`📂 Wczytano „${p.name}".`);
  };
  const restoreVersion = (p: SiteProject, idx: number) => {
    const v = p.versions?.[idx];
    if (!v) return;
    setHtml(v.html); setAudit(auditSite(v.html)); setView("preview");
    toast(`↩ Przywrócono wersję z ${new Date(v.at).toLocaleString("pl-PL")} (nie zapisano — kliknij 💾, by utrwalić).`);
  };
  const delProject = (id: string) => { removeSiteProject(id); if (projId === id) { setProjId(null); setProjName(""); } refreshProjs(); };
  const renameProj = (p: SiteProject) => {
    const n = window.prompt("Nazwa projektu:", p.name);
    if (n && n.trim()) { renameSiteProject(p.id, n.trim()); if (projId === p.id) setProjName(n.trim()); refreshProjs(); }
  };
  const exportProject = (id: string) => {
    const json = exportSiteProject(id);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `projekt-strony-${id}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importProject = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const rec = importSiteProject(String(r.result || ""));
      if (rec) { refreshProjs(); toast(`📥 Zaimportowano „${rec.name}".`); }
      else toast("⚠ Niepoprawny plik projektu.");
    };
    r.readAsText(file);
  };
  const zl = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;

  const briefText = buildClientBrief(brief);
  const canBuild = !!(prompt.trim() || briefText);

  const run = async (edit: boolean, instructionOverride?: string) => {
    const promptText = instructionOverride ?? prompt;
    // Edycja wymaga polecenia; budowa od zera może wyjść z briefu i/lub opisu.
    if (edit ? !promptText.trim() : !canBuild) return;
    setBusy(true);
    setErr("");
    try {
      const base = [briefText, prompt].filter((s) => s.trim()).join("\n\n");
      const desc = edit ? promptText : buildStrategySeed(base, strategy); // wlej strategię (ETAP 11), gdy jest
      const r = await generateSite(desc, edit && html ? html : undefined, kind, style);
      if ("error" in r) setErr(r.error);
      else {
        setHtml(r.html);
        setAudit(auditSite(r.html)); // ETAP 6/8/9 — automatyczny audyt jakości
        setView("preview");
        if (edit && !instructionOverride) setPrompt(""); // czyść pole tylko, gdy to z pola
        // 💾 Autosave: jeśli pracujesz na zapisanym projekcie, utrwal nową wersję automatycznie.
        if (projId) {
          const rec = saveSiteProject({ id: projId, name: projName, prompt: edit ? prompt : (instructionOverride ?? prompt), kind, style, html: r.html, brief });
          setProjId(rec.id); refreshProjs();
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); // zawsze odblokuj przycisk, nawet przy nieoczekiwanym błędzie
    }
  };

  // ETAP 11 — AI Business Analyst: strategia przed budową (branża, USP, sekcje, ton).
  const analyze = async () => {
    if (busy) return;
    const desc = [buildClientBrief(brief), prompt].filter((s) => s.trim()).join("\n\n");
    if (!desc.trim()) { setErr("Najpierw opisz, czego dotyczy strona."); return; }
    setBusy(true); setErr("");
    try {
      const r = await analyzeBusiness(desc);
      if ("error" in r) setErr(r.error);
      else setStrategy(r.strategy);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ETAP 10 — pętla samodoskonalenia: krytyka + przebudowa na wyższy poziom (jedno kliknięcie).
  const improve = async () => {
    if (!html || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await improveSite(html, kind, style);
      if ("error" in r) setErr(r.error);
      else { setHtml(r.html); setAudit(auditSite(r.html)); setView("preview"); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const setBriefField = (k: keyof ClientBrief, v: string) => setBrief((b) => ({ ...b, [k]: v }));

  const download = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind === "sklep" ? "sklep" : "strona"}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const ideas = kind === "sklep" ? IDEAS.sklep : IDEAS.inne;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🌐 Kreator stron i sklepów</h2>
        </div>
        <div className="panel-body">
          {!html && (
            <>
              <p className="muted">
                Opisz stronę lub sklep, a JARVIS zbuduje kompletną, nowoczesną witrynę (HTML+CSS+JS w jednym pliku) —
                z animacjami, responsywną, a sklep z <b>działającym koszykiem</b>. Podgląd na żywo, edycja słowem, pobranie.
              </p>

              {/* Wybór typu */}
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Typ strony</div>
              <div className="chips" style={{ marginBottom: 8 }}>
                {KINDS.map((k) => (
                  <button key={k.id} className={`chip ${kind === k.id ? "on" : ""}`} onClick={() => setKind(k.id)} disabled={busy}>
                    {k.label}
                  </button>
                ))}
              </div>

              {/* Styl wizualny — niesztampowy charakter */}
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Styl (nadaje charakter — nie „kolejny szablon”)</div>
              <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                {STYLES.map((st) => (
                  <button key={st.id} className={`chip ${style === st.id ? "on" : ""}`} onClick={() => setStyle(st.id)} disabled={busy}>
                    {st.label}
                  </button>
                ))}
              </div>

              {/* Pełen proces pod klienta — strukturalny brief */}
              <details open={showBrief} onToggle={(e) => setShowBrief((e.target as HTMLDetailsElement).open)} style={{ marginBottom: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>🧾 Brief klienta (opcjonalnie — pełny proces pod klienta)</summary>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <input placeholder="Firma / marka" value={brief.business || ""} onChange={(e) => setBriefField("business", e.target.value)} />
                  <input placeholder="Branża" value={brief.industry || ""} onChange={(e) => setBriefField("industry", e.target.value)} />
                  <input placeholder="Cel strony (np. pozyskać klientów)" value={brief.goal || ""} onChange={(e) => setBriefField("goal", e.target.value)} />
                  <input placeholder="Grupa docelowa" value={brief.audience || ""} onChange={(e) => setBriefField("audience", e.target.value)} />
                  <input placeholder="Kolory / branding" value={brief.colors || ""} onChange={(e) => setBriefField("colors", e.target.value)} />
                  <input placeholder="Kontakt (tel, e-mail)" value={brief.contact || ""} onChange={(e) => setBriefField("contact", e.target.value)} />
                  <input style={{ gridColumn: "1 / -1" }} placeholder="Wymagane sekcje (np. cennik, opinie, FAQ)" value={brief.sections || ""} onChange={(e) => setBriefField("sections", e.target.value)} />
                </div>
              </details>

              {/* Cennik rynkowy w Polsce — „ile to kosztuje" */}
              <details style={{ marginBottom: 8 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>💸 Ile takie strony kosztują w Polsce</summary>
                <div style={{ marginTop: 8 }}>
                  {marketRanges().map((r) => (
                    <div key={r.kind} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, lineHeight: 1.7 }}>
                      <span>{r.label}</span>
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{zl(r.min)}–{zl(r.max)}</span>
                    </div>
                  ))}
                  <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    Widełki rynkowe (freelancer → mała agencja) za samo wykonanie. Doliczane bywają treści,
                    integracja płatności (sklep), domena + hosting (~120–350 zł/rok) i opieka (~80–300 zł/mc).
                    Użyj „💰 Wyceń”, by policzyć pełny pakiet pod ten projekt.
                  </p>
                </div>
              </details>

              {/* Pomysły dopasowane do typu */}
              <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                {ideas.map((i) => (
                  <button key={i} className="chip" onClick={() => setPrompt(i)} disabled={busy}>
                    {i.split(" — ")[0]}
                  </button>
                ))}
              </div>

              <Guide title="ℹ Jak opublikować stronę i ile to kosztuje">
                <p><b>1. Plik masz za darmo</b> — kliknij „Pobierz .html". To gotowa, samodzielna strona.</p>
                <p><b>2. Postaw ją online za 0 zł</b> — wejdź na <b>app.netlify.com/drop</b> (albo Vercel, Cloudflare Pages, GitHub Pages) i przeciągnij plik. Dostajesz adres typu <i>twojastrona.netlify.app</i> od ręki.</p>
                <p><b>3. Własna domena</b> (opcjonalnie) — kup np. w <b>nazwa.pl / OVH / home.pl</b>: domena <b>.pl ~50–120 zł/rok</b>, <b>.com ~50–80 zł/rok</b>. Podłączasz ją do darmowego hostingu z punktu 2.</p>
                <p><b>4. Sklep z prawdziwymi płatnościami</b> — ten kreator robi <b>wygląd i koszyk</b>. Żeby brać płatności, podłącz bramkę: <b>Przelewy24 / PayU / Stripe</b> (prowizja ~1–2% od transakcji). Pełny sklep z magazynem to też <b>Shopify (~120 zł/mc)</b> lub <b>WooCommerce</b> — JARVIS przygotuje front, integrację wdraża się osobno.</p>
                <p><b>5. Zdjęcia</b> — wrzuć własne albo darmowe z <b>unsplash.com / pexels.com</b>.</p>
              </Guide>
            </>
          )}

          {html && (
            <>
              <div className="chips" style={{ marginBottom: 8 }}>
                <button className={`chip ${view === "preview" ? "on" : ""}`} onClick={() => setView("preview")}>👁 Podgląd</button>
                <button className={`chip ${view === "code" ? "on" : ""}`} onClick={() => setView("code")}>{"</>"} Kod</button>
              </div>
              {view === "preview" ? (
                <iframe
                  title="podgląd"
                  srcDoc={html}
                  sandbox="allow-scripts"
                  style={{ width: "100%", height: "48vh", border: "1px solid var(--line-strong)", borderRadius: 12, background: "#fff" }}
                />
              ) : (
                <textarea
                  readOnly
                  value={html}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: "100%", height: "48vh", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: 10, fontFamily: "Share Tech Mono, monospace", fontSize: 12 }}
                />
              )}
            </>
          )}

          <div className="field" style={{ marginTop: 10 }}>
            <textarea
              value={prompt}
              placeholder={html ? "Co zmienić? np. zmień kolor na granat, dodaj sekcję opinii…" : kind === "sklep" ? "Opisz sklep: branża, produkty, styl…" : "Opisz stronę, którą chcesz…"}
              onChange={(e) => setPrompt(e.target.value)}
              className="ta" style={{ minHeight: 64 }}
            />
          </div>
          {/* ETAP 11 — strategia przed budową: branża, grupa docelowa, USP, sekcje, ton */}
          {!html && (
            <button className="btn" style={{ width: "100%", marginBottom: 8 }} disabled={busy || !canBuild} onClick={analyze}>
              {busy ? "Analizuję…" : "🧭 Strategia (branża, USP, sekcje) — przed budową"}
            </button>
          )}
          {strategy && !html && (
            <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>🧭 Strategia (użyję jej przy budowie)</span>
                <button className="chip" style={{ fontSize: 11, padding: "1px 8px" }} onClick={() => setStrategy("")} title="Odrzuć">✕</button>
              </div>
              <textarea className="ta" style={{ minHeight: 120, marginTop: 6, fontSize: 12.5 }} value={strategy} onChange={(e) => setStrategy(e.target.value)} />
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => run(!!html)} disabled={busy || (html ? !prompt.trim() : !canBuild)}>
              {busy ? "Buduję…" : html ? "✏ Zastosuj zmianę" : strategy ? "✨ Zbuduj wg strategii" : kind === "sklep" ? "🛒 Zbuduj sklep" : "✨ Zbuduj stronę"}
            </button>
            {html && (
              <button className="btn" style={{ flex: 1 }} onClick={download}>⬇ Pobierz .html</button>
            )}
          </div>
          {html && (
            <div className="chips" style={{ marginTop: 8 }}>
              <button className="btn" style={{ flex: 1, marginTop: 0 }} onClick={() => copyWithToast(html, "Kod skopiowany ✓")}>
                📋 Kopiuj kod
              </button>
              <button className="btn" style={{ flex: 1, marginTop: 0 }} onClick={() => copyWithToast(clientHandoverMessage(brief.business), "Wiadomość do klienta skopiowana ✓")}>
                📨 Wiadomość do klienta
              </button>
            </div>
          )}

          {/* 💾 Projekty stron — zapis / wczytanie / wersje / eksport / import (zawsze dostępne) */}
          <details className="journal-card" style={{ marginTop: 10, padding: "8px 12px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>💾 Projekty {projs.length ? `(${projs.length})` : ""}</summary>
            <div className="field" style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input value={projName} placeholder="Nazwa projektu" onChange={(e) => setProjName(e.target.value)} style={{ flex: "1 1 140px" }} />
              <button className="btn" style={{ width: "auto", marginTop: 0 }} disabled={!html} onClick={saveProject}>💾 Zapisz</button>
              <button className="btn" style={{ width: "auto", marginTop: 0 }} disabled={!html} onClick={saveAsNew}>＋ Jako nowy</button>
            </div>
            {projId && <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Aktywny projekt — „Zapisz" nadpisuje i dodaje wersję do historii.</p>}
            {projs.length > 0 ? (
              <div style={{ marginTop: 6 }}>
                {projs.map((p) => (
                  <div key={p.id} className="journal-card" style={{ padding: "8px 10px", marginTop: 6, border: projId === p.id ? "1px solid var(--cyan)" : undefined }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{p.kind} · {new Date(p.updatedAt).toLocaleString("pl-PL")} · wersji: {p.versions?.length || 1}</div>
                    <div className="chips" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
                      <button className="chip" onClick={() => loadProject(p)}>📂 Wczytaj</button>
                      {(p.versions?.length || 0) > 1 && <button className="chip" onClick={() => restoreVersion(p, 1)}>↩ Poprzednia wersja</button>}
                      <button className="chip" onClick={() => renameProj(p)}>✏ Nazwa</button>
                      <button className="chip" onClick={() => exportProject(p.id)}>⬇ Eksport</button>
                      <button className="chip" onClick={() => delProject(p.id)}>🗑 Usuń</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Brak zapisanych projektów. Zbuduj stronę i kliknij „Zapisz".</p>
            )}
            <label className="btn" style={{ display: "inline-block", marginTop: 8, cursor: "pointer" }}>
              📥 Importuj projekt (.json)
              <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importProject(f); e.currentTarget.value = ""; }} />
            </label>
          </details>

          {/* ➕ Sekcje premium (ETAP 4) — model wstawia spójnie ze stylem strony */}
          {html && (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>➕ Dodaj sekcję premium</div>
              <div className="chips" style={{ flexWrap: "wrap", gap: 6 }}>
                {SECTION_PRESETS.map((s) => (
                  <button key={s.id} className="chip" disabled={busy} title={s.instruction} onClick={() => run(true, s.instruction)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 🔎 Audyt jakości (SEO/dostępność/UX) + pętla samodoskonalenia */}
          {html && audit && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>🔎 Jakość strony</span>
                <span style={{ fontSize: 16, fontWeight: 800, flexShrink: 0, color: audit.score >= 85 ? "#39d98a" : audit.score >= 60 ? "var(--gold)" : "#ff6b6b" }}>{audit.score}/100</span>
              </div>
              {audit.missing.length > 0 ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Do poprawy: {audit.missing.join(", ")}.</div>
              ) : (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Komplet: SEO, schema.org, dostępność, FAQ, formularz, RODO ✓</div>
              )}
              <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={improve}>
                {busy ? "Ulepszam…" : "✨ Ulepsz automatycznie (krytyka + wyższy poziom)"}
              </button>
            </div>
          )}

          {/* 🎯 Conversion AI (CRO) — osobny panel mocy sprzedażowej (nieinwazyjny dodatek) */}
          {html && (() => {
            const cro = conversionAudit(html);
            return (
              <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>🎯 Konwersja (CRO)</span>
                  <span style={{ fontSize: 16, fontWeight: 800, flexShrink: 0, color: cro.score >= 85 ? "#39d98a" : cro.score >= 60 ? "var(--gold)" : "#ff6b6b" }}>{cro.score}/100 · {cro.grade}</span>
                </div>
                {cro.topFixes.length > 0 ? (
                  <ul className="muted" style={{ fontSize: 12, marginTop: 4, paddingLeft: 16 }}>
                    {cro.topFixes.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
                  </ul>
                ) : (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Mocna strona sprzedażowa: CTA, dowód społeczny, lead capture ✓</div>
                )}
                {cro.topFixes.length > 0 && (
                  <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => run(true, conversionFixInstruction(cro))}>
                    {busy ? "Optymalizuję…" : "🎯 Podnieś konwersję (zastosuj poprawki)"}
                  </button>
                )}
              </div>
            );
          })()}

          {/* 🔍 Podgląd w Google + social — jak strona wygląda w wynikach i przy udostępnieniu */}
          {html && (() => {
            const seo = assessSeo(html);
            const m = seo.meta;
            const host = (m.canonical || "https://twojastrona.pl").replace(/^https?:\/\//, "").replace(/\/$/, "");
            return (
              <details className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--cyan)" }}>
                  🔍 Podgląd w Google + social {seo.issues.length > 0 ? `· ${seo.issues.length} do poprawy` : "· OK ✓"}
                </summary>
                {/* Snippet Google */}
                <div style={{ marginTop: 10, background: "rgba(255,255,255,.04)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: "#bdbdbd" }}>{host}</div>
                  <div style={{ fontSize: 15, color: "#8ab4f8", lineHeight: 1.2, marginTop: 2 }}>{m.title || "(brak tytułu — Google wybierze sam)"}</div>
                  <div style={{ fontSize: 12, color: "#cfcfcf", marginTop: 2 }}>{m.description || "(brak opisu — Google wytnie losowy fragment strony)"}</div>
                </div>
                {/* Karta social (OG) */}
                <div style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ height: 64, background: m.ogImage ? "#0c1118" : "rgba(255,107,107,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted)" }}>
                    {m.ogImage ? "🖼 og:image ✓" : "⚠ brak og:image (link bez miniatury)"}
                  </div>
                  <div style={{ padding: "6px 10px" }}>
                    <div style={{ fontSize: 11, color: "#bdbdbd", textTransform: "uppercase" }}>{host}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.ogTitle || m.title || "(brak og:title)"}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.ogDescription || m.description || ""}</div>
                  </div>
                </div>
                {seo.issues.length > 0 && (
                  <>
                    <ul className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 16 }}>
                      {seo.issues.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
                    </ul>
                    <button className="btn" style={{ width: "100%", marginTop: 6 }} disabled={busy} onClick={() => run(true, seoFixInstruction(seo))}>
                      {busy ? "Poprawiam…" : "🔍 Popraw SEO (zastosuj meta + Open Graph)"}
                    </button>
                  </>
                )}
              </details>
            );
          })()}

          {/* 💰 Automatyczna wycena — realne widełki rynku PL */}
          <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={busy} onClick={() => setQuote(estimateQuote(kind, brief))}>
            💰 Wyceń (rynek PL) — {zl(estimateQuote(kind, brief).totalMin)}–{zl(estimateQuote(kind, brief).totalMax)}
          </button>
          {quote && (
            <div className="journal-card" style={{ padding: "10px 12px", marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>💰 Wycena (orientacyjna)</div>
              {quote.oneTime.map((l) => (
                <div key={l.label} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                  <span style={{ minWidth: 0 }}>{l.label}</span><span className="muted" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{zl(l.min)}–{zl(l.max)}</span>
                </div>
              ))}
              <div style={{ fontSize: 13, fontWeight: 700, display: "flex", justifyContent: "space-between", marginTop: 4, borderTop: "1px solid var(--line)", paddingTop: 4 }}>
                <span>Razem (jednorazowo)</span><span>{zl(quote.totalMin)}–{zl(quote.totalMax)}</span>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Cyklicznie: {quote.recurring.map((l) => `${l.label} ${zl(l.min)}–${zl(l.max)}/${l.per}`).join(" · ")}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Rynkowo w PL: {zl(quote.marketMin)}–{zl(quote.marketMax)} za samą stronę tego typu.
              </div>
              <button className="btn" style={{ marginTop: 8, width: "auto", padding: "5px 12px", fontSize: 12 }} onClick={() => copyWithToast(formatQuote(quote, brief), "Oferta cenowa skopiowana ✓")}>
                📄 Kopiuj ofertę cenową
              </button>
            </div>
          )}

          {/* 📦 Pakiety Start/Pro/Premium — ułatwiają klientowi decyzję */}
          <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={busy} onClick={() => setPackages(quotePackages(kind, brief))}>
            📦 Pakiety (Start / Pro / Premium)
          </button>
          {packages && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                {packages.map((p) => (
                  <div key={p.id} className="journal-card" style={{ padding: "8px 10px", border: p.recommended ? "1px solid var(--gold)" : undefined }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}{p.recommended ? " ⭐" : ""}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "var(--cyan)", margin: "2px 0 6px" }}>{zl(p.price)}</div>
                    <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, lineHeight: 1.5 }}>
                      {p.features.map((f) => (<li key={f}>{f}</li>))}
                    </ul>
                  </div>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 8, width: "auto", padding: "5px 12px", fontSize: 12 }} onClick={() => copyWithToast(formatPackages(packages, brief), "Pakiety skopiowane ✓")}>
                📄 Kopiuj pakiety dla klienta
              </button>
            </>
          )}
          {err && <p className="muted">{err}</p>}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
