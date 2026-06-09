import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

export default function Conversation({
  messages,
  interim,
}: {
  messages: ChatMessage[];
  interim: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, interim]);

  if (!messages.length && !interim) {
    return (
      <div className="convo">
        <div className="empty">
          Witaj. Jestem <b>JARVIS</b>.
          <br />
          Powiedz „<b>Jarvis</b>" lub napisz polecenie.
          <br />
          <br />
          <span className="muted">
            „Dodaj zadanie: zadzwonić do mamy jutro o 18", „Jaka jest pogoda w Krakowie?",
            „Włącz Spotify — Daft Punk", „Przypomnij mi o spotkaniu w piątek".
          </span>
        </div>
        <div ref={endRef} />
      </div>
    );
  }

  return (
    <div className="convo">
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.role}`}>
          {m.text}
          {m.tools && m.tools.length > 0 && (
            <div className="tools">
              {m.tools.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
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
