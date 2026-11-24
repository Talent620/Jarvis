import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { PROVIDER_LIST } from "../lib/providers/registry";
import { healthSnapshot } from "../lib/autocore/health";
import { authorizeService, budgetState, setDailyLimit } from "../lib/autocore/budget";
import { connectService, discoveredModelsFor, migrateExistingConfig } from "../lib/autocore/discovery";
import { routingLog } from "../lib/autocore/router";
import { experimentHistory } from "../lib/autocore/experiments";
import { resolveService } from "../lib/autocore/gateway";
import { speak } from "../lib/voice";
import { desktopDiagnostics, desktopKeyringAvailable, isDesktop, isLinuxDesktop, type SystemDiagnosticsReport } from "../lib/desktop";
import { detectPlatform } from "../lib/selfManifest";

/** Zwięzły raport głosowy stanu AUTOCORE (również dla Androida). */
export function buildAutocoreVoiceReport(): string {
  const s = store.settings;
  const ready = PROVIDER_LIST.filter((p) => (p.id === "ollama" ? !!s.ollamaUrl?.trim() : p.id === "webllm" ? !!s.webllmEnabled : !!s.keys[p.id]?.trim()));
  const b = budgetState();
  const tts = resolveService("tts");
  const live = resolveService("live");
  const issues: string[] = [];
  if (!ready.length) issues.push("brak skonfigurowanego mózgu");
  if (b.level === "stop") issues.push("osiągnięto limit budżetu");
  if (b.pending.length) issues.push(`${b.pending.length} usług czeka na limit`);
  if (!live.allowed) issues.push("Live Vision bez klucza Gemini");
  const head = s.provider === "auto" ? "Tryb Auto aktywny." : `Przypięty dostawca: ${s.provider}.`;
  return `${head} Gotowych usług: ${ready.length}. Głos: ${tts.provider}. Wydatki w tym miesiącu: ${b.spentMonthUsd.toFixed(2)} dolara. ${issues.length ? `Uwagi: ${issues.join(", ")}.` : "Wszystkie główne systemy sprawne."}`;
}

