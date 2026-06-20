import { useEffect, useMemo, useState } from "react";
import { store } from "../lib/store";
import { listSpeechVoices, bestPlVoiceName, speak, activeVoiceLabel, resolveVoiceMode, type NativeVoiceInfo, type VoiceMode } from "../lib/voice";
import { PROVIDER_LIST, PROVIDERS, autoPick, detectProvider, FREE_UNCENSORED, modelBadges } from "../lib/providers/registry";
import { resetConsents } from "../lib/permissions";
import { pushSync, pullSync, testBackend } from "../lib/sync";
import { openSalesOs, syncFromSalesOs, testSalesOs, pushLeadsToSalesOs } from "../lib/salesOs";
import { getAllMemories, memoryServiceAvailable } from "../lib/memoryService";
import { mcpManager } from "../lib/mcp";
import { enableAtRest, disableAtRest } from "../lib/secretsVault";
import { googleStartUrl, gmailSearch, connectDesktopGoogle } from "../lib/google";
import { testApi, testProvider, resolveProvider } from "../lib/brain";
import { startBackgroundWake, stopBackgroundWake, wakeSupported } from "../lib/wakeword";
import { exportData, exportFull, exportFullEncrypted, importData } from "../lib/backup";
import { keyList, keyCount, isTavilyKey } from "../lib/keys";
import { systemCheck } from "../lib/diagnostics";
import { runHealthCheck, statusIcon, type HealthItem } from "../lib/healthCheck";
import { checkAllApis, stateDot, type ApiStatus } from "../lib/apiStatus";
import { lockIsSet, setPin as setLockPin, clearPin } from "../lib/lock";
import { enablePrivateMode, detectOllama, findOllamaServer } from "../lib/privateMode";
import { pullOllamaModel } from "../lib/ollamaPull";
import { warmNow } from "../lib/prewarm";
import { benchmarkModels, speedLabel, type BenchResult } from "../lib/benchmarkOllama";
import { applyPremiumSetup, applyFastSetup, ensurePremiumModels, applyAutoFromInstalled, ADDABLE_MODELS } from "../lib/ollamaMaestro";
import { BRAIN_MODES, applyBrainMode, detectBrainMode, modeReadinessWarning } from "../lib/brainModes";
import { detectSd } from "../lib/localImage";
import { checkForUpdate, applyUpdate, type UpdateInfo } from "../lib/updater";
import { recentRoutes, type RouteLine } from "../lib/routeView";
import { clearRouteLog } from "../lib/modelRouter";
import { toast } from "../lib/toast";
import { runProspecting } from "../lib/prospect";
import { verifyMailConnection, sendTestEmail, mailReadiness } from "../lib/mailer";
import { enrollVoice } from "../lib/voiceEnroll";
import { listMics, ensureMicPermission } from "../lib/mic";
import FitnessPanel from "./FitnessPanel";
import WebllmPanel from "./WebllmPanel";
import type { ProviderId } from "../lib/providers/types";
import type { Settings } from "../types";
import { useEscape } from "../hooks/useEscape";
import { listPlugins } from "../plugins/PluginRegistry";
import { hourlyActivity, resetAdaptive } from "../lib/usage";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <div className={`switch ${on ? "on" : ""}`} onClick={onClick} />;
}

