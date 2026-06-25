import { useEffect, useRef, useState } from "react";
import { speak, stopSpeaking } from "../lib/voice";
import { askJarvis } from "../lib/brain";
import { LIVE_VOICE_PERSONA } from "../lib/voicePersona";
import { speakableChunks } from "../lib/speechStream";
import { loadLiveThread, saveLiveThread, clearLiveThread } from "../lib/liveThread";
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
  const speechCancel = useRef<(() => void) | null>(null); // przerwij strumieniową mowę (barge-in)

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
        onBargeIn: () => { stopSpeaking(); speechCancel.current?.(); },
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

    // Strumieniowy głos: mów każde zdanie, gdy tylko się pojawi (nie czekaj na całą odpowiedź).
    // Sekwencyjna kolejka, żeby zdania się nie nakładały; barge-in (speechCancel) ją przerywa.
    let cursor = 0;
    let lastFull = ""; // ostatni skumulowany tekst ze strumienia (do wykrycia, czy finał go zmienił)
    let chain: Promise<void> = Promise.resolve();
    let cancelled = false;
    let started = false;
    speechCancel.current = () => { cancelled = true; stopSpeaking(); };
    const say = (chunks: string[]) => {
      for (const c of chunks) {
        chain = chain.then(async () => {
          if (cancelled || closed.current) return;
          if (!started) { started = true; setPhase("speaking"); convo.current?.setSpeaking(true); }
          await speak(c, { ...store.settings, speak: true }).catch(() => {});
        });
      }
    };

    try {
      // Persona mowy (krótko, naturalnie, jak człowiek) + pamięć/profil/narzędzia/uczenie się z askJarvis.
      const reply = await askJarvis(
        history.current,
        (full) => {
          if (cancelled) return;
          lastFull = full;
          setCaption(full);
          const r = speakableChunks(full, cursor, false); // tylko KOMPLETNE zdania
          cursor = r.nextIndex;
          if (r.chunks.length) say(r.chunks);
        },
        undefined,
        LIVE_VOICE_PERSONA,
      );
      history.current = [...history.current, { role: "assistant" as const, content: reply.text }].slice(-16);
      saveLiveThread(history.current); // ciągłość: zapamiętaj wątek na później
      if (!cancelled) {
        setCaption(reply.text);
        // Domknij resztę. Jeśli finał odpowiada strumieniowi (lub nic nie strumieniowano) — mów ogon
        // od kursora. Jeśli finał ZMIENIŁ tekst (refine), a nic jeszcze nie wybrzmiało — mów całość.
        // Jeśli zmienił po częściowym wypowiedzeniu — nie dubluj/garble, zostaw to, co już powiedziane.
        if (reply.text.startsWith(lastFull.slice(0, cursor))) {
          const tail = speakableChunks(reply.text, cursor, true);
          if (tail.chunks.length) say(tail.chunks);
        } else if (!started) {
          const all = speakableChunks(reply.text, 0, true);
          if (all.chunks.length) say(all.chunks);
        }
      }
      await chain; // poczekaj, aż wszystkie zdania wybrzmią
      if (!cancelled) cue("confirm");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaption("⚠ " + msg);
      cue("error");
      await speak(msg, { ...store.settings, speak: true }).catch(() => {});
    } finally {
      speechCancel.current = null;
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
    // Ciągłość: jeśli rozmawialiśmy niedawno, wznów wątek (JARVIS pamięta, o czym była mowa).
    history.current = loadLiveThread();
    if (history.current.length) setCaption("Wracam do naszej rozmowy. Słucham.");
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
        <button className="chip" onClick={() => { stopSpeaking(); speechCancel.current?.(); history.current = []; clearLiveThread(); setCaption("Nowa rozmowa. Słucham."); }} title="Zacznij rozmowę od nowa (wyczyść wątek)">
          🆕 Nowa
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
