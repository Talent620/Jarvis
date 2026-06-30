import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import { copyWithToast } from "../lib/toast";
import { resolveProvider } from "../lib/brain";
import { store, uid } from "../lib/store";
import { parseItems, basketSummary, findBasket, shoppingToText, syncShoppingItems, type BasketLine } from "../lib/basket";

// Lista zakupów — wpisujesz kilka rzeczy naraz, JARVIS znajduje każdą najtaniej
// i liczy łączną sumę koszyka. Każda pozycja korzysta z Łowcy Okazji.
// Lista jest TRWAŁA: zapisuje się do store.data.shopping (przeżywa zamknięcie i restart;
// współdzielona z narzędziami czatu add_shopping_item / list_shopping).

export default function ShoppingList({ onClose }: { onClose: () => void }) {
  // Wczytaj zapisaną listę przy otwarciu (jednorazowo).
  const [text, setText] = useState(() => shoppingToText(store.data.shopping));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [lines, setLines] = useState<BasketLine[] | null>(null);
  const ready = !!resolveProvider();

  const items = useMemo(() => parseItems(text), [text]);
  const summary = useMemo(() => (lines ? basketSummary(lines) : null), [lines]);

  // Trwałość: zapisuj listę do store (debounce), by przeżyła zamknięcie ekranu.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; } // nie nadpisuj przy montażu
    const t = setTimeout(() => {
      store.setData((d) => { d.shopping = syncShoppingItems(d.shopping, items, uid, Date.now()); });
    }, 400);
    return () => clearTimeout(t);
  }, [items]);

  const run = async () => {
    if (!items.length || busy) return;
    setBusy(true);
    setLines(null);
    setProgress({ done: 0, total: items.length, label: items[0] });
    try {
      const result = await findBasket(items, (done, total, line) => {
        setProgress({ done, total, label: done < total ? items[done] : "" });
        setLines((prev) => [...(prev || []), line]);
      });
      setLines(result);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const money = (n: number, c: string) => `${n.toLocaleString("pl-PL")} ${c}`;

  return (
    <Modal
      title="🛒 Lista zakupów — kup wszystko najtaniej"
      onClose={onClose}
      foot={<button className="btn" onClick={onClose}>Zamknij</button>}
    >
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Wpisz kilka rzeczy (każda w nowej linii lub po przecinku). JARVIS znajdzie każdą najtaniej i policzy sumę.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"np.\nwiertarka Bosch\nopona 205/55 R16\nlampa do Golfa"}
            rows={4}
            style={{ width: "100%", boxSizing: "border-box", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 15, resize: "vertical" }}
          />

          {items.length > 0 && (
            <div className="chips" style={{ flexWrap: "wrap", marginTop: 6 }}>
              {items.map((it, i) => <span key={i} className="chip">{it}</span>)}
            </div>
          )}

          <button className="btn primary" style={{ marginTop: 10, width: "100%" }} onClick={run} disabled={busy || !items.length}>
            {busy ? `Szukam… ${progress ? `${progress.done}/${progress.total}` : ""}` : `🔍 Znajdź wszystko najtaniej${items.length ? ` (${items.length})` : ""}`}
          </button>

          {busy && progress && progress.label && (
            <p className="muted" style={{ textAlign: "center", fontSize: 14, marginTop: 8 }}>🌐 Sprawdzam: „{progress.label}"…</p>
          )}

          {/* Wyniki — najtańsza oferta dla każdej pozycji */}
          {lines && lines.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {lines.map((l, i) => (
                <div key={i} className="journal-card" style={{ padding: "10px 12px", borderLeft: `3px solid ${l.best ? "var(--ok, #58e08a)" : "var(--line)"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                    <span style={{ fontWeight: 600, minWidth: 0 }}>{l.query}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {l.best ? money(l.best.price, l.best.currency) : "—"}
                    </span>
                  </div>
                  {l.best ? (
                    <>
                      <div style={{ fontSize: 13, marginTop: 2 }}>{l.best.condition === "used" ? "🔁 używane" : "✨ nowe"} · {l.best.source} — {l.best.title}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <a className="chip" href={l.best.url} target="_blank" rel="noopener">🔗 Otwórz</a>
                        <button className="chip" onClick={() => copyWithToast(l.best!.url)}>📋 Kopiuj link</button>
                      </div>
                    </>
                  ) : (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{l.error ? "Błąd wyszukiwania" : "Nie znaleziono oferty"}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Podsumowanie koszyka */}
          {summary && (lines?.length ?? 0) > 0 && !busy && (
            <div className="journal-card" style={{ marginTop: 12, padding: "12px 14px", borderLeft: "3px solid var(--gold)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>Razem najtaniej</span>
                <span style={{ fontWeight: 800, fontSize: 20 }}>{money(summary.total, summary.currency)}</span>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                Znaleziono {summary.found} z {summary.found + summary.missing} pozycji{summary.missing > 0 ? ` · ${summary.missing} bez ceny` : ""}.
              </p>
            </div>
          )}

          {!ready && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>💡 Lista zakupów używa mózgu AI z wyszukiwaniem w sieci — wklej klucz w ⚙ → AI (np. Claude lub Gemini).</p>}
    </Modal>
  );
}
