import { useEffect, useRef, useState } from "react";
import Orb, { type OrbState } from "./components/Orb";
import Conversation from "./components/Conversation";
import Composer from "./components/Composer";
import SettingsPanel from "./components/Settings";
import Panels from "./components/Panels";
import LiveOverlay from "./components/LiveOverlay";
import ChatHistory from "./components/ChatHistory";
import Projects from "./components/Projects";
import Journal from "./components/Journal";
import Help from "./components/Help";
import More from "./components/More";
import LockScreen from "./components/LockScreen";
import PermissionDialog from "./components/PermissionDialog";
import { lockIsSet } from "./lib/lock";
import { Suspense, lazy } from "react";

const Gadgets = lazy(() => import("./components/Gadgets"));
const HudVision = lazy(() => import("./components/HudVision"));
const Studio = lazy(() => import("./components/Studio"));
import { loadChats, upsertChat, titleFrom, type ChatSession } from "./lib/chats";
import { setConsentHandler, setStepListener, type ConsentRequest } from "./lib/permissions";
import { startBackgroundWake } from "./lib/wakeword";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

type PendingConsent = { req: ConsentRequest; resolve: (d: { allow: boolean; remember: boolean }) => void };
import { askJarvis, resolveProvider } from "./lib/brain";
import { Listener, isSpeechSupported, loadVoices, speak, stopSpeaking } from "./lib/voice";
import { capturePhoto } from "./lib/camera";
import { captureScreen, isDesktop } from "./lib/desktop";
import { getWeather } from "./lib/weather";
import { feedback, buzz, cue } from "./lib/feedback";
import { ensureNotifPerms, notify } from "./lib/notifications";
import { registerIntents } from "./lib/intents";
import { store, uid } from "./lib/store";
import { useStore } from "./hooks/useStore";
import type { ChatMessage } from "./types";

type PendingImage = { data: string; mediaType: string } | null;

// Lokalne proaktywne powitanie (bez API) — pora dnia + krótki raport.
function buildGreeting(): string {
  const s = store.settings;
  const d = store.data;
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "Dzień dobry" : h < 18 ? "Dobre popołudnie" : "Dobry wieczór";
  const today = now.toISOString().slice(0, 10);
  const tasks = d.tasks.filter((t) => !t.done).length;
  const events = d.calendar.filter((e) => e.start.slice(0, 10) === today).length;
  const bits: string[] = [];
  if (tasks) bits.push(`${tasks} aktywnych zadań`);
  if (events) bits.push(`${events} dziś w kalendarzu`);
  const parts = [`${part}, ${s.userName}.`];
  if (bits.length) parts.push(`Masz ${bits.join(" i ")}.`);
  parts.push("W czym mogę pomóc?");
  return parts.join(" ");
}

// Poranny raport: pora dnia + pogoda (best-effort) + kalendarz + zadania.
async function buildBriefing(): Promise<string> {
  const s = store.settings;
  const d = store.data;
  const now = new Date();
  const h = now.getHours();
  const part = h < 12 ? "Dzień dobry" : h < 18 ? "Dobre popołudnie" : "Dobry wieczór";
  const today = now.toISOString().slice(0, 10);
  const tasks = d.tasks.filter((t) => !t.done);
  const events = d.calendar.filter((e) => e.start.slice(0, 10) === today).sort((a, b) => a.start.localeCompare(b.start));
  const parts = [`${part}, ${s.userName}. Oto Twój poranny raport.`];
  try {
    const w = await getWeather();
    if (w && !/nie udało|niedostęp/i.test(w)) parts.push(w);
  } catch {
    /* pomiń pogodę */
  }
  parts.push(events.length ? `W kalendarzu na dziś: ${events.map((e) => e.title).slice(0, 6).join(", ")}.` : "Kalendarz na dziś jest pusty.");
  if (tasks.length) {
    const word = tasks.length === 1 ? "zadanie" : tasks.length < 5 ? "zadania" : "zadań";
    const list = tasks.length <= 3 ? `: ${tasks.map((t) => t.title).join(", ")}` : "";
    parts.push(`Masz ${tasks.length} ${word} do zrobienia${list}.`);
  } else {
    parts.push("Nie masz aktywnych zadań.");
  }
  parts.push("Miłego dnia.");
  return parts.join(" ");
}

const initialChat = (() => {
  const chats = loadChats();
  return chats[0] ?? null;
})();

