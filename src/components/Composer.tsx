import { useEffect, useRef, useState } from "react";
import { ArrowUp, Image, Mic, Scale, Search, Square, Volume2, X } from "lucide-react";
import { anticipate, type RecallHit } from "../lib/recall";
import { store } from "../lib/store";
import { speak } from "../lib/voice";
import { hapticTap } from "../lib/androidNative";

export default function Composer({
  onSend,
  onStop,
  onMic,
  onAttach,
  onAttachFile,
  onRemoveImage,
  onRecall,
  onCommandPalette,
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
  onAttachFile?: (file: File) => void;
  onRemoveImage: () => void;
  onRecall?: (query: string) => void;
  onCommandPalette?: () => void;
  imagePreview: string | null;
  micOn: boolean;
  busy: boolean;
  micSupported: boolean;
  councilAvailable?: boolean;
}) {
  const [text, setText] = useState("");
  const [council, setCouncil] = useState(false);
  const [research, setResearch] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<RecallHit | null>(null); // 🧲 anticipatory recall
  const dismissed = useRef<string>(""); // id trafienia odrzuconego przez użytkownika
  const sentHistory = useRef<string[]>([]); // historia wysłanych poleceń (strzałka ↑/↓)
  const histIdx = useRef<number>(-1);
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

  // Auto-wysokość: pole rośnie z treścią (do ~6 linijek), potem przewija.
  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 136) + "px";
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && !imagePreview) || busy) return;
    hapticTap("light");
    if (t) {
      sentHistory.current = [t, ...sentHistory.current.filter((x) => x !== t)].slice(0, 30);
      histIdx.current = -1;
    }
    onSend(t, { council: council && !imagePreview, research: research && !imagePreview });
    setText("");
    setResearch(false);
    setHint(null);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachFile || busy) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!imgItem) return;
    const file = imgItem.getAsFile();
    if (file) {
      e.preventDefault();
      onAttachFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!onAttachFile || busy) return;
    const file = Array.from(e.dataTransfer?.files || []).find((f) => f.type.startsWith("image/"));
    if (file) onAttachFile(file);
  };

  return (
    <div
      className={dragging ? "composer-wrap composer-drop" : "composer-wrap"}
      onDragOver={(e) => {
        if (!onAttachFile || busy) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {imagePreview && (
        <div className="img-preview">
          <img src={imagePreview} alt="załącznik" />
          <button className="img-x" onClick={onRemoveImage} title="Usuń zdjęcie" aria-label="Usuń zdjęcie">
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}
      {hint && onRecall && (
        <div
          className="journal-card"
          style={{ padding: "6px 10px", margin: "0 4px 6px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Masz to już u siebie: <b>{hint.title || hint.type}</b>
          </span>
          <button className="chip" onClick={() => { onRecall(text.trim()); setHint(null); }}>Pokaż</button>
          <button className="chip" onClick={() => { dismissed.current = hint.id; setHint(null); }} title="Ukryj" aria-label="Ukryj podpowiedź">
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="composer-tools">
        <button className="composer-pill" onClick={onAttach} title="Zdjęcie / aparat (możesz też wkleić Ctrl+V lub upuścić plik)" aria-label="Dodaj obraz" disabled={busy}>
          <Image size={14} strokeWidth={1.9} /> <span className="pill-label">Obraz</span>
        </button>
        <button
          className={`composer-pill ${research ? "on" : ""}`}
          onClick={() => { hapticTap("light"); setResearch((v) => !v); }}
          title={research ? "Głębokie badanie WŁĄCZONE — JARVIS zrobi dokładny research ze źródłami" : "Głębokie badanie: dokładny research w sieci ze źródłami [1][2]"}
          aria-label="Głębokie badanie"
          disabled={busy}
          aria-pressed={research}
        >
          <Search size={14} strokeWidth={1.9} /> <span className="pill-label">Badanie</span>
        </button>
        {councilAvailable && (
          <button
            className={`composer-pill ${council ? "on" : ""}`}
            onClick={() => { hapticTap("light"); setCouncil((v) => !v); }}
            title={council ? "Konsylium WŁĄCZONE — to pytanie pójdzie do kilku modeli" : "Konsylium: zapytaj kilka modeli o to pytanie"}
            aria-label="Konsylium"
            disabled={busy}
            aria-pressed={council}
          >
            <Scale size={14} strokeWidth={1.9} /> <span className="pill-label">Konsylium</span>
          </button>
        )}
        {text.trim() && (
          <button
            className="composer-pill"
            onClick={() => void speak(text, { ...store.settings, speak: true }).catch(() => {})}
            title="Przeczytaj wpisany/wklejony tekst na głos (dosłownie)"
            aria-label="Przeczytaj na głos"
          >
            <Volume2 size={14} strokeWidth={1.9} /> <span className="pill-label">Czytaj</span>
          </button>
        )}
        <div className="spacer" />
        {onCommandPalette && (
          <button
            className="composer-pill composer-kbd"
            onClick={onCommandPalette}
            title="Szybkie polecenia (Ctrl+K lub /)"
            aria-label="Otwórz szybkie polecenia"
          >
            ⌘K
          </button>
        )}
      </div>
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={dragging ? "Upuść obraz tutaj…" : "Wydaj polecenie JARVIS-owi…"}
          onPaste={handlePaste}
          onChange={(e) => {
            setText(e.target.value);
            histIdx.current = -1;
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
              return;
            }
            if (e.key === "/" && !text && onCommandPalette) {
              e.preventDefault();
              onCommandPalette();
              return;
            }
            if (e.key === "ArrowUp" && (!text || histIdx.current >= 0) && sentHistory.current.length) {
              const next = Math.min(sentHistory.current.length - 1, histIdx.current + 1);
              if (next !== histIdx.current) {
                e.preventDefault();
                histIdx.current = next;
                setText(sentHistory.current[next]);
                requestAnimationFrame(autoGrow);
              }
              return;
            }
            if (e.key === "ArrowDown" && histIdx.current >= 0) {
              e.preventDefault();
              const next = histIdx.current - 1;
              histIdx.current = next;
              setText(next < 0 ? "" : sentHistory.current[next]);
              requestAnimationFrame(autoGrow);
            }
          }}
        />
        {micSupported && (
          <button
            className={`mic ${micOn ? "on" : ""}`}
            onClick={() => { hapticTap("medium"); onMic(); }}
            title={micOn ? "Zatrzymaj mikrofon" : "Mów"}
            aria-label={micOn ? "Zatrzymaj mikrofon" : "Mów"}
          >
            {micOn ? <Square size={16} strokeWidth={2.2} /> : <Mic size={18} strokeWidth={1.9} />}
          </button>
        )}
        {busy ? (
          <button className="send stop" onClick={() => { hapticTap("medium"); onStop?.(); }} title="Zatrzymaj" aria-label="Zatrzymaj generowanie">
            <Square size={15} fill="currentColor" strokeWidth={2} />
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim() && !imagePreview}
            title="Wyślij (Enter)"
            aria-label="Wyślij"
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}
