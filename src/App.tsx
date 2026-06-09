import { useEffect, useRef, useState } from "react";
import Orb, { type OrbState } from "./components/Orb";
import Conversation from "./components/Conversation";
import Composer from "./components/Composer";
import SettingsPanel from "./components/Settings";
import Panels from "./components/Panels";
import { askJarvis, resolveProvider } from "./lib/brain";
import { Listener, isSpeechSupported, loadVoices, speak, stopSpeaking } from "./lib/voice";
import { capturePhoto } from "./lib/camera";
import { ensureNotifPerms } from "./lib/notifications";
import { store, uid } from "./lib/store";
import { useStore } from "./hooks/useStore";
import type { ChatMessage } from "./types";

type PendingImage = { data: string; mediaType: string } | null;

const CHAT_KEY = "jarvis.chat.v1";

function loadChat(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const { settings } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat);
  const [interim, setInterim] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage>(null);

  const listenerRef = useRef<Listener | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const pendingImageRef = useRef<PendingImage>(null);
  pendingImageRef.current = pendingImage;
  const micSupported = isSpeechSupported();

  useEffect(() => {
    loadVoices();
    ensureNotifPerms();
    if (!resolveProvider()) setShowSettings(true);
  }, []);

  const attachImage = async () => {
    const img = await capturePhoto();
    if (img) setPendingImage(img);
  };

  // Trwałość rozmowy (ostatnie 100 wiadomości).
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-100)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  // --- Wysłanie polecenia do JARVIS-a (agentowa pętla) ---
  const handleSend = async (text: string) => {
    setInterim("");
    stopSpeaking();
    const image = pendingImageRef.current || undefined;
    const userMsg: ChatMessage = { id: uid(), role: "user", text, image, createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setPendingImage(null);
    setBusy(true);
    setOrb("thinking");

    try {
      const history = [...messagesRef.current, userMsg]
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.text, image: m.image }));

      const reply = await askJarvis(history);
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: reply.text,
        tools: reply.tools,
        createdAt: Date.now(),
      };
      setLiveId(aiMsg.id);
      setMessages((m) => [...m, aiMsg]);

      if (store.settings.speak) {
        setOrb("speaking");
        await speak(reply.text, store.settings);
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: `⚠ ${err}`, createdAt: Date.now() },
      ]);
    } finally {
      setBusy(false);
      setOrb(listenerRef.current?.listening ? "listening" : "idle");
    }
  };

  const newChat = () => {
    stopSpeaking();
    setMessages([]);
    setLiveId(null);
    try {
      localStorage.removeItem(CHAT_KEY);
    } catch {
      /* ignore */
    }
  };

  // --- Sterowanie nasłuchem (z barge-in: nasłuch przerywa mówienie) ---
  const startListening = (wake: boolean) => {
    if (!micSupported) return;
    stopSpeaking();
    listenerRef.current?.stop();
    const listener = new Listener({
      wakeWord: wake,
      onWake: () => {
        stopSpeaking();
        setOrb("listening");
      },
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        if (t.trim()) handleSend(t);
      },
      onEnd: () => {
        if (!wake) {
          setMicOn(false);
          setOrb("idle");
        }
      },
    });
    listener.start();
    listenerRef.current = listener;
    setMicOn(true);
    setOrb(wake ? "idle" : "listening");
  };

  const stopListening = () => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setMicOn(false);
    setInterim("");
    setOrb("idle");
  };

  const toggleMic = () => {
    if (micOn) stopListening();
    else startListening(settings.wakeWord);
  };

  // Auto-start ciągłego nasłuchu słowa-klucza, gdy włączone w ustawieniach.
  useEffect(() => {
    if (settings.wakeWord && micSupported) {
      startListening(true);
    } else if (!settings.wakeWord && listenerRef.current) {
      stopListening();
    }
    return () => listenerRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWord]);

  // --- Przypomnienia: sprawdzaj co 20 s ---
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      store.data.reminders
        .filter((r) => !r.fired && new Date(r.at).getTime() <= now)
        .forEach((r) => {
          store.setData((d) => {
            const x = d.reminders.find((y) => y.id === r.id);
            if (x) x.fired = true;
          });
          const text = `Przypomnienie, ${store.settings.userName}: ${r.text}.`;
          const id = uid();
          setLiveId(id);
          setMessages((m) => [...m, { id, role: "assistant", text, tools: ["reminder"], createdAt: Date.now() }]);
          if (store.settings.speak) speak(text, store.settings);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("JARVIS", { body: r.text });
          }
        });
    }, 20000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          JARVIS
          <small>{(resolveProvider()?.model || "BRAK API").toUpperCase()} · ONLINE</small>
        </div>
        <div className="spacer" />
        {messages.length > 0 && (
          <button className="icon-btn" onClick={newChat} title="Nowa rozmowa">
            ＋
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowPanels(true)} title="Dane">
          ▣
        </button>
        <button
          className={`icon-btn ${settings.wakeWord ? "active" : ""}`}
          onClick={() => store.setSettings({ wakeWord: !settings.wakeWord })}
          title="Słowo-klucz Jarvis"
        >
          👂
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ustawienia">
          ⚙
        </button>
      </div>

      <Orb state={orb} />

      <Conversation messages={messages} interim={interim} liveId={liveId} onSuggest={handleSend} />

      <Composer
        onSend={handleSend}
        onMic={toggleMic}
        onAttach={attachImage}
        onRemoveImage={() => setPendingImage(null)}
        imagePreview={pendingImage ? `data:${pendingImage.mediaType};base64,${pendingImage.data}` : null}
        micOn={micOn}
        busy={busy}
        micSupported={micSupported}
      />

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showPanels && <Panels onClose={() => setShowPanels(false)} />}
    </div>
  );
}
