import { useState } from "react";
import { generateSite, buildClientBrief, clientHandoverMessage, type SiteKind, type SiteStyle, type ClientBrief } from "../lib/webgen";
import { useEscape } from "../hooks/useEscape";
import { copyWithToast } from "../lib/toast";
import Guide from "./Guide";

const KINDS: { id: SiteKind; label: string }[] = [
  { id: "auto", label: "✨ Auto" },
  { id: "sklep", label: "🛒 Sklep" },
  { id: "landing", label: "🚀 Landing" },
  { id: "firma", label: "🏢 Firma" },
  { id: "portfolio", label: "🎨 Portfolio" },
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

  const briefText = buildClientBrief(brief);
  const canBuild = !!(prompt.trim() || briefText);

  const run = async (edit: boolean) => {
    // Edycja wymaga polecenia; budowa od zera może wyjść z briefu i/lub opisu.
    if (edit ? !prompt.trim() : !canBuild) return;
    setBusy(true);
    setErr("");
    try {
      const desc = edit ? prompt : [briefText, prompt].filter((s) => s.trim()).join("\n\n");
      const r = await generateSite(desc, edit && html ? html : undefined, kind, style);
      if ("error" in r) setErr(r.error);
      else {
        setHtml(r.html);
        setView("preview");
        if (edit) setPrompt("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); // zawsze odblokuj przycisk, nawet przy nieoczekiwanym błędzie
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
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => run(!!html)} disabled={busy || (html ? !prompt.trim() : !canBuild)}>
              {busy ? "Buduję…" : html ? "✏ Zastosuj zmianę" : kind === "sklep" ? "🛒 Zbuduj sklep" : "✨ Zbuduj stronę"}
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
          {err && <p className="muted">{err}</p>}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
