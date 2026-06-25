import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "../lib/voice";
import { askJarvis } from "../lib/brain";
import { LIVE_VOICE_PERSONA } from "../lib/voicePersona";
import { store } from "../lib/store";
import { cue, buzz } from "../lib/feedback";
import { keepAwake, releaseAwake } from "../lib/wakeLock";
import { startHeadsetControls, stopHeadsetControls } from "../lib/mediaSession";
import { musicCommand } from "../lib/music";
import { useStore } from "../hooks/useStore";
import { SmartConversation, type SmartState } from "../lib/smartConversation";
import { DEFAULT_ENDPOINT } from "../lib/endpoint";
import { enrollVoice, hasVoiceProfile } from "../lib/voiceEnroll";
import { useEscape } from "../hooks/useEscape";
import type { Msg } from "../lib/providers/types";

const LABEL: Record<SmartState, string> = {
  idle: "Gotowy",
  listening: "Słucham…",
  capturing: "Słucham…",
  thinking: "Myślę…",
  speaking: "Mówię…",
  error: "Błąd",
};

/**
 * Tryb Słuchawki — flagowe centrum dowodzenia hands-free. Naturalna rozmowa:
 * nie przerywa, gdy się zacinasz (semantyczny endpointing), reaguje tylko na Twój
 * głos (blokada głosu), milknie gdy zaczynasz mówić (barge-in). Telefon możesz
 * schować — Wake Lock + przycisk słuchawek. Earcony zamiast patrzenia.
 */
