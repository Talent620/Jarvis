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
import SalesDashboard from "./components/SalesDashboard";
const MoneyHub = lazy(() => import("./components/MoneyHub"));
import Help from "./components/Help";
import More from "./components/More";
import Boot from "./components/Boot";
import LockScreen from "./components/LockScreen";
import Onboarding, { needsOnboarding } from "./components/Onboarding";
import LicenseGate from "./components/LicenseGate";
import { checkActivation, licenseRequired } from "./lib/license";
import HeadsetMode from "./components/HeadsetMode";
import { watchHeadset } from "./lib/headset";
import { toast } from "./lib/toast";
import { autoPlanDaily, autoPlanSummary } from "./lib/autoPlan";
import { notifySummary } from "./lib/notifyCenter";
import { startGeneration, cancelGeneration, isCurrent } from "./lib/generation";
import { nextNudge, markShown, type NudgeScreen } from "./lib/proactive";
import PermissionDialog from "./components/PermissionDialog";
import { lockIsSet } from "./lib/lock";
import { Suspense, lazy } from "react";

const Gadgets = lazy(() => import("./components/Gadgets"));
const HudVision = lazy(() => import("./components/HudVision"));
const Studio = lazy(() => import("./components/Studio"));
const SystemStatus = lazy(() => import("./components/SystemStatus"));
const MemoryCenter = lazy(() => import("./components/MemoryCenter"));
const AuditLog = lazy(() => import("./components/AuditLog"));
const SentBox = lazy(() => import("./components/SentBox"));
const ContentStudio = lazy(() => import("./components/ContentStudio"));
const AdStudio = lazy(() => import("./components/AdStudio"));
const FAQ = lazy(() => import("./components/FAQ"));
const WebStudio = lazy(() => import("./components/WebStudio"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));
const Cards = lazy(() => import("./components/Cards"));
const Transcribe = lazy(() => import("./components/Transcribe"));
const Profile = lazy(() => import("./components/Profile"));
const DayPlan = lazy(() => import("./components/DayPlan"));
const TaskHub = lazy(() => import("./components/TaskHub"));
const Translator = lazy(() => import("./components/Translator"));
const BargainHunter = lazy(() => import("./components/BargainHunter"));
const WhereToBuy = lazy(() => import("./components/WhereToBuy"));
const ShoppingList = lazy(() => import("./components/ShoppingList"));
const Notifications = lazy(() => import("./components/Notifications"));
import { loadChats, upsertChat, titleFrom, type ChatSession } from "./lib/chats";
import { setConsentHandler, setStepListener, type ConsentRequest } from "./lib/permissions";
import { startBackgroundWake } from "./lib/wakeword";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

