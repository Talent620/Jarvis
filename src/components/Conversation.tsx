import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import TypeText from "./TypeText";
import { speak } from "../lib/voice";
import { store } from "../lib/store";
import { isDesktop } from "../lib/desktop";

// Akcje pod odpowiedzią: odsłuchaj + kopiuj (z potwierdzeniem ✓).
function MsgActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* brak dostępu do schowka */
    }
  };
  return (
    <div className="msg-actions">
      <button onClick={() => speak(text, { ...store.settings, speak: true })} title="Odsłuchaj">
        🔊
      </button>
      <button onClick={copy} title="Kopiuj">
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}

const SUGGESTIONS = isDesktop()
  ? [
      "Przedstaw raport poranny",
      "Co mam na ekranie?",
      "Otwórz notatnik",
      "Co mam dziś do zrobienia?",
      "Co nowego w wiadomościach?",
    ]
  : [
      "Przedstaw raport poranny",
      "Jaka jest pogoda?",
      "Co mam dziś do zrobienia?",
      "Włącz Spotify",
      "Co nowego w wiadomościach?",
    ];

const CONSENSUS: Record<string, { icon: string; label: string }> = {
  full: { icon: "✅", label: "Pełna zgoda modeli" },
  partial: { icon: "≈", label: "Częściowa zgoda" },
  conflict: { icon: "⚠", label: "Modele się różnią" },
  single: { icon: "•", label: "Jeden model" },
};

// Panel Trybu Konsylium: ocena zgodności + rozwijane odpowiedzi każdego modelu.
function CouncilPanel({ council }: { council: NonNullable<ChatMessage["council"]> }) {
  const c = CONSENSUS[council.consensus] || CONSENSUS.partial;
  return (
    <details className="council">
      <summary>
        ⚖ Konsylium {council.members.length} modeli · {c.icon} {c.label}
      </summary>
      {council.note && <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>{council.note}</p>}
      {council.members.map((mem, i) => (
        <div key={i} className="council-member">
          <b>{mem.label}</b>
          <p>{mem.text}</p>
        </div>
      ))}
    </details>
  );
}

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
          <p className="muted" style={{ marginTop: 18, fontSize: 13, lineHeight: 1.6 }}>
            <b>☎</b> rozmowa na żywo · <b>＋</b> nowa rozmowa · <b>⋯</b> menu:
            <br />
            👁 kamera (wizja) · 🎨 studio obrazów · 📔 dziennik · 🗝 sejf · 🧰 gadżety
          </p>
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
              src={`data:${m.image.mediaType || "image/png"};base64,${m.image.data}`}
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
          {m.council && m.council.members.length > 1 && <CouncilPanel council={m.council} />}
          {m.role === "assistant" && m.text && <MsgActions text={m.text} />}
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
