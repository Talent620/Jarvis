import { useEffect, useRef, useState } from "react";
import { createListener, isSpeechSupported, speakLang, stopSpeaking, TTS_VOICES, type VoiceListener } from "../lib/voice";
import { translateText } from "../lib/translate";
import { resolveProvider } from "../lib/brain";
import { primaryKey } from "../lib/keys";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { LANGS, getLang } from "../lib/langs";
import { copyWithToast } from "../lib/toast";
import { useEscape } from "../hooks/useEscape";

// Tryb Tłumacza — rozmowa na żywo dwóch osób w różnych językach, z głosem
// PREMIUM (Gemini TTS — naturalny, wielojęzyczny). Strona A mówi → JARVIS
// rozpoznaje, tłumaczy i czyta na głos w języku strony B. Tryb Auto prowadzi
// rozmowę ping-pong (po przeczytaniu od razu słucha drugiej osoby).

interface Turn { side: "A" | "B"; src: string; dst: string; }

export default function Translator({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { settings } = useStore();
  const [a, setA] = useState("pl");
  const [b, setB] = useState("uk");
  const [log, setLog] = useState<Turn[]>([]);
  const [listening, setListening] = useState<"A" | "B" | "">("");
  const [speaking, setSpeaking] = useState(false);
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
  const premium = !!primaryKey("gemini"); // głos premium dostępny?
  const voice = settings.translatorVoice || "Aoede";

  useEffect(() => () => { listenerRef.current?.stop(); stopSpeaking(); }, []);

  const stop = () => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening("");
    setInterim("");
  };

  const say = async (text: string, ttsLang: string) => {
    setSpeaking(true);
    try { await speakLang(text, ttsLang, { voice }); } finally { setSpeaking(false); }
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
        setLog((l) => [...l, { side, src: text.trim(), dst: dst || "(nie udało się przetłumaczyć)" }]);
        if (dst) await say(dst, to.tts);
        if (autoRef.current) setTimeout(() => listen(side === "A" ? "B" : "A"), 350);
      },
    });
    listener.start(from.stt);
    listenerRef.current = listener;
    setListening(side);
  };

  const tap = (side: "A" | "B") => { listening === side ? stop() : listen(side); };
  const swap = () => { setA(b); setB(a); };

  const Picker = ({ val, set }: { val: string; set: (v: string) => void }) => (
    <select value={val} onChange={(e) => set(e.target.value)}
      style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px", fontSize: 15 }}>
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
    </select>
  );

  const MicBtn = ({ side, lang }: { side: "A" | "B"; lang: typeof langA }) => {
    const on = listening === side;
    return (
      <button
        className={`btn ${on ? "" : "primary"}`}
        style={{ flex: 1, padding: "18px 8px", fontSize: 17, lineHeight: 1.3, borderColor: on ? "var(--ok, #58e08a)" : undefined, boxShadow: on ? "0 0 0 2px var(--ok, #58e08a) inset" : undefined }}
        onClick={() => tap(side)}
        disabled={busy && !on}
      >
        <div style={{ fontSize: 26 }}>{lang.flag}</div>
        {on ? "🎙 Słucham…" : `Mów: ${lang.label}`}
      </button>
    );
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🌍 Tłumacz na żywo</h2>
        </div>
        <div className="panel-body">
          {/* Języki */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Picker val={a} set={setA} />
            <button className="chip" onClick={swap} title="Zamień strony">⇄</button>
            <Picker val={b} set={setB} />
          </div>

          {/* Głos + tryb auto */}
          <div className="field" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 14 }}>🔊 Głos:</span>
            <select
              value={voice}
              onChange={(e) => store.setSettings({ translatorVoice: e.target.value })}
              disabled={!premium}
              style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 8px", fontSize: 14 }}
            >
              {TTS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: -2 }}>
            {premium ? "✨ Głos premium (Gemini) — naturalny, brzmi jak żywy człowiek." : "Głos systemowy. Dodaj klucz Gemini w ⚙ → AI, by włączyć naturalny głos premium ✨."}
          </p>

          <label className="row" style={{ cursor: "pointer", margin: "8px 0" }}>
            <span>🔁 Tryb Auto — po tłumaczeniu od razu słucha drugiej osoby</span>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          </label>

          {/* Przyciski mówienia */}
          <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
            <MicBtn side="A" lang={langA} />
            <MicBtn side="B" lang={langB} />
          </div>

          {/* Status na żywo */}
          {listening && (
            <p style={{ textAlign: "center", color: "var(--ok, #58e08a)", fontSize: 14, margin: "6px 0" }}>
              ● słucham… {interim && <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>„{interim}"</span>}
            </p>
          )}
          {busy && <p className="muted" style={{ textAlign: "center", fontSize: 14 }}>🌐 Tłumaczę…</p>}
          {speaking && <p className="muted" style={{ textAlign: "center", fontSize: 14 }}>🔊 Mówię…</p>}
          {err && <p style={{ color: "#e08558", fontSize: 13 }}>{err}</p>}
          {!ready && <p className="muted" style={{ fontSize: 12 }}>💡 Tłumacz używa mózgu AI — wklej klucz w ⚙ → AI (np. Claude).</p>}

          {/* Rozmowa (dymki kolorowane wg strony) */}
          <div style={{ marginTop: 10 }}>
            {log.length === 0 ? (
              <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>
                Dotknij przycisku swojego języka i mów. JARVIS przetłumaczy i przeczyta na głos w drugim języku. 💛
              </p>
            ) : (
              [...log].reverse().map((t, i) => {
                const from = t.side === "A" ? langA : langB;
                const to = t.side === "A" ? langB : langA;
                const mine = t.side === "A";
                return (
                  <div key={log.length - i} className="journal-card"
                    style={{ padding: "10px 12px", borderLeft: `3px solid ${mine ? "var(--cyan)" : "var(--gold)"}` }}>
                    <div className="muted" style={{ fontSize: 11 }}>{from.flag} {from.label} → {to.flag} {to.label}</div>
                    <div style={{ fontSize: 13, opacity: 0.65 }}>{t.src}</div>
                    <div style={{ fontSize: 18, marginTop: 3, fontWeight: 500 }}>{t.dst}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="chip" onClick={() => say(t.dst, to.tts)}>🔊 Powtórz</button>
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
          <button className="btn" onClick={() => { stop(); stopSpeaking(); onClose(); }}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
