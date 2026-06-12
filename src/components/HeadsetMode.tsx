import { useEffect, useRef, useState } from "react";
import { Listener, speak, stopSpeaking } from "../lib/voice";
import { askJarvis } from "../lib/brain";
import { store } from "../lib/store";
import { cue, buzz } from "../lib/feedback";
import { keepAwake, releaseAwake } from "../lib/wakeLock";
import { startHeadsetControls, stopHeadsetControls } from "../lib/mediaSession";
import { musicCommand } from "../lib/music";
import { subscribeLevel } from "../lib/audioLevel";
import { useEscape } from "../hooks/useEscape";
import type { Msg } from "../lib/providers/types";

type Phase = "idle" | "listening" | "thinking" | "speaking";
const LABEL: Record<Phase, string> = {
  idle: "Powiedz „Jarvis…”",
  listening: "Słucham…",
  thinking: "Myślę…",
  speaking: "Mówię…",
};

/**
 * Tryb Słuchawki — centrum dowodzenia w uchu. Ciągła rozmowa hands-free: mówisz
 * „Jarvis…”, on słucha, wykonuje i odpowiada głosem, potem znów słucha. Telefon
 * możesz schować — ekran trzyma Wake Lock (na OLED czarny prawie nie zużywa baterii),
 * a przycisk na słuchawkach wywołuje JARVIS-a bez dotykania telefonu. Earcony
 * (krótkie dźwięki) informują o stanie, więc nie musisz patrzeć.
 */
export default function HeadsetMode({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [phase, setPhase] = useState<Phase>("idle");
  const [wakeMode, setWakeMode] = useState(true); // true: po słowie „Jarvis”; false: ciągła rozmowa
  const [caption, setCaption] = useState("Gotowy. Telefon możesz schować.");
  const [level, setLevel] = useState(0);

  const history = useRef<Msg[]>([]);
  const listener = useRef<Listener | null>(null);
  const retry = useRef<number | null>(null);
  const closed = useRef(false);
  const processing = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const wakeRef = useRef(true);
  phaseRef.current = phase;
  wakeRef.current = wakeMode;

  // Pętla nasłuchu (z opcjonalną bramką słowa „Jarvis”).
  const listen = (force = false) => {
    if (closed.current || processing.current) return;
    const useWake = wakeRef.current && !force;
    setPhase(useWake ? "idle" : "listening");
    listener.current?.stop();
    listener.current = new Listener({
      wakeWord: useWake,
      onWake: () => { cue("wake"); setPhase("listening"); },
      onInterim: (t) => setCaption("🗣 " + t),
      onFinal: (t) => { if (!closed.current && !processing.current && t.trim()) void handle(t.trim()); },
      onEnd: () => {
        if (closed.current || processing.current) return;
        if (retry.current) clearTimeout(retry.current);
        retry.current = window.setTimeout(() => listen(), 280);
      },
    });
    listener.current.start();
  };

  const handle = async (text: string) => {
    processing.current = true;
    listener.current?.stop();
    setCaption("🗣 " + text);
    setPhase("thinking");
    cue("tap");
    history.current = [...history.current, { role: "user" as const, content: text }].slice(-16);
    try {
      const reply = await askJarvis(history.current);
      history.current = [...history.current, { role: "assistant" as const, content: reply.text }].slice(-16);
      setCaption(reply.text);
      setPhase("speaking");
      await speak(reply.text, { ...store.settings, speak: true });
      cue("confirm");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaption("⚠ " + msg);
      cue("error");
      await speak(msg, { ...store.settings, speak: true }).catch(() => {});
    } finally {
      processing.current = false;
      if (!closed.current) listen();
    }
  };

  // Przycisk na słuchawkach (play/pause) — natychmiast „gadaj”: przerwij mówienie
  // i słuchaj, niezależnie od słowa-klucza.
  const headsetTalk = () => {
    if (processing.current && phaseRef.current === "speaking") {
      stopSpeaking();
    }
    if (processing.current) return;
    buzz(20);
    listen(true);
  };

  useEffect(() => {
    cue("wake");
    void keepAwake();
    void startHeadsetControls({
      onToggle: headsetTalk,
      onNext: () => void musicCommand("next"),
      onPrev: () => void musicCommand("prev"),
    });
    const unsub = subscribeLevel(setLevel);
    listen();
    return () => {
      closed.current = true;
      if (retry.current) clearTimeout(retry.current);
      listener.current?.stop();
      stopSpeaking();
      stopHeadsetControls();
      releaseAwake();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zmiana trybu (wake/ciągły) restartuje nasłuch.
  useEffect(() => {
    if (!processing.current) listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeMode]);

  const scale = 1 + Math.min(0.5, level * 0.6) + (phase === "listening" ? 0.06 : 0);

  return (
    <div className="headset">
      <button className="voicemode-exit" onClick={onClose}>✕ Zakończ</button>

      <div className="headset-core" style={{ transform: `scale(${scale})` }} data-phase={phase} />
      <div className="headset-status">{LABEL[phase]}</div>
      <div className="headset-caption" aria-live="polite">{caption}</div>

      <button className="headset-talk" onClick={headsetTalk} aria-label="Mów">🎙 Mów</button>

      <div className="headset-bar">
        <button className={`chip ${wakeMode ? "on" : ""}`} onClick={() => setWakeMode(true)}>🔑 Po „Jarvis”</button>
        <button className={`chip ${!wakeMode ? "on" : ""}`} onClick={() => setWakeMode(false)}>💬 Ciągła</button>
      </div>
      <div className="headset-music">
        <button className="chip" onClick={() => musicCommand("prev")}>⏮</button>
        <button className="chip" onClick={() => musicCommand("playpause")}>⏯</button>
        <button className="chip" onClick={() => musicCommand("next")}>⏭</button>
      </div>

      <p className="headset-hint">
        Telefon możesz schować. Klik na słuchawkach = „mów”. Powiedz np. „zadzwoń do…”, „puść muzykę”, „dodaj zadanie”.
      </p>
    </div>
  );
}
