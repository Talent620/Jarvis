import { useEffect, useMemo, useState } from "react";
import { store } from "../lib/store";
import { loadVoices, speak } from "../lib/voice";
import { PROVIDER_LIST, PROVIDERS, autoPick, detectProvider, FREE_UNCENSORED } from "../lib/providers/registry";
import { resetConsents } from "../lib/permissions";
import { pushSync, pullSync, testBackend } from "../lib/sync";
import { googleStartUrl } from "../lib/google";
import { testApi, testProvider } from "../lib/brain";
import { startBackgroundWake, stopBackgroundWake, wakeSupported } from "../lib/wakeword";
import { exportData, exportFull, exportFullEncrypted, importData } from "../lib/backup";
import { keyList, keyCount } from "../lib/keys";
import { systemCheck } from "../lib/diagnostics";
import { lockIsSet, setPin as setLockPin, clearPin } from "../lib/lock";
import { enablePrivateMode } from "../lib/privateMode";
import { runProspecting } from "../lib/prospect";
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
const TABS: { id: Tab; label: string }[] = [
  { id: "ai", label: "🤖 AI" },
  { id: "voice", label: "🗣 Głos" },
  { id: "behavior", label: "✨ Zachowanie" },
  { id: "interface", label: "🎨 Interfejs" },
  { id: "integrations", label: "🔗 Integracje" },
  { id: "data", label: "🗄 Dane" },
];

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [s, setS] = useState<Settings>(() => ({ ...store.settings, keys: { ...store.settings.keys } }));
  const [tab, setTab] = useState<Tab>("ai");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [syncMsg, setSyncMsg] = useState("");
  const [apiMsg, setApiMsg] = useState("");
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

  useEffect(() => {
    loadVoices().then(setVoices);
  }, []);

  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));
  // Klucze zapisują się NATYCHMIAST do magazynu — nigdy nie giną po wyjściu bez „Zapisz".
  const setKey = (id: ProviderId, val: string) => {
    const keys = { ...s.keys, [id]: val };
    setS((prev) => ({ ...prev, keys }));
    store.setSettings({ keys });
  };

  // „Wklej dowolny klucz" — rozpoznaj dostawcę, zapisz i od razu przetestuj.
  const addQuickKey = async (raw?: string) => {
    const key = (raw ?? quickKey).trim();
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
  const modelOptions = useMemo(() => {
    if (s.provider === "auto") return [];
    return PROVIDERS[s.provider as ProviderId]?.models ?? [];
  }, [s.provider]);

  const autoTarget = useMemo(() => (s.provider === "auto" ? autoPick(s.keys) : null), [s.provider, s.keys]);

  const save = () => {
    // Jeśli zmieniono dostawcę, a model nie pasuje — zresetuj na domyślny.
    let next = { ...s };
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
          <div className="chips" style={{ marginTop: 10 }}>
            {TABS.map((t) => (
              <button key={t.id} className={`chip ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {/* ============ 🤖 AI ============ */}
          {tab === "ai" && (
            <>
              <h3>🩺 Diagnostyka startowa</h3>
              <p className="muted">
                Jedno kliknięcie sprawdza wszystko: internet, każdy klucz AI, research, głos,
                mikrofon, backend i smart home — z podpowiedzią, jak naprawić braki.
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

              <h3>Dostawca AI</h3>
              <div className="field">
                <label>Dostawca</label>
                <select value={s.provider} onChange={(e) => set({ provider: e.target.value, model: "auto" })}>
                  <option value="auto">⚡ Auto — wybierz najlepszy dostępny</option>
                  {PROVIDER_LIST.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {s.provider === "auto" ? (
                <p className="muted">
                  {autoTarget
                    ? `Tryb auto użyje: ${PROVIDERS[autoTarget.provider].label} · ${autoTarget.model}. Wpisz klucze poniżej — im wyżej na liście, tym wyższy priorytet.`
                    : "Brak kluczy. Wprowadź przynajmniej jeden klucz API poniżej."}
                </p>
              ) : (
                <div className="field">
                  <label>Model</label>
                  <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
                    <option value="auto">Domyślny modelu dostawcy</option>
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <h3>Klucze API (lokalnie na urządzeniu)</h3>
              <p className="muted" style={{ marginTop: -4 }}>
                💡 Możesz wpisać <b>kilka kluczy jednego dostawcy</b> — każdy w nowej linii. Gdy
                jeden wyczerpie limit dzienny, JARVIS automatycznie przełączy się na kolejny, żeby
                rozmowa nie wywaliła się błędem.
              </p>
              {PROVIDER_LIST.filter((p) => p.id !== "ollama").map((p) => {
                const n = keyCount(p.id);
                return (
                  <div className="field" key={p.id}>
                    <label>
                      {p.label}
                      {p.needsProxy ? " · może wymagać proxy (CORS)" : ""} —{" "}
                      <a href={p.keysUrl} target="_blank" rel="noopener" style={{ color: "var(--cyan)" }}>
                        klucz
                      </a>
                      {n > 1 ? <span style={{ color: "var(--ok, #58e08a)" }}> · {n} kluczy (rotacja)</span> : null}
                    </label>
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
              {apiMsg && <p className="muted" style={{ whiteSpace: "pre-line" }}>{apiMsg}</p>}

              <h3>Research z cytatami (Tavily)</h3>
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

              <h3>Zaawansowane</h3>
              <div className="field">
                <label>Lokalny model — adres Ollama (prywatny, offline)</label>
                <input
                  value={s.ollamaUrl}
                  placeholder="http://192.168.0.10:11434"
                  onChange={(e) => set({ ollamaUrl: e.target.value })}
                />
                <p className="muted" style={{ marginTop: 4 }}>
                  Wybierz dostawcę „Lokalny model (Ollama)" powyżej. Uruchom Ollamę na komputerze
                  w tej samej sieci — żadne dane nie wychodzą do chmury. Modele bez cenzury pobierzesz lokalnie,
                  np. <code>ollama pull dolphin-mistral</code> (działają w pełni offline, na Twoim sprzęcie).
                </p>
              </div>
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
              <h3>Mowa i nasłuch</h3>
              <div className="row">
                <span>Czytaj odpowiedzi na głos</span>
                <Toggle on={s.speak} onClick={() => set({ speak: !s.speak })} />
              </div>
              <div className="row">
                <span>Ciągłe nasłuchiwanie słowa „Jarvis"</span>
                <Toggle on={s.wakeWord} onClick={() => set({ wakeWord: !s.wakeWord })} />
              </div>
              <div className="row">
                <span>
                  🚗 Słowo „Jarvis" otwiera tryb głosowy
                  <br />
                  <span className="muted">
                    Pełnoekranowy tryb bez patrzenia (duży tekst + głos) — idealny w aucie.
                    Wymaga włączonego nasłuchu powyżej.
                  </span>
                </span>
                <Toggle on={s.voiceModeWake} onClick={() => set({ voiceModeWake: !s.voiceModeWake })} />
              </div>
              <div className="row">
                <span>Słuchaj od razu po otwarciu (i zapytaj „o co chodzi?")</span>
                <Toggle on={s.autoListenOnOpen} onClick={() => set({ autoListenOnOpen: !s.autoListenOnOpen })} />
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

              <h3>Brzmienie głosu</h3>
              <div className="row">
                <span>
                  🎙 Darmowy głos premium (Gemini TTS)
                  <br />
                  <span className="muted">wysoka jakość, naturalny — wymaga klucza Gemini (darmowy)</span>
                </span>
                <Toggle on={s.geminiTts} onClick={() => set({ geminiTts: !s.geminiTts })} />
              </div>
              {s.geminiTts && (
                <div className="field">
                  <label>Głos Gemini</label>
                  <select value={s.geminiVoice} onChange={(e) => set({ geminiVoice: e.target.value })}>
                    {[
                      ["Charon", "Charon — głęboki, spokojny (JARVIS)"],
                      ["Orus", "Orus — stanowczy, męski"],
                      ["Fenrir", "Fenrir — energiczny, męski"],
                      ["Puck", "Puck — żywy"],
                      ["Kore", "Kore — wyrazisty"],
                      ["Zephyr", "Zephyr — jasny"],
                      ["Aoede", "Aoede — ciepły"],
                      ["Leda", "Leda — młodzieńczy"],
                    ].map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <p className="muted" style={{ marginTop: 4 }}>
                    Najlepszy darmowy głos. Działa też w „Przetestuj głos" niżej. Gdy wpiszesz
                    klucz ElevenLabs/Fish, mają one priorytet.
                  </p>
                </div>
              )}
              <div className="field">
                <label>Głos systemowy (zapasowy)</label>
                <select value={s.voiceName} onChange={(e) => set({ voiceName: e.target.value })}>
                  <option value="">Auto (najbardziej „JARVIS-owy")</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn"
                onClick={() =>
                  set({
                    speak: true,
                    voicePitch: 0.85,
                    voiceRate: 0.98,
                    elevenLabsVoiceId:
                      s.elevenLabsVoiceId || (s.elevenLabsApiKey ? "onwK4e9ZLuTAKqWW03F9" : ""),
                  })
                }
              >
                🎩 Ustaw głos JARVIS (Iron Man)
              </button>
              <p className="muted">
                Najbliższy legalny odpowiednik filmowego JARVIS-a: niski, brytyjski męski głos.
                Z kluczem ElevenLabs użyje stockowego głosu „Daniel"; bez niego — najlepszego
                głosu systemowego z dostrojonym tonem.
              </p>
              <div className="chips" style={{ marginBottom: 8 }}>
                {[
                  { l: "JARVIS", p: 0.9, r: 1.0 },
                  { l: "Głęboki", p: 0.7, r: 0.95 },
                  { l: "Neutralny", p: 1.0, r: 1.0 },
                  { l: "Energiczny", p: 1.1, r: 1.15 },
                ].map((v) => (
                  <button key={v.l} className="chip" onClick={() => set({ voicePitch: v.p, voiceRate: v.r })}>
                    {v.l}
                  </button>
                ))}
              </div>
              <div className="field">
                <label>Wysokość głosu: {s.voicePitch.toFixed(1)}</label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={s.voicePitch}
                  onChange={(e) => set({ voicePitch: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>Tempo mowy: {s.voiceRate.toFixed(1)}</label>
                <input
                  type="range"
                  min="0.5"
                  max="1.8"
                  step="0.1"
                  value={s.voiceRate}
                  onChange={(e) => set({ voiceRate: Number(e.target.value) })}
                />
              </div>
              <button className="btn" onClick={() => speak("Dzień dobry. Systemy w pełni sprawne.", s)}>
                ▶ Przetestuj głos
              </button>

              <h3>Premium głos (opcjonalnie)</h3>
              <div className="field">
                <label>Klucz API ElevenLabs</label>
                <input
                  type="password"
                  value={s.elevenLabsApiKey}
                  placeholder="(opcjonalnie)"
                  onChange={(e) => set({ elevenLabsApiKey: e.target.value })}
                />
              </div>
              <div className="field">
                <label>ID głosu ElevenLabs</label>
                <input
                  value={s.elevenLabsVoiceId}
                  placeholder="np. JBFqnCBsd6RMkjVDRZzb"
                  onChange={(e) => set({ elevenLabsVoiceId: e.target.value })}
                />
              </div>
              <p className="muted">
                Fish Audio — jakość zbliżona do ElevenLabs, taniej; sklonuj głos z 10–15 s próbki.
                Ma priorytet nad ElevenLabs, gdy uzupełniony.
              </p>
              <div className="field">
                <label>Klucz API Fish Audio</label>
                <input
                  type="password"
                  value={s.fishAudioApiKey}
                  placeholder="(opcjonalnie)"
                  onChange={(e) => set({ fishAudioApiKey: e.target.value })}
                />
              </div>
              <div className="field">
                <label>reference_id głosu Fish Audio</label>
                <input
                  value={s.fishAudioVoiceId}
                  placeholder="np. 7f92f8afb8ec43bf81429cc1c9199cb1"
                  onChange={(e) => set({ fishAudioVoiceId: e.target.value })}
                />
              </div>
            </>
          )}

          {/* ============ ✨ ZACHOWANIE ============ */}
          {tab === "behavior" && (
            <>
              <h3>Osobowość</h3>
              <div className="field">
                <label>Jak JARVIS ma się do Ciebie zwracać</label>
                <input value={s.userName} onChange={(e) => set({ userName: e.target.value })} />
              </div>
              <div className="field">
                <label>Charakter JARVIS-a</label>
                <select value={s.persona} onChange={(e) => set({ persona: e.target.value })}>
                  <option value="operator">Operacyjny — elitarny, precyzyjny, działa zamiast pytać</option>
                  <option value="classic">Klasyczny — elegancki majordomus</option>
                  <option value="concise">Zwięzły — krótko i na temat</option>
                  <option value="warm">Ciepły — wspierający i empatyczny</option>
                  <option value="witty">Błyskotliwy — suchy brytyjski humor</option>
                </select>
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
              <h3>💸 Automat sprzedaży (auto-prospekting)</h3>
              <p className="muted">
                JARVIS sam, kilka razy dziennie (gdy apka otwarta), szuka nowych firm w Twojej niszy
                i dopisuje je do Pulpitu Sprzedaży. Wymaga klucza Tavily (⚙ → AI).
              </p>
              <div className="row">
                <span>Włącz auto-prospekting (co ~4 h)</span>
                <Toggle on={s.autoProspect} onClick={() => set({ autoProspect: !s.autoProspect })} />
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
              <h3>Motyw HUD</h3>
              <p className="muted">Kolor akcentów całego interfejsu.</p>
              <div className="chips" style={{ marginBottom: 8 }}>
                {[
                  { id: "default", l: "Cyan" },
                  { id: "gold", l: "Złoty" },
                  { id: "green", l: "Zielony" },
                  { id: "red", l: "Czerwony" },
                  { id: "purple", l: "Fiolet" },
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
              <h3>Synchronizacja (chmura)</h3>
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

              <h3>Integracje Google (Gmail + Kalendarz)</h3>
              <p className="muted">
                Wymaga wdrożonego backendu (powyżej) z kluczami Google OAuth. Po połączeniu JARVIS
                może czytać/wysyłać maile i zarządzać Kalendarzem Google. Instrukcja: <code>proxy/README</code>.
              </p>
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

              <h3>Smart home (Home Assistant)</h3>
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
              <h3>Kopia danych</h3>
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

              <h3>🔒 Blokada aplikacji (PIN)</h3>
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

              <h3>Prywatność i zgody</h3>
              <p className="muted">
                Akcje (dzwonienie, SMS, smart home, zapisy) wymagają Twojej zgody. Możesz wyczyścić
                zapamiętane zgody, by JARVIS znów pytał za każdym razem.
              </p>
              <button className="btn" onClick={() => resetConsents()}>
                Zresetuj zapamiętane zgody
              </button>
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
