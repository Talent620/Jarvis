import { useMemo, useState } from "react";
import { useStore } from "../hooks/useStore";
import { generateContentPack, generateProductIdeas } from "../lib/content";
import { runProspecting } from "../lib/prospect";
import { copyWithToast } from "../lib/toast";
import { useEscape } from "../hooks/useEscape";

export default function MoneyHub({ onClose, onSales, onWeb }: { onClose: () => void; onSales: () => void; onWeb: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const leads = data.leads || [];
  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState("Instagram");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState("");
  const [hunting, setHunting] = useState(false);
  const [huntMsg, setHuntMsg] = useState("");

  const hunt = async () => {
    setHunting(true);
    setHuntMsg("🔎 Szukam firm w Twojej niszy…");
    const r = await runProspecting();
    setHunting(false);
    if (r.error) setHuntMsg(`⚙ ${r.error} Ustaw niszę i lokalizację w ⚙ → Zachowanie oraz klucz Tavily w ⚙ → AI.`);
    else if (r.added > 0) setHuntMsg(`✅ Dodałem ${r.added} nowych leadów do Pulpitu Sprzedaży.`);
    else setHuntMsg("Brak nowych firm tym razem — zmień niszę/lokalizację w ⚙ → Zachowanie.");
  };

  const stats = useMemo(() => {
    const won = leads.filter((l) => l.status === "won");
    const pipeline = leads.filter((l) => l.status !== "lost" && l.status !== "won");
    return {
      total: leads.length,
      earned: won.reduce((s, l) => s + (l.value || 0), 0),
      potential: pipeline.reduce((s, l) => s + (l.value || 0), 0),
      offers: leads.filter((l) => l.offer).length,
    };
  }, [leads]);

  const run = async (kind: "content" | "product") => {
    if (!niche.trim()) {
      setOut("Wpisz najpierw niszę — np. dietetyk, warsztat samochodowy, fotograf.");
      return;
    }
    setBusy(kind);
    setOut("");
    const r = kind === "content" ? await generateContentPack(niche, platform, 5) : await generateProductIdeas(niche);
    setOut("error" in r ? r.error : r.text);
    setBusy("");
  };

  const copy = () => copyWithToast(out);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>💰 Zarabianie</h2>
        </div>
        <div className="panel-body">
          {/* Kokpit */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontFamily: "Orbitron", color: "var(--gold)" }}>{stats.potential} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>w toku</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontFamily: "Orbitron", color: "var(--ok, #58e08a)" }}>{stats.earned} zł</div>
              <div className="muted" style={{ fontSize: 11 }}>zarobione</div>
            </div>
            <div className="journal-card" style={{ flex: 1, margin: 0, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontFamily: "Orbitron", color: "var(--cyan)" }}>{stats.offers}</div>
              <div className="muted" style={{ fontSize: 11 }}>ofert gotowych</div>
            </div>
          </div>

          {/* Skróty — szybkie wejścia do narzędzi zarabiania */}
          <h3>🏢 Agencja stron na autopilocie</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: -2 }}>
            JARVIS znajduje firmy, pisze oferty i buduje demo. Ty wysyłasz i rozmawiasz.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className="btn primary" onClick={hunt} disabled={hunting}>
              {hunting ? "🔎 Szukam…" : "🔎 Znajdź leady"}
            </button>
            <button className="btn" onClick={onSales}>📈 Pulpit Sprzedaży</button>
            <button className="btn" style={{ gridColumn: "1 / -1" }} onClick={onWeb}>🌐 Kreator stron — zbuduj demo</button>
          </div>
          {huntMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{huntMsg}</p>}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Auto-prospekting i auto-oferty włączysz w ⚙ → Zachowanie. Powiedz też: „znajdź leady: [nisza] w [miasto] i zapisz je".
          </p>

          {/* Generatory treści/produktów */}
          <h3 style={{ marginTop: 14 }}>✍ Fabryka treści i produktów</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Zarabiaj treścią (afiliacja, marka) lub sprzedażą produktów cyfrowych. Podaj niszę:
          </p>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <input value={niche} placeholder="Nisza (np. fitness, finanse, gotowanie)" onChange={(e) => setNiche(e.target.value)} style={{ flex: 2 }} />
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "0 8px" }}>
              {["Instagram", "TikTok", "Facebook", "LinkedIn", "Blog", "X (Twitter)"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => run("content")} disabled={!!busy}>
              {busy === "content" ? "Tworzę…" : "📝 Paczka 5 postów"}
            </button>
            <button className="btn" style={{ flex: 1 }} onClick={() => run("product")} disabled={!!busy}>
              {busy === "product" ? "Myślę…" : "📦 Pomysły na produkt"}
            </button>
          </div>

          {out && (
            <div style={{ marginTop: 12 }}>
              <textarea
                readOnly
                value={out}
                onFocus={(e) => e.currentTarget.select()}
                className="ta" style={{ minHeight: "32vh", fontSize: 14 }}
              />
              <button className="btn" onClick={copy}>📋 Kopiuj</button>
            </div>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
            <b>Uczciwie:</b> JARVIS robi 95% pracy (research, pisanie, budowa). Pieniądze powstają,
            gdy Ty dowieziesz ludzką część (wysyłka, publikacja, rozmowa). To dźwignia, nie bankomat —
            ale przy konsekwencji realnie działa.
          </p>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
