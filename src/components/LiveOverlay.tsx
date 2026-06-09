import { useEffect, useRef, useState } from "react";
import { LiveSession, type LiveState } from "../lib/liveVoice";
import { systemPrompt } from "../lib/brain";
import { store } from "../lib/store";

const LABEL: Record<LiveState, string> = {
  connecting: "Łączę…",
  listening: "Słucham…",
  speaking: "Mówię…",
  closed: "Rozłączono",
  error: "Błąd połączenia",
};

export default function LiveOverlay({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<LiveState>("connecting");
  const [detail, setDetail] = useState("");
  const [caption, setCaption] = useState("");
  const sessionRef = useRef<LiveSession | null>(null);
  const key = store.settings.keys.gemini;

  useEffect(() => {
    if (!key) {
      setState("error");
      setDetail("Tryb na żywo wymaga klucza Google Gemini. Dodaj go w ⚙ Ustawienia.");
      return;
    }
    const session = new LiveSession(
      key,
      systemPrompt(),
      (s, d) => {
        setState(s);
        if (d) setDetail(d);
      },
      (t) => setCaption((c) => (c + t).slice(-300)),
    );
    sessionRef.current = session;
    session.start().catch(() => setState("error"));
    return () => session.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    sessionRef.current?.stop();
    onClose();
  };

  const orbClass =
    state === "speaking" ? "speaking" : state === "listening" ? "listening" : "thinking";

  return (
    <div className="sheet live" onClick={(e) => e.stopPropagation()}>
      <div className="live-inner">
        <div className="brand" style={{ textAlign: "center" }}>
          JARVIS
          <small>ROZMOWA NA ŻYWO · GEMINI LIVE</small>
        </div>

        <div className="orb-wrap" style={{ transform: "scale(1.6)", margin: "40px 0" }}>
          <div className={`orb ${orbClass}`}>
            <div className="ring r1" />
            <div className="ring r2" />
            <div className="ring r3" />
            <div className="core" />
          </div>
        </div>

        <div className="orb-status" style={{ fontSize: 14 }}>
          {LABEL[state]}
        </div>

        {detail && (state === "error" || state === "closed") && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 340, color: state === "error" ? "var(--danger, #ff6b6b)" : undefined }}>
            {detail}
          </p>
        )}
        {(state === "error" || state === "closed") && (
          <button
            className="btn"
            style={{ maxWidth: 220, marginTop: 14 }}
            onClick={() => {
              if (!key) return;
              sessionRef.current?.stop(); // zwolnij mikrofon/audio starej sesji
              setCaption("");
              setDetail("");
              setState("connecting");
              const s = new LiveSession(
                key,
                systemPrompt(),
                (st, d) => {
                  setState(st);
                  if (d) setDetail(d);
                },
                (t) => setCaption((c) => (c + t).slice(-300)),
              );
              sessionRef.current = s;
              s.start().catch(() => setState("error"));
            }}
          >
            ↻ Połącz ponownie
          </button>
        )}
        {caption && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 360, marginTop: 18 }}>
            {caption}
          </p>
        )}

        <button className="btn" style={{ maxWidth: 220, marginTop: 28 }} onClick={close}>
          ■ Zakończ rozmowę
        </button>
      </div>
    </div>
  );
}
