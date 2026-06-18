import { useEffect, useRef, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { transcribeAudio, transcribeSupported } from "../lib/transcribe";
import { store, uid } from "../lib/store";
import { micAudioConstraints } from "../lib/mic";
import { copyWithToast, toast } from "../lib/toast";
import Guide from "./Guide";

type Phase = "idle" | "recording" | "working" | "done";

const MAX_SECS = 600; // ~10 min — twarda granica, by blob nie urósł ponad limit Whisper/Groq i pamięci

// Transkrypcja spotkań/notatek głosowych — nagrywasz, Groq Whisper zamienia na
// tekst, zapisujesz jako notatkę lub wpis dziennika. Darmowe (klucz Groq).
export default function Transcribe({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  // Sprzątanie przy zamknięciu panelu (także w trakcie nagrywania): zatrzymaj
  // timer, recorder i zwolnij mikrofon — bez „utkniętego" mikrofonu w tle.
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
      try { if (rec.current && rec.current.state !== "inactive") rec.current.stop(); } catch { /* ignore */ }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    if (!transcribeSupported()) { toast("To urządzenie nie wspiera nagrywania."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: micAudioConstraints() });
      chunks.current = [];
      const mr = new MediaRecorder(stream.current);
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => void finish();
      mr.start();
      rec.current = mr;
      setPhase("recording");
      setSecs(0);
      timer.current = window.setInterval(() => setSecs((x) => x + 1), 1000);
    } catch {
      toast("Brak dostępu do mikrofonu.");
    }
  };

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  };

  // Auto-stop po limicie — długie nagranie inaczej rośnie bez ograniczeń (pamięć + limit API).
  useEffect(() => {
    if (phase === "recording" && secs >= MAX_SECS) {
      stop();
      toast("Osiągnięto limit nagrania (10 min) — przetwarzam, co mam.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs, phase]);

  const finish = async () => {
    setPhase("working");
    const blob = new Blob(chunks.current, { type: "audio/webm" });
    const r = await transcribeAudio(blob);
    if ("error" in r) { toast(r.error); setPhase("idle"); return; }
    setText(r.text || "(nic nie rozpoznano)");
    setPhase("done");
  };

  const saveNote = () => {
    store.setData((d) => d.notes.unshift({ id: uid(), text, createdAt: Date.now() }));
    toast("Zapisano jako notatka ✓");
  };
  const saveJournal = () => {
    const now = Date.now();
    store.setData((d) => d.journal.unshift({ id: uid(), title: "Transkrypcja", body: text, tags: ["transkrypcja"], createdAt: now, updatedAt: now }));
    toast("Zapisano w dzienniku ✓");
  };

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎙 Transkrypcja</h2>
        </div>
        <div className="panel-body">
          <p className="muted">
            Nagraj spotkanie lub notatkę głosową — zamienię ją na tekst (Groq Whisper, darmowe).
            Potem zapiszesz jako notatkę albo wpis dziennika.
          </p>

          <div style={{ textAlign: "center", padding: "14px 0" }}>
            {phase === "recording" ? (
              <>
                <div style={{ fontFamily: "Orbitron", fontSize: 30, color: "#ff8585" }}>● {mm}:{ss}</div>
                <button className="btn primary" style={{ marginTop: 10 }} onClick={stop}>⏹ Zatrzymaj i przepisz</button>
              </>
            ) : phase === "working" ? (
              <div className="muted">⏳ Przepisuję nagranie…</div>
            ) : (
              <button className="btn primary" onClick={start}>🎙 Nagrywaj</button>
            )}
          </div>

          {phase === "done" && (
            <>
              <textarea className="ta" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => copyWithToast(text, "Skopiowano ✓")}>📋 Kopiuj</button>
                <button className="btn" style={{ flex: 1 }} onClick={saveNote}>📝 Notatka</button>
                <button className="btn" style={{ flex: 1 }} onClick={saveJournal}>📔 Dziennik</button>
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => { setText(""); setPhase("idle"); }}>🎙 Nagraj kolejne</button>
            </>
          )}

          <Guide title="ℹ Wskazówki">
            <p>Mów wyraźnie, telefon blisko źródła dźwięku. Darmowy limit Groq to ~2000 transkrypcji/dzień.</p>
            <p>Możesz też dyktować w czacie (🎤) — to do krótkich poleceń. Transkrypcja jest do <b>dłuższych</b> nagrań i spotkań.</p>
          </Guide>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
