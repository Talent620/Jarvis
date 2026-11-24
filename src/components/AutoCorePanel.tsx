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
  const [, setTick] = useState(0);
  const refresh = () => { setTick((t) => t + 1); onChanged(); };

  const s = store.settings;
  useMemo(() => migrateExistingConfig(), []);

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

  return (
    <div className="journal-card" style={{ padding: 14, marginBottom: 14, border: "1px solid var(--cyan)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <b style={{ fontSize: 15, color: "var(--cyan)" }}>🧠 JARVIS AUTOCORE</b>
          <div className="muted" style={{ fontSize: 12 }}>
            Tryb: <b>{s.provider === "auto" ? "AUTO (domyślny)" : s.provider}</b> · Usługi: <b>{configured.length}</b> · Modele w puli: <b>{discoveredCount}</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
        <span>{configured.length ? "🟢" : "🔴"} Mózg/Agenci ({configured.length})</span>
        <span>{tts.allowed ? "🟢" : "🟡"} Głos TTS ({tts.provider})</span>
        <span>{stt.allowed ? "🟢" : "🟡"} Słuch STT ({stt.provider})</span>
        <span>{live.allowed ? "🟢" : "🟡"} Live Vision ({live.allowed ? "Gemini" : "wymaga klucza Gemini"})</span>
      </div>

      {/* Budżet */}
      <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12 }}>
        <div>
          <b>💰 Budżet:</b> dziś <b>{budget.spentTodayUsd.toFixed(3)} USD</b> · miesiąc <b>{budget.spentMonthUsd.toFixed(2)} USD</b>
          {budget.monthlyLimitUsd > 0 ? ` / ${budget.monthlyLimitUsd.toFixed(2)} USD (prognoza ${budget.forecastMonthUsd.toFixed(2)} USD)` : " (brak limitu — ustaw poniżej, by chronić płatne usługi)"}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <label className="muted">Limit miesięczny (USD):</label>
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
          <div style={{ marginTop: 6, color: "var(--gold)" }}>
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
            style={{ flex: 1 }}
          />
          <button className="btn primary" disabled={busy || !keyInput.trim()} onClick={handleConnect}>
            {busy ? "Łączę…" : "Podłącz"}
          </button>
        </div>
        <div style={{ marginTop: 4, display: "flex", gap: 12, alignItems: "center", fontSize: 11 }}>
          <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setShowEndpoint((v) => !v)}>
            {showEndpoint ? "Ukryj własny endpoint" : "+ Mam własny URL (np. Modal / serwer)"}
          </button>
          {onJumpBackup && (
            <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={onJumpBackup}>
              🔐 Kopia / przywrócenie konfiguracji (APK)
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
