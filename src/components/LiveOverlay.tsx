import { useEffect, useRef, useState } from "react";
import { LiveSession, type LiveState } from "../lib/liveVoice";
import { ConversationLoop, type LoopState } from "../lib/voiceLoop";
import { systemPrompt, resolveProvider } from "../lib/brain";
import { PROVIDERS } from "../lib/providers/registry";
import { store } from "../lib/store";

type Engine = "gemini" | "loop";
type AnyState = LiveState | LoopState;

const LABEL: Record<string, string> = {
  connecting: "Łączę…",
  listening: "Słucham…",
  thinking: "Myślę…",
  speaking: "Mówię…",
  closed: "Zakończono",
  error: "Błąd połączenia",
};

export default function LiveOverlay({ onClose }: { onClose: () => void }) {
  const geminiKey = store.settings.keys.gemini?.trim();
  // Domyślnie Gemini Live (gdy jest klucz), inaczej uniwersalny tryb rozmowy.
  const [engine, setEngine] = useState<Engine>(geminiKey ? "gemini" : "loop");
  const [state, setState] = useState<AnyState>("connecting");
  const [detail, setDetail] = useState("");
  const [caption, setCaption] = useState("");
  const liveRef = useRef<LiveSession | null>(null);
  const loopRef = useRef<ConversationLoop | null>(null);

  const stopAll = () => {
    liveRef.current?.stop();
    liveRef.current = null;
    loopRef.current?.stop();
    loopRef.current = null;
  };

  const startEngine = (which: Engine) => {
    stopAll();
    setCaption("");
    setDetail("");
    setState("connecting");
    if (which === "gemini") {
      if (!geminiKey) {
        setState("error");
        setDetail("Tryb Gemini Live wymaga klucza Gemini. Możesz użyć trybu rozmowy (dowolny model) poniżej.");
        return;
      }
      const session = new LiveSession(
        geminiKey,
        systemPrompt(),
        (s, d) => {
          setState(s);
          if (d) setDetail(d);
        },
        (t) => setCaption((c) => (c + t).slice(-300)),
      );
      liveRef.current = session;
      session.start().catch(() => setState("error"));
    } else {
      if (!resolveProvider()) {
        setState("error");
        setDetail("Brak skonfigurowanego modelu AI. Dodaj klucz w ⚙ Ustawienia.");
        return;
      }
      const loop = new ConversationLoop(
        (s, d) => {
          setState(s);
          if (d) setDetail(d);
        },
        (t) => setCaption(t),
      );
      loopRef.current = loop;
      loop.start();
    }
  };

  useEffect(() => {
    startEngine(engine);
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchEngine = (which: Engine) => {
    setEngine(which);
    startEngine(which);
  };

  const close = () => {
    stopAll();
    onClose();
  };

  const orbClass = state === "speaking" ? "speaking" : state === "listening" ? "listening" : "thinking";
  const failed = state === "error" || state === "closed";
  const providerLabel = (() => {
    const r = resolveProvider();
    return r ? PROVIDERS[r.provider].label.toUpperCase() : "MODEL AI";
  })();

  return (
    <div className="sheet live" onClick={(e) => e.stopPropagation()}>
      <div className="live-inner">
        <div className="brand" style={{ textAlign: "center" }}>
          JARVIS
          <small>ROZMOWA NA ŻYWO · {engine === "gemini" ? "GEMINI LIVE" : providerLabel}</small>
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
          {LABEL[state] || state}
        </div>

        {detail && failed && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 340, color: state === "error" ? "var(--danger, #ff6b6b)" : undefined }}>
            {detail}
          </p>
        )}

        {failed && (
          <button className="btn" style={{ maxWidth: 240, marginTop: 14 }} onClick={() => startEngine(engine)}>
            ↻ Połącz ponownie
          </button>
        )}

        {/* Zawsze dostępne przełączenie silnika — dzięki temu rozmowę można włączyć,
            nawet gdy Gemini Live ma limit albo brak klucza. */}
        {engine === "gemini" ? (
          <button className="btn" style={{ maxWidth: 280, marginTop: 10 }} onClick={() => switchEngine("loop")}>
            🎙 Tryb rozmowy (dowolny model)
          </button>
        ) : (
          geminiKey && (
            <button className="btn" style={{ maxWidth: 280, marginTop: 10 }} onClick={() => switchEngine("gemini")}>
              ⚡ Wróć do Gemini Live
            </button>
          )
        )}

        {caption && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 360, marginTop: 18 }}>
            {caption}
          </p>
        )}

        <button className="btn" style={{ maxWidth: 220, marginTop: 24 }} onClick={close}>
          ■ Zakończ rozmowę
        </button>
      </div>
    </div>
  );
}
