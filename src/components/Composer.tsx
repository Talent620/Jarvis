import { useEffect, useRef, useState } from "react";
import { anticipate, type RecallHit } from "../lib/recall";
import { store } from "../lib/store";
import { speak } from "../lib/voice";
import { usePersistentState } from "../hooks/usePersistentState";

export default function Composer({
  onSend,
  onStop,
  onMic,
  onAttach,
  onRemoveImage,
  onRecall,
  imagePreview,
  micOn,
  busy,
  micSupported,
  councilAvailable,
}: {
  onSend: (text: string, opts?: { council?: boolean; research?: boolean }) => void;
  onStop?: () => void;
  onMic: () => void;
  onAttach: () => void;
  onRemoveImage: () => void;
  onRecall?: (query: string) => void;
  imagePreview: string | null;
  micOn: boolean;
  busy: boolean;
  micSupported: boolean;
  councilAvailable?: boolean;
}) {
  // Trwały szkic wpisanej, lecz NIEwysłanej wiadomości — po wyjściu z czatu / zamknięciu apki
  // wraca (jak w każdym komunikatorze). Po wysłaniu setText("") zapisuje pusty szkic (nie wraca).
  const [text, setText] = usePersistentState("composer.text", "");
  const [council, setCouncil] = useState(false);
  const [research, setResearch] = useState(false);
  const [hint, setHint] = useState<RecallHit | null>(null); // 🧲 anticipatory recall
  const dismissed = useRef<string>(""); // id trafienia odrzuconego przez użytkownika
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 🧲 Anticipatory recall: gdy to, co piszesz, mocno pokrywa się z czymś z Twojej
  // historii — pokaż cichy dymek „masz to już u siebie". Debounce, tylko gdy włączone
  // coachingowe podpowiedzi (settings.tips) i jest dokąd otworzyć (onRecall).
  useEffect(() => {
    if (!onRecall || store.settings.tips === false) { setHint(null); return; }
    const q = text.trim();
    if (q.length < 6) { setHint(null); return; }
    const id = window.setTimeout(() => {
      let h: RecallHit | null = null;
      try { h = anticipate(q); } catch { h = null; }
      setHint(h && h.id !== dismissed.current ? h : null);
    }, 450);
    return () => clearTimeout(id);
  }, [text, onRecall]);

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
    setHint(null);
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
      {hint && onRecall && (
        <div
          className="journal-card"
          style={{ padding: "6px 10px", margin: "0 4px 6px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            🧲 Masz to już u siebie: <b>{hint.title || hint.type}</b>
          </span>
          <button className="chip" onClick={() => { onRecall(text.trim()); setHint(null); }}>Pokaż</button>
          <button className="chip" onClick={() => { dismissed.current = hint.id; setHint(null); }} title="Ukryj">✕</button>
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
        {text.trim() && (
          <button
            className="mic"
            onClick={() => void speak(text, { ...store.settings, speak: true }).catch(() => {})}
            title="Przeczytaj wpisany/wklejony tekst na głos (dosłownie)"
            aria-label="Przeczytaj na głos"
          >
            🔊
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
        {busy ? (
          <button className="send stop" onClick={onStop} title="Zatrzymaj" aria-label="Zatrzymaj generowanie">
            ■
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim() && !imagePreview}
            title="Wyślij"
          >
            ➤
          </button>
        )}
      </div>
    </div>
  );
}