type PendingConsent = { req: ConsentRequest; resolve: (d: { allow: boolean; remember: boolean }) => void };
import { askJarvis, resolveProvider } from "./lib/brain";
import { askCouncil, councilMembers, type CouncilReply } from "./lib/council";
import { isComplex } from "./lib/aiHelpers";
import { dueCount } from "./lib/cards";
import { statusFlags } from "./lib/status";
import { buildContext } from "./lib/context";
import { isUncensored, PROVIDERS } from "./lib/providers/registry";
import { enablePrivateMode } from "./lib/privateMode";
import { runProspecting } from "./lib/prospect";
import { createListener, isSpeechSupported, loadVoices, speak, stopSpeaking, type VoiceListener } from "./lib/voice";
import { capturePhoto } from "./lib/camera";
import { captureScreen, isDesktop, watchClipboard } from "./lib/desktop";
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
  const cards = dueCount();
  const bits: string[] = [];
  if (tasks) bits.push(`${tasks} aktywnych zadań`);
  if (events) bits.push(`${events} dziś w kalendarzu`);
  if (cards) bits.push(`${cards} fiszek do powtórki`);
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
  const [showSales, setShowSales] = useState(false);
  const [showMoney, setShowMoney] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showGadgets, setShowGadgets] = useState(false);
  const [showHud, setShowHud] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [showWeb, setShowWeb] = useState(false);
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
  const [councilStep, setCouncilStep] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [locked, setLocked] = useState(lockIsSet());
  const [onboarding, setOnboarding] = useState(needsOnboarding());
  const [clipSuggest, setClipSuggest] = useState<string>("");
  const [showVoice, setShowVoice] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDayPlan, setShowDayPlan] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showTranslator, setShowTranslator] = useState(false);
  const [showBargain, setShowBargain] = useState(false);
  const [showWhereToBuy, setShowWhereToBuy] = useState(false);
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showAds, setShowAds] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [booting, setBooting] = useState(true); // ładne „włączanie" przy starcie
  // null = sprawdzam aktywację; true/false = wynik. Brama licencji przed całą apką.
  const [licensed, setLicensed] = useState<boolean | null>(licenseRequired() ? null : true);

  useEffect(() => {
    if (licenseRequired()) checkActivation().then((r) => setLicensed(r.valid));
  }, []);

  const listenerRef = useRef<VoiceListener | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const pendingImageRef = useRef<PendingImage>(null);
  pendingImageRef.current = pendingImage;
  const sendRef = useRef<(t: string) => void>(() => {});
  const retryTextRef = useRef<string>(""); // ostatnie polecenie — do przycisku „Ponów"
  const busyRef = useRef(false); // aktualny „busy" dla pętli proaktywnej (bez stale-closure)
  busyRef.current = busy;
  const micSupported = isSpeechSupported();

  useEffect(() => {
    loadVoices();
    ensureNotifPerms();
    // Okno na telefonie (nie „strona w przeglądarce"): pasek stanu jako lity ciemny
    // pasek, a treść RENDEROWANA PONIŻEJ niego (overlay:false) — system sam pilnuje
    // marginesów, więc nic nie chowa się pod paskiem stanu ani nawigacji.
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#04070f" }).catch(() => {});
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
        if (store.settings.speak) void speak(text, store.settings).catch(() => {});
        if (micSupported) startListening(false);
      },
    );
    if (store.settings.backgroundWake) startBackgroundWake();
    // Bramka zgód i podgląd kroków agenta.
    setConsentHandler((req) => new Promise((resolve) => setPendingConsent({ req, resolve })));
    setStepListener((tool) => setStep(tool));

    // Autopilot sprzedaży — raz dziennie sam robi zadania z leadów (telefony,
    // follow-upy) i domyka nieaktualne. Cicho; dyskretny toast tylko gdy coś dodał.
    try {
      const r = autoPlanDaily();
      if (r && (r.added || r.completed)) toast(autoPlanSummary(r));
    } catch { /* nie blokuj startu */ }

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
        if (st.speak) void speak(text, st).catch(() => {});
        // Powitanie wspomina zadania/kalendarz/fiszki — nie powtarzaj ich od razu
        // przez Agenta proaktywnego (zostają przypomnienia i follow-upy).
        markShown("tasks"); markShown("cards"); markShown("event");
      }
      if (st.autoListenOnOpen && micSupported && ready) startListening(st.wakeWord);
    }, 800);

    return () => {
      clearTimeout(t);
      dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Proaktywny Agent: JARVIS sam się odzywa w trakcie pracy ===
  // Co chwilę sprawdza, czy jest coś ważnego (przypomnienie po terminie, wydarzenie
  // za moment, follow-up, zadanie na dziś, fiszka) i delikatnie to zgłasza — bubble
  // w czacie + toast z akcją „Otwórz". Nie przerywa, gdy JARVIS pracuje, i nie spamuje.
  const openProactiveScreen = (screen?: NudgeScreen) => {
    if (screen === "sales") setShowSales(true);
    else if (screen === "cards") setShowCards(true);
    else if (screen === "tasks") setShowTasks(true);
    else setShowPanels(true);
  };
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (busyRef.current || !resolveProvider()) return; // nie przerywaj pracy / brak mózgu
      const n = nextNudge();
      if (!n) return;
      markShown(n.kind);
      const id = uid();
      setLiveId(id);
      setMessages((m) => [...m, { id, role: "assistant", text: n.text, tools: ["proactive"], createdAt: Date.now() }]);
      if (n.speak && store.settings.speak) void speak(n.text, store.settings).catch(() => {});
      toast("📌 JARVIS się odezwał", { label: "Otwórz", onClick: () => openProactiveScreen(n.screen) });
    };
    const first = setTimeout(tick, 12_000);          // pierwszy szturchaniec ~12 s po starcie
    const iv = setInterval(tick, 90_000);            // potem co 90 s (silnik i tak ma anty-spam)
    return () => { clearTimeout(first); clearInterval(iv); };
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
  const handleSend = async (text: string, opts?: { council?: boolean; research?: boolean }) => {
    setInterim("");
    stopSpeaking();
    buzz(14); // subtelna haptyka przy wysłaniu

    // Komenda: Tryb Prywatny (w 100% lokalnie, offline).
    const lcp = text.toLowerCase();
    if (/(tryb|w[łl][aą]?cz|wlacz).{0,16}(prywatn|offline|lokaln)|w pe[łl]ni prywatn|ca[łl]kowicie prywatn/.test(lcp)) {
      const id0 = uid();
      setLiveId(id0);
      setMessages((m) => [...m, { id: id0, role: "assistant", text: "Szukam lokalnego modelu…", tools: ["tryb"], createdAt: Date.now() }]);
      const r = await enablePrivateMode();
      setMessages((m) => m.map((x) => (x.id === id0 ? { ...x, text: r.message } : x)));
      if (store.settings.speak) void speak(r.message, store.settings).catch(() => {});
      return;
    }

    // Komenda: przełącz tryb bez ograniczeń (działa realnie z modelem lokalnym/uncensored).
    const lc = text.toLowerCase();
    const wantOn = /(tryb|w[łl][aą]?cz|wlacz).{0,24}(bez cenzury|bez ogranicze|nieocenzurow|posłusze|posluszen)|zdejmij.{0,16}ogranicze|wy[łl][aą]?cz.{0,16}(cenzur|filtr|ogranicze|wszelkie)|pe[łl]ne pos[łl]usze/.test(lc);
    const wantOff = /(przywr[oó][cć]|w[łl][aą]?cz|wlacz).{0,24}(cenzur|filtr|ogranicze)|tryb.{0,8}(normaln|standardow|bezpieczn)/.test(lc);
    if (wantOn || wantOff) {
      const on = wantOn && !wantOff;
      store.setSettings({ unfilteredLocal: on });
      const r = resolveProvider();
      const localOk = !!r && (r.provider === "ollama" || isUncensored(r.model));
      const msg = !on
        ? "Przywróciłem standardowy tryb."
        : localOk
          ? "Tryb bez ograniczeń aktywny. Słucham wprost, bez zbędnych zastrzeżeń."
          : "Włączyłem tryb bez ograniczeń — ale używasz modelu w chmurze, który ma własne zasady dostawcy (tego nie zdejmę). Pełny brak granic działa tylko z modelem lokalnym (Ollama) lub Dolphin — ustaw w ⚙ → AI.";
      const id = uid();
      setLiveId(id);
      setMessages((m) => [...m, { id, role: "assistant", text: msg, tools: ["tryb"], createdAt: Date.now() }]);
      if (store.settings.speak) void speak(msg, store.settings).catch(() => {});
      return;
    }

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
    retryTextRef.current = text; // zapamiętaj do „Ponów", gdyby odpowiedź się nie udała
    const userMsg: ChatMessage = { id: uid(), role: "user", text, image, createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setPendingImage(null);
    setBusy(true);
    setOrb("thinking");
    const genToken = startGeneration(); // do bezpiecznego „Stop"

    try {
      // Okno kontekstu: czysty dialog (bez komunikatów systemowych), ostatnie 30
      // wiadomości — żeby JARVIS pamiętał, co napisałeś, a nie powitania/briefingi.
      const history = buildContext([...messagesRef.current, userMsg], 30);

      // Głębokie badanie (🔬): wzmocnij ostatnie polecenie dyrektywą researchu ze
      // źródłami. Używa narzędzi (web_research), więc idzie normalną ścieżką.
      if (opts?.research) {
        const last = history[history.length - 1];
        last.content =
          "Przeprowadź GŁĘBOKIE BADANIE tematu: użyj narzędzia web_research kilka razy z różnymi, " +
          "uzupełniającymi się zapytaniami, zbierz fakty z wielu źródeł i zsyntezuj wyczerpującą, " +
          "uporządkowaną odpowiedź (sekcje/punkty), powołując się na źródła numerami [1], [2]. " +
          `Na końcu dodaj krótkie „W skrócie".\n\nTemat: ${text}`;
      }

      // Tryb Konsylium: na żądanie (przycisk ⚖) albo automatycznie przy złożonych
      // pytaniach, gdy włączony w ustawieniach. Obrazy, research (narzędzia) i proste
      // polecenia idą normalną ścieżką.
      const wantCouncil = opts?.council || (store.settings.councilMode && isComplex(text));
      const useCouncil = !!wantCouncil && !image && !opts?.research && councilMembers(3).length >= 2;
      if (useCouncil) setCouncilStep(`⚖ Konsylium — pytam ${councilMembers(3).length} modele…`);
      let reply;
      try {
        reply = useCouncil ? await askCouncil(history) : await askJarvis(history);
      } finally {
        setCouncilStep(null);
      }
      // Failover widoczny: gdy główny mózg był zajęty i odpowiedział zapasowy — powiedz to
      // wprost (koniec strachu „API się skończyło"). Tylko gdy faktycznie był fallback.
      // Użytkownik kliknął Stop (albo wysłał coś nowego) — porzuć spóźnioną odpowiedź.
      if (!isCurrent(genToken)) return;
      const r = reply as Partial<{ via: string; fellBack: boolean }>;
      if (r.fellBack && r.via) {
        const label = PROVIDERS[r.via as keyof typeof PROVIDERS]?.label || r.via;
        toast(`🔄 Główny mózg był zajęty — odpowiedział zapasowy: ${label}`);
      }
      const aiMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: reply.text,
        tools: reply.tools,
        citations: reply.citations,
        council: (reply as Partial<CouncilReply>).council,
        createdAt: Date.now(),
      };
      setLiveId(aiMsg.id);
      setMessages((m) => [...m, aiMsg]);

      if (store.settings.speak) {
        setOrb("speaking");
        await speak(reply.text, store.settings);
      }
    } catch (e) {
      if (!isCurrent(genToken)) return; // zatrzymane przez użytkownika — nie pokazuj błędu
      const err = e instanceof Error ? e.message : String(e);
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: `⚠ ${err}`, createdAt: Date.now() },
      ]);
    } finally {
      // Resetuj stan tylko, jeśli to wciąż ta sama generacja — inaczej Stop / nowa
      // wiadomość już ustawiły swój stan i nie wolno go nadpisać.
      if (isCurrent(genToken)) {
        setBusy(false);
        setOrb(listenerRef.current?.listening ? "listening" : "idle");
      }
    }
  };

  // Zatrzymanie generowania: ucisz głos, porzuć trwającą odpowiedź, odblokuj wejście.
  const stopGeneration = () => {
    cancelGeneration();
    stopSpeaking();
    setCouncilStep(null);
    setBusy(false);
    setOrb(listenerRef.current?.listening ? "listening" : "idle");
    toast("⏹ Zatrzymano");
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
    const listener = createListener({
      wakeWord: wake,
      onWake: () => {
        stopSpeaking();
        if (store.settings.voiceModeWake) {
          // Słowo „Jarvis" otwiera pełnoekranowy tryb głosowy (bez patrzenia).
          listenerRef.current?.stop();
          setShowVoice(true);
          return;
        }
        setOrb("listening");
      },
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim("");
        if (t.trim()) handleSend(t);
      },
      onError: (msg) => {
        setInterim("");
        setMicOn(false);
        setOrb("idle");
        toast(msg);
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
      if (store.settings.speak) void speak(text, store.settings).catch(() => {});
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
          if (store.settings.speak) void speak(text, store.settings).catch(() => {});
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
        void speak(text, st).catch(() => {});
      }
    }, 30000);
    return () => clearInterval(tick);
  }, []);

  // --- Auto-prospekting: co ~4 h (gdy włączone) JARVIS szuka nowych leadów ---
  useEffect(() => {
    const tick = setInterval(async () => {
      const st = store.settings;
      if (!st.autoProspect || !st.tavilyApiKey?.trim() || !st.prospectNiche?.trim()) return;
      const last = Number(localStorage.getItem("jarvis.prospect.ts") || 0);
      if (Date.now() - last < 4 * 3600 * 1000) return; // ~6×/dzień
      localStorage.setItem("jarvis.prospect.ts", String(Date.now()));
      const r = await runProspecting();
      if (r.added) {
        const id = uid();
        setLiveId(id);
        setMessages((m) => [
          ...m,
          { id, role: "assistant", text: `📈 Automat sprzedaży: znalazłem ${r.added} nowych leadów (${st.prospectNiche}, ${st.prospectLocation}). Są w Pulpicie Sprzedaży (⋯ → 📈).`, tools: ["prospect"], createdAt: Date.now() },
        ]);
      }
    }, 60000);
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

  // Słuchawki BT podłączone → zaproponuj/otwórz tryb głosowy (obsługa bez patrzenia).
  useEffect(() => {
    const stop = watchHeadset(() => {
      toast("🎧 Słuchawki podłączone — Tryb Słuchawki gotowy");
      setShowVoice(true);
    });
    const offVoice = (window as any).jarvisDesktop?.onVoiceMode?.(() => setShowVoice((v: boolean) => !v));
    return () => {
      stop();
      offVoice?.();
    };
  }, []);

  // Proaktywny schowek (desktop, opt-in): skopiowany tekst → dyskretna propozycja.
  useEffect(() => {
    if (!isDesktop() || !settings.clipboardWatch) return;
    const stop = watchClipboard((text) => setClipSuggest(text));
    return () => stop?.();
  }, [settings.clipboardWatch]);

  if (licensed === null) return <div className="onboard"><div className="onboard-orb" /></div>;
  if (!licensed) return <LicenseGate onActivated={() => setLicensed(true)} />;
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  if (onboarding)
    return (
      <Onboarding
        onDone={() => {
          setOnboarding(false);
          if (resolveProvider()) setShowSettings(false); // klucz dodany w kreatorze
        }}
      />
    );

  return (
    <div className={`app${messages.length ? " chatting" : ""}`}>
      {booting && <Boot onDone={() => setBooting(false)} />}
      {clipSuggest && (
        <div className="clip-widget">
          <p>📋 {clipSuggest.slice(0, 120)}</p>
          <div className="row-btns">
            <button
              className="btn primary"
              style={{ flex: 1, marginTop: 0, padding: "8px 10px", fontSize: 13 }}
              onClick={() => {
                const t = clipSuggest;
                setClipSuggest("");
                const isUrl = /^https?:\/\/\S+$/i.test(t.trim());
                sendRef.current(
                  isUrl
                    ? `Przeanalizuj ten link i powiedz mi, co w nim jest najważniejsze: ${t.trim()}`
                    : `Przeanalizuj tekst, który właśnie skopiowałem, i zaproponuj, co mogę z nim zrobić:\n\n${t}`,
                );
              }}
            >
              🔍 Przeanalizuj
            </button>
            <button className="btn" style={{ width: "auto", marginTop: 0, padding: "8px 10px", fontSize: 13 }} onClick={() => setClipSuggest("")}>
              ✕
            </button>
          </div>
        </div>
      )}
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
            setShowVoice(true);
          }}
          title="Tryb Słuchawki — rozmowa hands-free"
        >
          🎙
        </button>
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
        {(() => {
          const n = notifySummary().total;
          return (
            <button className="icon-btn" style={{ position: "relative" }} onClick={() => setShowNotifs(true)} title="Powiadomienia">
              🔔
              {n > 0 && (
                <span className="notif-badge" style={{ position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 9, background: "#e0584f", color: "#fff", fontSize: 10, lineHeight: "16px", textAlign: "center", fontWeight: 700, boxSizing: "border-box" }}>
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </button>
          );
        })()}
        <button className="icon-btn" onClick={() => setShowMore(true)} title="Menu">
          ⋯
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ustawienia">
          ⚙
        </button>
      </div>

      {(() => {
        const flags = statusFlags();
        if (!flags.length) return null;
        const open = (id: string) => {
          if (id === "decisions") setShowSales(true);
          else if (id === "review") setShowCards(true);
          else setShowPanels(true);
          toast(flags.find((f) => f.id === id)?.detail || "");
        };
        return (
          <div className="status-deck">
            {flags.map((f) => (
              <button key={f.id} className={`status-flag ${f.severity}`} onClick={() => open(f.id)} title={f.detail}>
                {f.severity === "error" ? "⛔" : f.severity === "warn" ? "⚑" : "•"} {f.label}
              </button>
            ))}
          </div>
        );
      })()}

      {(messages.length === 0 || orb !== "idle") && (
        <div onClick={onOrbTap}>
          <Orb state={orb} label={councilStep || (step && busy ? `⚙ ${step}…` : undefined)} />
        </div>
      )}

      <Conversation
        messages={messages}
        interim={interim}
        liveId={liveId}
        onSuggest={handleSend}
        onRetry={() => { if (retryTextRef.current && !busy) handleSend(retryTextRef.current); }}
        thinking={busy}
      />

      <Composer
        onSend={handleSend}
        onStop={stopGeneration}
        onMic={toggleMic}
        onAttach={attachImage}
        onRemoveImage={() => setPendingImage(null)}
        imagePreview={pendingImage ? `data:${pendingImage.mediaType};base64,${pendingImage.data}` : null}
        micOn={micOn}
        busy={busy}
        micSupported={micSupported}
        councilAvailable={councilMembers(3).length >= 2}
      />

      {showVoice && <HeadsetMode onClose={() => setShowVoice(false)} />}
      {showAdmin && (
        <Suspense fallback={null}>
          <AdminPanel onClose={() => setShowAdmin(false)} />
        </Suspense>
      )}
      {showCards && (
        <Suspense fallback={null}>
          <Cards onClose={() => setShowCards(false)} />
        </Suspense>
      )}
      {showTranscribe && (
        <Suspense fallback={null}>
          <Transcribe onClose={() => setShowTranscribe(false)} />
        </Suspense>
      )}
      {showProfile && (
        <Suspense fallback={null}>
          <Profile onClose={() => setShowProfile(false)} />
        </Suspense>
      )}
      {showDayPlan && (
        <Suspense fallback={null}>
          <DayPlan onClose={() => setShowDayPlan(false)} onSales={() => { setShowDayPlan(false); setShowSales(true); }} />
        </Suspense>
      )}
      {showTasks && (
        <Suspense fallback={null}>
          <TaskHub onClose={() => setShowTasks(false)} />
        </Suspense>
      )}
      {showTranslator && (
        <Suspense fallback={null}>
          <Translator onClose={() => setShowTranslator(false)} />
        </Suspense>
      )}
      {showBargain && (
        <Suspense fallback={null}>
          <BargainHunter onClose={() => setShowBargain(false)} />
        </Suspense>
      )}
      {showWhereToBuy && (
        <Suspense fallback={null}>
          <WhereToBuy onClose={() => setShowWhereToBuy(false)} />
        </Suspense>
      )}
      {showShoppingList && (
        <Suspense fallback={null}>
          <ShoppingList onClose={() => setShowShoppingList(false)} />
        </Suspense>
      )}
      {showNotifs && (
        <Suspense fallback={null}>
          <Notifications
            onClose={() => setShowNotifs(false)}
            onTasks={() => { setShowNotifs(false); setShowTasks(true); }}
            onSales={() => { setShowNotifs(false); setShowSales(true); }}
            onCards={() => { setShowNotifs(false); setShowCards(true); }}
          />
        </Suspense>
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showPanels && <Panels onClose={() => setShowPanels(false)} />}
      {showLive && <LiveOverlay onClose={() => setShowLive(false)} />}
      {showHistory && (
        <ChatHistory activeId={activeId} onOpen={openChat} onClose={() => setShowHistory(false)} />
      )}
      {showProjects && <Projects onClose={() => setShowProjects(false)} />}
      {showJournal && <Journal onClose={() => setShowJournal(false)} />}
      {showSales && (
        <SalesDashboard
          onClose={() => setShowSales(false)}
          onWeb={() => { setShowSales(false); setShowWeb(true); }}
          onMoney={() => { setShowSales(false); setShowMoney(true); }}
        />
      )}
      {showMoney && (
        <Suspense fallback={null}>
          <MoneyHub
            onClose={() => setShowMoney(false)}
            onSales={() => { setShowMoney(false); setShowSales(true); }}
            onWeb={() => { setShowMoney(false); setShowWeb(true); }}
          />
        </Suspense>
      )}
      {showHelp && <Help onClose={() => setShowHelp(false)} />}
      {showMore && (
        <More
          onProjects={() => setShowProjects(true)}
          onJournal={() => setShowJournal(true)}
          onMoney={() => setShowMoney(true)}
          onSales={() => setShowSales(true)}
          onHistory={() => setShowHistory(true)}
          onData={() => setShowPanels(true)}
          onGadgets={() => setShowGadgets(true)}
          onHud={() => setShowHud(true)}
          onStudio={() => setShowStudio(true)}
          onWeb={() => setShowWeb(true)}
          onScreen={isDesktop() ? lookAtScreen : undefined}
          onHelp={() => setShowHelp(true)}
          onAdmin={() => setShowAdmin(true)}
          onCards={() => setShowCards(true)}
          onTranscribe={() => setShowTranscribe(true)}
          onProfile={() => setShowProfile(true)}
          onDayPlan={() => setShowDayPlan(true)}
          onTasks={() => setShowTasks(true)}
          onTranslator={() => setShowTranslator(true)}
          onBargain={() => setShowBargain(true)}
          onWhereToBuy={() => setShowWhereToBuy(true)}
          onShoppingList={() => setShowShoppingList(true)}
          onNotifications={() => setShowNotifs(true)}
          onStatus={() => setShowStatus(true)}
          onMemory={() => setShowMemory(true)}
          onAudit={() => setShowAudit(true)}
          onSent={() => setShowSent(true)}
          onContent={() => setShowContent(true)}
          onAds={() => setShowAds(true)}
          onFaq={() => setShowFaq(true)}
          onClose={() => setShowMore(false)}
        />
      )}
      {showStatus && (
        <Suspense fallback={null}>
          <SystemStatus onClose={() => setShowStatus(false)} />
        </Suspense>
      )}
      {showMemory && (
        <Suspense fallback={null}>
          <MemoryCenter onClose={() => setShowMemory(false)} />
        </Suspense>
      )}
      {showAudit && (
        <Suspense fallback={null}>
          <AuditLog onClose={() => setShowAudit(false)} />
        </Suspense>
      )}
      {showSent && (
        <Suspense fallback={null}>
          <SentBox onClose={() => setShowSent(false)} />
        </Suspense>
      )}
      {showContent && (
        <Suspense fallback={null}>
          <ContentStudio onClose={() => setShowContent(false)} />
        </Suspense>
      )}
      {showAds && (
        <Suspense fallback={null}>
          <AdStudio onClose={() => setShowAds(false)} />
        </Suspense>
      )}
      {showFaq && (
        <Suspense fallback={null}>
          <FAQ onClose={() => setShowFaq(false)} />
        </Suspense>
      )}
      {showStudio && (
        <Suspense fallback={null}>
          <Studio onClose={() => setShowStudio(false)} />
        </Suspense>
      )}
      {showWeb && (
        <Suspense fallback={null}>
          <WebStudio onClose={() => setShowWeb(false)} />
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
