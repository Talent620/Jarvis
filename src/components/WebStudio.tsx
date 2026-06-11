import { useState } from "react";
import { generateSite } from "../lib/webgen";
import { useEscape } from "../hooks/useEscape";

const IDEAS = [
  "Strona kawiarni Aroma — menu, galeria, godziny, mapa kontaktu, ciepłe kolory",
  "Portfolio fotografa — siatka zdjęć, hero, o mnie, formularz kontaktu, ciemny motyw",
  "Landing aplikacji SaaS — hero z CTA, funkcje, cennik, opinie, FAQ",
  "Strona siłowni — grafik zajęć, trenerzy, karnety, energiczny styl",
];

export default function WebStudio({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [prompt, setPrompt] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"preview" | "code">("preview");

  const run = async (edit: boolean) => {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr("");
    const r = await generateSite(prompt, edit && html ? html : undefined);
    if ("error" in r) setErr(r.error);
    else {
      setHtml(r.html);
      setView("preview");
      if (edit) setPrompt("");
    }
    setBusy(false);
  };

  const download = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strona-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🌐 Kreator stron</h2>
        </div>
        <div className="panel-body">
          {!html && (
            <>
              <p className="muted">
                Opisz stronę, a JARVIS sam zbuduje kompletną, nowoczesną witrynę (HTML+CSS+JS w jednym pliku).
                Podgląd na żywo, edycja słowem, pobranie gotowego pliku.
              </p>
              <div className="chips" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                {IDEAS.map((i) => (
                  <button key={i} className="chip" onClick={() => setPrompt(i)} disabled={busy}>
                    {i.split(" — ")[0]}
                  </button>
                ))}
              </div>
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
              placeholder={html ? "Co zmienić? np. zmień kolor na granat, dodaj sekcję opinii…" : "Opisz stronę, którą chcesz…"}
              onChange={(e) => setPrompt(e.target.value)}
              className="ta" style={{ minHeight: 64 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => run(!!html)} disabled={busy || !prompt.trim()}>
              {busy ? "Buduję…" : html ? "✏ Zastosuj zmianę" : "✨ Zbuduj stronę"}
            </button>
            {html && (
              <button className="btn" style={{ flex: 1 }} onClick={download}>⬇ Pobierz .html</button>
            )}
          </div>
          {err && <p className="muted">{err}</p>}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
