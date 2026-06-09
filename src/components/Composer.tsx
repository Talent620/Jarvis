import { useState } from "react";

export default function Composer({
  onSend,
  onMic,
  micOn,
  busy,
  micSupported,
}: {
  onSend: (text: string) => void;
  onMic: () => void;
  micOn: boolean;
  busy: boolean;
  micSupported: boolean;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder="Wydaj polecenie JARVIS-owi…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {micSupported && (
        <button className={`mic ${micOn ? "on" : ""}`} onClick={onMic} title="Mów">
          {micOn ? "■" : "🎤"}
        </button>
      )}
      <button className="send" onClick={submit} disabled={busy || !text.trim()} title="Wyślij">
        ➤
      </button>
    </div>
  );
}
