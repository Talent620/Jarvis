import { useEffect, useMemo, useState } from "react";
import { store } from "../lib/store";
import { loadVoices, speak } from "../lib/voice";
import { PROVIDER_LIST, PROVIDERS, autoPick, detectProvider, FREE_UNCENSORED } from "../lib/providers/registry";
import { resetConsents } from "../lib/permissions";
import { pushSync, pullSync, testBackend } from "../lib/sync";
import { googleStartUrl, gmailSearch, connectDesktopGoogle } from "../lib/google";
import { testApi, testProvider, resolveProvider } from "../lib/brain";
import { startBackgroundWake, stopBackgroundWake, wakeSupported } from "../lib/wakeword";
import { exportData, exportFull, exportFullEncrypted, importData } from "../lib/backup";
import { keyList, keyCount } from "../lib/keys";
import { systemCheck } from "../lib/diagnostics";
import { runHealthCheck, statusIcon, type HealthItem } from "../lib/healthCheck";
import { checkAllApis, stateDot, type ApiStatus } from "../lib/apiStatus";
import { lockIsSet, setPin as setLockPin, clearPin } from "../lib/lock";
import { enablePrivateMode } from "../lib/privateMode";
import { runProspecting } from "../lib/prospect";
import { verifyMailConnection, sendTestEmail } from "../lib/mailer";
import { enrollVoice } from "../lib/voiceEnroll";
import { listMics, ensureMicPermission } from "../lib/mic";
import FitnessPanel from "./FitnessPanel";
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
    loadVoices().then(setVoices);
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
          {/* Wskaźnik sprawności — zawsze widoczny u góry, niezależnie od zakładki. */}
          <FitnessPanel />
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

              <h3>🩺 Centrum sprawdzania — czy wszystko działa</h3>
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

              <h3>📨 Poczta — wysyłka e-maili z aplikacji</h3>
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

              <h3>🎨 Studio premium (edycja zdjęć)</h3>
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

              <h3>⚖ Tryb Konsylium</h3>
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
              <h3>💸 Automat sprzedaży (auto-prospekting)</h3>
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
                  { id: "matrix", l: "Matrix 🟢" },
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

              <h3>⚙ n8n — warstwa wykonawcza (automatyzacje)</h3>
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
