import { useEffect, useRef, useState } from "react";
import { askJarvis } from "../lib/brain";
import { Listener, speak, stopSpeaking } from "../lib/voice";
import { store } from "../lib/store";
import { cue, buzz } from "../lib/feedback";
import { useEscape } from "../hooks/useEscape";
import type { Msg } from "../lib/providers/types";

type Phase = "idle" | "listening" | "thinking" | "speaking";

const HINT: Record<Phase, string> = {
  idle: "Przytrzymaj i mów",
  listening: "Słucham…",
  thinking: "Myślę…",
  speaking: "Mówię…",
};

/**
 * Tryb głosowy (driving mode): obsługa bez patrzenia na ekran. Jeden wielki
 * przycisk push-to-talk, odpowiedź dużym tekstem + głosem. Własna krótka
 * historia (kontekst rozmowy w trybie), pełny mózg JARVIS-a pod spodem.
 */
export default function VoiceMode({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("Gotowy. Przytrzymaj przycisk i powiedz, czego potrzebujesz.");
  const listenerRef = useRef<Listener | null>(null);
  const historyRef = useRef<Msg[]>([]);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => {
    cue("wake");
    return () => {
      listenerRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t) {
      setPhase("idle");
      return;
    }
    setHeard(t);
    setPhase("thinking");
    historyRef.current = [...historyRef.current, { role: "user" as const, content: t }].slice(-12);
    try {
      const r = await askJarvis(historyRef.current);
      historyRef.current = [...historyRef.current, { role: "assistant" as const, content: r.text }].slice(-12);
      setReply(r.text);
      setPhase("speaking");
      await speak(r.text, { ...store.settings, speak: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setReply(`⚠ ${msg}`);
      await speak(msg, { ...store.settings, speak: true }).catch(() => {});
    } finally {
      setPhase("idle");
    }
  };

  const pttDown = () => {
    if (phaseRef.current === "thinking") return;
    stopSpeaking();
    buzz(20);
    cue("tap");
    setHeard("");
    setPhase("listening");
    const l = new Listener({
      onInterim: (t) => setHeard(t),
      onFinal: (t) => void ask(t),
      onEnd: () => {
        if (phaseRef.current === "listening") setPhase("idle");
      },
    });
    listenerRef.current = l;
    l.start();
  };

  const pttUp = () => {
    // Puść przycisk → zamknij nasłuch; finalny wynik dojdzie przez onFinal.
    listenerRef.current?.stop();
  };

  return (
    <div className="voicemode">
      <button className="voicemode-exit" onClick={onClose}>✕ Wyjdź z trybu głosowego</button>

      <div className="voicemode-reply" aria-live="polite">{reply}</div>
      {heard && <div className="voicemode-heard">„{heard}"</div>}

      <button
        className={`voicemode-ptt ${phase}`}
        onPointerDown={pttDown}
        onPointerUp={pttUp}
        onPointerLeave={pttUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Przytrzymaj i mów"
      >
        {phase === "thinking" ? "⏳" : "🎙"}
      </button>
      <div className="voicemode-hint">{HINT[phase]}</div>
    </div>
  );
}
