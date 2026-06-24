import { lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CommandItem } from "./lib/commandPalette";
import Orb, { type OrbState } from "./components/Orb";
import Conversation from "./components/Conversation";
import Composer from "./components/Composer";
const SettingsPanel = lazy(() => import("./components/Settings"));
const Panels = lazy(() => import("./components/Panels"));
import LiveOverlay from "./components/LiveOverlay";
const ChatHistory = lazy(() => import("./components/ChatHistory"));
const Projects = lazy(() => import("./components/Projects"));
const Journal = lazy(() => import("./components/Journal"));
const SalesDashboard = lazy(() => import("./components/SalesDashboard"));
const MoneyHub = lazy(() => import("./components/MoneyHub"));
const Help = lazy(() => import("./components/Help"));
const More = lazy(() => import("./components/More"));
import Boot from "./components/Boot";
import LockScreen from "./components/LockScreen";
import Onboarding, { needsOnboarding } from "./components/Onboarding";
import LicenseGate from "./components/LicenseGate";
import { checkActivation, licenseRequired } from "./lib/license";
const HeadsetMode = lazy(() => import("./components/HeadsetMode"));
import { watchHeadset } from "./lib/headset";
import { toast, copyWithToast } from "./lib/toast";
import { conversationToMarkdown } from "./lib/exportChat";
import { followUps } from "./lib/followups";
import { PRESETS } from "./lib/prompts";
import { detectDecision, decisionKey, decisionValue, type DecisionCandidate } from "./lib/decisions";
import { isBossSummon } from "./lib/boss";
import { completionReport } from "./lib/completion";
import { healthIssues, topIssue, newIssues, alertText, applyAutoFixes } from "./lib/watchdog";
import { valueToday, prettyMinutes } from "./lib/valueLog";
import { rememberFact } from "./lib/memory";
import { autoPlanDaily, autoPlanSummary } from "./lib/autoPlan";
import { notifySummary } from "./lib/notifyCenter";
import { startGeneration, cancelGeneration, isCurrent } from "./lib/generation";
import { nextNudge, markShown, type NudgeScreen } from "./lib/proactive";
import { runProactiveNotifications } from "./lib/proactiveNotify";
import { recordActiveDay } from "./lib/habit";
import { nextTip, recordTipShown, contextualTipNow, dailyDigestNow, recordDigestShown, type Tip } from "./lib/tips";
import TipBubble from "./components/TipBubble";
import PermissionDialog from "./components/PermissionDialog";
import { lockIsSet } from "./lib/lock";

const Gadgets = lazy(() => import("./components/Gadgets"));
const HudVision = lazy(() => import("./components/HudVision"));
const Studio = lazy(() => import("./components/Studio"));
const SystemStatus = lazy(() => import("./components/SystemStatus"));
const CostPanel = lazy(() => import("./components/CostPanel"));
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
const TaskHub = lazy(() => import("./components/TaskHub"));
const Translator = lazy(() => import("./components/Translator"));
const BargainHunter = lazy(() => import("./components/BargainHunter"));
const WhereToBuy = lazy(() => import("./components/WhereToBuy"));
const ShoppingList = lazy(() => import("./components/ShoppingList"));
const Notifications = lazy(() => import("./components/Notifications"));
import { loadChats, upsertChat, titleFrom, type ChatSession } from "./lib/chats";
import { mcpManager } from "./lib/mcp";
import { setConsentHandler, setStepListener, type ConsentRequest } from "./lib/permissions";
import { startBackgroundWake } from "./lib/wakeword";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