export default function App() {
  const { settings } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>(initialChat?.messages ?? []);
  const [activeId, setActiveId] = useState<string>(initialChat?.id ?? uid());
  const [showHistory, setShowHistory] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showGadgets, setShowGadgets] = useState(false);
  const [showHud, setShowHud] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [interim, setInterim] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPanels, setShowPanels] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [locked, setLocked] = useState(lockIsSet());

  const listenerRef = useRef<Listener | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const pendingImageRef = useRef<PendingImage>(null);
  pendingImageRef.current = pendingImage;
  const sendRef = useRef<(t: string) => void>(() => {});
  const micSupported = isSpeechSupported();

  useEffect(() => {
    loadVoices();
    ensureNotifPerms();
    // Pełny ekran / natywny wygląd: pasek stanu edge-to-edge, ciemny.
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    }
    if (!resolveProvider()) setShowSettings(true);
    // Skróty / udostępnienia → polecenie; jarvis://wake (nasłuch w tle) → start słuchania.
    const dispose = registerIntents(
      (text) => sendRef.current(text),
      () => {
        stopSpeaking();
        feedback("wake");
        const text = "Tak? Słucham.";
        const id = uid();
        setLiveId(id);
        setMessages((m) => [...m, { id, role: "assistant", text, tools: ["wake"], createdAt: Date.now() }]);
        if (store.settings.speak) speak(text, store.settings);
        if (micSupported) startListening(false);
      },
    );
    if (store.settings.backgroundWake) startBackgroundWake();
    // Bramka zgód i podgląd kroków agenta.
    setConsentHandler((req) => new Promise((resolve) => setPendingConsent({ req, resolve })));
    setStepListener((tool) => setStep(tool));

    // Proaktywne powitanie + opcjonalny auto-nasłuch po otwarciu.
    const t = setTimeout(() => {
      const st = store.settings;
      const ready = !!resolveProvider();
      if (st.proactiveOnOpen && messagesRef.current.length === 0 && ready) {
        cue("wake"); // sygnał „systemy online"
        const text = buildGreeting();
        const id = uid();
        setLiveId(id);
        setMessages((m) => [...m, { id, role: "assistant", text, tools: ["proactive"], createdAt: Date.now() }]);
        if (st.speak) speak(text, st);
      }
      if (st.autoListenOnOpen && micSupported && ready) startListening(st.wakeWord);
    }, 800);

    return () => {
      clearTimeout(t);
      dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachImage = async () => {
    const img = await capturePhoto();
    if (img) setPendingImage(img);
  };

  // Motyw HUD.
  useEffect(() => {
    const b = document.body;
    ["theme-gold", "theme-green", "theme-red", "theme-purple"].forEach((c) => b.classList.remove(c));
    if (settings.theme && settings.theme !== "default") b.classList.add(`theme-${settings.theme}`);
  }, [settings.theme]);

  // Trwałość: zapisuj aktywną rozmowę do historii (najnowsze pierwsze).
  useEffect(() => {
    if (!messages.length) return;
    upsertChat({
      id: activeId,
      title: titleFrom(messages),
      messages: messages.slice(-100),
      updatedAt: Date.now(),
    });
  }, [messages, activeId]);

  // --- Wysłanie polecenia do JARVIS-a (agentowa pętla) ---
  const handleSend = async (text: string) => {
    setInterim("");
    stopSpeaking();
    buzz(14); // subtelna haptyka przy wysłaniu
    // Na komputerze: gdy użytkownik pyta o swój ekran, dołącz zrzut do analizy wizyjnej.
    if (
      isDesktop() &&
      !pendingImageRef.current &&
      /(m[oó]j ekran|na ekranie|zrzut ekranu|sp[oó]jrz na ekran|widzisz na ekranie|przeanalizuj ekran)/i.test(text)
    ) {
      const shot = await captureScreen();
      if (shot) pendingImageRef.current = shot;
    }
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
        citations: reply.citations,
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

  sendRef.current = handleSend;

  // Zrzut ekranu komputera → analiza wizyjna (desktop).
  const lookAtScreen = async () => {
    const img = await captureScreen();
    if (!img) {
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: "Zrzut ekranu działa tylko w aplikacji desktopowej (Windows .exe).", createdAt: Date.now() },
      ]);
      return;
    }
    pendingImageRef.current = img;
    handleSend("Przeanalizuj mój ekran — powiedz, co na nim widzisz i pomóż mi z tym.");
  };

  const newChat = () => {
    stopSpeaking();
    setMessages([]); // bieżąca jest już zapisana w historii
    setActiveId(uid());
    setLiveId(null);
  };

  const openChat = (s: ChatSession) => {
    stopSpeaking();
    setActiveId(s.id);
    setMessages(s.messages);
    setLiveId(null);
    setShowHistory(false);
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

  // Easter egg: 5 szybkich tapnięć w orb → tryb „Stark Industries".
  const tapRef = useRef<{ count: number; t: number }>({ count: 0, t: 0 });
  const onOrbTap = () => {
    const now = Date.now();
    const r = tapRef.current;
    r.count = now - r.t < 1500 ? r.count + 1 : 1;
    r.t = now;
    if (r.count >= 5) {
      r.count = 0;
      document.body.classList.toggle("stark");
      const on = document.body.classList.contains("stark");
      const text = on
        ? "Tryb Stark Industries aktywny. Wszystkie systemy do Twojej dyspozycji, Sir."
        : "Powrót do trybu standardowego.";
      const id = uid();
      setLiveId(id);
      setMessages((m) => [...m, { id, role: "assistant", text, tools: ["easter-egg"], createdAt: Date.now() }]);
      if (store.settings.speak) speak(text, store.settings);
    }
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
          notify("JARVIS — przypomnienie", r.text);
        });
    }, 20000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // --- Poranny briefing o ustalonej porze (raz dziennie, gdy aplikacja otwarta) ---
  useEffect(() => {
    const tick = setInterval(async () => {
      const st = store.settings;
      if (!st.dailyBriefing) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const todayStr = now.toISOString().slice(0, 10);
      if (localStorage.getItem("jarvis.briefing.date") === todayStr) return; // już dziś było
      if (hhmm < (st.briefingTime || "08:00")) return; // jeszcze nie pora
      localStorage.setItem("jarvis.briefing.date", todayStr);
      const text = await buildBriefing();
      const id = uid();
      setLiveId(id);
      setMessages((m) => [...m, { id, role: "assistant", text, tools: ["briefing"], createdAt: Date.now() }]);
      notify("JARVIS — poranny raport", text.replace(/\s+/g, " ").slice(0, 140));
      if (st.speak) {
        setOrb("speaking");
        speak(text, st);
      }
    }, 30000);
    return () => clearInterval(tick);
  }, []);

  // Status sieci dla wskaźnika HUD.
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          JARVIS
          <small>
            {(resolveProvider()?.model || "BRAK API").toUpperCase()}
            {(() => {
              const p = store.data.projects.find((x) => x.id === settings.activeProjectId);
              return p ? ` · ${p.name.toUpperCase()}` : "";
            })()}{" "}
            · {online ? "ONLINE" : "OFFLINE"}
          </small>
        </div>
        <div className="spacer" />
        <button
          className="icon-btn"
          onClick={() => {
            stopSpeaking();
            listenerRef.current?.stop();
            setShowLive(true);
          }}
          title="Rozmowa na żywo"
        >
          ☎
        </button>
        {messages.length > 0 && (
          <button className="icon-btn" onClick={newChat} title="Nowa rozmowa">
            ＋
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowMore(true)} title="Menu">
          ⋯
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ustawienia">
          ⚙
        </button>
      </div>

      <div onClick={onOrbTap}>
        <Orb state={orb} label={step && busy ? `⚙ ${step}…` : undefined} />
      </div>

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
      {showLive && <LiveOverlay onClose={() => setShowLive(false)} />}
      {showHistory && (
        <ChatHistory activeId={activeId} onOpen={openChat} onClose={() => setShowHistory(false)} />
      )}
      {showProjects && <Projects onClose={() => setShowProjects(false)} />}
      {showJournal && <Journal onClose={() => setShowJournal(false)} />}
      {showHelp && <Help onClose={() => setShowHelp(false)} />}
      {showMore && (
        <More
          onProjects={() => setShowProjects(true)}
          onJournal={() => setShowJournal(true)}
          onHistory={() => setShowHistory(true)}
          onData={() => setShowPanels(true)}
          onGadgets={() => setShowGadgets(true)}
          onHud={() => setShowHud(true)}
          onStudio={() => setShowStudio(true)}
          onScreen={isDesktop() ? lookAtScreen : undefined}
          onHelp={() => setShowHelp(true)}
          onClose={() => setShowMore(false)}
        />
      )}
      {showStudio && (
        <Suspense fallback={null}>
          <Studio onClose={() => setShowStudio(false)} />
        </Suspense>
      )}
      {showGadgets && (
        <Suspense fallback={null}>
          <Gadgets onClose={() => setShowGadgets(false)} />
        </Suspense>
      )}
      {showHud && (
        <Suspense fallback={null}>
          <HudVision onClose={() => setShowHud(false)} />
        </Suspense>
      )}
      {pendingConsent && (
        <PermissionDialog
          req={pendingConsent.req}
          onDecision={(allow, remember) => {
            pendingConsent.resolve({ allow, remember });
            setPendingConsent(null);
          }}
        />
      )}
    </div>
  );
}
