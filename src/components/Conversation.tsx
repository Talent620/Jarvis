import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";
import TypeText from "./TypeText";
import { speak } from "../lib/voice";
import { store } from "../lib/store";

const SUGGESTIONS = [
  "Przedstaw raport poranny",
  "Jaka jest pogoda?",
  "Co mam dziś do zrobienia?",
  "Włącz Spotify",
  "Co nowego w wiadomościach?",
];

export default function Conversation({
  messages,
  interim,
  liveId,
  onSuggest,
}: {
  messages: ChatMessage[];
  interim: string;
  liveId: string | null;
  onSuggest: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, interim, liveId]);

  if (!messages.length && !interim) {
    return (
      <div className="convo">
        <div className="empty">
          Witaj. Jestem <b>JARVIS</b>.
          <br />
          Powiedz „<b>Jarvis</b>" lub napisz polecenie.
          <div className="chips" style={{ justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => onSuggest(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div ref={endRef} />
      </div>
    );
  }

  return (
    <div className="convo">
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          {m.image && (
            <img
              className="bubble-img"
              src={`data:${m.image.mediaType};base64,${m.image.data}`}
              alt="załączone zdjęcie"
            />
          )}
          {m.role === "assistant" ? <TypeText text={m.text} animate={m.id === liveId} /> : m.text}
          {m.tools && m.tools.length > 0 && (
            <div className="tools">
              {m.tools.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {m.role === "assistant" && (
            <div className="msg-actions">
              <button onClick={() => speak(m.text, { ...store.settings, speak: true })} title="Odsłuchaj">
                🔊
              </button>
              <button
                onClick={() => navigator.clipboard?.writeText(m.text).catch(() => {})}
                title="Kopiuj"
              >
                📋
              </button>
            </div>
          )}
          {m.citations && m.citations.length > 0 && (
            <div className="citations">
              <div className="cit-head">Źródła</div>
              {m.citations.map((c, i) => (
                <a key={c.url} className="cit" href={c.url} target="_blank" rel="noopener">
                  [{i + 1}] {c.title}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      {interim && <div className="bubble user">{interim}</div>}
      <div ref={endRef} />
    </div>
  );
}