// Mini-wykres aktywności: słupki per godzina z ostatnich 7 dni (Adaptive UI).
function UsageChart() {
  const hours = hourlyActivity();
  const max = Math.max(1, ...hours);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 44, margin: "8px 0" }}>
      {hours.map((n, h) => (
        <div
          key={h}
          title={`${h}:00 — ${n} akcji`}
          style={{
            flex: 1,
            height: `${Math.max(8, (n / max) * 100)}%`,
            background: n ? "var(--cyan)" : "var(--line)",
            opacity: n ? 0.45 + 0.55 * (n / max) : 0.5,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

type Tab = "ai" | "voice" | "behavior" | "interface" | "integrations" | "data";
const TABS: { id: Tab; label: string; summary: string }[] = [
  { id: "ai", label: "🤖 AI", summary: "Tryb pracy, dostawca, klucze API, poczta, lokalny model" },
  { id: "voice", label: "🗣 Głos", summary: "Silnik głosu, mikrofon i nasłuch, Tryb Słuchawki" },
  { id: "behavior", label: "✨ Zachowanie", summary: "Osobowość, proaktywność, automat sprzedaży" },
  { id: "interface", label: "🎨 Interfejs", summary: "Motyw, układ, tłumacz na żywo, przewodnik" },
  { id: "integrations", label: "🔗 Integracje", summary: "Google, kalendarz, MCP, SalesOS, pamięć" },
  { id: "data", label: "🗄 Dane", summary: "Aktualizacja, kopia danych, blokada PIN, prywatność" },
];

// 🔎 „Skocz do ustawienia": wpisz, czego szukasz → klik przenosi do właściwej zakładki i przewija
// do sekcji (koniec przewijania i szukania). anchor = id nagłówka <h3>/sekcji niżej.
const SETTINGS_INDEX: { label: string; tab: Tab; anchor?: string; keys: string }[] = [
  { label: "🎛 Tryb pracy JARVISA", tab: "ai", anchor: "set-mode", keys: "tryb szybki madry lokalny praca" },
  { label: "🤖 Dostawca i model AI", tab: "ai", anchor: "set-provider", keys: "dostawca model provider claude gemini groq mistral auto wybor modelu" },
  { label: "🔑 Klucze API (Gemini/Claude/OpenAI…)", tab: "ai", anchor: "set-keys", keys: "klucz api gemini openai claude anthropic groq" },
  { label: "📨 Poczta — wysyłka e-maili", tab: "ai", anchor: "set-email", keys: "mail email smtp poczta wysylka gmail haslo" },
  { label: "🔎 Research z cytatami (Tavily)", tab: "ai", anchor: "set-research", keys: "research tavily wyszukiwanie zrodla cytaty web search" },
  { label: "🎨 Studio premium (edycja zdjęć)", tab: "ai", anchor: "set-studio", keys: "studio obraz zdjecie edycja fal flux gemini premium" },
  { label: "🖥 Lokalny model (Ollama, obrazy)", tab: "ai", anchor: "set-ollama", keys: "ollama lokalny serwer stable diffusion obrazy sd model" },
  { label: "🗣 Głos JARVISA (silnik, próbka)", tab: "voice", anchor: "set-voice", keys: "glos voice mowa silnik gemini eleven fish czyta brzmienie ton" },
  { label: "🎤 Mikrofon i nasłuch", tab: "voice", anchor: "set-listen", keys: "mikrofon nasluch sluchanie wake slowo jarvis" },
  { label: "🎭 Osobowość / charakter", tab: "behavior", anchor: "set-persona", keys: "osobowosc charakter persona ton imie zwracanie" },
  { label: "💸 Automat sprzedaży / leady", tab: "behavior", anchor: "set-sales", keys: "sprzedaz leady prospekting oferty firmy" },
  { label: "🎨 Motyw / wygląd", tab: "interface", anchor: "set-theme", keys: "motyw kolor wyglad interfejs hud theme" },
  { label: "🔗 Integracje (Google, MCP…)", tab: "integrations", keys: "integracje google kalendarz mcp salesos pamiec sync" },
  { label: "⬆ Aktualizacja JARVISA", tab: "data", anchor: "set-update", keys: "aktualizacja update wersja nowa" },
  { label: "🗄 Kopia danych (backup/eksport)", tab: "data", anchor: "set-backup", keys: "kopia backup eksport import dane zapis przywroc" },
  { label: "🔒 Blokada aplikacji (PIN)", tab: "data", anchor: "set-lock", keys: "blokada pin haslo lock zabezpieczenie" },
  { label: "🛡 Prywatność i zgody", tab: "data", anchor: "set-privacy", keys: "prywatnosc zgody consent uprawnienia" },
];

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [s, setS] = useState<Settings>(() => ({ ...store.settings, keys: { ...store.settings.keys } }));
  const [tab, setTab] = useState<Tab>("ai");
  const [voices, setVoices] = useState<NativeVoiceInfo[]>([]);
  const [syncMsg, setSyncMsg] = useState("");
  const [salesOsMsg, setSalesOsMsg] = useState("");
  const [salesOsBusy, setSalesOsBusy] = useState(false);
  const [memMsg, setMemMsg] = useState("");
  const [memBusy, setMemBusy] = useState(false);
  const [mcpMsg, setMcpMsg] = useState("");
  const [mcpLoaded, setMcpLoaded] = useState(() => mcpManager.listLoaded());
  const [apiMsg, setApiMsg] = useState("");
  const [secPass, setSecPass] = useState("");
  const [secMsg, setSecMsg] = useState("");
  const [health, setHealth] = useState<HealthItem[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [apiStatus, setApiStatus] = useState<Partial<Record<ProviderId, ApiStatus>>>({});
  const [statusBusy, setStatusBusy] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [mailCheck, setMailCheck] = useState("");
  const [mailChecking, setMailChecking] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupPass, setBackupPass] = useState("");
  const [backendMsg, setBackendMsg] = useState("");
  const [quickKey, setQuickKey] = useState("");
  const [quickMsg, setQuickMsg] = useState("");
  const [pinVal, setPinVal] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [privMsg, setPrivMsg] = useState("");
  const [privBusy, setPrivBusy] = useState(false);
  const [prospMsg, setProspMsg] = useState("");
  const [hasPin, setHasPin] = useState(lockIsSet());
  const [diag, setDiag] = useState<string[]>([]);
  const [diagBusy, setDiagBusy] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micMsg, setMicMsg] = useState("");
  const [gcalBusy, setGcalBusy] = useState(false);
  const [gcalMsg, setGcalMsg] = useState("");
  const desktopGoogle = typeof window !== "undefined" && !!(window as { jarvisDesktop?: { googleConnect?: unknown } }).jarvisDesktop?.googleConnect;

  useEffect(() => {
    listSpeechVoices().then(setVoices);
    // Wstępna lista mikrofonów (etykiety bywają puste do czasu zgody — wtedy przycisk niżej).
    listMics().then(setMics);
  }, []);

  const loadMics = async () => {
    setMicMsg("Sprawdzam mikrofony…");
    const ok = await ensureMicPermission();
    if (!ok) {
      setMicMsg("Brak zgody na mikrofon — zezwól w ustawieniach systemu/przeglądarki.");
      return;
    }
    const list = await listMics();
    setMics(list);
    setMicMsg(list.length ? "" : "Nie znaleziono żadnego mikrofonu.");
  };
  const pickMic = (id: string) => {
    set({ micDeviceId: id });
    store.setSettings({ micDeviceId: id }); // od razu obowiązuje — bez czekania na „Zapisz"
  };

  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));
  // GŁOS: zmiany obowiązują OD RAZU i nie giną po zamknięciu bez „Zapisz" —
  // (to było źródło „głos się nie zmienia": wybór ginął, bo nie był utrwalany).
  const setVoice = (patch: Partial<Settings>) => { setS((prev) => ({ ...prev, ...patch })); store.setSettings(patch); };
  // JEDEN wybór silnika głosu (źródło prawdy) — steruje, co pokazujemy i co naprawdę zabrzmi.
  const voiceMode = resolveVoiceMode(s);
  // 🔎 „Skocz do ustawienia" — koniec przewijania w poszukiwaniu opcji.
  const [find, setFind] = useState("");
  const findResults = find.trim()
    ? SETTINGS_INDEX.filter((x) => `${x.label} ${x.keys}`.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 6)
    : [];
  const jumpTo = (r: (typeof SETTINGS_INDEX)[number]) => {
    setTab(r.tab); setFind("");
    if (r.anchor) setTimeout(() => document.getElementById(r.anchor as string)?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
  };
  // Klucze zapisują się NATYCHMIAST do magazynu — nigdy nie giną po wyjściu bez „Zapisz".
  const setKey = (id: ProviderId, val: string) => {
    const keys = { ...s.keys, [id]: val };
    setS((prev) => ({ ...prev, keys }));
    store.setSettings({ keys });
  };

  // „Wklej dowolny klucz" — rozpoznaj dostawcę, zapisz i od razu przetestuj.
  const addQuickKey = async (raw?: string) => {
    const key = (raw ?? quickKey).trim();
    // Klucz Tavily (research) ma pewny prefiks — zapisz go do slotu research jednym wklejeniem.
    if (isTavilyKey(key)) {
      const next = { ...s, tavilyApiKey: key, webSearch: true };
      setS(next); store.setSettings(next); setQuickKey("");
      setQuickMsg("✓ Rozpoznano klucz Tavily (research) — zapisany i włączono wyszukiwanie w sieci.");
      return;
    }
    const prov = detectProvider(key);
    if (!prov) {
      setQuickMsg("Nie rozpoznałem dostawcy po formacie klucza — wklej go w odpowiednie pole niżej.");
      return;
    }
    // Dokładaj klucz do istniejących tego dostawcy (nowa linia) — nie nadpisuj, by
    // móc zbierać kilka kluczy do automatycznej rotacji. Pomiń, jeśli już jest.
    const existing = keyList(prov);
    const merged = existing.includes(key) ? existing : [...existing, key];
    const note = existing.length && !existing.includes(key) ? ` (dodano jako ${merged.length}. klucz — rotacja)` : "";
    const next = { ...s, keys: { ...s.keys, [prov]: merged.join("\n") } };
    setS(next);
    store.setSettings(next);
    setQuickMsg(`✓ Rozpoznano: ${PROVIDERS[prov].label}${note}. Sprawdzam połączenie…`);
    setQuickKey("");
    setQuickMsg(`${PROVIDERS[prov].label}${note} → ${await testProvider(prov, key)}`);
  };

  // Lista modeli dla wybranego dostawcy (lub info o auto).
  // Modele realnie zainstalowane na Twojej Ollamie (z /api/tags) — żebyś wybierał z tego,
  // co masz pobrane na PC, a nie ze sztywnej listy.
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const loadOllamaModels = async () => {
    setOllamaLoading(true);
    try {
      const r = await detectOllama(store.settings.ollamaUrl);
      setOllamaModels(r.ok ? r.models : []);
      if (!r.ok) toast(r.error ? `Ollama: ${r.error}` : "Nie połączono z Ollamą — sprawdź adres.");
    } finally {
      setOllamaLoading(false);
    }
  };
  // Auto-pobierz listę, gdy wybierzesz dostawcę Ollama (i masz adres).
  useEffect(() => {
    if (s.provider === "ollama" && store.settings.ollamaUrl?.trim()) void loadOllamaModels();
  }, [s.provider]);
  // Auto-wykryj checkpointy SD, gdy wchodzisz w AI z ustawionym adresem serwera obrazów —
  // lista modeli pojawia się sama, bez szukania przycisku „Sprawdź".
  useEffect(() => {
    if (tab !== "ai" || !s.sdUrl?.trim() || sdModels.length) return;
    void detectSd(s.sdUrl).then((r) => { if (r.ok && r.models.length) setSdModels(r.models); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // Debounce: po wpisaniu/zmianie adresu Ollamy (~600 ms) wykryj modele z serwera.
  useEffect(() => {
    if (!s.ollamaUrl?.trim()) return;
    const t = setTimeout(() => void loadOllamaModels(), 600);
    return () => clearTimeout(t);
  }, [s.ollamaUrl]);

  // „Mózg na żywo" — podgląd ostatnich decyzji routera (Refleks vs Kora). Tylko lokalnie.
  const [routeLines, setRouteLines] = useState<RouteLine[]>([]);
  const refreshRoutes = () => setRouteLines(recentRoutes(12));

  // Tryb premium lokalny „pod klucz" — dobór modeli + auto-pobranie + inteligentny routing.
  const [maestroBusy, setMaestroBusy] = useState(false);
  const [maestroMsg, setMaestroMsg] = useState("");
  const [sdChecking, setSdChecking] = useState(false);
  const [sdMsg, setSdMsg] = useState("");
  const [sdModels, setSdModels] = useState<string[]>([]);
  const [findingServer, setFindingServer] = useState(false);
  const [findMsg, setFindMsg] = useState("");
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState("");
  const [updInfo, setUpdInfo] = useState<UpdateInfo | null>(null);
  // Benchmark szybkości modeli na sprzęcie użytkownika.
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchMsg, setBenchMsg] = useState("");
  const [benchResults, setBenchResults] = useState<BenchResult[]>([]);
  const runBench = async () => {
    if (benchBusy) return;
    if (!store.settings.ollamaUrl?.trim()) { toast("Najpierw podaj adres Ollamy."); return; }
    const models = ollamaModels.length ? ollamaModels : [];
    if (!models.length) { setBenchMsg("Brak wykrytych modeli — kliknij Odśwież modele z Ollamy wyżej."); return; }
    setBenchBusy(true); setBenchResults([]); setBenchMsg("Mierzę (pierwszy bieg ładuje model — chwilę to trwa)…");
    const res = await benchmarkModels(models, (m) => setBenchMsg(m));
    setBenchResults(res);
    setBenchBusy(false);
    const best = res.find((r) => r.ok && r.tokPerSec > 0);
    setBenchMsg(best ? `Najszybszy: ${best.model} (${best.tokPerSec} tok/s).` : "Nie udało się zmierzyć — sprawdź serwer.");
  };
  const runMaestro = async (uncensored: boolean) => {
    if (maestroBusy) return;
    if (!store.settings.ollamaUrl?.trim()) { toast("Najpierw wpisz adres Ollamy (pole niżej)."); return; }
    setMaestroBusy(true);
    setMaestroMsg("Konfiguruję tryb premium…");
    const sum = applyPremiumSetup({ uncensored });
    setS((prev) => ({ ...prev, ...store.settings }));
    const r = await ensurePremiumModels({ uncensored, onProgress: setMaestroMsg });
    setMaestroBusy(false);
    if (r.ok) {
      setMaestroMsg(
        `✅ Gotowe. ${sum.overrides.simple} (szybki) · ${sum.overrides.complex} (mądry) · ${sum.overrides.vision} (wizja)` +
        `${uncensored ? ` · ${sum.overrides.uncensored} (bez cenzury)` : ""}. Włączone: ${sum.enabled.join(", ")}.` +
        `${r.pulled.length ? ` Pobrano na PC: ${r.pulled.join(", ")}.` : " Wszystkie modele już były."}`,
      );
      void loadOllamaModels();
      void warmNow(); // rozgrzej, by pierwsza odpowiedź była natychmiastowa
      toast("🚀 Tryb premium lokalny gotowy.");
    } else {
      setMaestroMsg(`❌ ${r.error}`);
      toast(`❌ ${r.error}`);
    }
  };

  // „Dobierz automatycznie z moich modeli" — konfiguracja ról z tego, co już zainstalowane.
  const runAutoFromInstalled = async () => {
    if (maestroBusy) return;
    if (!store.settings.ollamaUrl?.trim()) { toast("Najpierw wpisz adres Ollamy (pole niżej)."); return; }
    setMaestroBusy(true);
    setMaestroMsg("Dobieram role z Twoich modeli…");
    const r = await applyAutoFromInstalled();
    setMaestroBusy(false);
    if (r.ok && r.overrides) {
      setS((prev) => ({ ...prev, ...store.settings }));
      const o = r.overrides;
      setMaestroMsg(`✅ Dobrane: ${o.simple || "—"} (szybki) · ${o.complex || "—"} (mądry)${o.vision ? ` · ${o.vision} (wizja)` : ""}${o.uncensored ? ` · ${o.uncensored} (bez cenzury)` : ""}. Włączony inteligentny routing.`);
      void warmNow();
      toast("⚙ Skonfigurowano z Twoich modeli.");
    } else {
      setMaestroMsg(`❌ ${r.error}`);
      toast(`❌ ${r.error}`);
    }
  };

  // Katalog „dodaj jednym tapnięciem" — pobiera wybrany model z listy (zamiast wpisywania nazwy).
  const [catalogPulling, setCatalogPulling] = useState<string>("");
  const isInstalled = (id: string): boolean => {
    const base = id.toLowerCase().split(":")[0];
    return ollamaModels.some((m) => { const ml = m.toLowerCase(); return ml === id.toLowerCase() || ml.split(":")[0] === base; });
  };
  const pullFromCatalog = async (id: string) => {
    if (catalogPulling) return;
    if (!store.settings.ollamaUrl?.trim()) { toast("Najpierw wpisz adres Ollamy (pole niżej)."); return; }
    setCatalogPulling(id);
    setMaestroMsg(`⬇ Pobieram ${id}…`);
    const r = await pullOllamaModel(id, (p) => setMaestroMsg(`${id}: ${p.status}${p.percent != null ? ` ${p.percent}%` : ""}`), store.settings.ollamaUrl);
    setCatalogPulling("");
    if (r.ok) { setMaestroMsg(`✅ ${id} gotowy.`); toast(`✅ ${id} pobrany.`); void loadOllamaModels(); }
    else { setMaestroMsg(`❌ ${r.error}`); toast(`❌ ${r.error || "Nie udało się pobrać."}`); }
  };

  // Pobieranie modeli Ollamy z aplikacji (bez terminala) — z podglądem postępu.
  const [pullName, setPullName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState("");
  const doPull = async () => {
    const name = pullName.trim();
    if (pulling || !name) return;
    setPulling(true);
    setPullStatus("Łączę z Ollamą…");
    const r = await pullOllamaModel(
      name,
      (p) => setPullStatus(`${p.status}${p.percent != null ? ` ${p.percent}%` : ""}`),
      store.settings.ollamaUrl,
    );
    setPulling(false);
    if (r.ok) {
      setPullStatus(`✅ Pobrano ${name}.`);
      toast(`✅ Model ${name} gotowy.`);
      setPullName("");
      void loadOllamaModels();
    } else {
      setPullStatus(`❌ ${r.error || "Nie udało się pobrać."}`);
      toast(`❌ ${r.error || "Nie udało się pobrać modelu."}`);
    }
  };

  const modelOptions = useMemo(() => {
    if (s.provider === "auto") return [];
    // Ollama: pokaż REALNE modele z serwera (gdy wykryte), inaczej lista podpowiedzi.
    if (s.provider === "ollama" && ollamaModels.length) return ollamaModels.map((m) => ({ id: m, label: m }));
    return PROVIDERS[s.provider as ProviderId]?.models ?? [];
  }, [s.provider, ollamaModels]);

  const autoTarget = useMemo(() => (s.provider === "auto" ? autoPick(s.keys) : null), [s.provider, s.keys]);
  // Czytelny opis modelu (z katalogu) — żeby w „auto" i przy „domyślnym" widać było, CO realnie zadziała.
  const modelLabel = (prov: ProviderId, id: string) => PROVIDERS[prov]?.models.find((m) => m.id === id)?.label || id;
  // Czy dla danego dostawcy jest gotowy klucz/adres (Ollama łączy się adresem, nie kluczem).
  const providerReady = (id: ProviderId) => (id === "ollama" ? !!s.ollamaUrl?.trim() : !!s.keys[id as keyof typeof s.keys]?.trim());

  const save = () => {
    // Jeśli zmieniono dostawcę, a model nie pasuje — zresetuj na domyślny.
    const next = { ...s };
    if (next.provider !== "auto") {
      const meta = PROVIDERS[next.provider as ProviderId];
      if (meta && next.model !== "auto" && !meta.models.some((m) => m.id === next.model)) {
        next.model = meta.defaultModel;
      }
    }
    store.setSettings(next);
    onClose();
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>⚙ Ustawienia</h2>
          {/* 🔎 Wpisz, czego szukasz — przeniesiemy Cię prosto do sekcji (bez przewijania). */}
          <div style={{ position: "relative", marginTop: 8 }}>
            <input
              value={find}
              placeholder="🔎 Szukaj ustawienia… (np. klucz, głos, kopia, PIN)"
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && findResults[0]) jumpTo(findResults[0]); if (e.key === "Escape") setFind(""); }}
              style={{ width: "100%" }}
            />
            {findResults.length > 0 && (
              <div className="journal-card" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 20, padding: 4, maxHeight: 240, overflowY: "auto" }}>
                {findResults.map((r) => (
                  <button key={r.label} className="btn" style={{ width: "100%", textAlign: "left", padding: "8px 10px", marginTop: 2 }} onClick={() => jumpTo(r)}>
                    <span style={{ fontSize: 13 }}>{r.label}</span>
                    <span className="muted" style={{ fontSize: 11, display: "block" }}>{TABS.find((t) => t.id === r.tab)?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {TABS.map((t) => (
              <button key={t.id} className={`chip ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {/* Jednolinijkowy spis, co jest w aktywnej zakładce — wiadomo gdzie szukać bez klikania. */}
          <p className="muted" style={{ margin: "8px 2px 0", fontSize: 12 }}>{TABS.find((t) => t.id === tab)?.summary}</p>
        </div>
        <div className="panel-body">
          {/* Wskaźnik sprawności — zawsze widoczny u góry, niezależnie od zakładki. */}
          <FitnessPanel />
          {/* ============ 🤖 AI ============ */}
          {tab === "ai" && (
            <>
              {/* 🎛 Tryb pracy — jasny wybór zamiast dziesiątek przełączników */}
              <h3 id="set-mode">🎛 Tryb pracy JARVISA</h3>
              <p className="muted">Najprościej: wybierz <b>jeden</b> tryb — JARVIS ustawi za Ciebie dostawcę, model i szybkość. Chcesz sam? Niżej: <b>🤖 Dostawca i model</b>.</p>
              {(() => { const activeMode = detectBrainMode(s); return BRAIN_MODES.map((m) => {
                const on = activeMode === m.id;
                return (
                  <div
                    key={m.id}
                    className="journal-card"
                    style={{ padding: "10px 12px", marginBottom: 8, cursor: "pointer", border: on ? "1px solid var(--gold)" : undefined }}
                    onClick={() => {
                      applyBrainMode(m.id, ollamaModels);
                      setS((p) => ({ ...p, ...store.settings }));
                      const cloudKeys = PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim()).length;
                      const warn = modeReadinessWarning(m.id, { ollamaConfigured: !!s.ollamaUrl?.trim(), cloudKeys });
                      toast(`${m.icon} Tryb: ${m.title}${warn ? ` — ⚠ ${warn}` : ""}`);
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{m.icon}</span>
                      <b style={{ flex: 1, fontSize: 14 }}>{m.title}</b>
                      {on && <span style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>✓ aktywny</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{m.tagline}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>{m.does}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>⚙ Ustawi: {m.happens}<br />📋 Wymaga: {m.needs}</div>
                  </div>
                );
              }); })()}

              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🩺 Diagnostyka startowa — sprawdź wszystko jednym kliknięciem</summary>
              <p className="muted">
                Sprawdza internet, każdy klucz AI, research, głos, mikrofon, backend i smart home — z podpowiedzią, jak naprawić braki.
              </p>
              <button
                className="btn"
                disabled={diagBusy}
                onClick={async () => {
                  store.setSettings(s);
                  setDiagBusy(true);
                  setDiag(["⏳ Uruchamiam diagnostykę…"]);
                  try {
                    await systemCheck((lines) => setDiag(lines));
                  } finally {
                    setDiagBusy(false);
                  }
                }}
              >
                {diagBusy ? "⏳ Sprawdzam systemy…" : "🩺 Uruchom diagnostykę"}
              </button>
              {diag.length > 0 && (
                <p className="muted" style={{ whiteSpace: "pre-line", marginTop: 8 }}>{diag.join("\n")}</p>
              )}
              </details>

              <h3>🚀 Szybki start</h3>
              <p className="muted">
                Wklej <b>dowolny</b> klucz API — JARVIS sam rozpozna dostawcę i sprawdzi połączenie.
                Nie masz?{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                  Zdobądź darmowy klucz Gemini
                </a>{" "}
                (1 min, bez karty).
              </p>
              <div className="field">
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={quickKey}
                    placeholder="Wklej klucz API…"
                    onChange={(e) => setQuickKey(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn primary" onClick={() => addQuickKey()} disabled={!quickKey.trim()}>
                    Dodaj
                  </button>
                </div>
                <button
                  className="btn"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    try {
                      const txt = (await navigator.clipboard.readText())?.trim();
                      if (!txt) {
                        setQuickMsg("Schowek jest pusty.");
                        return;
                      }
                      await addQuickKey(txt);
                    } catch {
                      setQuickMsg("Brak dostępu do schowka — wklej klucz ręcznie w pole powyżej.");
                    }
                  }}
                >
                  📋 Wklej klucz ze schowka
                </button>
                {quickMsg && <p className="muted" style={{ marginTop: 6 }}>{quickMsg}</p>}
              </div>

              <div className="field">
                <button
                  className="btn"
                  onClick={async () => {
                    // Jeden klik: darmowy uncensored w chmurze (OpenRouter, Dolphin) + tryb bez cenzury.
                    if (s.keys.openrouter?.trim()) {
                      const next = {
                        ...s,
                        provider: FREE_UNCENSORED.provider,
                        model: FREE_UNCENSORED.model,
                        unfilteredLocal: true,
                      };
                      setS(next);
                      store.setSettings(next);
                      setQuickMsg(`⏳ Włączam czat bez cenzury (Dolphin)…`);
                      setQuickMsg(`Czat bez cenzury → ${await testProvider(FREE_UNCENSORED.provider, s.keys.openrouter, FREE_UNCENSORED.model)}`);
                    } else {
                      setQuickMsg(
                        "Aby włączyć darmowy czat bez cenzury w chmurze: załóż darmowe konto na openrouter.ai, skopiuj klucz (zaczyna się od sk-or-...) i wklej go w pole na górze. Potem kliknij ten przycisk ponownie.",
                      );
                    }
                  }}
                >
                  🔓 Włącz darmowy czat bez cenzury (chmura)
                </button>
                <p className="muted" style={{ marginTop: 4 }}>
                  Używa darmowego modelu <b>Dolphin</b> (OpenRouter) + trybu bez cenzury. Wymaga
                  darmowego klucza{" "}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                    openrouter.ai
                  </a>
                  . Pełne 100% bez cenzury i prywatność = model lokalny (Ollama) niżej.
                </p>
              </div>

              <h3 id="set-provider">🤖 Dostawca i model AI</h3>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Ręczna kontrola. Nie chcesz wybierać? Użyj <b>🎛 Trybu pracy</b> wyżej — ustawi to za Ciebie. Większość zostawia <b>Auto</b>.
              </p>
              <div className="field">
                <label>Dostawca</label>
                <select value={s.provider} onChange={(e) => { set({ provider: e.target.value, model: "auto" }); if (e.target.value === "ollama") void warmNow(); /* rozgrzej model lokalny — pierwsza odpowiedź od ręki */ }}>
                  <option value="auto">⚡ Auto — najlepszy dostępny (zalecane)</option>
                  {PROVIDER_LIST.map((p) => (
                    <option key={p.id} value={p.id}>
                      {providerReady(p.id) ? "✓ " : "🔑 "}{p.label}{providerReady(p.id) ? "" : " — brak klucza"}
                    </option>
                  ))}
                </select>
                <span className="muted" style={{ fontSize: 12 }}>✓ = gotowy (masz klucz/adres) · 🔑 = dodaj klucz w „🔑 Klucze API" niżej</span>
              </div>

              {s.provider === "auto" ? (
                <p className="muted">
                  {autoTarget
                    ? `▶ Teraz zadziała: ${PROVIDERS[autoTarget.provider].label} · ${[modelBadges(modelLabel(autoTarget.provider, autoTarget.model)), modelLabel(autoTarget.provider, autoTarget.model)].filter(Boolean).join(" ")}. Im wyżej klucz na liście, tym wyższy priorytet.`
                    : "⚠ Brak kluczy — dodaj przynajmniej jeden w „🔑 Klucze API” niżej (albo użyj lokalnej Ollamy)."}
                </p>
              ) : (
                <div className="field">
                  <label>Model</label>
                  <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
                    <option value="auto">🔵 Auto — domyślny dostawcy{PROVIDERS[s.provider as ProviderId]?.defaultModel ? ` (${modelLabel(s.provider as ProviderId, PROVIDERS[s.provider as ProviderId].defaultModel)})` : ""}</option>
                    {modelOptions.map((m) => {
                      const bdg = modelBadges(m.label);
                      return (
                        <option key={m.id} value={m.id}>
                          {bdg ? `${bdg} ` : ""}{m.label}
                        </option>
                      );
                    })}
                  </select>
                  <span className="muted" style={{ fontSize: 12 }}>🆓 darmowy · ⚡ szybki · 🧠 mocny · 👁 wizja · 🔓 bez cenzury</span>
                  {!providerReady(s.provider as ProviderId) && (
                    <span className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>
                      ⚠ Ten dostawca nie ma jeszcze {s.provider === "ollama" ? "adresu serwera" : "klucza"} — {s.provider === "ollama" ? "podaj adres Ollamy niżej" : "dodaj go w „🔑 Klucze API” niżej"}, inaczej nie odpowie.
                    </span>
                  )}
                  {s.provider === "ollama" && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }} disabled={ollamaLoading} onClick={() => void loadOllamaModels()}>
                          {ollamaLoading ? "⏳ Sprawdzam…" : "🔄 Odśwież modele z Ollamy"}
                        </button>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {ollamaModels.length ? `Znaleziono ${ollamaModels.length} — wybierz z listy.` : "Podaj adres Ollamy niżej i odśwież."}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <input
                          value={pullName}
                          placeholder="np. qwen3.5:4b — pobierz nowy model"
                          disabled={pulling}
                          onChange={(e) => setPullName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void doPull(); }}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <button
                          className="btn"
                          style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                          disabled={pulling || !pullName.trim()}
                          onClick={() => void doPull()}
                        >
                          {pulling ? "⏳ Pobieram…" : "⬇ Pobierz"}
                        </button>
                      </div>
                      {pullStatus && (
                        <p className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-line" }}>{pullStatus}</p>
                      )}
                      <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                        Ściągasz model wprost na swój serwer Ollama — bez terminala. Po pobraniu pojawi się na liście.
                      </span>
                    </>
                  )}
                </div>
              )}

              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary id="set-keys" style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🔑 Klucze API (chmura) — kliknij, by rozwinąć</summary>
              <p className="muted" style={{ marginTop: 6 }}>
                💡 Możesz wpisać <b>kilka kluczy jednego dostawcy</b> — każdy w nowej linii. Gdy
                jeden wyczerpie limit dzienny, JARVIS automatycznie przełączy się na kolejny, żeby
                rozmowa nie wywaliła się błędem.
              </p>
              {PROVIDER_LIST.filter((p) => p.id !== "ollama").map((p) => {
                const n = keyCount(p.id);
                const st = apiStatus[p.id];
                return (
                  <div className="field" key={p.id}>
                    <label>
                      {st && <span title={st.detail}>{stateDot(st.state)} </span>}
                      {p.label}
                      {st?.usedPct !== undefined && (
                        <span style={{ color: st.usedPct >= 85 ? "var(--gold)" : "var(--ok, #58e08a)" }}> · zużyte {st.usedPct}%</span>
                      )}
                      {p.needsProxy ? " · może wymagać proxy (CORS)" : ""} —{" "}
                      <a href={p.keysUrl} target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                        klucz
                      </a>
                      {n > 1 ? <span style={{ color: "var(--ok, #58e08a)" }}> · {n} kluczy (rotacja)</span> : null}
                    </label>
                    {st && <p className="muted" style={{ fontSize: 11, margin: "2px 0 4px" }}>{st.detail}</p>}
                    <textarea
                      value={s.keys[p.id] || ""}
                      placeholder={p.id === "anthropic" ? "sk-ant-…  (kilka? każdy w nowej linii)" : "klucz API  (kilka? każdy w nowej linii)"}
                      onChange={(e) => setKey(p.id, e.target.value)}
                      rows={s.keys[p.id]?.includes("\n") ? 3 : 1}
                      spellCheck={false}
                      style={{ resize: "vertical", fontFamily: "monospace", fontSize: 13, minHeight: 38 }}
                    />
                  </div>
                );
              })}
              </details>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    store.setSettings(s);
                    setApiMsg("⏳ Sprawdzam…");
                    setApiMsg(await testApi());
                  }}
                >
                  🔌 Sprawdź aktywne
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={statusBusy}
                  onClick={async () => {
                    store.setSettings(s);
                    setStatusBusy(true);
                    setApiMsg("⏳ Sprawdzam status i zużycie wszystkich API…");
                    await checkAllApis((map) => setApiStatus(map));
                    setStatusBusy(false);
                    setApiMsg("Gotowe — status 🟢🟡🔴 i zużycie widać przy każdym dostawcy wyżej.");
                  }}
                >
                  {statusBusy ? "📊 Sprawdzam…" : "📊 Status + zużycie"}
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    const withKeys = PROVIDER_LIST.filter((p) => p.id !== "ollama" && s.keys[p.id]?.trim());
                    if (!withKeys.length) {
                      setApiMsg("Brak wpisanych kluczy do przetestowania.");
                      return;
                    }
                    store.setSettings(s);
                    setApiMsg("⏳ Testuję wszystkie klucze…");
                    const lines: string[] = [];
                    for (const p of withKeys) {
                      const keys = keyList(p.id);
                      if (keys.length <= 1) {
                        lines.push(await testProvider(p.id, keys[0] || ""));
                      } else {
                        for (let idx = 0; idx < keys.length; idx++) {
                          lines.push(`[#${idx + 1}] ${await testProvider(p.id, keys[idx])}`);
                        }
                      }
                    }
                    setApiMsg(lines.join("\n"));
                  }}
                >
                  🔑 Testuj wszystkie
                </button>
              </div>

              {/* Szyfrowanie kluczy w spoczynku (opcjonalne, hasłem) */}
              <div className="field" style={{ marginTop: 12 }}>
                <label>🔒 Szyfrowanie kluczy w spoczynku</label>
                {store.settings.secretsAtRest ? (
                  <>
                    <p className="muted" style={{ marginTop: 4 }}>
                      ✅ Klucze API są zapisywane na dysku zaszyfrowane (AES-256). Przy starcie pytamy o hasło.
                    </p>
                    <button
                      className="btn"
                      style={{ marginTop: 6 }}
                      onClick={() => setSecMsg(disableAtRest())}
                    >
                      🔓 Wyłącz szyfrowanie (zapis jawny)
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 4 }}>
                      Zaszyfruj klucze API hasłem (AES-256). Bez tego są w pamięci urządzenia jawnie.
                      Zapomniane hasło = wpisz klucze ponownie (są odtwarzalne) — nic nieodwracalnego.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="password"
                        value={secPass}
                        placeholder="Hasło (min. 4 znaki)"
                        onChange={(e) => setSecPass(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn"
                        style={{ width: "auto", marginTop: 0 }}
                        disabled={secPass.trim().length < 4}
                        onClick={async () => {
                          setSecMsg(await enableAtRest(secPass));
                          setSecPass("");
                        }}
                      >
                        Zaszyfruj
                      </button>
                    </div>
                  </>
                )}
                {secMsg && <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-line" }}>{secMsg}</p>}
              </div>
              <button
                className="btn"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  // Jedno kliknięcie: czy klucz Claude działa + czy Claude jest aktywnym mózgiem.
                  const key = keyList("anthropic")[0] || "";
                  if (!key) {
                    setApiMsg("🧠 Brak klucza Claude — wklej klucz sk-ant-… wyżej (platform.claude.com), a stanie się głównym mózgiem.");
                    return;
                  }
                  setApiMsg("⏳ Sprawdzam Claude…");
                  const test = await testProvider("anthropic", key);
                  const active = resolveProvider();
                  const isBrain = active?.provider === "anthropic";
                  setApiMsg([
                    `🧠 Klucz Claude: ${test}`,
                    isBrain
                      ? `✅ Claude JEST aktywnym mózgiem (model: ${active!.model}).`
                      : `⚠ Aktywny mózg to teraz ${active ? PROVIDERS[active.provider].label : "—"} — ustaw Dostawcę na „auto" albo „Claude", by Claude odpowiadał.`,
                  ].join("\n"));
                }}
              >
                🧠 Sprawdź Claude (klucz + czy jest mózgiem)
              </button>
              {apiMsg && <p className="muted" style={{ whiteSpace: "pre-line" }}>{apiMsg}</p>}

              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🩺 Centrum sprawdzania — czy wszystko działa (pełna diagnoza i naprawa: 🛡 Strażnik)</summary>
              <p className="muted">
                Jeden przycisk sprawdza wszystkie funkcje (mózg AI, Claude, mikrofon, głos, leady,
                pocztę…), tłumaczy po ludzku co i dlaczego, a drobne problemy <b>naprawia sam</b>.
              </p>
              <button
                className="btn primary"
                disabled={healthBusy}
                onClick={async () => {
                  setHealthBusy(true);
                  setHealth([]);
                  await runHealthCheck((items) => setHealth(items));
                  setHealthBusy(false);
                }}
              >
                {healthBusy ? "🩺 Sprawdzam…" : "🩺 Sprawdź wszystko (z naprawami)"}
              </button>
              {health && health.length > 0 && (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {health.map((h) => (
                    <div key={h.id} className="journal-card" style={{ margin: 0, padding: "8px 10px" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span>{statusIcon(h.status)}</span>
                        <b style={{ fontSize: 14 }}>{h.icon} {h.title}</b>
                      </div>
                      <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{h.detail}</p>
                      {h.fix && (
                        <button
                          className="chip"
                          style={{ marginTop: 6, borderColor: "var(--gold)" }}
                          onClick={async () => {
                            h.fix!.apply();
                            setS({ ...store.settings }); // odśwież formularz po naprawie
                            setHealthBusy(true);
                            await runHealthCheck((items) => setHealth(items));
                            setHealthBusy(false);
                          }}
                        >
                          🔧 {h.fix.label}
                        </button>
                      )}
                    </div>
                  ))}
                  {!healthBusy && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      {health.some((h) => h.status === "err")
                        ? "Czerwone pozycje wymagają Twojego ruchu — opis mówi dokładnie, co zrobić."
                        : health.some((h) => h.status === "warn")
                          ? "Żółte pozycje warto poprawić — większość naprawisz przyciskiem 🔧."
                          : "Wszystko gra! JARVIS w pełnej gotowości. 🚀"}
                    </p>
                  )}
                </div>
              )}

              </details>
              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary id="set-email" style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>📨 Poczta — wysyłka e-maili z aplikacji</summary>
              {(() => {
                // Diagnostyka „dlaczego nie idzie" — jeden czytelny powód (reaguje na zmiany w `s`).
                const rd = mailReadiness();
                return (
                  <div
                    className="status-row"
                    style={{ borderRadius: 8, padding: "8px 10px", marginBottom: 8, border: `1px solid ${rd.ready ? "var(--ok,#62e6a8)" : "var(--line)"}` }}
                  >
                    <span style={{ fontSize: 13 }}>
                      {rd.ready ? "✅ " : "⚠ "}
                      <b>Wysyłka:</b> {rd.reason}
                    </span>
                  </div>
                );
              })()}
              <p className="muted">
                Pozwala wysyłać oferty do leadów <b>jednym potwierdzeniem</b>, prosto z Teczki Klienta
                (Windows). Dla Gmaila: włącz weryfikację dwuetapową, potem wygeneruj{" "}
                <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                  hasło aplikacji
                </a>{" "}
                i wklej je niżej (NIE zwykłe hasło). Dane zostają tylko na tym urządzeniu.
              </p>
              <details className="journal-card" style={{ margin: "0 0 10px", padding: "10px 12px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>
                  📖 Jak zdobyć „hasło aplikacji" Google (krok po kroku)
                </summary>
                <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  <li>Zaloguj się na swoje konto Google na telefonie/komputerze.</li>
                  <li>Włącz <b>weryfikację dwuetapową</b> (Konto Google → Bezpieczeństwo). Bez niej hasła aplikacji są niedostępne.</li>
                  <li>Otwórz stronę haseł aplikacji (przycisk niżej) i zaloguj się ponownie, jeśli poprosi.</li>
                  <li>Wpisz nazwę, np. <b>JARVIS</b>, i kliknij <b>Utwórz</b>.</li>
                  <li>Google pokaże <b>16-znakowy kod</b> (4 grupy po 4). Skopiuj go.</li>
                  <li>Wklej kod w pole <b>„Hasło aplikacji"</b> poniżej (spacje znikną same).</li>
                  <li>Naciśnij <b>„Sprawdź połączenie"</b>, a potem <b>„Wyślij testowy e-mail"</b>.</li>
                </ol>
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener"
                  className="btn"
                  style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}
                >
                  🔑 Otwórz stronę haseł aplikacji Google
                </a>
              </details>
              <div className="field">
                <label>Adres e-mail (Gmail)</label>
                <input value={s.smtpUser} placeholder="twoj@gmail.com" onChange={(e) => set({ smtpUser: e.target.value })} />
              </div>
              <div className="field">
                <label>Hasło aplikacji</label>
                <input type="password" value={s.smtpPass} placeholder="xxxx xxxx xxxx xxxx" onChange={(e) => set({ smtpPass: e.target.value.replace(/\s/g, "") })} />
              </div>
              <div className="field" style={{ display: "flex", gap: 8 }}>
                <input value={s.smtpHost} placeholder="smtp.gmail.com" onChange={(e) => set({ smtpHost: e.target.value })} style={{ flex: 2 }} />
                <input type="number" value={s.smtpPort} placeholder="465" onChange={(e) => set({ smtpPort: Number(e.target.value) || 465 })} style={{ flex: 1 }} />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Inna poczta niż Gmail? Wpisz jej serwer SMTP i port 465 (np. o2: poczta.o2.pl, WP: smtp.wp.pl).
              </p>
              <div className="field">
                <label>Podpis (stopka maila)</label>
                <textarea
                  className="ta"
                  rows={3}
                  value={s.emailSignature}
                  placeholder={"—\ntel. +48 500 390 009\nwww.v-ai.pl"}
                  onChange={(e) => set({ emailSignature: e.target.value })}
                />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Dopisywany automatycznie na końcu każdej oferty i follow-upu (telefon, strona — możesz dodać też nazwisko i przykłady realizacji).
              </p>
              <div className="field">
                <button
                  className="btn"
                  disabled={mailChecking}
                  onClick={async () => {
                    setMailChecking(true);
                    setMailCheck("⏳ Sprawdzam połączenie z pocztą…");
                    const r = await verifyMailConnection();
                    setMailChecking(false);
                    setMailCheck(r.ok ? r.message : `❌ ${r.message}`);
                  }}
                >
                  {mailChecking ? "⏳ Sprawdzam…" : "🔌 Sprawdź połączenie poczty"}
                </button>
                <button
                  className="btn"
                  style={{ marginTop: 8 }}
                  disabled={mailChecking}
                  onClick={async () => {
                    setMailChecking(true);
                    setMailCheck("⏳ Wysyłam testowy e-mail…");
                    const r = await sendTestEmail();
                    setMailChecking(false);
                    setMailCheck(r.ok ? r.message : `❌ ${r.message}`);
                  }}
                >
                  📧 Wyślij testowy e-mail do siebie
                </button>
                {mailCheck && <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{mailCheck}</p>}
              </div>

              </details>
              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary id="set-research" style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🔎 Research z cytatami (Tavily)</summary>
              <p className="muted">
                Daje wyszukiwanie ze źródłami dla każdego dostawcy (nie tylko Claude). Darmowe
                1000 zapytań/mies. —{" "}
                <a href="https://tavily.com" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                  klucz
                </a>
                .
              </p>
              <div className="field">
                <label>Klucz API Tavily</label>
                <input
                  type="password"
                  value={s.tavilyApiKey}
                  placeholder="tvly-..."
                  onChange={(e) => set({ tavilyApiKey: e.target.value })}
                />
              </div>
              <div className="row">
                <span>Wyszukiwanie w sieci (gdy dostawca wspiera)</span>
                <Toggle on={s.webSearch} onClick={() => set({ webSearch: !s.webSearch })} />
              </div>

              </details>
              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary id="set-studio" style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🎨 Studio premium (edycja zdjęć)</summary>
              <p className="muted">
                Darmowa edycja działa na kluczu Gemini (Nano Banana). Modele <b>premium</b>
                {" "}(FLUX.1 Kontext, Nano Banana Pro) idą przez{" "}
                <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>fal.ai</a>
                {" "}— płatne (~$0.03–0.08/obraz), najwyższa spójność detali.
              </p>
              <div className="field">
                <label>Klucz fal.ai (opcjonalnie, dla premium)</label>
                <input
                  type="password"
                  value={s.falApiKey}
                  placeholder="fal-..."
                  onChange={(e) => set({ falApiKey: e.target.value })}
                />
              </div>

              </details>
              <details className="journal-card" style={{ margin: "8px 0", padding: "8px 12px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>⚖ Tryb Konsylium (kilka modeli na raz)</summary>
              <div className="row">
                <span>
                  Ważne pytania konsultuj z kilkoma modelami
                  <br />
                  <span className="muted">
                    Przy złożonych pytaniach JARVIS pyta równolegle kilku różnych dostawców
                    (np. Gemini + Groq + Cerebras), a sędzia syntezuje jedną odpowiedź i pokazuje,
                    czy modele się zgadzają. Wymaga kluczy ≥ 2 dostawców; zużywa więcej zapytań.
                  </span>
                </span>
                <Toggle on={s.councilMode} onClick={() => set({ councilMode: !s.councilMode })} />
              </div>
              </details>

              <h3 id="set-ollama">🖥 Lokalny model / serwery (Ollama, obrazy)</h3>
              <div className="field">
                <label>Lokalny model — adres Ollama (prywatny, offline)</label>
                <input
                  value={s.ollamaUrl}
                  placeholder="http://192.168.0.10:11434"
                  onChange={(e) => set({ ollamaUrl: e.target.value })}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <button
                    className="btn"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                    disabled={findingServer}
                    onClick={async () => {
                      setFindingServer(true); setFindMsg("Szukam serwera (localhost)…");
                      const r = await findOllamaServer();
                      setFindingServer(false);
                      if (r.ok) {
                        set({ ollamaUrl: r.url, provider: "ollama" });
                        store.setSettings({ ollamaUrl: r.url, provider: "ollama" });
                        setFindMsg(`✅ Znaleziono: ${r.url} (${r.models.length} model(i)). Wybrano dostawcę lokalnego.`);
                        void loadOllamaModels();
                        void warmNow(); // rozgrzej model — pierwsza odpowiedź od ręki
                      } else {
                        setFindMsg(`❌ ${r.error}`);
                      }
                    }}
                  >
                    {findingServer ? "⏳ Szukam…" : "🔍 Znajdź serwer automatycznie"}
                  </button>
                  <span className="muted" style={{ fontSize: 12 }}>na tym PC łączy localhost od ręki</span>
                </div>
                {findMsg && <p className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-line" }}>{findMsg}</p>}
                <p className="muted" style={{ marginTop: 4 }}>
                  Wybierz dostawcę „Lokalny model (Ollama)" powyżej. Uruchom Ollamę na komputerze
                  w tej samej sieci — żadne dane nie wychodzą do chmury. Modele bez cenzury pobierzesz lokalnie,
                  np. <code>ollama pull dolphin-mistral</code> (działają w pełni offline, na Twoim sprzęcie).
                </p>
              </div>
              <div className="field">
                <label>🖼 Lokalny generator obrazów — adres Stable Diffusion (Studio, offline)</label>
                <input
                  value={s.sdUrl}
                  placeholder="http://192.168.0.10:7860"
                  onChange={(e) => set({ sdUrl: e.target.value })}
                />
                <p className="muted" style={{ marginTop: 4 }}>
                  Uruchom Automatic1111/Forge na PC z flagami <code>--api --listen --cors-allow-origins=*</code>,
                  podaj jego adres tutaj i w Studiu wybierz „Lokalny (Stable Diffusion)". Tworzenie obrazów dzieje się
                  wtedy na Twoim komputerze — za darmo, offline; zdalnie przez tę samą sieć lub Tailscale.
                </p>
                {s.sdUrl?.trim() && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <button
                      className="btn"
                      style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                      disabled={sdChecking}
                      onClick={async () => {
                        setSdChecking(true); setSdMsg("Sprawdzam serwer SD…");
                        const r = await detectSd(s.sdUrl);
                        setSdChecking(false);
                        setSdModels(r.ok ? r.models : []);
                        setSdMsg(r.ok ? `✅ Połączono. Modele: ${r.models.length ? r.models.length : "(brak checkpointów — dodaj model do models/Stable-diffusion)"}` : `❌ ${r.error}`);
                      }}
                    >
                      {sdChecking ? "⏳ Sprawdzam…" : "🔌 Sprawdź połączenie SD"}
                    </button>
                  </div>
                )}
                {sdMsg && <p className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-line" }}>{sdMsg}</p>}
                {sdModels.length > 0 && (
                  <div className="field" style={{ marginTop: 6 }}>
                    <label>Model obrazu (checkpoint) — wybierz z serwera</label>
                    <select value={s.sdModel} onChange={(e) => set({ sdModel: e.target.value })}>
                      <option value="">Domyślny serwera</option>
                      {sdModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <details className="journal-card" style={{ margin: "10px 0", padding: "10px 12px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>
                  🧠 Refleks i Kora — dwubiegowy mózg (zaawansowane)
                </summary>
                <p className="muted" style={{ marginTop: 6 }}>
                  Lokalny model (Ollama, „Refleks") odpowiada od ręki, a chmura („Kora") wkracza tylko wtedy,
                  gdy naprawdę trzeba. Wszystko domyślnie wyłączone i wymaga skonfigurowanej Ollamy (adres powyżej).
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 12px" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn primary" style={{ width: "auto", marginTop: 0 }} disabled={maestroBusy} onClick={() => void runMaestro(false)}>
                      {maestroBusy ? "⏳ Pracuję…" : "🚀 Tryb premium lokalny (auto)"}
                    </button>
                    <button className="btn" style={{ width: "auto", marginTop: 0 }} disabled={maestroBusy} onClick={() => void runMaestro(true)}>
                      🔓 + bez cenzury
                    </button>
                    <button className="btn" style={{ width: "auto", marginTop: 0 }} disabled={maestroBusy} onClick={() => void runAutoFromInstalled()} title="Skonfiguruj z modeli, które już masz — bez pobierania">
                      ⚙ Dobierz z moich modeli
                    </button>
                    <button
                      className="btn"
                      style={{ width: "auto", marginTop: 0 }}
                      disabled={maestroBusy}
                      title="Najszybsze odpowiedzi: bez myślenia i dodatkowych tur"
                      onClick={() => { const r = applyFastSetup(); setS((p) => ({ ...p, ...store.settings })); setMaestroMsg(`⚡ Tryb szybki: ${r.model} · ${r.enabled.join(", ")}. Odpowiada od ręki.`); void warmNow(); toast("⚡ Tryb szybki włączony."); }}
                    >
                      ⚡ Szybki (od ręki)
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Wybierz priorytet: <b>⚡ Szybki</b> = odpowiada od ręki (bez myślenia i dodatkowych tur).
                    <b> 🚀 Premium</b> = mądrzej, trochę wolniej (dobiera i pobiera najlepsze modele + inteligentny routing).
                    „⚙ Dobierz z moich modeli" — premium tylko z tego, co już masz. Wymaga adresu Ollamy poniżej.
                  </span>
                  {maestroMsg && <p className="muted" style={{ fontSize: 12, whiteSpace: "pre-line", marginTop: 2 }}>{maestroMsg}</p>}

                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--cyan)" }}>➕ Dodaj model jednym tapnięciem (katalog)</summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {ADDABLE_MODELS.map((m) => {
                        const installed = isInstalled(m.id);
                        return (
                          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <b>{m.id}</b> <span className="muted">· {m.role} · {m.size}</span>
                              <br /><span className="muted">{m.desc}</span>
                            </span>
                            {installed ? (
                              <span style={{ color: "var(--ok, #58e08a)", flex: "0 0 auto" }}>✓ jest</span>
                            ) : (
                              <button
                                className="btn"
                                style={{ width: "auto", marginTop: 0, padding: "4px 8px", fontSize: 12, flex: "0 0 auto" }}
                                disabled={!!catalogPulling}
                                onClick={() => void pullFromCatalog(m.id)}
                              >
                                {catalogPulling === m.id ? "⏳" : "⬇ Pobierz"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>

                  <div style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                      disabled={benchBusy}
                      onClick={() => void runBench()}
                    >
                      {benchBusy ? "⏳ Mierzę…" : "🏎 Zmierz szybkość modeli (na Twoim sprzęcie)"}
                    </button>
                    {benchMsg && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{benchMsg}</p>}
                    {benchResults.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                        {benchResults.map((r) => (
                          <div key={r.model} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <b>{r.model}</b>{" "}
                              {r.ok ? <span className="muted">· {r.tokPerSec} tok/s · {speedLabel(r.tokPerSec)}</span> : <span style={{ color: "var(--gold)" }}>· nie zmierzono</span>}
                            </span>
                            {r.ok && r.tokPerSec > 0 && (
                              <button
                                className="btn"
                                style={{ width: "auto", marginTop: 0, padding: "2px 8px", fontSize: 11, flex: "0 0 auto" }}
                                onClick={() => { set({ ollamaModelSimple: r.model }); toast(`⚡ ${r.model} ustawiony jako szybki (Refleks).`); }}
                              >
                                ⚡ jako szybki
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="row">
                  <span>
                    🧠 Pozwól modelowi „myśleć" (wolniej, mądrzej)
                    <br />
                    <span className="muted">
                      Modele rozumujące (qwen3, deepseek‑r1) potrafią długo „myśleć" przed odpowiedzią — to bywa wolne
                      (nawet kilka minut). <b>Domyślnie wyłączone = odpowiedź od ręki.</b> Włącz tylko do naprawdę trudnych zagadek.
                    </span>
                  </span>
                  <Toggle on={!s.ollamaNoThink} onClick={() => set({ ollamaNoThink: !s.ollamaNoThink })} />
                </div>
                <div className="field">
                  <label>Limit długości odpowiedzi (Ollama): {s.ollamaNumPredict ? `${s.ollamaNumPredict} tokenów` : "bez limitu"}</label>
                  <input
                    type="range"
                    min={0}
                    max={2048}
                    step={128}
                    value={s.ollamaNumPredict ?? 0}
                    onChange={(e) => set({ ollamaNumPredict: Number(e.target.value) })}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>Krótsze odpowiedzi = szybciej. 0 = bez limitu (model sam decyduje).</span>
                </div>

                <div className="row">
                  <span>
                    ⚡ Lokalnie najpierw dla prostych pytań
                    <br />
                    <span className="muted">
                      Krótkie/proste pytania kierowane najpierw do modelu lokalnego (szybko, prywatnie, za darmo);
                      chmura zostaje w rezerwie, gdyby lokalny zawiódł.
                    </span>
                  </span>
                  <Toggle on={s.localFirstSimple} onClick={() => set({ localFirstSimple: !s.localFirstSimple })} />
                </div>

                <div className="row">
                  <span>
                    🚪 Brama Pewności (eskalacja Refleks→Kora)
                    <br />
                    <span className="muted">
                      Gdy odpowiedź lokalna jest niepewna (zgadywanie, „nie wiem", urwana), JARVIS sam dopytuje
                      model w chmurze i zwraca lepszą wersję.
                    </span>
                  </span>
                  <Toggle on={s.confidenceGate} onClick={() => set({ confidenceGate: !s.confidenceGate })} />
                </div>
                {s.confidenceGate && (
                  <div className="field">
                    <label>Próg pewności: {Math.round((s.confidenceThreshold ?? 0.55) * 100)}%</label>
                    <input
                      type="range"
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={s.confidenceThreshold ?? 0.55}
                      onChange={(e) => set({ confidenceThreshold: Number(e.target.value) })}
                    />
                    <span className="muted" style={{ fontSize: 12 }}>
                      Wyżej = częstsza eskalacja do chmury (ostrożniej). 0% praktycznie wyłącza bramę.
                    </span>
                  </div>
                )}

                <div className="row">
                  <span>
                    🔮 Spekulacja Refleks→Kora (szkic, potem weryfikacja)
                    <br />
                    <span className="muted">
                      Przy złożonych pytaniach lokalny model daje szybki szkic, a chmura równolegle go
                      weryfikuje i poprawia tylko, gdy odpowiedzi istotnie się różnią.
                    </span>
                  </span>
                  <Toggle on={s.speculativeMode} onClick={() => set({ speculativeMode: !s.speculativeMode })} />
                </div>

                <div className="row">
                  <span>
                    ⚖ Konsylium hybrydowe (dołącz lokalny głos)
                    <br />
                    <span className="muted">
                      W „Trybie Konsylium" (powyżej) dorzuca lokalny model jako dodatkowego, prywatnego
                      rozmówcę obok modeli z chmury.
                    </span>
                  </span>
                  <Toggle on={s.councilIncludeLocal} onClick={() => set({ councilIncludeLocal: !s.councilIncludeLocal })} />
                </div>

                <div className="row">
                  <span>
                    📈 Router, który się uczy
                    <br />
                    <span className="muted">
                      JARVIS zapamiętuje (lokalnie), które ścieżki sprawdzają się dla danego typu pytań,
                      i stopniowo dostraja próg eskalacji. Nic nie wychodzi do chmury.
                    </span>
                  </span>
                  <Toggle on={s.adaptiveRouter} onClick={() => set({ adaptiveRouter: !s.adaptiveRouter })} />
                </div>

                <div className="row">
                  <span>
                    🔥 Trzymaj model lokalny „gorący" (prewarm)
                    <br />
                    <span className="muted">
                      Po starcie i przy powrocie do aplikacji JARVIS wstępnie ładuje model do pamięci serwera,
                      żeby pierwsza odpowiedź nie czekała na rozgrzewkę.
                    </span>
                  </span>
                  <Toggle on={s.prewarmLocal} onClick={() => set({ prewarmLocal: !s.prewarmLocal })} />
                </div>

                <div className="row">
                  <span>
                    🪜 Drabina Mądrości (lokalna samokorekta)
                    <br />
                    <span className="muted">
                      Przy złożonych pytaniach model lokalny sam sprawdza i poprawia swoją odpowiedź w drugiej
                      turze — w całości na PC (działa też offline). Mądrzej, kosztem chwili dłużej.
                    </span>
                  </span>
                  <Toggle on={s.localRefine} onClick={() => set({ localRefine: !s.localRefine })} />
                </div>

                <div className="row">
                  <span>
                    🎯 Self-consistency (kilka prób, wybór najspójniejszej)
                    <br />
                    <span className="muted">
                      Najtrudniejsze pytania: model lokalny odpowiada kilka razy, a JARVIS wybiera odpowiedź
                      zgodną z większością własnych prób — odporność na halucynacje. Najwolniejsze (kilka razy dłużej).
                    </span>
                  </span>
                  <Toggle on={s.localConsensus} onClick={() => set({ localConsensus: !s.localConsensus })} />
                </div>

                <div className="field">
                  <label>Okno kontekstu Ollamy (num_ctx): {s.ollamaNumCtx ?? 4096} tokenów</label>
                  <input
                    type="range"
                    min={2048}
                    max={16384}
                    step={1024}
                    value={s.ollamaNumCtx ?? 4096}
                    onChange={(e) => set({ ollamaNumCtx: Number(e.target.value) })}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Większe okno = dłuższa pamięć rozmowy, ale więcej VRAM i wolniej. Dobierz do swojej karty.
                  </span>
                </div>

                <div className="field">
                  <label>
                    Warstwy na GPU (num_gpu): {(s.ollamaNumGpu ?? -1) < 0 ? "auto (wszystkie)" : s.ollamaNumGpu}
                  </label>
                  <input
                    type="range"
                    min={-1}
                    max={60}
                    step={1}
                    value={s.ollamaNumGpu ?? -1}
                    onChange={(e) => set({ ollamaNumGpu: Number(e.target.value) })}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    -1 = auto (Ollama decyduje). Zmniejsz, jeśli model nie mieści się w VRAM (część warstw trafi na CPU).
                  </span>
                </div>

                <label style={{ display: "block", marginTop: 10, fontSize: 13, color: "var(--cyan)" }}>
                  Model lokalny per typ zadania (puste = katalog domyślny)
                </label>
                <span className="muted" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Dobierz osobny model Ollamy do prostych pytań (szybki), złożonych (mocniejszy) i obrazów (wizja).
                  Działa dla trybu lokalnie-najpierw i offline. Jawny wybór modelu wyżej nadal ma pierwszeństwo.
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    value={s.ollamaModelSimple}
                    placeholder="proste — np. qwen3:1.7b"
                    onChange={(e) => set({ ollamaModelSimple: e.target.value })}
                  />
                  <input
                    value={s.ollamaModelComplex}
                    placeholder="złożone — np. qwen3.5:4b"
                    onChange={(e) => set({ ollamaModelComplex: e.target.value })}
                  />
                  <input
                    value={s.ollamaModelVision}
                    placeholder="obraz/wizja — np. gemma3:4b-it-qat"
                    onChange={(e) => set({ ollamaModelVision: e.target.value })}
                  />
                  <input
                    value={s.ollamaModelUncensored}
                    placeholder="bez cenzury — np. dolphin-mistral (gdy tryb nieocenzurowany)"
                    onChange={(e) => set({ ollamaModelUncensored: e.target.value })}
                  />
                </div>
              </details>

              <details
                className="journal-card"
                style={{ margin: "10px 0", padding: "10px 12px" }}
                onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) refreshRoutes(); }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>
                  🧭 Mózg na żywo — dziennik decyzji (diagnostyka)
                </summary>
                <p className="muted" style={{ marginTop: 6 }}>
                  Ostatnie decyzje routera: co poszło do <b>Refleksu</b> (lokalny), co do <b>Kory</b> (chmura),
                  czy nastąpiła eskalacja i jak szybko. Wszystko liczone i trzymane <b>lokalnie</b> — nic nie
                  wychodzi do chmury.
                </p>
                {routeLines.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Brak danych — zadaj kilka pytań przy włączonych opcjach powyżej, potem odśwież.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {routeLines.map((r, i) => (
                      <div
                        key={`${r.at}-${i}`}
                        style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, lineHeight: 1.35 }}
                      >
                        <span style={{ flex: "0 0 auto" }}>{r.badge}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <b>{r.kind}</b> → {r.tier}
                          {r.outcome !== "ok" && <span style={{ color: "var(--cyan)" }}> · {r.outcome}</span>}
                          <br />
                          <span className="muted">
                            {r.provider}{r.meta ? ` · ${r.meta}` : ""} · {r.when}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className="btn"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                    onClick={refreshRoutes}
                  >
                    🔄 Odśwież
                  </button>
                  <button
                    className="btn"
                    style={{ width: "auto", marginTop: 0, padding: "6px 10px", fontSize: 13 }}
                    onClick={() => { clearRouteLog(); refreshRoutes(); toast("Wyczyszczono dziennik tras."); }}
                  >
                    🗑 Wyczyść
                  </button>
                </div>
              </details>

              <div className="row">
                <span>
                  🔓 Tryb nieocenzurowany (lokalny)
                  <br />
                  <span className="muted">
                    JARVIS odpowiada wprost, bez moralizowania. Realnie bez cenzury działa tylko
                    z modelem lokalnym (Ollama) — modele w chmurze mają własne zasady dostawcy.
                  </span>
                </span>
                <Toggle on={s.unfilteredLocal} onClick={() => set({ unfilteredLocal: !s.unfilteredLocal })} />
              </div>
              <div className="row">
                <span>
                  🔒 Tryb on-device (blokada chmury)
                  <br />
                  <span className="muted">
                    Twarda blokada prywatności: JARVIS używa <b>wyłącznie</b> modelu lokalnego (Ollama),
                    nigdy chmury, a web-search jest wyłączony. Nic nie opuszcza urządzenia. Wymaga
                    skonfigurowanej Ollamy (adres poniżej); bez niej rozmowa zgłosi instrukcję.
                  </span>
                </span>
                <Toggle on={s.onDeviceOnly} onClick={() => set({ onDeviceOnly: !s.onDeviceOnly })} />
              </div>
              <div className="row">
                <span>
                  🔒 Zawsze potwierdzaj akcje wychodzące
                  <br />
                  <span className="muted">
                    Wyższe bezpieczeństwo: e-mail/SMS/telefon/smart-home wymagają potwierdzenia ZAWSZE —
                    także w trybie głośnomówiącym (bez ekranu zgody akcja jest blokowana, nie wykonywana po cichu).
                  </span>
                </span>
                <Toggle on={s.requireConsentAlways} onClick={() => set({ requireConsentAlways: !s.requireConsentAlways })} />
              </div>
              <div className="row">
                <span>
                  🧠 Pamięć on-device (embeddingi lokalnie)
                  <br />
                  <span className="muted">
                    Wektory pamięci liczone <b>na urządzeniu</b> (Transformers.js, WebGPU→WASM) zamiast
                    w chmurze — prywatnie i bez kosztów. Pierwsze użycie pobiera mały model (~45 MB,
                    cache w przeglądarce). Gdy WebGPU/WASM niedostępne → cicho wraca do chmury.
                  </span>
                </span>
                <Toggle on={s.localEmbeddings} onClick={() => set({ localEmbeddings: !s.localEmbeddings })} />
              </div>
              <WebllmPanel s={s} set={set} />
              <div className="row">
                <span>
                  🎙 Rozpoznawanie mowy on-device (Whisper)
                  <br />
                  <span className="muted">
                    Transkrypcja głosu liczona <b>na urządzeniu</b> (Whisper/Transformers.js) zamiast w chmurze —
                    prywatnie i bez limitu. Pierwsze użycie pobiera model (~145 MB, cache). Bez wsparcia → wraca do Groq.
                  </span>
                </span>
                <Toggle on={s.localStt} onClick={() => set({ localStt: !s.localStt })} />
              </div>
              <div className="row">
                <span>
                  🔊 Synteza mowy on-device (Kokoro)
                  <br />
                  <span className="muted">
                    Głos generowany <b>lokalnie</b> (Kokoro) — bez chmury. Najlepszy dla angielskiego; dla polskiego
                    jakość bywa ograniczona, dlatego to opcja z fallbackiem do dotychczasowych głosów.
                  </span>
                </span>
                <Toggle on={s.localTts} onClick={() => set({ localTts: !s.localTts })} />
              </div>
              <div className="field">
                <button
                  className="btn"
                  disabled={privBusy}
                  onClick={async () => {
                    setPrivBusy(true);
                    setPrivMsg("Szukam lokalnego modelu (Ollama)…");
                    const r = await enablePrivateMode(s.ollamaUrl);
                    if (r.enabled) setS((prev) => ({ ...prev, ...store.settings }));
                    setPrivMsg(r.message);
                    setPrivBusy(false);
                  }}
                >
                  🛡 Włącz Tryb Prywatny (100% lokalnie, offline)
                </button>
                <p className="muted" style={{ marginTop: 4 }}>
                  JARVIS działa w pełni na Twoim sprzęcie (Ollama) — żadne dane nie wychodzą do
                  chmury, brak polityki dostawcy. To prawdziwie prywatny asystent.
                </p>
                {privMsg && <p className="muted" style={{ whiteSpace: "pre-line" }}>{privMsg}</p>}
              </div>
              <div className="row">
                <span>
                  🧠 Głębokie myślenie
                  <br />
                  <span className="muted">przy trudnych pytaniach JARVIS najpierw analizuje problem (wolniej, mądrzej)</span>
                </span>
                <Toggle on={s.deepThink} onClick={() => set({ deepThink: !s.deepThink })} />
              </div>
              <div className="row">
                <span>
                  🔍 Auto-weryfikacja trudnych odpowiedzi
                  <br />
                  <span className="muted">przy zadaniach z liczeniem/logiką model sam sprawdza i poprawia swój wynik (wolniej, pewniej)</span>
                </span>
                <Toggle on={s.verifyHard} onClick={() => set({ verifyHard: !s.verifyHard })} />
              </div>
              <div className="row">
                <span>
                  📚 Wiedza ekspercka (wszczepiona)
                  <br />
                  <span className="muted">dobiera modele mentalne i heurystyki do pytania — offline, za darmo</span>
                </span>
                <Toggle on={s.expertKnowledge} onClick={() => set({ expertKnowledge: !s.expertKnowledge })} />
              </div>
              <div className="field">
                <label>Backend-proxy (opcjonalnie — omija CORS, chowa klucze)</label>
                <input
                  value={s.proxyUrl}
                  placeholder="https://jarvis-bff.twoja.workers.dev"
                  onChange={(e) => set({ proxyUrl: e.target.value })}
                />
                <button
                  className="btn"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    setBackendMsg("Sprawdzam…");
                    setBackendMsg(await testBackend(s.proxyUrl || s.syncUrl));
                  }}
                >
                  🔌 Testuj backend
                </button>
                {backendMsg && <p className="muted" style={{ marginTop: 6 }}>{backendMsg}</p>}
              </div>
            </>
          )}

          {/* ============ 🗣 GŁOS ============ */}
          {tab === "voice" && (
            <>
              <h3 id="set-listen">Mowa i nasłuch</h3>
              <div className="row">
                <span>Czytaj odpowiedzi na głos</span>
                <Toggle on={s.speak} onClick={() => setVoice({ speak: !s.speak })} />
              </div>
              <div className="row">
                <span>Ciągłe nasłuchiwanie słowa „Jarvis"</span>
                <Toggle on={s.wakeWord} onClick={() => set({ wakeWord: !s.wakeWord })} />
              </div>
              <div className="row">
                <span>
                  🎧 Słowo „Jarvis" otwiera Tryb Słuchawki
                  <br />
                  <span className="muted">
                    Rozmowa hands-free bez patrzenia — telefon możesz schować, sterujesz głosem
                    i przyciskiem słuchawek. Wymaga włączonego nasłuchu powyżej.
                  </span>
                </span>
                <Toggle on={s.voiceModeWake} onClick={() => set({ voiceModeWake: !s.voiceModeWake })} />
              </div>
              <div className="row">
                <span>Słuchaj od razu po otwarciu (i zapytaj „o co chodzi?")</span>
                <Toggle on={s.autoListenOnOpen} onClick={() => set({ autoListenOnOpen: !s.autoListenOnOpen })} />
              </div>

              <div className="field">
                <label>🎙 Mikrofon (wejście)</label>
                <select value={s.micDeviceId} onChange={(e) => pickMic(e.target.value)}>
                  <option value="">Systemowy domyślny</option>
                  {mics.map((m, i) => (
                    <option key={m.deviceId || i} value={m.deviceId}>
                      {m.label || `Mikrofon ${i + 1}`}
                    </option>
                  ))}
                </select>
                <button className="btn" style={{ marginTop: 6 }} onClick={loadMics}>
                  Odśwież listę mikrofonów
                </button>
                <span className="muted">
                  Jeśli JARVIS „nie słyszy" przez słuchawki Bluetooth — wybierz je tutaj. Przypnie
                  to wejście na stałe, niezależnie od domyślnego urządzenia w Windows. Etykiety
                  pojawią się po kliknięciu „Odśwież" (i zgodzie na mikrofon). {micMsg}
                </span>
              </div>

              <h3>🎧 Tryb Słuchawki — naturalna rozmowa</h3>
              <div className="row">
                <span>
                  🔒 Reaguj tylko na mój głos
                  <br />
                  <span className="muted">
                    Odsiewa inne osoby, telewizor i tło (lokalnie, prywatnie). Najpierw naucz
                    JARVIS-a swojego głosu (przycisk niżej albo w samym Trybie Słuchawki).
                  </span>
                </span>
                <Toggle on={s.voiceLock} onClick={() => set({ voiceLock: !s.voiceLock })} />
              </div>
              <button
                className="btn"
                disabled={enrollMsg === "rec"}
                onClick={async () => {
                  setEnrollMsg("rec");
                  const r = await enrollVoice(3, (i, t) => setEnrollMsg(`🎙 Próbka ${i}/${t} — mów teraz (np. policz do dziesięciu)…`));
                  setS((p) => ({ ...p, voiceProfile: store.settings.voiceProfile, voiceLock: store.settings.voiceLock }));
                  setEnrollMsg(r.ok ? "✅ Nauczyłem się Twojego głosu — blokada głosu włączona." : `❌ ${r.error}`);
                }}
              >
                {(s.voiceProfile?.length || 0) > 0 ? "🎤 Naucz głosu ponownie" : "🎤 Naucz JARVIS-a mojego głosu"}
              </button>
              {enrollMsg && enrollMsg !== "rec" && <p className="muted" style={{ marginTop: 6 }}>{enrollMsg}</p>}
              {enrollMsg === "rec" && <p className="muted" style={{ marginTop: 6 }}>🎙 Nagrywam… mów teraz.</p>}
              <div className="field" style={{ marginTop: 8 }}>
                <label>Czułość przerywania (cisza kończąca zdanie): {s.endpointShortMs} ms</label>
                <input type="range" min={500} max={1800} step={100} value={s.endpointShortMs} onChange={(e) => set({ endpointShortMs: Number(e.target.value) })} />
                <span className="muted" style={{ fontSize: 12 }}>Wyżej = JARVIS dłużej czeka, aż skończysz (mniej przerywania).</span>
              </div>
              <div className="row">
                <span>
                  Potwierdzaj akcje głosem
                  <br />
                  <span className="muted">JARVIS pyta, a Ty mówisz „tak"/„nie" w oknie zgody</span>
                </span>
                <Toggle on={s.voiceConfirm} onClick={() => set({ voiceConfirm: !s.voiceConfirm })} />
              </div>
              <div className="row">
                <span>Dźwięki interfejsu (HUD)</span>
                <Toggle on={s.soundCues} onClick={() => set({ soundCues: !s.soundCues })} />
              </div>
              <div className="row">
                <span>Wibracje (haptyka)</span>
                <Toggle on={s.haptics} onClick={() => set({ haptics: !s.haptics })} />
              </div>
              {wakeSupported() && (
                <div className="row">
                  <span>
                    Nasłuch „Jarvis" w tle (uruchom apkę głosem)
                    <br />
                    <span className="muted">eksperymentalne · zużywa baterię · wymaga mikrofonu</span>
                  </span>
                  <Toggle
                    on={s.backgroundWake}
                    onClick={() => {
                      const next = !s.backgroundWake;
                      set({ backgroundWake: next });
                      if (next) startBackgroundWake();
                      else stopBackgroundWake();
                    }}
                  />
                </div>
              )}
              <p className="muted">
                Wskazówka: jeśli nasłuch w tle nie działa na Twoim telefonie, powiedz „Hej Google,
                otwórz Jarvis" — aplikacja otworzy się (z auto-nasłuchem) nawet z zablokowanego ekranu.
              </p>

              <h3 id="set-voice">Brzmienie głosu</h3>
              {/* 🔊 Co naprawdę zabrzmi — jasny status + obietnica „działa od ręki" (koniec chaosu). */}
              <div className="journal-card" style={{ padding: "10px 12px", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>🔊 Aktualny głos: {activeVoiceLabel(s)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                  Zmiany głosu poniżej obowiązują <b>od razu</b> — bez „Zapisz". Wybierz głos z listy, by usłyszeć próbkę.
                </div>
                <button className="btn" style={{ marginTop: 8, padding: "5px 14px", width: "auto" }} onClick={() => speak("Dzień dobry. Tu JARVIS — tak właśnie brzmię.", { ...store.settings, ...s, speak: true })}>
                  ▶ Posłuchaj
                </button>
              </div>
              {/* 🚀 Jeden klik dla 99% ludzi: dobierz i przypnij najlepszy polski głos. */}
              <button
                className="btn primary"
                style={{ width: "100%" }}
                onClick={async () => {
                  let list = voices;
                  if (!list.length) { list = await listSpeechVoices(); setVoices(list); }
                  const best = bestPlVoiceName(list);
                  setVoice({ speak: true, voiceMode: "system", voiceSystemPl: true, voicePinned: true, geminiTts: false, localTts: false, voiceName: best, voicePitch: 0.9, voiceRate: 1.0 });
                  toast(best ? `🚀 Włączono polski głos JARVISA: ${best}` : "🚀 Włączono polski głos systemowy. Brak osobnych głosów PL — zainstaluj „Mowa Google”.");
                  setTimeout(() => speak("Dzień dobry. Tu JARVIS. Tak będę teraz brzmiał.", { ...store.settings, speak: true, voiceMode: "system", voiceName: best, voicePitch: 0.9, voiceRate: 1.0 }), 120);
                }}
              >
                🚀 Najlepszy polski głos JARVISA (jeden klik)
              </button>
              <p className="muted" style={{ marginTop: 4 }}>Nie chcesz nic ustawiać? Kliknij to — dobierzemy i przypniemy ładny polski głos.</p>

              {/* 🎙 JEDEN wybór silnika — to ON decyduje, jak brzmi JARVIS (koniec walki przełączników). */}
              <div className="field" style={{ marginTop: 12 }}>
                <label>🎙 Silnik głosu — wybierz jeden</label>
                <select
                  value={voiceMode}
                  onChange={(e) => {
                    const m = e.target.value as VoiceMode;
                    // Ustaw JEDNO źródło prawdy + zsynchronizuj stare flagi, by reszta apki była spójna.
                    setVoice({ voiceMode: m, speak: true, voiceSystemPl: m === "system", geminiTts: m === "gemini", localTts: m === "local" });
                    setTimeout(() => speak("Tak właśnie teraz brzmię.", { ...store.settings, ...s, voiceMode: m, speak: true }), 120);
                  }}
                >
                  <option value="system">🇵🇱 Polski systemowy — zalecane (offline, spójny)</option>
                  <option value="gemini">🎙 Gemini TTS — darmowy premium (klucz Gemini)</option>
                  <option value="eleven">⭐ ElevenLabs — premium (klucz)</option>
                  <option value="fish">🐟 Fish Audio — premium (klucz)</option>
                  <option value="local">🧠 Lokalny offline (Kokoro)</option>
                </select>
              </div>

              {/* Pokazujemy TYLKO opcje wybranego silnika — koniec przewijania przez wszystko naraz. */}
              {voiceMode === "system" && (
                <>
                  <div className="field">
                    <label>🎚 Głos urządzenia (kliknij, by usłyszeć)</label>
                    <select
                      value={s.voiceName}
                      onChange={(e) => { const name = e.target.value; setVoice({ voiceName: name, speak: true }); speak("Tu JARVIS. Tak właśnie brzmię.", { ...store.settings, ...s, voiceName: name, speak: true }); }}
                    >
                      <option value="">Auto (systemowy domyślny)</option>
                      {voices.map((v) => (
                        <option key={v.name} value={v.name}>{v.name}{v.lang ? ` (${v.lang})` : ""}{v.network ? " · sieciowy" : ""}</option>
                      ))}
                    </select>
                    <div className="chips" style={{ gap: 8, marginTop: 6 }}>
                      <button className="btn" onClick={() => { const best = bestPlVoiceName(voices); if (best) { setVoice({ voiceName: best, speak: true }); } else { void listSpeechVoices().then((vs) => { setVoices(vs); const b = bestPlVoiceName(vs); if (b) setVoice({ voiceName: b, speak: true }); }); } }}>🇵🇱 Najlepszy polski</button>
                      <button className="btn" onClick={() => speak("Dzień dobry. Tu JARVIS. Tak właśnie brzmię.", { ...store.settings, ...s, speak: true })}>🧪 Odsłuch</button>
                    </div>
                    <p className="muted" style={{ marginTop: 4 }}>
                      Brak polskich głosów na liście? Telefon: zainstaluj „Mowa Google” (Ustawienia Androida → Język → Zamiana tekstu na mowę). Komputer: dodaj polski głos w ustawieniach systemu (Windows: Ustawienia → Czas i język → Mowa).
                    </p>
                  </div>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Ton i tempo</label>
                  <div className="chips" style={{ margin: "4px 0 8px" }}>
                    {[{ l: "JARVIS", p: 0.9, r: 1.0 }, { l: "Głęboki", p: 0.7, r: 0.95 }, { l: "Neutralny", p: 1.0, r: 1.0 }, { l: "Energiczny", p: 1.1, r: 1.15 }].map((v) => (
                      <button key={v.l} className="chip" onClick={() => setVoice({ voicePitch: v.p, voiceRate: v.r })}>{v.l}</button>
                    ))}
                  </div>
                  <div className="field"><label>Wysokość głosu: {s.voicePitch.toFixed(1)}</label><input type="range" min="0.1" max="2" step="0.1" value={s.voicePitch} onChange={(e) => setVoice({ voicePitch: Number(e.target.value) })} /></div>
                  <div className="field"><label>Tempo mowy: {s.voiceRate.toFixed(1)}</label><input type="range" min="0.5" max="1.8" step="0.1" value={s.voiceRate} onChange={(e) => setVoice({ voiceRate: Number(e.target.value) })} /></div>
                </>
              )}

              {voiceMode === "gemini" && (
                <div className="field">
                  <label>Głos Gemini</label>
                  <select value={s.geminiVoice} onChange={(e) => setVoice({ geminiVoice: e.target.value })}>
                    {[["Charon", "Charon — głęboki, spokojny (JARVIS)"], ["Orus", "Orus — stanowczy, męski"], ["Fenrir", "Fenrir — energiczny, męski"], ["Puck", "Puck — żywy"], ["Kore", "Kore — wyrazisty"], ["Zephyr", "Zephyr — jasny"], ["Aoede", "Aoede — ciepły"], ["Leda", "Leda — młodzieńczy"]].map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                  {!s.keys.gemini?.trim()
                    ? <p className="muted" style={{ fontSize: 12, color: "var(--gold)" }}>⚠ Wymaga klucza Gemini (zakładka „AI”). Bez niego zabrzmi głos systemowy.</p>
                    : <p className="muted" style={{ fontSize: 12 }}>Najlepszy darmowy głos, naturalny. Kliknij „▶ Posłuchaj” u góry, by sprawdzić.</p>}
                </div>
              )}

              {voiceMode === "eleven" && (
                <>
                  <div className="field"><label>Klucz API ElevenLabs</label><input type="password" value={s.elevenLabsApiKey} placeholder="(wymagany)" onChange={(e) => setVoice({ elevenLabsApiKey: e.target.value })} /></div>
                  <div className="field"><label>ID głosu ElevenLabs</label><input value={s.elevenLabsVoiceId} placeholder="np. JBFqnCBsd6RMkjVDRZzb" onChange={(e) => setVoice({ elevenLabsVoiceId: e.target.value })} /></div>
                  <button className="btn" onClick={() => setVoice({ speak: true, voicePitch: 0.85, voiceRate: 0.98, elevenLabsVoiceId: s.elevenLabsVoiceId || (s.elevenLabsApiKey ? "onwK4e9ZLuTAKqWW03F9" : "") })}>🎩 Ustaw głos JARVIS (Iron Man)</button>
                  <p className="muted">Najbliższy legalny odpowiednik filmowego JARVIS-a: niski, brytyjski męski głos „Daniel”.</p>
                </>
              )}

              {voiceMode === "fish" && (
                <>
                  <p className="muted">Fish Audio — jakość zbliżona do ElevenLabs, taniej; możesz sklonować głos z 10–15 s próbki.</p>
                  <div className="field"><label>Klucz API Fish Audio</label><input type="password" value={s.fishAudioApiKey} placeholder="(wymagany)" onChange={(e) => setVoice({ fishAudioApiKey: e.target.value })} /></div>
                  <div className="field"><label>reference_id głosu Fish Audio</label><input value={s.fishAudioVoiceId} placeholder="np. 7f92f8afb8ec43bf81429cc1c9199cb1" onChange={(e) => setVoice({ fishAudioVoiceId: e.target.value })} /></div>
                </>
              )}

              {voiceMode === "local" && (
                <p className="muted">🧠 Głos w pełni offline na Twoim urządzeniu (model Kokoro). Pierwsze użycie pobiera model; potem działa bez internetu i nic nie wychodzi do chmury.</p>
              )}
            </>
          )}

          {/* ============ ✨ ZACHOWANIE ============ */}
          {tab === "behavior" && (
            <>
              <h3 id="set-persona">Osobowość</h3>
              <div className="field">
                <label>Jak JARVIS ma się do Ciebie zwracać</label>
                <input value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
              </div>
              <div className="field">
                <label>Nazwa asystenta (white-label)</label>
                <input
                  value={s.brandName}
                  placeholder="JARVIS"
                  maxLength={32}
                  onChange={(e) => set({ brandName: e.target.value })}
                />
                <p className="muted" style={{ marginTop: 4 }}>
                  Własna marka w interfejsie (nagłówek, ekran powitalny, rozmowa na żywo).
                  Puste = „JARVIS". Nie zmienia działania modelu — tylko wygląd.
                </p>
              </div>
              <div className="field">
                <label>Charakter JARVIS-a</label>
                <select value={s.persona} onChange={(e) => set({ persona: e.target.value })}>
                  <option value="operator">Operacyjny — elitarny, precyzyjny, działa zamiast pytać</option>
                  <option value="natural">Naturalny — rozmowa jak z mądrym znajomym</option>
                  <option value="classic">Klasyczny — elegancki majordomus</option>
                  <option value="concise">Zwięzły — krótko i na temat</option>
                  <option value="warm">Ciepły — wspierający i empatyczny</option>
                  <option value="witty">Błyskotliwy — suchy brytyjski humor</option>
                </select>
              </div>
              <div className="field">
                <label>Długość odpowiedzi</label>
                <select value={s.responseLength} onChange={(e) => set({ responseLength: e.target.value as Settings["responseLength"] })}>
                  <option value="concise">Krótko — 1–3 zdania</option>
                  <option value="balanced">Zrównoważona (domyślnie)</option>
                  <option value="detailed">Szczegółowo — z przykładami</option>
                </select>
              </div>
              <div className="field">
                <label>Ciepło rozmowy: {Math.round((s.warmth ?? 0.5) * 100)}% <span className="muted">(50% = neutralnie)</span></label>
                <input type="range" min={0} max={1} step={0.1} value={s.warmth ?? 0.5} onChange={(e) => set({ warmth: Number(e.target.value) })} />
                <span className="muted" style={{ fontSize: 12 }}>Wyżej = cieplej i bardziej po ludzku; niżej = rzeczowo i formalnie. Działa razem z charakterem.</span>
              </div>
              <div className="field">
                <label>Własne wytyczne osobowości (opcjonalnie)</label>
                <input
                  value={s.customPersona}
                  placeholder="np. mów do mnie per szefie, używaj metafor z motoryzacji"
                  onChange={(e) => set({ customPersona: e.target.value })}
                />
              </div>

              <h3>Proaktywność</h3>
              <div className="row">
                <span>Proaktywne powitanie/raport po otwarciu</span>
                <Toggle on={s.proactiveOnOpen} onClick={() => set({ proactiveOnOpen: !s.proactiveOnOpen })} />
              </div>
              <div className="row">
                <span>
                  Proaktywny Agent — JARVIS sam się odzywa
                  <br />
                  <span className="muted">przypomnienia po terminie, wydarzenia za chwilę, follow-upy, zadania na dziś</span>
                </span>
                <Toggle on={s.proactiveAgent !== false} onClick={() => set({ proactiveAgent: s.proactiveAgent === false })} />
              </div>
              <div className="row">
                <span>
                  Poranny briefing o ustalonej porze
                  <br />
                  <span className="muted">pogoda + kalendarz + zadania, czytany głosem (gdy apka otwarta)</span>
                </span>
                <Toggle on={s.dailyBriefing} onClick={() => set({ dailyBriefing: !s.dailyBriefing })} />
              </div>
              {s.dailyBriefing && (
                <div className="field">
                  <label>Godzina briefingu</label>
                  <input type="time" value={s.briefingTime} onChange={(e) => set({ briefingTime: e.target.value })} />
                </div>
              )}
              <h3 id="set-sales">💸 Automat sprzedaży (auto-prospekting)</h3>
              <p className="muted">
                JARVIS sam, kilka razy dziennie (gdy apka otwarta), szuka nowych firm w Twojej niszy
                i dopisuje je do Pulpitu Sprzedaży. Darmowe (OpenStreetMap) — z telefonami firm, bez klucza.
              </p>
              <div className="row">
                <span>Włącz auto-prospekting (co ~4 h)</span>
                <Toggle on={s.autoProspect} onClick={() => set({ autoProspect: !s.autoProspect })} />
              </div>
              <div className="row">
                <span>
                  🤖 Autopilot sprzedaży
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>Raz dziennie sam robi zadania z leadów (telefony, follow-upy) → ✅ Zadania Pro</span>
                </span>
                <Toggle on={s.salesAutopilot !== false} onClick={() => set({ salesAutopilot: s.salesAutopilot === false })} />
              </div>
              <div className="row">
                <span>
                  Auto-szkice ofert
                  <br />
                  <span className="muted">JARVIS sam pisze gotowe oferty dla nowych leadów — czekają w Pulpicie do wysłania</span>
                </span>
                <Toggle on={s.autoDraftOffers} onClick={() => set({ autoDraftOffers: !s.autoDraftOffers })} />
              </div>
              <div className="field" style={{ display: "flex", gap: 8 }}>
                <input value={s.prospectNiche} placeholder="Nisza (np. fryzjer)" onChange={(e) => set({ prospectNiche: e.target.value })} style={{ flex: 1 }} />
                <input value={s.prospectLocation} placeholder="Miasto" onChange={(e) => set({ prospectLocation: e.target.value })} style={{ flex: 1 }} />
              </div>
              <div className="field">
                <label>Kadencja follow-upów: co {s.followUpDays} dni</label>
                <input
                  type="range"
                  min={1}
                  max={14}
                  step={1}
                  value={s.followUpDays}
                  onChange={(e) => { const v = Number(e.target.value); set({ followUpDays: v }); store.setSettings({ followUpDays: v }); }}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  Po każdym kontakcie JARVIS sam planuje następne ponaglenie za tyle dni. Niżej = częściej (ostrożnie, by nie nękać).
                </span>
              </div>
              <button
                className="btn"
                onClick={async () => {
                  store.setSettings({ prospectNiche: s.prospectNiche, prospectLocation: s.prospectLocation });
                  setProspMsg("Szukam leadów…");
                  const r = await runProspecting();
                  setProspMsg(r.error ? `❌ ${r.error}` : r.added ? `✅ Dodano ${r.added} nowych leadów — sprawdź ⋯ → 📈.` : "Brak nowych firm (wszystkie już masz).");
                }}
              >
                ▶ Uruchom teraz
              </button>
              {prospMsg && <p className="muted">{prospMsg}</p>}

              <h3>Tryb tłumacza na żywo</h3>
              <p className="muted">
                JARVIS staje się tłumaczem symultanicznym — świetne z „Rozmową na żywo" (☎).
              </p>
              <div className="row">
                <span>Włącz tryb tłumacza</span>
                <Toggle on={s.interpreterMode} onClick={() => set({ interpreterMode: !s.interpreterMode })} />
              </div>
              <div className="field" style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label>Język A</label>
                  <input value={s.interpreterFrom} onChange={(e) => set({ interpreterFrom: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Język B</label>
                  <input value={s.interpreterTo} onChange={(e) => set({ interpreterTo: e.target.value })} />
                </div>
              </div>

            </>
          )}

          {/* ============ 🔗 INTEGRACJE ============ */}
          {/* ============ 🎨 INTERFEJS ============ */}
          {tab === "interface" && (
            <>
              <h3 id="set-theme">Motyw HUD</h3>
              <p className="muted">Kolor akcentów całego interfejsu.</p>
              <div className="chips" style={{ marginBottom: 8 }}>
                {[
                  { id: "default", l: "Cyan" },
                  { id: "gold", l: "Złoty" },
                  { id: "amber", l: "Bursztyn" },
                  { id: "green", l: "Zielony" },
                  { id: "ocean", l: "Ocean" },
                  { id: "red", l: "Czerwony" },
                  { id: "rose", l: "Róż" },
                  { id: "purple", l: "Fiolet" },
                  { id: "matrix", l: "Matrix 🟢" },
                  { id: "nord", l: "Nord ❄" },
                  { id: "sunset", l: "Sunset 🌅" },
                  { id: "retro", l: "Retro 95 🖥" },
                  { id: "xp", l: "XP Luna 🪟" },
                ].map((t) => (
                  <button
                    key={t.id}
                    className={`chip ${s.theme === t.id ? "on" : ""}`}
                    onClick={() => set({ theme: t.id })}
                  >
                    {t.l}
                  </button>
                ))}
              </div>

              <h3>🧠 Adaptacyjny układ</h3>
              <div className="row">
                <span>
                  Menu uczy się Twoich nawyków
                  <br />
                  <span className="muted">
                    Po ~7 dniach sekcje, których używasz najczęściej o danej porze dnia, wskakują
                    na górę. Dane tylko lokalnie (max 30 dni).
                  </span>
                </span>
                <Toggle on={s.adaptiveUi !== false} onClick={() => set({ adaptiveUi: s.adaptiveUi === false })} />
              </div>
              <UsageChart />
              <button className="btn" onClick={() => { resetAdaptive(); store.setSettings(s); }}>
                ↺ Resetuj układ do domyślnego
              </button>

              {typeof window !== "undefined" && (window as any).jarvisDesktop && (
                <>
                  <h3>📋 Proaktywny schowek (komputer)</h3>
                  <div className="row">
                    <span>
                      Analiza skopiowanego tekstu/linku
                      <br />
                      <span className="muted">
                        Skopiuj cokolwiek — JARVIS dyskretnie zaproponuje analizę. Nic nie wysyła
                        samo. Skróty: Ctrl+Alt+J — okno, Ctrl+Alt+V — tryb głosowy.
                      </span>
                    </span>
                    <Toggle on={s.clipboardWatch} onClick={() => set({ clipboardWatch: !s.clipboardWatch })} />
                  </div>
                </>
              )}

              <h3>👋 Przewodnik powitalny</h3>
              <p className="muted">Pokaż ponownie kreator pierwszego uruchomienia (3 kroki).</p>
              <button
                className="btn"
                onClick={() => {
                  try { localStorage.removeItem("jarvis.onboarded.v1"); } catch { /* ignore */ }
                  location.reload();
                }}
              >
                ↺ Uruchom przewodnik powitalny
              </button>
            </>
          )}

          {tab === "integrations" && (
            <>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🧠 Pamięć długoterminowa (Mem0 + Qdrant)</summary>
              <p className="muted">
                JARVIS pamięta fakty o Tobie i ustalenia między sesjami. Postaw serwer raz
                (katalog <code>server/</code>: <code>docker compose up -d</code>) i podaj adres.
                Puste = pamięć wyłączona, JARVIS działa normalnie.
              </p>
              <div className="field">
                <label>Adres serwera pamięci</label>
                <input
                  value={s.memoryServiceUrl}
                  placeholder="http://localhost:8000"
                  onChange={(e) => set({ memoryServiceUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Token serwera pamięci (MEM0_API_TOKEN)</label>
                <input
                  type="password"
                  value={s.memoryServiceToken}
                  placeholder="ten sam co w server/.env"
                  onChange={(e) => set({ memoryServiceToken: e.target.value })}
                />
              </div>
              <button
                className="btn"
                disabled={memBusy}
                onClick={async () => {
                  store.setSettings({ memoryServiceUrl: s.memoryServiceUrl, memoryServiceToken: s.memoryServiceToken });
                  if (!memoryServiceAvailable()) { setMemMsg("Podaj adres serwera pamięci."); return; }
                  setMemBusy(true); setMemMsg("⏳ Sprawdzam połączenie…");
                  try {
                    const mems = await getAllMemories("personal");
                    setMemMsg(`✅ Połączono z pamięcią. Wspomnień (personal): ${mems.length}.`);
                  } catch { setMemMsg("❌ Brak połączenia z serwerem pamięci."); }
                  setMemBusy(false);
                }}
              >
                🔌 Test pamięci
              </button>
              {memMsg && <p className="muted">{memMsg}</p>}

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🔌 Serwery MCP (narzędzia)</summary>
              <p className="muted">
                Podłącz narzędzia przez standard MCP. Tylko hosty z allowlisty (domyślnie localhost +
                mcp.googleapis.com). Niedostępny serwer jest pomijany — JARVIS działa dalej.
              </p>
              <div className="field">
                <label>Serwery MCP (JSON)</label>
                <textarea
                  className="ta"
                  rows={3}
                  value={s.mcpServers}
                  placeholder='[{"name":"gcal","url":"http://localhost:9100/mcp"}]'
                  onChange={(e) => set({ mcpServers: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Dodatkowe zaufane hosty (allowlista)</label>
                <input
                  value={s.mcpAllowlist}
                  placeholder="np. mcp.mojadomena.pl"
                  onChange={(e) => set({ mcpAllowlist: e.target.value })}
                />
              </div>
              <button
                className="btn"
                onClick={async () => {
                  store.setSettings({ mcpServers: s.mcpServers, mcpAllowlist: s.mcpAllowlist });
                  setMcpMsg("⏳ Łączę z serwerami MCP…");
                  try {
                    const loaded = await mcpManager.loadAll();
                    setMcpLoaded(mcpManager.listLoaded());
                    setMcpMsg(loaded.length ? `✅ Załadowano ${loaded.length} narzędzi.` : "Brak narzędzi (sprawdź adres/allowlistę).");
                  } catch { setMcpMsg("❌ Nie udało się połączyć z serwerami MCP."); }
                }}
              >
                🔌 Połącz / odśwież MCP
              </button>
              {mcpMsg && <p className="muted">{mcpMsg}</p>}
              {mcpLoaded.length > 0 && (
                <ul className="muted" style={{ fontSize: 12, marginTop: 4, paddingLeft: 18 }}>
                  {mcpLoaded.map((t) => <li key={t.toolName}>{t.original} <span style={{ opacity: 0.6 }}>({t.server})</span></li>)}
                </ul>
              )}

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>📈 AI Sales OS (osobne narzędzie)</summary>
              <p className="muted">
                AI Sales OS to <b>osobna aplikacja</b> (katalog <code>sales-os/</code>), z której korzystasz
                w przeglądarce. JARVIS jej nie wchłania — ma do niej <b>wgląd</b>: jednym kliknięciem ją
                otwierasz, a drugim pobierasz jej leady (read-only) do Pulpitu Sprzedaży. Uruchom ją raz:{" "}
                <code>npm run salesos</code> w katalogu JARVIS-a.
              </p>
              <div className="field">
                <label>Adres AI Sales OS</label>
                <input
                  value={s.salesOsUrl}
                  placeholder="http://localhost:3000"
                  onChange={(e) => set({ salesOsUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Token przechwytywania (X-Ingest-Token)</label>
                <input
                  type="password"
                  value={s.salesOsToken}
                  placeholder="token z ⚙ Sales OS → Pozyskiwanie → Inbound"
                  onChange={(e) => set({ salesOsToken: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    store.setSettings({ salesOsUrl: s.salesOsUrl, salesOsToken: s.salesOsToken });
                    if (!openSalesOs()) setSalesOsMsg("Najpierw podaj adres AI Sales OS.");
                  }}
                >
                  🚀 Otwórz Sales OS
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={salesOsBusy}
                  onClick={async () => {
                    store.setSettings({ salesOsUrl: s.salesOsUrl, salesOsToken: s.salesOsToken });
                    setSalesOsBusy(true);
                    setSalesOsMsg("⏳ Synchronizuję z Sales OS…");
                    const r = await syncFromSalesOs();
                    setSalesOsBusy(false);
                    setSalesOsMsg(r.message);
                  }}
                >
                  {salesOsBusy ? "⏳ Synchronizuję…" : "⬇ Synchronizuj leady"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={salesOsBusy}
                  onClick={async () => {
                    store.setSettings({ salesOsUrl: s.salesOsUrl, salesOsToken: s.salesOsToken });
                    setSalesOsBusy(true);
                    setSalesOsMsg("⏳ Sprawdzam połączenie…");
                    setSalesOsMsg(await testSalesOs());
                    setSalesOsBusy(false);
                  }}
                >
                  🔌 Test połączenia
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  disabled={salesOsBusy}
                  title="Odeślij leady znalezione w JARVIS-ie do Sales OS (źródła prawdy)"
                  onClick={async () => {
                    store.setSettings({ salesOsUrl: s.salesOsUrl, salesOsToken: s.salesOsToken });
                    setSalesOsBusy(true);
                    setSalesOsMsg("⏳ Wysyłam leady do Sales OS…");
                    const r = await pushLeadsToSalesOs();
                    setSalesOsBusy(false);
                    setSalesOsMsg(r.message);
                  }}
                >
                  📤 Wyślij leady do Sales OS
                </button>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Auto-synchronizacja</label>
                <select
                  value={s.salesOsAutoSync}
                  onChange={(e) => { const v = Number(e.target.value); set({ salesOsAutoSync: v }); store.setSettings({ salesOsAutoSync: v }); }}
                >
                  <option value={0}>Wyłączona (synchronizuj ręcznie)</option>
                  <option value={15}>Co 15 minut</option>
                  <option value={30}>Co 30 minut</option>
                  <option value={60}>Co godzinę</option>
                  <option value={240}>Co 4 godziny</option>
                </select>
              </div>
              {salesOsMsg && <p className="muted">{salesOsMsg}</p>}

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>☁ Synchronizacja (chmura)</summary>
              <p className="muted">
                Współdziel pamięć, projekty i dane między urządzeniami przez własny backend
                (katalog <code>proxy/</code>). Token to Twoja prywatna nazwa przestrzeni danych.
              </p>
              <div className="field">
                <label>Adres backendu sync</label>
                <input
                  value={s.syncUrl}
                  placeholder="https://jarvis-bff.twoja.workers.dev"
                  onChange={(e) => set({ syncUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Token sync (prywatny)</label>
                <input
                  type="password"
                  value={s.syncToken}
                  placeholder="dowolny sekretny ciąg"
                  onChange={(e) => set({ syncToken: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    store.setSettings({ syncUrl: s.syncUrl, syncToken: s.syncToken });
                    setSyncMsg("…"); setSyncMsg(await pushSync());
                  }}
                >
                  ⬆ Wyślij
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={async () => {
                    store.setSettings({ syncUrl: s.syncUrl, syncToken: s.syncToken });
                    setSyncMsg("…"); setSyncMsg(await pullSync());
                  }}
                >
                  ⬇ Pobierz
                </button>
              </div>
              {syncMsg && <p className="muted">{syncMsg}</p>}

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>📧 Integracje Google (Gmail + Kalendarz)</summary>
              <p className="muted">
                Wymaga wdrożonego backendu (powyżej) z kluczami Google OAuth. Po połączeniu JARVIS
                może czytać/wysyłać maile i zarządzać Kalendarzem Google. Instrukcja: <code>proxy/README</code>.
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                Po połączeniu na <b>telefonie</b> oferty do leadów wyślesz <b>jednym potwierdzeniem</b>
                {" "}prosto z Teczki Klienta — Gmailem w tle, bez otwierania aplikacji.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() => {
                    store.setSettings({ syncUrl: s.syncUrl, syncToken: s.syncToken });
                    const url = googleStartUrl();
                    if (!url) { setSyncMsg("Najpierw uzupełnij adres i token synchronizacji."); return; }
                    window.open(url, "_blank", "noopener");
                  }}
                >
                  🔗 Połącz konto Google
                </button>
                <button
                  className="btn"
                  disabled={gmailBusy}
                  onClick={async () => {
                    if (!s.syncUrl?.trim() || !s.syncToken?.trim()) { setSyncMsg("Najpierw uzupełnij adres i token synchronizacji (wyżej)."); return; }
                    store.setSettings({ syncUrl: s.syncUrl, syncToken: s.syncToken });
                    setGmailBusy(true);
                    setSyncMsg("⏳ Sprawdzam połączenie z Gmailem…");
                    const r = await gmailSearch("");
                    setGmailBusy(false);
                    setSyncMsg(/Skonfiguruj|Błąd|błąd|error/i.test(r) ? `Gmail: ${r}` : "✅ Gmail połączony — możesz wysyłać oferty jednym potwierdzeniem (też na telefonie).");
                  }}
                >
                  {gmailBusy ? "✅ Sprawdzam…" : "✅ Sprawdź Gmaila"}
                </button>
              </div>

              {desktopGoogle && (
                <>
                  <h3>📅 Kalendarz Google — na tym komputerze (bez serwera)</h3>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Logowanie odbywa się wprost na tym komputerze (Google „Aplikacja desktopowa"). Wklej dane
                    z pliku pobranego z Google Cloud — zostają lokalnie, nie są nigdzie wysyłane poza Google.
                  </p>
                  <div className="field">
                    <label>Client ID</label>
                    <input
                      value={s.googleClientId}
                      placeholder="…apps.googleusercontent.com"
                      onChange={(e) => set({ googleClientId: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Client Secret</label>
                    <input
                      type="password"
                      value={s.googleClientSecret}
                      placeholder="GOCSPX-…"
                      onChange={(e) => set({ googleClientSecret: e.target.value })}
                    />
                  </div>
                  <button
                    className="btn primary"
                    disabled={gcalBusy}
                    onClick={async () => {
                      store.setSettings({ googleClientId: s.googleClientId, googleClientSecret: s.googleClientSecret });
                      setGcalBusy(true);
                      setGcalMsg("⏳ Otwieram logowanie Google w przeglądarce — kliknij „Zezwól”…");
                      const r = await connectDesktopGoogle();
                      setGcalBusy(false);
                      setGcalMsg(r);
                    }}
                  >
                    {gcalBusy ? "⏳ Łączę…" : "🔗 Połącz Kalendarz Google (ten komputer)"}
                  </button>
                  {gcalMsg && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{gcalMsg}</p>}
                </>
              )}

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>🏠 Smart home (Home Assistant)</summary>
              <div className="field">
                <label>Adres Home Assistant</label>
                <input
                  value={s.homeAssistantUrl}
                  placeholder="http://homeassistant.local:8123"
                  onChange={(e) => set({ homeAssistantUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Token dostępu (long-lived)</label>
                <input
                  type="password"
                  value={s.homeAssistantToken}
                  placeholder="(opcjonalnie)"
                  onChange={(e) => set({ homeAssistantToken: e.target.value })}
                />
              </div>

              </details>
              <details className="journal-card" style={{ margin: "6px 0", padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--cyan)" }}>⚙ n8n — automatyzacje</summary>
              <p className="muted">
                JARVIS faktycznie WYKONUJE zadania przez Twój n8n: outreach, deployment, research,
                integracje (WHOOP, finanse, CRM). Utwórz w n8n workflow z węzłem <b>Webhook</b> i wklej
                jego adres. Powiedz np. „uruchom automatyzację outreach…", a JARVIS wyśle zlecenie.
              </p>
              <div className="field">
                <label>Adres webhooka n8n</label>
                <input
                  value={s.n8nUrl}
                  placeholder="https://twój-n8n/webhook/jarvis"
                  onChange={(e) => set({ n8nUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Token autoryzacji (opcjonalnie)</label>
                <input
                  type="password"
                  value={s.n8nToken}
                  placeholder="Bearer token (jeśli webhook go wymaga)"
                  onChange={(e) => set({ n8nToken: e.target.value })}
                />
              </div>

              </details>
              <h3>🧩 Wtyczki</h3>
              <p className="muted">
                JARVIS to platforma: wtyczki dokładają własne narzędzia i ustawienia.
                Jak napisać swoją — zobacz <code>PLUGIN_API.md</code> w repozytorium.
              </p>
              {listPlugins().map((rp) => (
                <div key={rp.plugin.id} className="journal-card">
                  <b>{rp.plugin.name}</b>{" "}
                  <span className="muted" style={{ fontSize: 12 }}>
                    v{rp.plugin.version} · narzędzia: {rp.tools.length ? rp.tools.join(", ") : "brak"}
                  </span>
                  {rp.error && <p className="muted" style={{ color: "#ff8585" }}>Błąd wtyczki: {rp.error}</p>}
                  {rp.sections.map((sec, i) => (
                    <div key={i} style={{ marginTop: 8 }}>
                      <h3 style={{ marginTop: 0 }}>{sec.label}</h3>
                      {sec.render()}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {/* ============ 🗄 DANE ============ */}
          {tab === "data" && (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                🧩 Wersja (build): <b>{typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "dev"}</b> UTC — podaj ją, gdy zgłaszasz problem.
              </p>

              <h3 id="set-update">⬆ Aktualizacja JARVISA</h3>
              <p className="muted" style={{ marginTop: -4 }}>
                Sprawdź i pobierz najnowszą wersję z GitHub. Na telefonie/PC: 1 klik → instalacja najnowszej.
                W przeglądarce: odświeży do najnowszej od ręki.
              </p>
              <button
                className="btn primary"
                disabled={updBusy}
                onClick={async () => {
                  setUpdBusy(true); setUpdMsg("Sprawdzam najnowszą wersję…");
                  const r = await checkForUpdate();
                  setUpdBusy(false);
                  if ("error" in r) { setUpdMsg(`❌ ${r.error}`); return; }
                  setUpdInfo(r);
                  setUpdMsg(r.newer
                    ? `🎉 Jest nowsza wersja (${r.latest}). Twoja: ${r.current}.`
                    : `✅ Masz najnowszą wersję (${r.current}).`);
                }}
              >
                {updBusy ? "⏳ Sprawdzam…" : "🔎 Sprawdź aktualizacje"}
              </button>
              {updMsg && <p className="muted" style={{ fontSize: 12, marginTop: 6, whiteSpace: "pre-line" }}>{updMsg}</p>}
              {updInfo?.newer && (
                <button
                  className="btn"
                  style={{ marginTop: 6 }}
                  onClick={() => { void applyUpdate(updInfo); toast(updInfo.platform === "web" ? "↻ Odświeżam do najnowszej…" : "⬇ Pobieram najnowszą — kliknij plik, by zainstalować."); }}
                >
                  {updInfo.platform === "web" ? "↻ Odśwież do najnowszej" : "⬇ Pobierz i zainstaluj najnowszą"}
                </button>
              )}
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Jak działa aktualizacja (i czemu antywirus ostrzega)</summary>
                <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                  • <b>Przeglądarka/PWA</b>: aktualizacja jest <b>płynna i automatyczna</b> — JARVIS czyści cache
                  i przeładowuje się w miejscu, bez zamykania.<br />
                  • <b>Telefon (APK)</b> i <b>Windows (EXE)</b>: system bezpieczeństwa nie pozwala aplikacji
                  zainstalować się <i>sama po cichu</i> — zawsze potwierdzasz instalację jednym kliknięciem (to
                  celowa ochrona Androida/Windows).<br />
                  • <b>iPhone (iOS)</b>: najprościej dodać JARVISA do ekranu początkowego z Safari (Udostępnij →
                  „Do ekranu początkowego") — działa jak aplikacja i sam się odświeża. Pełna aplikacja iOS wymaga
                  konta Apple Developer (App Store) albo sideloadu (AltStore/Sideloadly).<br />
                  • <b>Ostrzeżenie antywirusa/SmartScreen</b> pojawia się, bo plik nie jest podpisany certyfikatem
                  wydawcy. Pobranie idzie z oficjalnego <b>GitHub po HTTPS</b> — jest bezpieczne. Na Windows: „Więcej
                  informacji → Uruchom mimo to". Trwałe usunięcie ostrzeżeń wymaga płatnego podpisu kodu
                  (do rozważenia osobno).<br />
                  • JARVIS <b>sam sprawdza</b> aktualizacje przy starcie (raz dziennie) i proponuje je jednym kliknięciem.
                </p>
              </details>

              <h3 id="set-backup">Kopia danych</h3>
              <p className="muted">
                Zapisz wszystkie swoje dane (zadania, notatki, pamięć, dziennik, projekty, targ…)
                do pliku i przywróć je po reinstalacji lub na innym urządzeniu. Ten plik
                <b> nie zawiera kluczy API</b> — bezpieczny do przeniesienia.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => exportData()}>
                  ⬇ Eksportuj dane
                </button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={async () => setBackupMsg(await importData())}
                >
                  ⬆ Importuj
                </button>
              </div>

              <h3 style={{ marginTop: 14 }}>🔐 Pełna kopia (z kluczami API)</h3>
              <p className="muted">
                Zapisuje JARVIS-a w całości — dane <b>oraz wszystkie ustawienia i klucze API</b>.
                Odtwarza wszystko 1:1 po reinstalacji, bez ponownego wklejania kluczy.
                <br />
                <b style={{ color: "var(--gold)" }}>Uwaga:</b> ten plik zawiera Twoje klucze —
                trzymaj go w bezpiecznym miejscu (nie wysyłaj nikomu, nie wrzucaj do chmury publicznej).
              </p>
              <div className="field" style={{ display: "flex", gap: 8 }}>
                <input
                  type="password"
                  value={backupPass}
                  placeholder="Hasło kopii (zalecane)"
                  onChange={(e) => setBackupPass(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn primary"
                  style={{ width: "auto", marginTop: 0 }}
                  disabled={backupPass.trim().length < 4}
                  onClick={async () => setBackupMsg(await exportFullEncrypted(backupPass))}
                >
                  🔐 Zaszyfrowana
                </button>
              </div>
              <button className="btn" onClick={() => exportFull()}>
                ⬇ Pełna kopia (jawna, bez hasła)
              </button>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Zaszyfrowana kopia (AES-256) jest bezpieczna nawet w chmurze — bez hasła plik jest
                bezużyteczny. Obie przywracasz przyciskiem „⬆ Importuj" (przy zaszyfrowanej JARVIS
                poprosi o hasło).
              </p>
              {backupMsg && <p className="muted">{backupMsg}</p>}

              <h3 id="set-lock">🔒 Blokada aplikacji (PIN)</h3>
              <p className="muted">
                Zabezpiecz JARVIS-a PIN-em — bez niego apka jest bezużyteczna dla niepowołanych
                osób (sejf haseł, dane, sterowanie). PIN trzymany tylko jako skrót, lokalnie.
              </p>
              {hasPin ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <span className="muted" style={{ flex: 1, alignSelf: "center" }}>✅ Blokada aktywna.</span>
                  <button
                    className="btn"
                    style={{ width: "auto", marginTop: 0 }}
                    onClick={() => { clearPin(); setHasPin(false); setPinMsg("Blokada wyłączona."); }}
                  >
                    Wyłącz
                  </button>
                </div>
              ) : (
                <div className="field" style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pinVal}
                    placeholder="Ustaw PIN"
                    onChange={(e) => setPinVal(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn primary"
                    style={{ width: "auto", marginTop: 0 }}
                    disabled={pinVal.length < 4}
                    onClick={async () => { await setLockPin(pinVal); setHasPin(true); setPinVal(""); setPinMsg("PIN ustawiony — zadziała przy następnym otwarciu."); }}
                  >
                    Ustaw
                  </button>
                </div>
              )}
              {pinMsg && <p className="muted">{pinMsg}</p>}

              <h3 id="set-privacy">Prywatność i zgody</h3>
              <p className="muted">
                Akcje (dzwonienie, SMS, smart home, zapisy) wymagają Twojej zgody. Możesz wyczyścić
                zapamiętane zgody, by JARVIS znów pytał za każdym razem.
              </p>
              <button className="btn" onClick={() => resetConsents()}>
                Zresetuj zapamiętane zgody
              </button>

              <h3>© O programie / Licencja</h3>
              <p className="muted" style={{ lineHeight: 1.6 }}>
                <b>JARVIS</b> — osobisty asystent AI.
                <br />
                <b>© 2026 Artur Józefczak.</b> Wszelkie prawa zastrzeżone.
                <br />
                Program jest własnością autora i podlega ochronie prawa autorskiego. Kopiowanie,
                rozpowszechnianie, przesyłanie i odsprzedaż — wyłącznie za pisemną zgodą autora.
                Dostęp lub licencję (osobistą/komercyjną) można uzyskać za zgodą autora.
              </p>
            </>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn primary" onClick={save}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
