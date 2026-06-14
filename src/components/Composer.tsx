import { useRef, useState } from "react";

export default function Composer({
  onSend,
  onMic,
  onAttach,
  onRemoveImage,
  imagePreview,
  micOn,
  busy,
  micSupported,
  councilAvailable,
}: {
  onSend: (text: string, opts?: { council?: boolean; research?: boolean }) => void;
  onMic: () => void;
  onAttach: () => void;
  onRemoveImage: () => void;
  imagePreview: string | null;
  micOn: boolean;
  busy: boolean;
  micSupported: boolean;
  councilAvailable?: boolean;
}) {
  const [text, setText] = useState("");
  const [council, setCouncil] = useState(false);
  const [research, setResearch] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-wysokość: pole rośnie z treścią (do ~5 linijek), potem przewija.
  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && !imagePreview) || busy) return;
    onSend(t, { council: council && !imagePreview, research: research && !imagePreview });
    setText("");
    setResearch(false);
    if (taRef.current) taRef.current.style.height = "auto";
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
      <div className="composer-tools">
        <button className="mic" onClick={onAttach} title="Zdjęcie / aparat" disabled={busy}>
          📷
        </button>
        <button
          className={`mic ${research ? "on" : ""}`}
          onClick={() => setResearch((v) => !v)}
          title={research ? "Głębokie badanie WŁĄCZONE — JARVIS zrobi dokładny research ze źródłami" : "Głębokie badanie: dokładny research w sieci ze źródłami [1][2]"}
          disabled={busy}
        >
          🔬
        </button>
        {councilAvailable && (
          <button
            className={`mic ${council ? "on" : ""}`}
            onClick={() => setCouncil((v) => !v)}
            title={council ? "Konsylium WŁĄCZONE — to pytanie pójdzie do kilku modeli" : "Konsylium: zapytaj kilka modeli o to pytanie"}
            disabled={busy}
          >
            ⚖
          </button>
        )}
      </div>
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder="Wydaj polecenie JARVIS-owi…"
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
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
