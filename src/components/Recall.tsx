import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { recallEverything, type RecallType, type RecallHit } from "../lib/recall";
import { toastOk } from "../lib/toast";

// === 🔎 Recall — przeszukaj CAŁE swoje życie w JARVISIE (lokalnie) ===
// Jedno pole znajduje rzeczy w historii czatów, dzienniku, pamięci, zadaniach, leadach,
// projektach i notatkach — natychmiast, bez sieci, bez wysyłania danych. To przewaga,
// której ChatGPT/Gemini nie mają: Twoje dane są zindeksowane TYLKO u Ciebie.

const ICON: Record<RecallType, string> = {
  Czat: "💬", Dziennik: "📔", Pamięć: "🧠", Zadanie: "✅", Lead: "📈", Projekt: "📁", Notatka: "🗒",
};

const FILTERS: (RecallType | "Wszystko")[] = ["Wszystko", "Czat", "Dziennik", "Pamięć", "Zadanie", "Lead", "Projekt", "Notatka"];

function when(at?: number): string {
  if (!at) return "";
  try { return new Date(at).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return new Date(at).toLocaleDateString(); }
}

export default function Recall({ onClose, onOpenChat, seed = "" }: { onClose: () => void; onOpenChat?: (id: string) => void; seed?: string }) {
  useEscape(onClose);
  const [q, setQ] = useState(seed);
  const [filter, setFilter] = useState<(RecallType | "Wszystko")>("Wszystko");

  // Indeks budujemy raz na otwarcie panelu; ranking liczymy na żywo przy wpisywaniu.
  const hits = useMemo<RecallHit[]>(() => recallEverything(q, 60), [q]);
  const shown = filter === "Wszystko" ? hits : hits.filter((h) => h.type === filter);

  const copy = async (h: RecallHit) => {
    try { await navigator.clipboard.writeText(`${h.title}\n${h.text}`.trim()); toastOk("Skopiowano ✓"); }
    catch { toastOk("Nie udało się skopiować"); }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🔎 Recall — znajdź wszystko u siebie</h2>
        </div>
        <div className="panel-body">
          <input
            className="input"
            autoFocus
            placeholder="Szukaj w czatach, dzienniku, pamięci, zadaniach…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", fontSize: 16, marginBottom: 10 }}
          />

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {FILTERS.map((f) => (
              <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                {f === "Wszystko" ? "Wszystko" : `${ICON[f]} ${f}`}
              </button>
            ))}
          </div>

          {q.trim().length < 2 ? (
            <p className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
              Wpisz, czego szukasz — JARVIS przeszuka całą Twoją historię lokalnie, bez wysyłania danych. 🔒
            </p>
          ) : shown.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
              Nic nie znalazłem dla „{q.trim()}”. Spróbuj innych słów.
            </p>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Znaleziono: {shown.length}</div>
              {shown.map((h) => (
                <div key={h.id} className="journal-card" style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, lineHeight: "20px" }}>{ICON[h.type]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{h.title || h.type}</div>
                    <div className="muted" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.text}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{h.type}{when(h.at) ? ` · ${when(h.at)}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {h.type === "Czat" && h.openId && onOpenChat && (
                      <button className="chip" onClick={() => { onOpenChat(h.openId!); onClose(); }}>Otwórz</button>
                    )}
                    <button className="chip" onClick={() => copy(h)}>Kopiuj</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
