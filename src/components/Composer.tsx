import { useState } from "react";

export default function Composer({
  onSend,
  onMic,
  onAttach,
  onRemoveImage,
  imagePreview,
  micOn,
  busy,
  micSupported,
}: {
  onSend: (text: string) => void;
  onMic: () => void;
  onAttach: () => void;
  onRemoveImage: () => void;
  imagePreview: string | null;
  micOn: boolean;
  busy: boolean;
  micSupported: boolean;
}) {
  const [text, setText] = useState("");

  const submit = () => {
    const t = text.trim();
    if ((!t && !imagePreview) || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div>
      {imagePreview && (
        <div className="img-preview">
          <img src={imagePreview} alt="załącznik" />
          <button className="img-x" onClick={onRemoveImage} title="Usuń zdjęcie">
            ✕
          </button>
        </div>
      )}
      <div className="composer">
        <button className="mic" onClick={onAttach} title="Zdjęcie / aparat" disabled={busy}>
          📷
        </button>
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
        <button
          className="send"
          onClick={submit}
          disabled={busy || (!text.trim() && !imagePreview)}
          title="Wyślij"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
