import { useEffect, useRef, useState } from "react";
import { createListener, isSpeechSupported, speakLang, stopSpeaking, type VoiceListener } from "../lib/voice";
import { translateText } from "../lib/translate";
import { resolveProvider } from "../lib/brain";
import { LANGS, getLang } from "../lib/langs";
import { copyWithToast } from "../lib/toast";
import { useEscape } from "../hooks/useEscape";

// Tryb Tłumacza — rozmowa na żywo dwóch osób w różnych językach.
// Strona A mówi (np. po polsku) → JARVIS rozpoznaje, tłumaczy na język strony B
// (np. ukraiński), wyświetla i CZYTA na głos. I odwrotnie. Tryb Auto prowadzi
// rozmowę „ping-pong": po przeczytaniu tłumaczenia od razu słucha drugiej osoby.

interface Turn { side: "A" | "B"; src: string; dst: string; }

export default function Translator({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [a, setA] = useState("pl");
  const [b, setB] = useState("uk");
  const [log, setLog] = useState<Turn[]>([]);
  const [listening, setListening] = useState<"A" | "B" | "">("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState("");
  const listenerRef = useRef<VoiceListener | null>(null);
  const autoRef = useRef(false);
  autoRef.current = auto;
  const langA = getLang(a);
  const langB = getLang(b);
  const ready = !!resolveProvider();

  useEffect(() => () => { listenerRef.current?.stop(); stopSpeaking(); }, []);

  const stop = () => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening("");
    setInterim("");
  };

  const listen = (side: "A" | "B") => {
    if (!ready) { setErr("Najpierw wpisz klucz AI w ⚙ → AI — to mózg tłumacza."); return; }
    if (!isSpeechSupported()) { setErr("To urządzenie nie wspiera rozpoznawania mowy (na Windows dodaj klucz Groq w ⚙ → AI)."); return; }
    setErr("");
    stopSpeaking();
    listenerRef.current?.stop();
    const from = side === "A" ? langA : langB;
    const to = side === "A" ? langB : langA;
    const listener = createListener({
      wakeWord: false,
      onInterim: (t) => setInterim(t),
      onError: (m) => { setErr(m); setListening(""); setInterim(""); },
      onFinal: async (text) => {
        setInterim("");
        setListening("");
        if (!text.trim()) { if (autoRef.current) listen(side); return; }
        setBusy(true);
        const dst = await translateText(text, to.name);
        setBusy(false);
        const turn: Turn = { side, src: text.trim(), dst: dst || "(nie udało się przetłumaczyć)" };
        setLog((l) => [...l, turn]);
        if (dst) await speakLang(dst, to.tts);
        // Tryb Auto: oddaj głos drugiej osobie (płynna rozmowa tam i z powrotem).
        if (autoRef.current) setTimeout(() => listen(side === "A" ? "B" : "A"), 400);
      },
    });
    listener.start(from.stt);
    listenerRef.current = listener;
    setListening(side);
  };

  const tap = (side: "A" | "B") => {
    if (listening === side) { stop(); return; }
    listen(side);
  };

  const swap = () => { setA(b); setB(a); };
  const Picker = ({ val, set }: { val: string; set: (v: string) => void }) => (
    <select value={val} onChange={(e) => set(e.target.value)}
      style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 8px", fontSize: 15 }}>
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
    </select>
  );

  const MicBtn = ({ side, lang }: { side: "A" | "B"; lang: typeof langA }) => (
    <button
      className={`btn ${listening === side ? "" : "primary"}`}
      style={{ flex: 1, padding: "16px 8px", fontSize: 16, borderColor: listening === side ? "var(--ok, #58e08a)" : undefined }}
      onClick={() => tap(side)}
      disabled={busy && listening !== side}
    >
      {listening === side ? "🎙 Słucham… (dotknij, by zakończyć)" : `🎤 Mów: ${lang.flag} ${lang.label}`}
    </button>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🌍 Tłumacz na żywo</h2>
        </div>
        <div className="panel-body">
          {/* Wybór języków */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
            <Picker val={a} set={setA} />
            <button className="chip" onClick={swap} title="Zamień języki">⇄</button>
            <Picker val={b} set={setB} />
          </div>

          <label className="row" style={{ cursor: "pointer", margin: "10px 0 4px" }}>
            <span>🔁 Tryb Auto — po przetłumaczeniu od razu słucha drugiej osoby</span>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          </label>

          {/* Przyciski mówienia */}
          <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
            <MicBtn side="A" lang={langA} />
            <MicBtn side="B" lang={langB} />
          </div>
          {busy && <p className="muted" style={{ textAlign: "center", fontSize: 13 }}>🌐 Tłumaczę…</p>}
          {interim && <p className="muted" style={{ textAlign: "center", fontStyle: "italic" }}>{interim}</p>}
          {err && <p style={{ color: "#e08558", fontSize: 13 }}>{err}</p>}
          {!ready && <p className="muted" style={{ fontSize: 12 }}>💡 Tłumacz używa mózgu AI — wklej klucz w ⚙ → AI (np. Claude).</p>}

          {/* Rozmowa */}
          <div style={{ marginTop: 10 }}>
            {log.length === 0 ? (
              <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>
                Dotknij przycisku swojego języka i mów. JARVIS przetłumaczy i przeczyta na głos w drugim języku.
              </p>
            ) : (
              [...log].reverse().map((t, i) => {
                const from = t.side === "A" ? langA : langB;
                const to = t.side === "A" ? langB : langA;
                return (
                  <div key={log.length - i} className="journal-card" style={{ padding: "8px 10px" }}>
                    <div className="muted" style={{ fontSize: 11 }}>{from.flag} {from.label} → {to.flag} {to.label}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>{t.src}</div>
                    <div style={{ fontSize: 16, marginTop: 2 }}>{t.dst}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button className="chip" onClick={() => speakLang(t.dst, to.tts)}>🔊 Powtórz</button>
                      <button className="chip" onClick={() => copyWithToast(t.dst)}>📋 Kopiuj</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {log.length > 0 && (
            <button className="btn" style={{ marginTop: 8 }} onClick={() => setLog([])}>🗑 Wyczyść rozmowę</button>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={() => { stop(); onClose(); }}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