export function AutoCorePanel({
  onChanged,
  onJumpBackup,
}: {
  onChanged: () => void;
  onJumpBackup?: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [endpointInput, setEndpointInput] = useState("");
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState(() => String(store.settings.aiMonthlyBudgetUsd || 0));
  const [sysDiag, setSysDiag] = useState<SystemDiagnosticsReport | null>(null);
  const [keyringOk, setKeyringOk] = useState<boolean | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [, setTick] = useState(0);
  const refresh = () => { setTick((t) => t + 1); onChanged(); };

  const s = store.settings;
  useMemo(() => migrateExistingConfig(), []);

  const platform = detectPlatform();
  const platformLabel = isLinuxDesktop()
    ? "Linux Desktop"
    : platform === "desktop"
      ? "Desktop"
      : platform === "android"
        ? "Android APK"
        : platform === "ios"
          ? "iOS"
          : "Web / PWA";

  const configured = PROVIDER_LIST.filter((p) =>
    p.id === "ollama" ? !!s.ollamaUrl?.trim() : p.id === "webllm" ? !!s.webllmEnabled : !!s.keys[p.id]?.trim(),
  );
  const discoveredCount = PROVIDER_LIST.reduce((acc, p) => acc + (discoveredModelsFor(p.id).length || p.models.length), 0);
  const budget = budgetState();
  const health = healthSnapshot();
  const tts = resolveService("tts");
  const stt = resolveService("stt");
  const live = resolveService("live");
  const recentRoutes = routingLog().slice(-4).reverse();
  const recentExps = experimentHistory().slice(-3).reverse();

  const budgetPct = budget.monthlyLimitUsd > 0 ? Math.min(100, Math.round((budget.spentMonthUsd / budget.monthlyLimitUsd) * 100)) : 0;
  const budgetBarColor = budget.level === "stop" ? "var(--danger)" : budget.level === "warn" ? "var(--gold)" : "var(--ok)";

  const problems: string[] = [];
  if (!configured.length) problems.push("Brak aktywnego mózgu — wklej dowolny klucz AI poniżej albo uruchom lokalną Ollamę.");
  for (const h of health) {
    if (h.badKeys > 0) problems.push(`${h.provider}: ${h.badKeys} klucz(e) tymczasowo zablokowane (${h.lastKind || "błąd"}).`);
    if (h.backoffUntil) problems.push(`${h.provider}: chwilowy backoff po serii błędów.`);
  }
  if (budget.level === "stop" || budget.level === "warn") problems.push(budget.message);

  const handleConnect = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    setMsg("Wykrywam dostawcę, sprawdzam /models i klasyfikuję możliwości…");
    try {
      const res = await connectService(keyInput, { endpoint: endpointInput.trim() || undefined });
      setMsg(res.message);
      if (res.ok) {
        setKeyInput("");
        setEndpointInput("");
        if (s.provider !== "auto" && !configured.length) store.setSettings({ provider: "auto", model: "auto" });
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const runSystemDiag = async () => {
    setDiagLoading(true);
    try {
      const [rep, kr] = await Promise.all([desktopDiagnostics(), desktopKeyringAvailable()]);
      setSysDiag(rep);
      setKeyringOk(kr);
    } finally {
      setDiagLoading(false);
    }
  };

  return (
    <div className="autocore-card">
      <div className="autocore-head">
        <div>
          <div className="autocore-title">🧠 JARVIS AUTOCORE <span className="autocore-plat">{platformLabel}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>
            Tryb: <b>{s.provider === "auto" ? "AUTO (domyślny)" : s.provider}</b> · Usługi: <b>{configured.length}</b> · Modele w puli: <b>{discoveredCount}</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {s.provider !== "auto" && (
            <button className="btn" onClick={() => { store.setSettings({ provider: "auto", model: "auto" }); refresh(); }}>
              Włącz AUTO
            </button>
          )}
          <button className="btn" onClick={() => speak(buildAutocoreVoiceReport(), { ...store.settings, speak: true })}>
            🔊 Raport głosowy
          </button>
        </div>
      </div>

      {/* Stan podsystemów */}
      <div className="autocore-pills">
        <span className={`ac-pill ${configured.length ? "ok" : "bad"}`}>{configured.length ? "🟢" : "🔴"} Mózg ({configured.length})</span>
        <span className={`ac-pill ${tts.allowed ? "ok" : "warn"}`}>{tts.allowed ? "🟢" : "🟡"} TTS: {tts.provider}</span>
        <span className={`ac-pill ${stt.allowed ? "ok" : "warn"}`}>{stt.allowed ? "🟢" : "🟡"} STT: {stt.provider}</span>
        <span className={`ac-pill ${live.allowed ? "ok" : "warn"}`}>{live.allowed ? "🟢" : "🟡"} Live Vision</span>
      </div>

      {/* Telemetria latencji i niezawodności */}
      {health.length > 0 && (
        <div className="autocore-telemetry">
          {health.slice(0, 5).map((h) => {
            const total = h.ok + h.ko;
            const pct = total > 0 ? Math.round((h.ok / total) * 100) : 100;
            return (
              <span key={h.provider} className="ac-metric" title={`Sukcesy: ${h.ok}, błędy: ${h.ko}`}>
                <b>{h.provider}</b> · {pct}%{typeof h.latencyEwma === "number" ? ` · ${h.latencyEwma} ms` : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Budżet + pasek postępu */}
      <div className="autocore-section">
        <div style={{ fontSize: 12 }}>
          <b>💰 Budżet:</b> dziś <b>{budget.spentTodayUsd.toFixed(3)} USD</b> · miesiąc <b>{budget.spentMonthUsd.toFixed(2)} USD</b>
          {budget.monthlyLimitUsd > 0
            ? ` / ${budget.monthlyLimitUsd.toFixed(2)} USD (${budgetPct}%, prognoza ${budget.forecastMonthUsd.toFixed(2)} USD)`
            : " (brak limitu — ustaw poniżej, by chronić płatne usługi)"}
        </div>
        {budget.monthlyLimitUsd > 0 && (
          <div className="ac-meter" aria-label={`Zużycie budżetu ${budgetPct}%`}>
            <div className="ac-meter-fill" style={{ width: `${budgetPct}%`, background: budgetBarColor }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <label className="muted" style={{ fontSize: 12 }}>Limit miesięczny (USD):</label>
          <input
            type="number"
            min={0}
            step={1}
            value={limitDraft}
            onChange={(e) => setLimitDraft(e.target.value)}
            style={{ width: 90 }}
          />
          <button
            className="btn"
            onClick={() => {
              const v = Math.max(0, Number(limitDraft) || 0);
              store.setSettings({ aiMonthlyBudgetUsd: v });
              setDailyLimit(v > 0 ? v / 10 : 0);
              refresh();
            }}
          >
            Zapisz limit
          </button>
        </div>
        {budget.pending.length > 0 && (
          <div style={{ marginTop: 6, color: "var(--gold)", fontSize: 12 }}>
            ⏳ Oczekują na zatwierdzenie limitu: {budget.pending.map((p) => (
              <button
                key={p}
                className="btn"
                style={{ marginLeft: 6 }}
                onClick={() => {
                  const r = authorizeService(p, Math.max(0, Number(limitDraft) || 0) || undefined);
                  setMsg(r.message);
                  refresh();
                }}
              >
                Zatwierdź {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Jeden przycisk: Podłącz nową usługę AI */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>🔌 PODŁĄCZ NOWĄ USŁUGĘ AI</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={keyInput}
            placeholder="Wklej dowolny klucz API (JARVIS sam wykryje usługę)…"
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button className="btn primary" disabled={busy || !keyInput.trim()} onClick={handleConnect}>
            {busy ? "Łączę…" : "Podłącz"}
          </button>
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11 }}>
          <button className="btn" style={{ padding: "4px 9px", fontSize: 11 }} onClick={() => setShowEndpoint((v) => !v)}>
            {showEndpoint ? "Ukryj własny endpoint" : "+ Własny URL (Modal / serwer)"}
          </button>
          {onJumpBackup && (
            <button className="btn" style={{ padding: "4px 9px", fontSize: 11 }} onClick={onJumpBackup}>
              🔐 Kopia / przywrócenie (APK)
            </button>
          )}
          {isDesktop() && (
            <button className="btn" style={{ padding: "4px 9px", fontSize: 11 }} disabled={diagLoading} onClick={runSystemDiag}>
              {diagLoading ? "Sprawdzam system…" : "🐧 Diagnostyka systemu (W1)"}
            </button>
          )}
        </div>
        {showEndpoint && (
          <input
            value={endpointInput}
            placeholder="Opcjonalny URL (np. https://…modal.run/v1)"
            onChange={(e) => setEndpointInput(e.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          />
        )}
        {msg && <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>{msg}</p>}
      </div>

      {/* Diagnostyka zależności systemu Linux/Desktop (W1) */}
      {sysDiag && (
        <div className="autocore-section" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            🖥 {sysDiag.distro || sysDiag.platform} · sesja: {sysDiag.sessionType || "native"}
            {sysDiag.gpu ? ` · GPU: ${sysDiag.gpu}${sysDiag.vramGb ? ` (${sysDiag.vramGb} GB)` : ""}` : ""}
            {keyringOk !== null ? ` · Pęk kluczy OS: ${keyringOk ? "aktywny" : "niedostępny"}` : ""}
          </div>
          <div className="ac-diag-list">
            {sysDiag.items.map((it) => (
              <div key={it.id} className="ac-diag-row">
                <span>
                  {it.status === "available" ? "🟢" : it.status === "disabled" ? "🟡" : it.status === "error" ? "🔴" : "⚪"}{" "}
                  <b>{it.label}</b> — <span className="muted">{it.detail}</span>
                </span>
                {it.fixHint && <code className="ac-fix">{it.fixHint}</code>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Problemy i czego potrzebuje */}
      {problems.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--gold)" }}>
          <b>⚠ Wymaga uwagi:</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {problems.map((pr, idx) => <li key={idx}>{pr}</li>)}
          </ul>
        </div>
      )}

      {/* Ostatnie decyzje/ulepszenia */}
      {(recentRoutes.length > 0 || recentExps.length > 0) && (
        <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
          {recentRoutes.length > 0 && (
            <div>Ostatnie zmiany routingu: {recentRoutes.map((r) => `${r.task}→${r.to} (${r.reason})`).join(" · ")}</div>
          )}
          {recentExps.length > 0 && (
            <div>Ostatnie testy modeli: {recentExps.map((e) => `${e.provider}/${e.model}: ${(e.score * 100).toFixed(0)}%`).join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