type PendingConsent = { req: ConsentRequest; resolve: (d: { allow: boolean; remember: boolean }) => void };
import { askJarvis, resolveProvider, hasUsableBrain } from "./lib/brain";
import { askCouncil, councilMembers, type CouncilReply } from "./lib/council";
import { isComplex, isActionRequest } from "./lib/aiHelpers";
import { dueCount } from "./lib/cards";
import { statusFlags } from "./lib/status";
import { buildContext } from "./lib/context";
import { isUncensored, PROVIDERS } from "./lib/providers/registry";
import { enablePrivateMode, findOllamaServer } from "./lib/privateMode";
import Guardian from "./components/Guardian";
import Mind from "./components/Mind";
const GoalRunner = lazy(() => import("./components/GoalRunner"));
const CommandPalette = lazy(() => import("./components/CommandPalette"));
const Recall = lazy(() => import("./components/Recall"));
const BossMode = lazy(() => import("./components/BossMode"));
import { guardianAutoHeal } from "./lib/guardian";
import { guardianScan } from "./lib/guardianAgents";
import { checkForUpdate, applyUpdate } from "./lib/updater";
import { topPredictions } from "./lib/predict";
import { runProspecting } from "./lib/prospect";
import { syncFromSalesOs, shouldAutoSyncSalesOs } from "./lib/salesOs";
import { currentBrainMode } from "./lib/brainMode";
import { createListener, isSpeechSupported, loadVoices, speak, stopSpeaking, checkPinnedVoice, type VoiceListener } from "./lib/voice";
import { capturePhoto } from "./lib/camera";
import { captureScreen, isDesktop, watchClipboard } from "./lib/desktop";
import ScreenBoundary from "./components/ScreenBoundary";
import { getWeather } from "./lib/weather";
import { buildChiefBriefing, formatBriefing } from "./lib/chiefOfStaff";
import { maybePrewarm, warmNow } from "./lib/prewarm";
import { feedback, buzz, cue } from "./lib/feedback";
import { ensureNotifPerms, notify } from "./lib/notifications";
import { registerIntents } from "./lib/intents";
import { store, uid } from "./lib/store";
import { brand } from "./lib/brand";
import { isLocked as keysAreLocked } from "./lib/secretsVault";
import UnlockKeys from "./components/UnlockKeys";
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
  // Chief of Staff: strukturalny przegląd z istniejących danych (zadania/zaległości/leady/
  // relacje/rekomendacje) — logika w testowanym `chiefOfStaff.ts` (jedyny silnik odprawy).
  const d = store.data;
  let weather = "";
  try {
    const w = await getWeather();
    if (w && !/nie udało|niedostęp/i.test(w)) weather = w;
  } catch {
    /* pomiń pogodę */
  }
  const b = buildChiefBriefing(
    { tasks: d.tasks, reminders: d.reminders, calendar: d.calendar, leads: d.leads, people: d.world?.entities || [] },
    Date.now(),
    weather || undefined,
  );
  return formatBriefing(b);
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
  // Czat prywatny/tymczasowy (jak w ChatGPT) — rozmowa NIE trafia do historii.
  const [privateChat, setPrivateChat] = useState(false);
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
  const [showGuardian, setShowGuardian] = useState(false);
  const [showMind, setShowMind] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [showCmd, setShowCmd] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const [recallSeed, setRecallSeed] = useState("");
  const [showBoss, setShowBoss] = useState(false);
  const [completionHidden, setCompletionHidden] = useState(false);
  const alertedRef = useRef<Set<string>>(new Set()); // 🩺 watchdog: nie alarmuj dwa razy o tym samym
  const [tip, setTip] = useState<Tip | null>(null);
  const [decision, setDecision] = useState<DecisionCandidate | null>(null); // 🧠 auto-capture
  const tipCountRef = useRef(0);
  // ⌘K — referencja na świeże akcje (rejestr poleceń budowany NIŻEJ, po deklaracji wszystkich stanów,
  // by uniknąć TDZ na setterach useState).
  const actionsRef = useRef<Record<string, () => void>>({});
  // Skrót ⌘K / Ctrl+K — globalny.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setShowCmd((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 🩺 Watchdog Szefa: sprawdź stan po starcie i co ~6 min; alarmuj TYLKO o nowych problemach.
  useEffect(() => {
    const alerted = alertedRef.current;
    const visibleVoice = () => store.settings.speak && (typeof document === "undefined" || document.visibilityState !== "hidden");
    const check = () => {
      // 1) 🛠 SELF-HEAL: sam napraw bezpieczne usterki ustawień i powiedz o tym.
      const fixed = applyAutoFixes();
      if (fixed.length) {
        const m = `Naprawiłem: ${fixed[0]}${fixed.length > 1 ? ` i ${fixed.length - 1} więcej` : ""}.`;
        toast("🛠 " + m);
        if (visibleVoice()) void speak("Sam naprawiłem: " + fixed[0] + ".", store.settings).catch(() => {});
      }
      // 2) 🔔 ALERT o nowych problemach, których nie da się naprawić automatycznie.
      const fresh = newIssues(alerted, healthIssues());
      if (!fresh.length) return;
      fresh.forEach((i) => alerted.add(i.id));
      const top = topIssue(fresh);
      if (!top) return;
      if (top.severity === "warn" && store.settings.tips === false) return; // szanuj wyciszenie (błędy zawsze)
      toast(alertText(top), { label: "Sprawdź", onClick: () => setShowGuardian(true) });
      // Głosowy alert Szefa — błędy mówi na głos i kieruje do naprawy.
      if (top.severity === "err" && visibleVoice()) void speak(`Uwaga: ${top.title}. Wejdź w diagnozę, żeby to naprawić.`, store.settings).catch(() => {});
    };
    const first = setTimeout(check, 4500);
    const iv = setInterval(check, 6 * 60_000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, []);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [locked, setLocked] = useState(lockIsSet());
  const [onboarding, setOnboarding] = useState(needsOnboarding());
  const [keysLocked, setKeysLocked] = useState(keysAreLocked());
  const [clipSuggest, setClipSuggest] = useState<string>("");
  const [showVoice, setShowVoice] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showTranslator, setShowTranslator] = useState(false);
  const [showBargain, setShowBargain] = useState(false);
  const [showWhereToBuy, setShowWhereToBuy] = useState(false);
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showCosts, setShowCosts] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showAds, setShowAds] = useState(false);
  // ⌘K — rejestr poleceń. MUSI być po WSZYSTKICH useState (referuje settery), inaczej TDZ na pierwszym
  // renderze (fabryka useMemo wykonuje się od razu). Stabilny (deps []); akcje przez actionsRef.
  const commands = useMemo<CommandItem[]>(() => {
    const open = (id: string, title: string, set: (v: boolean) => void, icon: string, keywords = ""): CommandItem =>
      ({ id, title, icon, keywords, group: "Otwórz", run: () => set(true) });
    const act = (id: string, title: string, icon: string, keywords = ""): CommandItem =>
      ({ id, title, icon, keywords, group: "Akcja", run: () => actionsRef.current[id]?.() });
    return [
      open("settings", "Ustawienia", setShowSettings, "⚙", "klucze model glos motyw konto api"),
      open("sales", "Pulpit Sprzedaży", setShowSales, "📈", "leady crm oferty klienci sprzedaz"),
      open("goal", "🎯 Zleć cel", setShowGoal, "🎯", "do-for-me projekt plan wieloetapowe cel"),
      open("studio", "Studio Obrazów", setShowStudio, "🎨", "zdjecia edycja generuj obraz foto"),
      open("guardian", "Diagnoza i naprawa (dawny Strażnik)", setShowGuardian, "🩺", "napraw przyspiesz pomoc diagnoza strażnik"),
      open("mind", "Umysł JARVISA", setShowMind, "🧠", "odprawa pamiec swiat wzorce samoocena"),
      open("memory", "Co JARVIS o mnie wie", setShowMemory, "🧠", "pamiec fakty edytuj usun wiedza"),
      open("profile", "Mój profil", setShowProfile, "👤", "kim jestem profil"),
      open("tasks", "Zadania", setShowTasks, "✅", "gtd projekty priorytety todo"),
      open("journal", "Dziennik", setShowJournal, "📔", "przemyslenia notatki"),
      open("web", "Kreator stron", setShowWeb, "🌐", "strona witryna www"),
      open("money", "Zarabianie", setShowMoney, "💰", "dochod autopilot pieniadze"),
      open("bargain", "Łowca Okazji", setShowBargain, "🏷", "tanio kup okazja cena"),
      open("translator", "Tłumacz na żywo", setShowTranslator, "🌍", "tlumacz jezyk rozmowa"),
      open("transcribe", "Transkrypcja", setShowTranscribe, "🎙", "spotkanie mowa tekst"),
      open("cards", "Kapsuły Wiedzy", setShowCards, "🃏", "ucz fiszki nauka"),
      open("content", "Maszynka do kontentu", setShowContent, "📱", "posty social media"),
      open("ads", "Generator reklam", setShowAds, "📢", "reklamy google facebook ads"),
      open("hud", "Wizja (kamera)", setShowHud, "👁", "kamera widzisz obraz wizja"),
      open("status", "Stan systemu", setShowStatus, "🩺", "diagnostyka co dziala"),
      open("recall", "🔎 Recall — znajdź wszystko", setShowRecall, "🔎", "szukaj znajdz historia czat dziennik pamiec notatki recall"),
      open("data", "Dane i kopia", setShowPanels, "🗄", "backup eksport dane kopia"),
      act("boss", "⬢ Tryb Szefa — agent głosowy (Matrix)", "⬢", "szef boss matrix agent glos rozkaz wykonaj strażnik"),
      act("voicemode", "Tryb Słuchawki (rozmowa)", "🎧", "glos hands-free rozmowa"),
      act("live", "Rozmowa na żywo", "☎", "live glos telefon"),
      act("newchat", "Nowa rozmowa", "＋", "wyczysc reset czat"),
      act("private", "Czat prywatny (przełącz)", "🕶", "prywatny incognito"),
      act("exportmd", "📤 Eksportuj rozmowę (Markdown)", "📤", "eksport zapisz markdown kopiuj rozmowa udostepnij"),
      act("mic", "Mikrofon (przełącz)", "🎤", "sluchaj mow mikrofon"),
      // ⚡ Szybkie startery (biblioteka promptów) — od razu ruszają z robotą.
      ...PRESETS.map((p): CommandItem => ({ id: p.id, title: p.title, icon: p.icon, keywords: p.kw, group: "⚡ Startery", run: () => actionsRef.current[p.id]?.() })),
    ];
  }, []);
  // 💡 Dymki-porady (coaching): nienachalnie, po chwili i co kilka minut, gdy nie pracujesz; maks 4/sesję.
  useEffect(() => {
    if (store.settings.tips === false) return;
    const maybeShow = () => {
      if (tipCountRef.current >= 4 || busyRef.current || !hasUsableBrain()) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setTip((cur) => {
        if (cur) return cur; // już wisi jeden
        const ctx = { hasBrain: true, messages: messagesRef.current.length, desktop: isDesktop() };
        // Pierwsza porada sesji: dzienny digest „Dziś możesz: …" (raz dziennie); potem pojedyncze.
        const t = (tipCountRef.current === 0 ? dailyDigestNow(ctx) : null) ?? nextTip(ctx);
        if (t) { if (t.id === "digest") recordDigestShown(); else recordTipShown(t.id); tipCountRef.current += 1; }
        return t;
      });
    };
    const first = setTimeout(maybeShow, 35_000);
    const iv = setInterval(maybeShow, 4 * 60_000);
    return () => { clearTimeout(first); clearInterval(iv); };

  }, []);
  const onTipAction = (actionId: string) => { setTip(null); commands.find((c) => c.id === actionId)?.run(); };
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
    // Voice Guardian — start aplikacji:
    // 1) Pierwsze uruchomienie bez wybranego głosu → przypnij na sztywno najlepszy polski
    //    „domyślny głos JARVISA" (jednorazowo), żeby od razu brzmiał spójnie i nie skakał.
    // 2) Później: sprawdź, czy przypięty głos wciąż istnieje; jeśli zniknął — najlepszy zamiennik.
    void (async () => {
      try {
        const inited = localStorage.getItem("jarvis.voice.init");
        if (!inited && !store.settings.voiceName?.trim()) {
          const { listSpeechVoices, bestPlVoiceName } = await import("./lib/voice");
          const best = bestPlVoiceName(await listSpeechVoices());
          // Flagę „zrobione" zapisz TYLKO, gdy realnie przypięliśmy głos. Gdy lista głosów jest
          // jeszcze pusta (zimny start), spróbuj ponownie przy następnym uruchomieniu.
          if (best) { localStorage.setItem("jarvis.voice.init", "1"); store.setSettings({ voiceName: best, voicePinned: true, voiceSystemPl: true }); }
          return; // pierwszy start — nie ma czego sprawdzać (przypiętego głosu)
        }
        const r = await checkPinnedVoice();
        if (r.changed && r.to) { store.setSettings({ voiceName: r.to }); toast(`🎤 Głos „${r.from}" zniknął — przełączono na ${r.to}.`); }
      } catch { /* brak głosów — zostaje systemowy */ }
    })();
    ensureNotifPerms();
    // Okno na telefonie (nie „strona w przeglądarce"): pasek stanu jako lity ciemny
    // pasek, a treść RENDEROWANA PONIŻEJ niego (overlay:false) — system sam pilnuje
    // marginesów, więc nic nie chowa się pod paskiem stanu ani nawigacji.
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#04070f" }).catch(() => {});
    }
    // Wymuś konfigurację TYLKO gdy brak JAKIEGOKOLWIEK mózgu — nie nękaj użytkowników
    // korzystających tylko z Ollamy (tryb auto + lokalny serwer daje resolveProvider=null).
    if (!hasUsableBrain()) setShowSettings(true);
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
      () => { stopSpeaking(); listenerRef.current?.stop(); setShowBoss(true); }, // jarvis://boss (hotword „szef”)
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
      const ready = hasUsableBrain(); // też tryb lokalny (Ollama/WebLLM), nie tylko klucz chmury
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
    recordActiveDay(); // licznik serii dni (nawyk) — raz dziennie
    const tick = () => {
      void runProactiveNotifications().catch(() => {}); // push systemowy — trigger nawyku (działa też, gdy karta schowana; dedup pilnuje spamu)
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (busyRef.current || !hasUsableBrain()) return; // nie przerywaj pracy / brak mózgu (też lokalny)
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
     
  }, []);

  const attachImage = async () => {
    const img = await capturePhoto();
    if (img) setPendingImage(img);
  };

  // Motyw HUD.
  useEffect(() => {
    const b = document.body;
    ["theme-gold", "theme-green", "theme-red", "theme-purple", "theme-matrix", "theme-amber", "theme-ocean", "theme-rose", "theme-retro", "theme-xp", "theme-nord", "theme-sunset", "theme-aurora"].forEach((c) => b.classList.remove(c));
    if (settings.theme && settings.theme !== "default") b.classList.add(`theme-${settings.theme}`);
  }, [settings.theme]);

  // Trwałość: zapisuj aktywną rozmowę do historii (najnowsze pierwsze).
  // Czat prywatny pomijamy — z założenia nie zostawia śladu w historii.
  useEffect(() => {
    if (!messages.length || privateChat) return;
    upsertChat({
      id: activeId,
      title: titleFrom(messages),
      messages: messages.slice(-100),
      updatedAt: Date.now(),
    });
  }, [messages, activeId, privateChat]);

  // --- Wysłanie polecenia do JARVIS-a (agentowa pętla) ---
  const handleSend = async (text: string, opts?: { council?: boolean; research?: boolean }) => {
    setInterim("");
    stopSpeaking();
    buzz(14); // subtelna haptyka przy wysłaniu

    // ⬢ „Szef" (wpisane lub wypowiedziane) → przywołaj pełnoekranowego agenta głosowego.
    if (isBossSummon(text)) { setShowBoss(true); return; }

    // 💡 Kontekstowa porada „w samą porę": gdy treść pasuje do funkcji (np. „zaplanuj…" → Zleć cel),
    // podpowiedz ją. Nienachalnie: respektuje ustawienie i limit sesji, raz na funkcję.
    if (store.settings.tips !== false && tipCountRef.current < 4) {
      const ct = contextualTipNow(text);
      if (ct) { recordTipShown(ct.id); tipCountRef.current += 1; setTip(ct); }
    }

    // 🧠 Auto-capture decisions: jeśli padła decyzja/zobowiązanie, zaproponuj zapis do pamięci
    // (lokalnie, natychmiast). Nienachalnie — jedna karta, można odrzucić.
    if (store.settings.tips !== false) {
      const d = detectDecision(text);
      if (d) setDecision(d);
    }

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
      // Żądania-akcje (leady, e-mail, kalendarz, dom…) NIGDY nie idą do konsylium — ono nie ma
      // narzędzi i „odmówiłoby". Takie prośby zawsze obsługuje pojedynczy mózg z toolami.
      const wantCouncil = (opts?.council || (store.settings.councilMode && isComplex(text))) && !isActionRequest(text);
      const useCouncil = !!wantCouncil && !image && !opts?.research && councilMembers(3).length >= 2;
      if (useCouncil) setCouncilStep(`⚖ Konsylium — pytam ${councilMembers(3).length} modele…`);
      let reply;
      // Strumieniowanie: bąbel tworzymy LENIWIE przy pierwszym tokenie — dostawcy bez
      // streamingu zachowują się dokładnie jak dotąd (bez pustego bąbla, zero regresji).
      let streamId = "";
      // Batching tokenów: pierwszy token tworzy bąbel NATYCHMIAST, kolejne aktualizacje dławimy do
      // ~25 fps (40 ms). Mniej re-renderów = płynniejszy streaming na szybkich modelach (bez „szarpania").
      let pendingText = "";
      let lastFlush = 0;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushStream = () => {
        flushTimer = null;
        lastFlush = Date.now();
        if (!isCurrent(genToken)) return;
        const full = pendingText;
        if (!streamId) {
          streamId = uid();
          setLiveId(streamId);
          setMessages((m) => [...m, { id: streamId, role: "assistant", text: full, streamed: true, createdAt: Date.now() }]);
        } else {
          setMessages((m) => m.map((x) => (x.id === streamId ? { ...x, text: full } : x)));
        }
      };
      const cancelStreamFlush = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } };
      const onTok = (full: string) => {
        if (!isCurrent(genToken)) return;
        pendingText = full;
        if (Date.now() - lastFlush >= 40) { cancelStreamFlush(); flushStream(); }
        else if (!flushTimer) { flushTimer = setTimeout(flushStream, 40); }
      };
      try {
        reply = useCouncil ? await askCouncil(history) : await askJarvis(history, onTok, setCouncilStep);
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
      cancelStreamFlush(); // żaden spóźniony batch nie nadpisze finalnego tekstu
      if (streamId) {
        // Tekst już przyleciał strumieniowo — domknij tę samą wiadomość (narzędzia/cytaty/finalny tekst).
        // Jeśli finalny tekst jest pusty/„…" (rzadki przypadek tur z narzędziami) — zostaw to, co już zeszło.
        const sid = streamId;
        const finalText = reply.text && reply.text.trim() && reply.text !== "…" ? reply.text : (pendingText || reply.text);
        setMessages((m) =>
          m.map((x) =>
            x.id === sid ? { ...x, text: finalText, tools: reply.tools, citations: reply.citations, via: reply.via, fellBack: reply.fellBack } : x,
          ),
        );
      } else {
        // Dostawca bez strumienia (np. konsylium/obraz) — utwórz wiadomość jak dotąd.
        const aiMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          text: reply.text,
          tools: reply.tools,
          citations: reply.citations,
          council: (reply as Partial<CouncilReply>).council,
          via: reply.via,
          fellBack: reply.fellBack,
          createdAt: Date.now(),
        };
        setLiveId(aiMsg.id);
        setMessages((m) => [...m, aiMsg]);
      }

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
      // Prewarm (Z13): po turze trzymaj model lokalny gorący na następną (opt-in, throttlowany).
      void maybePrewarm();
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
    setPrivateChat(false); // „nowa rozmowa" wychodzi z trybu prywatnego
  };

  const openChat = (s: ChatSession) => {
    stopSpeaking();
    setActiveId(s.id);
    setMessages(s.messages);
    setLiveId(null);
    setShowHistory(false);
    setPrivateChat(false); // otwierasz zapisaną rozmowę → tryb normalny
  };

  // Włącz/wyłącz czat prywatny. Wejście: czysta, nietrwała rozmowa (jak „Temporary chat").
  const togglePrivateChat = () => {
    stopSpeaking();
    setMessages([]);
    setActiveId(uid());
    setLiveId(null);
    setPrivateChat((p) => {
      const next = !p;
      toast(next
        ? "🕶 Czat prywatny — ta rozmowa NIE trafi do historii."
        : "Czat prywatny wyłączony — wracam do normalnych, zapisywanych rozmów.");
      return next;
    });
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
      const due = store.data.reminders.filter((r) => !r.fired && new Date(r.at).getTime() <= now);
      if (!due.length) return;
      // Jeden zapis store na wszystkie zapalone naraz (zamiast N zapisów+renderów w pętli).
      const dueIds = new Set(due.map((r) => r.id));
      store.setData((d) => { for (const x of d.reminders) if (dueIds.has(x.id)) x.fired = true; });
      for (const r of due) {
        const text = `Przypomnienie, ${store.settings.userName}: ${r.text}.`;
        const id = uid();
        setLiveId(id);
        setMessages((m) => [...m, { id, role: "assistant", text, tools: ["reminder"], createdAt: Date.now() }]);
        if (store.settings.speak) void speak(text, store.settings).catch(() => {});
        notify("JARVIS — przypomnienie", r.text);
      }
    }, 20000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Faza 2 — załaduj narzędzia z zaufanych serwerów MCP (jeśli skonfigurowane).
  // Graceful: serwer niedostępny/poza allowlistą → pominięty, JARVIS działa dalej.
  useEffect(() => {
    void mcpManager.loadAll().then((loaded) => {
      if (loaded.length) toast(`🔌 MCP: załadowano ${loaded.length} narzędzi z ${new Set(loaded.map((t) => t.server)).size} serwer(ów).`);
    }).catch(() => {});
  }, []);

  // --- Prewarm (Z13): rozgrzej model lokalny po powrocie do aplikacji (opt-in, throttlowany) ---
  useEffect(() => {
    const onFocus = () => { void maybePrewarm(); };
    window.addEventListener("focus", onFocus);
    void maybePrewarm(); // i raz na starcie
    return () => window.removeEventListener("focus", onFocus);
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
      // Auto-prospekting używa DARMOWEGO źródła (OpenStreetMap) — nie wymaga klucza Tavily ani niszy.
      // Wystarczy włączone + znane miasto (nisza jest opcjonalna; bez niej szukamy szeroko).
      if (!st.autoProspect || !st.prospectLocation?.trim()) return;
      const last = Number(localStorage.getItem("jarvis.prospect.ts") || 0);
      if (Date.now() - last < 4 * 3600 * 1000) return; // ~6×/dzień
      localStorage.setItem("jarvis.prospect.ts", String(Date.now()));
      const r = await runProspecting();
      if (r.added) {
        const id = uid();
        setLiveId(id);
        const where = [st.prospectNiche?.trim(), st.prospectLocation?.trim()].filter(Boolean).join(", ");
        setMessages((m) => [
          ...m,
          { id, role: "assistant", text: `📈 Automat sprzedaży: znalazłem ${r.added} nowych leadów${where ? ` (${where})` : ""}. Są w Pulpicie Sprzedaży (⋯ → 📈).`, tools: ["prospect"], createdAt: Date.now() },
        ]);
      }
    }, 60000);
    return () => clearInterval(tick);
  }, []);

  // --- Auto-sync z AI Sales OS: co N minut (gdy włączone) pobiera nowe leady ---
  useEffect(() => {
    const tick = setInterval(async () => {
      const st = store.settings;
      const lastTs = Number(localStorage.getItem("jarvis.salesos.ts") || 0);
      if (!shouldAutoSyncSalesOs({ everyMin: Number(st.salesOsAutoSync) || 0, url: st.salesOsUrl, token: st.salesOsToken, lastTs })) return;
      localStorage.setItem("jarvis.salesos.ts", String(Date.now()));
      const r = await syncFromSalesOs();
      if (r.ok && r.added) {
        const id = uid();
        setLiveId(id);
        setMessages((m) => [
          ...m,
          { id, role: "assistant", text: `🔄 AI Sales OS: pobrałem ${r.added} nowych leadów do Pulpitu Sprzedaży (⋯ → 📈).`, tools: ["salesos_sync"], createdAt: Date.now() },
        ]);
      }
    }, 60000);
    return () => clearInterval(tick);
  }, []);

  // Auto-wykrycie lokalnego serwera Ollama na DESKTOPIE (localhost = ten PC) — żeby nie trzeba
  // było wpisywać adresu. Tylko gdy nic nie skonfigurowano; ustawia adres (nie przejmuje providera).
  useEffect(() => {
    if (!isDesktop() || store.settings.ollamaUrl?.trim()) return;
    void findOllamaServer(["http://localhost:11434", "http://127.0.0.1:11434"]).then((r) => {
      if (r.ok && !store.settings.ollamaUrl?.trim()) {
        store.setSettings({ ollamaUrl: r.url });
        toast(`🧠 Wykryto lokalny serwer Ollama (${r.models.length} model(i)) — gotowy w ⚙ → AI.`);
        void warmNow(); // rozgrzej model, by pierwsza odpowiedź była natychmiastowa
      }
    });
  }, []);

  // Auto-sprawdzanie aktualizacji przy starcie (≤1×/dzień): gdy jest nowsza wersja, pokaż
  // nienachalny toast z przyciskiem „Zaktualizuj". W przeglądarce aktualizacja jest płynna
  // (czyści cache i przeładowuje — bez zamykania aplikacji); na telefonie/PC otwiera pobranie.
  useEffect(() => {
    const last = Number(localStorage.getItem("jarvis.update.lastCheck") || 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    const t = setTimeout(async () => {
      try {
        const r = await checkForUpdate();
        if ("error" in r) return; // błąd sieci — spróbujemy znów przy następnym starcie
        // Zapisz znacznik PO udanym sprawdzeniu (też gdy brak nowości) — inaczej throttle 24h
        // nie zadziała i sprawdzalibyśmy przy każdym starcie.
        localStorage.setItem("jarvis.update.lastCheck", String(Date.now()));
        if (!r.newer) return;
        toast(`🎉 Jest nowsza wersja JARVISA (${r.latest})`, { label: r.platform === "web" ? "Odśwież" : "Pobierz", onClick: () => void applyUpdate(r) });
      } catch { /* sieć — pomiń */ }
    }, 8000); // po starcie, nie blokuj pierwszego renderu
    return () => clearTimeout(t);
  }, []);

  // Silnik predykcyjny: po starcie (≤1×/dzień) wysuń PILNE przewidywania — JARVIS działa, zanim
  // zapytasz (zaległe zadania, terminy, follow-upy). Tylko gdy realnie jest coś pilnego.
  useEffect(() => {
    const last = Number(localStorage.getItem("jarvis.predict.ts") || 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    const t = setTimeout(() => {
      try {
        // Zapisz znacznik niezależnie od wyniku — inaczej (gdy brak pilnych) liczylibyśmy predykcje
        // przy KAŻDYM starcie zamiast raz dziennie.
        localStorage.setItem("jarvis.predict.ts", String(Date.now()));
        const d = store.data;
        const people = (d.world?.entities || []).filter((e) => e.kind === "person");
        const top = topPredictions({ tasks: d.tasks, reminders: d.reminders, calendar: d.calendar, leads: d.leads, people }, Date.now(), 3);
        const urgent = top.filter((p) => p.urgency === "high");
        if (urgent.length) toast(`🔮 ${urgent.map((p) => p.title).join(" · ")}`);
      } catch { /* pomiń */ }
    }, 12000);
    return () => clearTimeout(t);
  }, []);

  // Strażnik proaktywny: co jakiś czas (≤1×/20 min) sprawdza stan i podpowiada „Napraw", gdy coś nie gra.
  useEffect(() => {
    const tick = setInterval(async () => {
      if (!store.settings.guardianProactive) return;
      const last = Number(localStorage.getItem("jarvis.guardian.ts") || 0);
      if (Date.now() - last < 20 * 60 * 1000) return;
      localStorage.setItem("jarvis.guardian.ts", String(Date.now()));
      try {
        // Pełny skan agentowy: konkretny problem zamiast ogólnika. Bez sprawdzania aktualizacji
        // (to robi dzienny check przy starcie) — oszczędza zapytania do GitHub i limity.
        const scan = await guardianScan({ checkUpdate: false });
        const topRec = scan.recs.find((r) => r.problem);
        // Proaktywnie zaczepiamy TYLKO przy realnym problemie (czerwony) albo wyraźnie niskiej
        // kondycji — żeby nie męczyć ostrzeżeniami o rzeczach opcjonalnych (np. brak Ollamy u
        // użytkownika korzystającego tylko z chmury).
        const hasProblem = scan.reports.some((a) => a.state === "problem");
        if (hasProblem || scan.health.score < 60) {
          // Autopilot: dyrygent sam stosuje bezpieczne naprawy; inaczej podpowiada KONKRET.
          if (store.settings.guardianAutopilot) {
            const did = await guardianAutoHeal();
            if (did) { toast(did); const { recordGuardianEvent } = await import("./lib/guardianHistory"); recordGuardianEvent("fix", did); }
          } else {
            // Opiekun: jeśli problem nawraca, dołóż trwałą radę proaktywnie.
            const { getGuardianHistory, recurringHint } = await import("./lib/guardianHistory");
            const hint = recurringHint(getGuardianHistory());
            toast(topRec?.problem
              ? `🛡 Strażnik: ${topRec.problem}${hint ? ` 🧠 ${hint.advice}` : " Otwórz 🛡, by naprawić."}`
              : "🛡 Strażnik: coś wymaga uwagi — otwórz 🛡.");
          }
        }
      } catch { /* sieć — pomiń */ }
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
  if (keysLocked) return <UnlockKeys onDone={() => setKeysLocked(false)} />;
  if (onboarding)
    return (
      <Onboarding
        onDone={() => {
          setOnboarding(false);
          if (resolveProvider()) setShowSettings(false); // klucz dodany w kreatorze
        }}
      />
    );

  // Świeże domknięcia dla akcji ⌘K (po zdefiniowaniu handlerów).
  actionsRef.current = {
    boss: () => { stopSpeaking(); listenerRef.current?.stop(); setShowBoss(true); },
    exportmd: () => {
      const msgs = messagesRef.current;
      if (!msgs.length) { toast("Brak rozmowy do eksportu"); return; }
      copyWithToast(conversationToMarkdown(msgs.map((m) => ({ role: m.role, text: m.text }))), "Rozmowa skopiowana (Markdown) ✓");
    },
    voicemode: () => { stopSpeaking(); listenerRef.current?.stop(); setShowVoice(true); },
    live: () => { stopSpeaking(); listenerRef.current?.stop(); setShowLive(true); },
    newchat: newChat,
    private: togglePrivateChat,
    mic: toggleMic,
    ...Object.fromEntries(PRESETS.map((p) => [p.id, () => { setShowCmd(false); sendRef.current(p.text); }])),
  };

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
          {brand()}
          <small>
            {(resolveProvider()?.model || (hasUsableBrain() ? "LOKALNY" : "BRAK API")).toUpperCase()}
            {(() => {
              const p = store.data.projects.find((x) => x.id === settings.activeProjectId);
              return p ? ` · ${p.name.toUpperCase()}` : "";
            })()}{" "}
            · {online ? "ONLINE" : "OFFLINE"}
            {(() => {
              const m = currentBrainMode(online);
              return (
                <span title={m.title} style={{ color: m.kind === "cloud" ? "var(--cyan)" : "var(--gold)" }}>
                  {" · "}{m.icon} {m.label}
                </span>
              );
            })()}
          </small>
        </div>
        {(() => {
          const lvl = completionReport(store.settings).percent;
          const col = lvl >= 90 ? "#2fbf71" : lvl >= 60 ? "#28c0c8" : "var(--gold)";
          return (
            <button
              className="level-badge"
              style={{ borderColor: col, color: col }}
              onClick={() => setShowSettings(true)}
              title={`Poziom JARVISA: ${lvl}% gotowości. Kliknij, by dokończyć konfigurację.`}
              aria-label={`Poziom JARVISA ${lvl} procent`}
            >
              ⬢ {lvl}%
            </button>
          );
        })()}
        <div className="spacer" />
        <button
          className="icon-btn"
          onClick={() => setShowGuardian(true)}
          title="🛡 Strażnik JARVISA — napraw, przyspiesz, ulepsz, połącz serwery, doradź"
          aria-label="Strażnik JARVISA"
          style={{ color: "var(--gold)", borderColor: "var(--gold)" }}
        >
          🛡
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            stopSpeaking();
            listenerRef.current?.stop();
            setShowVoice(true);
          }}
          title="Tryb Słuchawki — rozmowa hands-free" aria-label="Tryb Słuchawki"
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
          title="Rozmowa na żywo" aria-label="Rozmowa na żywo"
        >
          ☎
        </button>
        {messages.length > 0 && (
          <button className="icon-btn" onClick={newChat} title="Nowa rozmowa" aria-label="Nowa rozmowa">
            ＋
          </button>
        )}
        <button
          className="icon-btn"
          onClick={togglePrivateChat}
          title={privateChat ? "Czat prywatny WŁĄCZONY — nie zapisuję. Kliknij, by wyłączyć." : "Czat prywatny (tymczasowy — nie trafia do historii)"}
          style={privateChat ? { color: "var(--gold)", borderColor: "var(--gold)" } : undefined}
          aria-label="Czat prywatny"
          aria-pressed={privateChat}
        >
          🕶
        </button>
        {(() => {
          const n = notifySummary().total;
          return (
            <button className="icon-btn" style={{ position: "relative" }} onClick={() => setShowNotifs(true)} title="Powiadomienia" aria-label="Powiadomienia">
              🔔
              {n > 0 && (
                <span className="notif-badge" style={{ position: "absolute", top: 0, right: 0, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 9, background: "#e0584f", color: "#fff", fontSize: 10, lineHeight: "16px", textAlign: "center", fontWeight: 700, boxSizing: "border-box" }}>
                  {n > 99 ? "99+" : n}
                </span>
              )}
            </button>
          );
        })()}
        <button className="icon-btn" onClick={() => setShowMore(true)} title="Menu" aria-label="Menu">
          ⋯
        </button>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Ustawienia" aria-label="Ustawienia">
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

      {privateChat && (
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "6px 12px", margin: "0 8px 4px", fontSize: 12, color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 8, background: "rgba(0,0,0,0.15)" }}
          title="Ta rozmowa nie jest zapisywana w historii"
        >
          🕶 Czat prywatny — nie zapisuję tej rozmowy.
          <button className="chip" style={{ fontSize: 11, padding: "1px 8px" }} onClick={togglePrivateChat}>Wyłącz</button>
        </div>
      )}

      <Conversation
        messages={messages}
        interim={interim}
        liveId={liveId}
        onSuggest={handleSend}
        onRetry={() => { if (retryTextRef.current && !busy) handleSend(retryTextRef.current); }}
        thinking={busy}
        needsSetup={!hasUsableBrain()}
        onOpenKeys={() => setShowSettings(true)}
        onBoss={() => setShowBoss(true)}
        onMemory={() => setShowMemory(true)}
        onVoice={() => setShowVoice(true)}
        tasksToday={(store.data.tasks || []).filter((t) => !t.done && (t.due || "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length}
      />

      {tip && store.settings.tips !== false && (
        <TipBubble tip={tip} onAction={onTipAction} onDismiss={() => setTip(null)} />
      )}
      {decision && (
        <div
          className="journal-card"
          style={{ margin: "0 8px 8px", padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            🧠 Zauważyłem decyzję: <b>{decision.statement}</b>{decision.due ? ` — termin: ${decision.due}` : ""}. Zapisać w pamięci?
          </span>
          <button
            className="chip on"
            onClick={() => { rememberFact(decisionKey(decision), decisionValue(decision)); toast("Zapisałem decyzję w pamięci ✓"); setDecision(null); }}
          >
            Zapisz
          </button>
          <button className="chip" onClick={() => setDecision(null)} title="Pomiń">✕</button>
        </div>
      )}
      <Composer
        onSend={handleSend}
        onStop={stopGeneration}
        onMic={toggleMic}
        onRecall={(q) => { setRecallSeed(q); setShowRecall(true); }}
        onAttach={attachImage}
        onRemoveImage={() => setPendingImage(null)}
        imagePreview={pendingImage ? `data:${pendingImage.mediaType};base64,${pendingImage.data}` : null}
        micOn={micOn}
        busy={busy}
        micSupported={micSupported}
        councilAvailable={councilMembers(3).length >= 2}
      />

      {/* 🚀 Droga do 100% — Szef proponuje następny krok; auto-kroki robi po „Zrób". */}
      {(() => {
        if (completionHidden) return null;
        const r = completionReport(store.settings);
        if (!r.next || r.percent >= 100) return null;
        const step = r.next;
        const apply = () => {
          if (step.patch) { store.setSettings(step.patch); toast(`Zrobione: ${step.title} ✓`); }
          else if (step.openScreen === "profile") setShowProfile(true);
          else setShowSettings(true);
        };
        return (
          <div className="journal-card" style={{ margin: "0 8px 8px", padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", fontSize: 13, borderLeft: "3px solid #2bff88" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              🚀 JARVIS w <b>{r.percent}%</b> — następny krok: <b>{step.title}</b>{step.patch ? " — Szef zrobi to sam" : ""}.
            </span>
            <button className="chip on" onClick={apply}>{step.patch ? "Zrób" : "Otwórz"}</button>
            <button className="chip" onClick={() => setCompletionHidden(true)} title="Później">✕</button>
          </div>
        );
      })()}

      {/* 💬 Sugestie dalszych pytań (Perplexity-style) — po odpowiedzi, gdy nie pracujesz. */}
      {(() => {
        if (busy || store.settings.tips === false || messages.length === 0) return null;
        const last = messages[messages.length - 1];
        if (last.role !== "assistant" || !last.text) return null;
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.text || "";
        const sugg = followUps(lastUser, last.text);
        if (!sugg.length) return null;
        return (
          <div className="followups">
            {sugg.map((s, i) => (
              <button key={i} className="chip" onClick={() => handleSend(s)} title="Zapytaj dalej">💬 {s}</button>
            ))}
          </div>
        );
      })()}

      {/* ✨ Wartość dnia — co JARVIS realnie zrobił za Ciebie (z audytu). Etyczny haczyk. */}
      {(() => {
        const v = valueToday(store.data.audit || []);
        if (v.actions < 1) return null;
        return (
          <div className="value-card" onClick={() => setShowAudit(true)} title="Zobacz, co JARVIS zrobił (dziennik działań)">
            ✨ Dziś JARVIS zrobił za Ciebie <b>{v.actions}</b> {v.actions === 1 ? "rzecz" : v.actions < 5 ? "rzeczy" : "rzeczy"} — oszczędził Ci {prettyMinutes(v.minutes)}.
          </div>
        );
      })()}

      {/* ⬢ Szef zawsze w zasięgu — centralny agent głosowy, jedno tknięcie z każdego ekranu. */}
      <button className="boss-fab" onClick={() => setShowBoss(true)} title="Tryb Szefa — agent głosowy (powiedz „szef”)" aria-label="Tryb Szefa">⬢</button>

      {showVoice && (<ScreenBoundary><HeadsetMode onClose={() => setShowVoice(false)} /></ScreenBoundary>)}
      {showAdmin && (
        <ScreenBoundary>
          <AdminPanel onClose={() => setShowAdmin(false)} />
        </ScreenBoundary>
      )}
      {showCards && (
        <ScreenBoundary>
          <Cards onClose={() => setShowCards(false)} />
        </ScreenBoundary>
      )}
      {showTranscribe && (
        <ScreenBoundary>
          <Transcribe onClose={() => setShowTranscribe(false)} />
        </ScreenBoundary>
      )}
      {showProfile && (
        <ScreenBoundary>
          <Profile onClose={() => setShowProfile(false)} />
        </ScreenBoundary>
      )}
      {showTasks && (
        <ScreenBoundary>
          <TaskHub onClose={() => setShowTasks(false)} />
        </ScreenBoundary>
      )}
      {showTranslator && (
        <ScreenBoundary>
          <Translator onClose={() => setShowTranslator(false)} />
        </ScreenBoundary>
      )}
      {showBargain && (
        <ScreenBoundary>
          <BargainHunter onClose={() => setShowBargain(false)} />
        </ScreenBoundary>
      )}
      {showWhereToBuy && (
        <ScreenBoundary>
          <WhereToBuy onClose={() => setShowWhereToBuy(false)} />
        </ScreenBoundary>
      )}
      {showShoppingList && (
        <ScreenBoundary>
          <ShoppingList onClose={() => setShowShoppingList(false)} />
        </ScreenBoundary>
      )}
      {showNotifs && (
        <ScreenBoundary>
          <Notifications
            onClose={() => setShowNotifs(false)}
            onTasks={() => { setShowNotifs(false); setShowTasks(true); }}
            onSales={() => { setShowNotifs(false); setShowSales(true); }}
            onCards={() => { setShowNotifs(false); setShowCards(true); }}
          />
        </ScreenBoundary>
      )}
      {showSettings && (<ScreenBoundary><SettingsPanel onClose={() => setShowSettings(false)} /></ScreenBoundary>)}
      {showPanels && (<ScreenBoundary><Panels onClose={() => setShowPanels(false)} /></ScreenBoundary>)}
      {showLive && <LiveOverlay onClose={() => setShowLive(false)} />}
      {showHistory && (
        <ScreenBoundary><ChatHistory activeId={activeId} onOpen={openChat} onClose={() => setShowHistory(false)} /></ScreenBoundary>
      )}
      {showProjects && (<ScreenBoundary><Projects onClose={() => setShowProjects(false)} /></ScreenBoundary>)}
      {showJournal && (<ScreenBoundary><Journal onClose={() => setShowJournal(false)} /></ScreenBoundary>)}
      {showSales && (
        <ScreenBoundary>
        <SalesDashboard
          onClose={() => setShowSales(false)}
          onWeb={() => { setShowSales(false); setShowWeb(true); }}
          onMoney={() => { setShowSales(false); setShowMoney(true); }}
        />
        </ScreenBoundary>
      )}
      {showMoney && (
        <ScreenBoundary>
          <MoneyHub
            onClose={() => setShowMoney(false)}
            onSales={() => { setShowMoney(false); setShowSales(true); }}
            onWeb={() => { setShowMoney(false); setShowWeb(true); }}
          />
        </ScreenBoundary>
      )}
      {showHelp && (<ScreenBoundary><Help onClose={() => setShowHelp(false)} /></ScreenBoundary>)}
      {showMore && (
        <ScreenBoundary>
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
          onGuardian={() => setShowGuardian(true)}
          onBoss={() => setShowBoss(true)}
          onRecall={() => setShowRecall(true)}
          onMind={() => setShowMind(true)}
          onGoal={() => setShowGoal(true)}
          onCommand={() => setShowCmd(true)}
          onWeb={() => setShowWeb(true)}
          onScreen={isDesktop() ? lookAtScreen : undefined}
          onHelp={() => setShowHelp(true)}
          onAdmin={() => setShowAdmin(true)}
          onCards={() => setShowCards(true)}
          onTranscribe={() => setShowTranscribe(true)}
          onProfile={() => setShowProfile(true)}
          onTasks={() => setShowTasks(true)}
          onTranslator={() => setShowTranslator(true)}
          onBargain={() => setShowBargain(true)}
          onWhereToBuy={() => setShowWhereToBuy(true)}
          onShoppingList={() => setShowShoppingList(true)}
          onNotifications={() => setShowNotifs(true)}
          onStatus={() => setShowStatus(true)}
          onCosts={() => setShowCosts(true)}
          onMemory={() => setShowMemory(true)}
          onAudit={() => setShowAudit(true)}
          onSent={() => setShowSent(true)}
          onContent={() => setShowContent(true)}
          onAds={() => setShowAds(true)}
          onFaq={() => setShowFaq(true)}
          onClose={() => setShowMore(false)}
        />
        </ScreenBoundary>
      )}
      {showStatus && (
        <ScreenBoundary>
          <SystemStatus onClose={() => setShowStatus(false)} />
        </ScreenBoundary>
      )}
      {showCosts && (
        <ScreenBoundary>
          <CostPanel onClose={() => setShowCosts(false)} />
        </ScreenBoundary>
      )}
      {showMemory && (
        <ScreenBoundary>
          <MemoryCenter onClose={() => setShowMemory(false)} />
        </ScreenBoundary>
      )}
      {showAudit && (
        <ScreenBoundary>
          <AuditLog onClose={() => setShowAudit(false)} />
        </ScreenBoundary>
      )}
      {showSent && (
        <ScreenBoundary>
          <SentBox onClose={() => setShowSent(false)} />
        </ScreenBoundary>
      )}
      {showContent && (
        <ScreenBoundary>
          <ContentStudio onClose={() => setShowContent(false)} />
        </ScreenBoundary>
      )}
      {showAds && (
        <ScreenBoundary>
          <AdStudio onClose={() => setShowAds(false)} />
        </ScreenBoundary>
      )}
      {showFaq && (
        <ScreenBoundary>
          <FAQ onClose={() => setShowFaq(false)} />
        </ScreenBoundary>
      )}
      {showStudio && (
        <ScreenBoundary>
          <Studio onClose={() => setShowStudio(false)} />
        </ScreenBoundary>
      )}
      {showGuardian && (
        <ScreenBoundary>
          <Guardian onClose={() => setShowGuardian(false)} />
        </ScreenBoundary>
      )}
      {showMind && (
        <ScreenBoundary>
          <Mind onClose={() => setShowMind(false)} />
        </ScreenBoundary>
      )}
      {showGoal && (
        <ScreenBoundary>
          <GoalRunner onClose={() => setShowGoal(false)} />
        </ScreenBoundary>
      )}
      {showCmd && (
        <ScreenBoundary>
          <CommandPalette commands={commands} onClose={() => setShowCmd(false)} />
        </ScreenBoundary>
      )}
      {showRecall && (
        <ScreenBoundary>
          <Recall
            seed={recallSeed}
            onClose={() => { setShowRecall(false); setRecallSeed(""); }}
            onOpenChat={(id) => { const s = loadChats().find((c) => c.id === id); if (s) openChat(s); }}
          />
        </ScreenBoundary>
      )}
      {showBoss && (
        <ScreenBoundary>
          <BossMode onClose={() => setShowBoss(false)} />
        </ScreenBoundary>
      )}
      {showWeb && (
        <ScreenBoundary>
          <WebStudio onClose={() => setShowWeb(false)} />
        </ScreenBoundary>
      )}
      {showGadgets && (
        <ScreenBoundary>
          <Gadgets onClose={() => setShowGadgets(false)} />
        </ScreenBoundary>
      )}
      {showHud && (
        <ScreenBoundary>
          <HudVision onClose={() => setShowHud(false)} />
        </ScreenBoundary>
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