export default function HeadsetMode({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { settings } = useStore();
  const [phase, setPhase] = useState<SmartState>("listening");
  const [wakeMode, setWakeMode] = useState(true);
  const [caption, setCaption] = useState("Gotowy. Telefon możesz schować.");
  const [level, setLevel] = useState(0);
  const [info, setInfo] = useState("");
  const [enrolling, setEnrolling] = useState("");

  const convo = useRef<SmartConversation | null>(null);
  const history = useRef<Msg[]>([]);
  const closed = useRef(false);
  const busy = useRef(false);

  const buildEngine = () => {
    const s = store.settings;
    return new SmartConversation(
      {
        voiceLock: !!s.voiceLock && (s.voiceProfile?.length || 0) > 0,
        profile: s.voiceProfile || [],
        matchThreshold: s.voiceMatch ?? 0.6,
        endpoint: { shortMs: s.endpointShortMs || DEFAULT_ENDPOINT.shortMs, longMs: DEFAULT_ENDPOINT.longMs },
        wakeWord: wakeMode,
      },
      {
        onState: (st) => { if (!busy.current) setPhase(st); },
        onPartial: (t) => setCaption("🗣 " + t),
        onLevel: (l) => setLevel(l),
        onInfo: (m) => setInfo(m),
        onRejected: () => setCaption("(zignorowałem — to nie Twój głos)"),
        onBargeIn: () => { stopSpeaking(); },
        onUtterance: (t) => void handle(t),
      },
    );
  };

  const restart = () => {
    convo.current?.stop();
    convo.current = buildEngine();
    void convo.current.start();
  };

  const handle = async (text: string) => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    setCaption("🗣 " + text);
    setPhase("thinking");
    cue("tap");
    history.current = [...history.current, { role: "user" as const, content: text }].slice(-16);
    try {
      // Rozmowa NA ŻYWO: persona mowy (krótko, naturalnie, jak człowiek) doklejona do systemowego
      // promptu. Pamięć/profil/narzędzia/uczenie się są już w askJarvis — tu nadajemy STYL głosu.
      const reply = await askJarvis(history.current, undefined, undefined, LIVE_VOICE_PERSONA);
      history.current = [...history.current, { role: "assistant" as const, content: reply.text }].slice(-16);
      setCaption(reply.text);
      setPhase("speaking");
      convo.current?.setSpeaking(true);
      await speak(reply.text, { ...store.settings, speak: true });
      cue("confirm");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaption("⚠ " + msg);
      cue("error");
      await speak(msg, { ...store.settings, speak: true }).catch(() => {});
    } finally {
      convo.current?.setSpeaking(false);
      busy.current = false;
      setPhase("listening");
    }
  };

  // Przycisk słuchawek — „mów teraz": przerwij i słuchaj (barge-in/push-to-talk).
  const headsetTalk = () => {
    if (phase === "speaking") stopSpeaking();
    buzz(20);
    cue("wake");
  };

  useEffect(() => {
    cue("wake");
    void keepAwake();
    void startHeadsetControls({
      onToggle: headsetTalk,
      onNext: () => void musicCommand("next"),
      onPrev: () => void musicCommand("prev"),
    });
    convo.current = buildEngine();
    void convo.current.start();
    return () => {
      closed.current = true;
      convo.current?.stop();
      stopSpeaking();
      stopHeadsetControls();
      releaseAwake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zmiana trybu wake/ciągły → przebuduj silnik.
  useEffect(() => {
    if (!closed.current) restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeMode]);

  const enroll = async () => {
    convo.current?.stop();
    setEnrolling("Za chwilę nagram Twój głos — mów spokojnie, np. policz do dziesięciu.");
    const r = await enrollVoice(3, (i, t) => setEnrolling(`🎙 Próbka ${i}/${t} — mów teraz…`));
    setEnrolling(r.ok ? "✅ Nauczyłem się Twojego głosu — blokada głosu włączona." : `❌ ${r.error}`);
    setTimeout(() => { setEnrolling(""); restart(); }, 1600);
  };

  const voiceLockOn = !!settings.voiceLock && (settings.voiceProfile?.length || 0) > 0;
  const scale = 1 + Math.min(0.5, level * 0.6) + (phase === "capturing" ? 0.06 : 0);

  return (
    <div className="headset">
      <button className="voicemode-exit" onClick={onClose}>✕ Zakończ</button>

      <div className="headset-core" style={{ transform: `scale(${scale})` }} data-phase={phase} />
      <div className="headset-status">{LABEL[phase]}</div>
      <div className="headset-caption" aria-live="polite">{caption}</div>
      {info && <div className="muted" style={{ fontSize: 12 }}>{info}</div>}

      <button className="headset-talk" onClick={headsetTalk} aria-label="Mów">🎙 Mów</button>

      <div className="headset-bar">
        <button className={`chip ${wakeMode ? "on" : ""}`} onClick={() => setWakeMode(true)}>🔑 Po „Jarvis”</button>
        <button className={`chip ${!wakeMode ? "on" : ""}`} onClick={() => setWakeMode(false)}>💬 Ciągła</button>
        <button className={`chip ${voiceLockOn ? "on" : ""}`} onClick={() => store.setSettings({ voiceLock: !settings.voiceLock })} title="Reaguj tylko na mój głos">
          {voiceLockOn ? "🔒 Mój głos" : "🔓 Każdy głos"}
        </button>
      </div>

      <div className="headset-music">
        <button className="chip" onClick={() => musicCommand("prev")}>⏮</button>
        <button className="chip" onClick={() => musicCommand("playpause")}>⏯</button>
        <button className="chip" onClick={() => musicCommand("next")}>⏭</button>
      </div>

      {enrolling ? (
        <p className="headset-hint">{enrolling}</p>
      ) : (
        <button className="chip" onClick={enroll} style={{ marginTop: 4 }}>
          {hasVoiceProfile() ? "🎤 Naucz głosu ponownie" : "🎤 Naucz JARVIS-a mojego głosu"}
        </button>
      )}

      <p className="headset-hint">
        Naturalna rozmowa — nie przerwę, gdy się zacieniesz. Telefon schowaj, klik na słuchawkach = „mów”.
        Powiedz np. „zadzwoń do…”, „otwórz YouTube”, „puść muzykę”, „dodaj zadanie”.
      </p>
    </div>
  );
}
