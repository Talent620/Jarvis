// === JARVIS AUTOPILOT & FORGE — Zero-Config Centrum Autonomicznego Programowania ===
// Jedno główne polecenie („Co mam zbudować, naprawić lub ulepszyć?"), zero ręcznej konfiguracji
// modelu/zespołu/strategii, przejrzysty podgląd: co Jarvis robi, jaki model i zespół działają,
// postęp i limity, zmieniane pliki, wykonywane testy, KARTA DECYZJI UŻYTKOWNIKA (waiting_approval)
// oraz jasny werdykt końcowy z historią prób i 1-klikowym rollbackiem. S9/ES2019 safe.

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import {
  cancelForgeRun,
  connectForge,
  decideAutopilotRun,
  getForgeMemory,
  getForgeProviders,
  getForgeRun,
  listForgeRuns,
  pauseForgeRun,
  resumeForgeRun,
  rollbackForgeRunClient,
  startAutopilotRun,
  subscribeForgeRun,
  type ForgeCostPolicy,
  type ForgeHardwareProfile,
  type ForgeMemorySnapshot,
  type ForgeProviderStatus,
  type ForgeRunState,
} from "../lib/forgeClient";

const PHASE_LABEL: Record<string, string> = {
  queued: "W kolejce",
  scouting: "Analiza repozytorium",
  planning: "Planowanie etapów",
  executing: "Pisanie kodu",
  verifying: "Uruchamianie testów",
  debugging: "Naprawa błędów i zmiana strategii",
  reviewing: "Niezależna recenzja kodu",
  waiting_approval: "Wymagana Twoja decyzja",
  completed: "Zakończono sukcesem (PASS)",
  paused: "Wstrzymano (zapisany checkpoint)",
  blocked: "Zablokowano (BLOCKED)",
  failed: "Błąd wykonania (FAIL)",
};

const TIER_LABEL: Record<string, string> = {
  local_free: "Tier 1 · Lokalny (0 USD)",
  api_free: "Tier 2 · Darmowe API (0 USD)",
  promo_credits: "Tier 3 · Kredyty promocyjne (limit)",
};

const TEAM_LABEL: Record<string, string> = {
  lean_2_agent: "Lekki zespół (2–3 role)",
  disciplined_4_role: "Zespół 4-rolny (Plan → Kod → Test → Recenzja)",
  specialist_squad: "Zespół specjalistyczny (z eskalacją)",
  competitive_dual_worktree: "Tryb konkurencyjny (2 worktree)",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  simple: "Proste",
  medium: "Średnie",
  hard: "Trudne",
};

const STEP_ICON: Record<string, string> = {
  pending: "○",
  active: "⏳",
  done: "✅",
  failed: "⚠",
};

const EXAMPLES = [
  "Napraw wykryte błędy w testach i dodaj brakujący test regresyjny",
  "Dodaj walidację danych wejściowych w module API i sprawdź testami",
  "Zbuduj nowy moduł pomocniczy z kompletem testów jednostkowych",
];

function isRunActive(status?: string): boolean {
  return status === "queued" || status === "scouting" || status === "planning"
    || status === "executing" || status === "verifying" || status === "debugging" || status === "reviewing";
}

function formatDurationLimit(ms?: number): string {
  if (!ms || ms <= 0) return "domyślny";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)} min`;
}

export default function ForgeWorkspace({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"mission" | "memory" | "history">("mission");
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [goal, setGoal] = useState("");
  const [costPolicy, setCostPolicy] = useState<ForgeCostPolicy>("zero_cost");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const [hardware, setHardware] = useState<ForgeHardwareProfile | null>(null);
  const [providers, setProviders] = useState<ForgeProviderStatus[]>([]);
  const [memory, setMemory] = useState<ForgeMemorySnapshot | null>(null);
  const [runs, setRuns] = useState<ForgeRunState[]>([]);
  const [activeRun, setActiveRun] = useState<ForgeRunState | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<Record<string, boolean>>({});
  const [expandedTest, setExpandedTest] = useState<Record<string, boolean>>({});
  const [showAttempts, setShowAttempts] = useState(false);
  const [notice, setNotice] = useState("");

  const refreshState = useCallback(async (targetRepo?: string, policy: ForgeCostPolicy = costPolicy) => {
    try {
      const sess = await connectForge();
      setConnected(true);
      setConnError("");
      const resolvedRepo = (targetRepo ?? repoPath) || sess.defaultRepoRoot;
      if (!repoPath && resolvedRepo) setRepoPath(resolvedRepo);

      const [provRes, runsRes, memRes] = await Promise.all([
        getForgeProviders(policy, resolvedRepo),
        listForgeRuns(resolvedRepo),
        getForgeMemory(resolvedRepo),
      ]);
      setHardware(provRes.hardware);
      setProviders(provRes.providers);
      setRuns(runsRes.runs);
      setMemory(memRes.memory);
      setActiveRun((cur) => {
        if (cur) {
          const updated = runsRes.runs.find((r) => r.id === cur.id);
          return updated || cur;
        }
        return runsRes.runs[0] || null;
      });
    } catch (e) {
      setConnected(false);
      setConnError(e instanceof Error ? e.message : "Nie można połączyć z lokalnym serwerem JARVIS Forge.");
    }
  }, [costPolicy, repoPath]);

  useEffect(() => {
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeRunId = activeRun?.id;
  const activeRunRepo = activeRun?.repoRoot;
  const activeRunStatus = activeRun?.status;

  // Żywa subskrypcja SSE dla aktywnego zadania + fallback polling co 3 s
  useEffect(() => {
    if (!connected || !activeRunId || !isRunActive(activeRunStatus)) return;
    const unsub = subscribeForgeRun(activeRunId, activeRunRepo, (nextState) => {
      setActiveRun(nextState);
      setRuns((prev) => [nextState, ...prev.filter((r) => r.id !== nextState.id)]);
    });
    const timer = setInterval(() => {
      void getForgeRun(activeRunId, activeRunRepo)
        .then((r) => {
          setActiveRun(r.run);
          setRuns((prev) => [r.run, ...prev.filter((item) => item.id !== r.run.id)]);
          if (!isRunActive(r.run.status)) {
            void getForgeMemory(r.run.repoRoot).then((m) => setMemory(m.memory)).catch(() => {});
          }
        })
        .catch(() => {});
    }, 3000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [connected, activeRunId, activeRunRepo, activeRunStatus]);

  const readyCount = providers.filter((p) => p.status === "ready").length;

  const handleLaunch = async (overrideGoal?: string) => {
    const g = (overrideGoal ?? goal).trim();
    if (!g || launching) return;
    if (overrideGoal) setGoal(overrideGoal);
    setLaunching(true);
    setNotice("");
    try {
      const started = await startAutopilotRun({
        goal: g,
        repoPath: repoPath.trim() || undefined,
        costPolicy,
      });
      if (started.run) {
        setActiveRun(started.run);
        setRuns((prev) => [started.run as ForgeRunState, ...prev.filter((r) => r.id !== started.run?.id)]);
      } else if (started.runId) {
        const fetched = await getForgeRun(started.runId, repoPath.trim() || undefined);
        setActiveRun(fetched.run);
      }
      if (started.status === "waiting_approval") {
        setNotice("Autopilot zatrzymał misję przed wykonaniem — sprawdź kartę decyzji poniżej.");
      } else if (started.status === "blocked") {
        setNotice("Brak dostępnego darmowego modelu (0 USD). Jarvis nie uruchomił płatnego API.");
      }
      setTab("mission");
      setGoal("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Nie udało się uruchomić Autopilota.");
    } finally {
      setLaunching(false);
    }
  };

  const handleDecision = async (decision: "approve" | "reject") => {
    if (!activeRun || deciding) return;
    setDeciding(true);
    setNotice("");
    try {
      const res = await decideAutopilotRun({
        runId: activeRun.id,
        decision,
        repoPath: activeRun.repoRoot,
        costPolicy,
      });
      if (res.run) {
        setActiveRun(res.run);
        setRuns((prev) => [res.run as ForgeRunState, ...prev.filter((r) => r.id !== res.run?.id)]);
      } else {
        const fetched = await getForgeRun(activeRun.id, activeRun.repoRoot).catch(() => null);
        if (fetched) setActiveRun(fetched.run);
      }
      setNotice(
        decision === "approve"
          ? "Zatwierdzono — Autopilot wznawia wykonanie zadania."
          : "Odrzucono — zadanie zostało bezpiecznie zablokowane bez zmian w kodzie.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Nie udało się zapisać decyzji.");
    } finally {
      setDeciding(false);
    }
  };

  const handlePause = async () => {
    if (!activeRun) return;
    await pauseForgeRun(activeRun.id, activeRun.repoRoot);
    setNotice("Zlecono wstrzymanie — bieżący krok zapisze checkpoint.");
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    await cancelForgeRun(activeRun.id, activeRun.repoRoot);
    setNotice("Wysłano sygnał przerwania (Kill-Switch).");
  };

  const handleResume = async () => {
    if (!activeRun) return;
    setNotice("Wznawiam zadanie od ostatniego checkpointu…");
    await resumeForgeRun(activeRun.id, activeRun.repoRoot, costPolicy);
    const updated = await getForgeRun(activeRun.id, activeRun.repoRoot).catch(() => null);
    if (updated) setActiveRun(updated.run);
  };

  const handleRollback = async () => {
    if (!activeRun) return;
    const res = await rollbackForgeRunClient(activeRun.id, activeRun.repoRoot);
    setNotice(`Wycofano zmiany: przywrócono ${res.rollback.restoredCount} plik(ów).`);
    const updated = await getForgeRun(activeRun.id, activeRun.repoRoot).catch(() => null);
    if (updated) setActiveRun(updated.run);
  };

  const activeBusy = isRunActive(activeRun?.status);
  const needsUserDecision = Boolean(
    activeRun && (activeRun.status === "waiting_approval" || activeRun.pendingDecision?.required),
  );
  const passedTestsCount = (activeRun?.testResults || []).filter((t) => t.ok).length;
  const totalTestsCount = (activeRun?.testResults || []).length;
  const attemptsList = activeRun?.attemptHistory || [];
  const verdictLabel = activeRun?.verdict || (
    activeRun?.status === "completed"
      ? "PASS"
      : activeRun?.status === "waiting_approval"
        ? "WAITING_APPROVAL"
        : activeRun?.status === "paused"
          ? "PAUSED"
          : activeRun?.status === "blocked"
            ? "BLOCKED"
            : null
  );

  return (
    <Modal
      title="⚒ Jarvis Autopilot (Forge)"
      ariaLabel="Jarvis Autopilot — autonomiczny wykonawca zadań programistycznych"
      className="panel-wide forge-panel"
      onClose={onClose}
      foot={
        <div className="forge-foot-row">
          <span className="muted" style={{ fontSize: 12 }}>
            {connected
              ? `Autopilot gotowy · ${readyCount} darmowych modeli · Koszt: $0.00`
              : "Lokalny silnik Forge offline"}
          </span>
          <button type="button" className="btn" style={{ width: "auto", marginTop: 0 }} onClick={onClose}>
            Zamknij
          </button>
        </div>
      }
    >
      {/* Proste zakładki bez szumu */}
      <div className="forge-tabs" role="tablist" aria-label="Widoki Jarvis Autopilot">
        <button type="button" role="tab" aria-selected={tab === "mission"} className={`menu-filter-pill ${tab === "mission" ? "on" : ""}`} onClick={() => setTab("mission")}>
          ⚡ Autopilot
        </button>
        <button type="button" role="tab" aria-selected={tab === "memory"} className={`menu-filter-pill ${tab === "memory" ? "on" : ""}`} onClick={() => setTab("memory")}>
          🧠 Modele i pamięć ({readyCount})
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={`menu-filter-pill ${tab === "history" ? "on" : ""}`} onClick={() => setTab("history")}>
          🕘 Historia ({runs.length})
        </button>
      </div>

      {!connected && (
        <div className="forge-card forge-warn">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Lokalny silnik Jarvis Forge nie jest uruchomiony</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            {connError || "Uruchom lokalnego towarzysza jednym poleceniem (w aplikacji desktopowej Electron startuje automatycznie):"}
          </div>
          <div className="forge-code-line">
            <code>npm run forge:server</code>
            <button type="button" className="btn primary" style={{ width: "auto", marginTop: 0, minHeight: 44, padding: "6px 14px" }} onClick={() => void refreshState()}>
              ↻ Połącz ponownie
            </button>
          </div>
        </div>
      )}

      {tab === "mission" && (
        <>
          {/* ZERO-CONFIG: JEDNO POLECENIE -> PEŁNA AUTONOMIA */}
          <div className="forge-card forge-hero">
            <label htmlFor="forge-goal-input" className="forge-hero-label">
              Co mam zbudować, naprawić lub ulepszyć?
            </label>
            <textarea
              id="forge-goal-input"
              className="ta forge-goal-ta"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Wpisz jedno polecenie — Autopilot sam oceni trudność, dobierze darmowy model i zespół, wprowadzi zmiany, uruchomi testy i zweryfikuje wynik…"
              disabled={launching}
            />
            <div className="forge-hero-controls">
              <button
                type="button"
                className="btn primary"
                style={{ width: "auto", marginTop: 0, minHeight: 44, padding: "8px 20px" }}
                disabled={!connected || launching || !goal.trim()}
                onClick={() => void handleLaunch()}
              >
                {launching ? "⏳ Planuję i uruchamiam…" : "▶ Uruchom Autopilot"}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                Tryb automatyczny · <b>0 USD</b> · bez ręcznej konfiguracji
              </span>
              <button
                type="button"
                className="chip"
                style={{ marginLeft: "auto" }}
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Ukryj opcje" : "⚙ Opcje"}
              </button>
            </div>

            {showAdvanced && (
              <div className="forge-hero-controls" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
                <input
                  type="text"
                  className="inp forge-repo-inp"
                  aria-label="Katalog repozytorium"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="Ścieżka repozytorium (domyślnie bieżące)"
                />
                <button
                  type="button"
                  className="chip"
                  title="Przełącz politykę kosztu (zawsze $0.00)"
                  onClick={() => {
                    const next: ForgeCostPolicy = costPolicy === "zero_cost" ? "local_only" : "zero_cost";
                    setCostPolicy(next);
                    void refreshState(repoPath, next);
                  }}
                >
                  {costPolicy === "zero_cost" ? "🛡 0 USD (Lokalny + Darmowe API)" : "💻 Tylko lokalnie (Ollama)"}
                </button>
              </div>
            )}

            {!activeRun && (
              <div className="chips" style={{ flexWrap: "wrap", marginTop: 8 }}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => setGoal(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          {notice && <p className="notice" role="status">ℹ {notice}</p>}

          {activeRun && (
            <div className="forge-mission-grid">
              {/* 6. KARTA DECYZJI UŻYTKOWNIKA — widoczna natychmiast gdy potrzebna jest decyzja */}
              {needsUserDecision && activeRun.pendingDecision && (
                <div className="forge-card forge-decision-card" role="alert" data-testid="autopilot-decision-card">
                  <div className="forge-row-between">
                    <div className="forge-kicker" style={{ color: "#f59e0b" }}>⚠ WYMAGANA DECYZJA UŻYTKOWNIKA</div>
                    <span className="forge-badge forge-status-waiting_approval">
                      {activeRun.pendingDecision.kind}
                    </span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 4 }}>{activeRun.pendingDecision.title}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{activeRun.pendingDecision.reason}</div>

                  {activeRun.pendingDecision.triggers && activeRun.pendingDecision.triggers.length > 0 && (
                    <div className="forge-pill-row">
                      {activeRun.pendingDecision.triggers.map((t, idx) => (
                        <span key={`${t.kind}-${idx}`} className="forge-pill">
                          🛡 {t.label}: <code>{t.match}</code>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="forge-actions-row">
                    {activeRun.status === "waiting_approval" && activeRun.pendingDecision.kind !== "budget_escalation" && (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: "auto", marginTop: 0, minHeight: 44 }}
                        disabled={deciding}
                        onClick={() => void handleDecision("approve")}
                      >
                        {deciding ? "⏳ Przetwarzam…" : "✅ Zatwierdź i wykonaj"}
                      </button>
                    )}
                    {activeRun.status === "waiting_approval" && (
                      <button
                        type="button"
                        className="btn"
                        style={{ width: "auto", marginTop: 0, minHeight: 44 }}
                        disabled={deciding}
                        onClick={() => void handleDecision("reject")}
                      >
                        🛑 Odrzuć operację
                      </button>
                    )}
                    {activeRun.status !== "waiting_approval" && (activeRun.pendingDecision.kind === "time_limit" || activeRun.pendingDecision.kind === "iteration_limit" || activeRun.pendingDecision.kind === "iteration_or_repair_limit") && (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ width: "auto", marginTop: 0, minHeight: 44 }}
                        onClick={() => void handleResume()}
                      >
                        ▶ Kontynuuj z checkpointu
                      </button>
                    )}
                    {(activeRun.pendingDecision.kind === "no_free_provider" || activeRun.pendingDecision.kind === "budget_limit") && (
                      <button
                        type="button"
                        className="btn"
                        style={{ width: "auto", marginTop: 0, minHeight: 44 }}
                        onClick={() => setTab("memory")}
                      >
                        🧠 Zobacz dostępne modele
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* 1. CO JARVIS ROBI + 2. MODEL & ZESPÓŁ + 3. POSTĘP I LIMITY */}
              <div className="forge-card">
                <div className="forge-row-between">
                  <div>
                    <div className="forge-kicker">AKTUALNE ZADANIE</div>
                    <div className="forge-goal-title">{activeRun.goal}</div>
                  </div>
                  <span className={`forge-badge forge-status-${activeRun.status}`}>
                    {PHASE_LABEL[activeRun.status] || activeRun.status}
                  </span>
                </div>

                <div className="forge-progress-wrap" aria-label="Postęp zadania">
                  <div className="forge-progress-bar" style={{ width: `${Math.max(4, activeRun.progressPct)}%` }} />
                </div>

                <div className="forge-meta-strip">
                  <span><b>Co robi:</b> {PHASE_LABEL[activeRun.phase] || activeRun.phase}</span>
                  <span><b>Postęp:</b> {activeRun.progressPct}% ({activeRun.iteration}/{activeRun.maxIterations} kroków)</span>
                  <span><b>Limit czasu:</b> {formatDurationLimit(activeRun.maxDurationMs)}</span>
                  <span><b>Koszt:</b> $0.00{activeRun.budgetSnapshot ? ` (kredyty: $${activeRun.budgetSnapshot.experimentSpentUsd})` : ""}</span>
                  <span><b>Decyzja użytkownika:</b> {needsUserDecision ? "⚠ TAK" : "Nie wymagana"}</span>
                </div>

                {/* Aktywny model, poziom inteligencji i zespół */}
                <div className="forge-executor-box">
                  <div>
                    <span className="forge-kicker">MODEL I ZESPÓŁ:</span>{" "}
                    <b>{activeRun.activeRole}</b> →{" "}
                    <code>{activeRun.activeExecutor ? `${activeRun.activeExecutor.provider}/${activeRun.activeExecutor.model}` : "automatyczny"}</code>
                  </div>
                  <div className="forge-pill-row">
                    {activeRun.difficulty && (
                      <span className="forge-pill">
                        Trudność: <b>{DIFFICULTY_LABEL[activeRun.difficulty.level] || activeRun.difficulty.level}</b> ({activeRun.difficulty.score}/100)
                      </span>
                    )}
                    {activeRun.activeIntelligenceTier && (
                      <span className="forge-pill">
                        {TIER_LABEL[activeRun.activeIntelligenceTier] || activeRun.activeIntelligenceTier}
                      </span>
                    )}
                    {activeRun.teamComposition && (
                      <span className="forge-pill">
                        {TEAM_LABEL[activeRun.teamComposition.teamPattern] || activeRun.teamComposition.teamPattern}
                      </span>
                    )}
                    {activeRun.worktreePath && (
                      <span className="forge-pill">🌿 Izolowany git worktree</span>
                    )}
                    {(activeRun.resumedCount || 0) > 0 && (
                      <span className="forge-pill">♻ Wznowiono z checkpointu ×{activeRun.resumedCount}</span>
                    )}
                  </div>
                </div>

                <div className="forge-actions-row">
                  {activeBusy && (
                    <>
                      <button type="button" className="btn" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => void handlePause()}>⏸ Pauza (checkpoint)</button>
                      <button type="button" className="btn" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => void handleCancel()}>⏹ Przerwij</button>
                    </>
                  )}
                  {!activeBusy && (activeRun.status === "paused" || activeRun.status === "blocked") && (
                    <button type="button" className="btn primary" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => void handleResume()}>
                      ▶ Wznów z checkpointu
                    </button>
                  )}
                  {!activeBusy && activeRun.modifiedFiles.length > 0 && !activeRun.rolledBackAt && (
                    <button type="button" className="btn" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => void handleRollback()}>
                      ↩ Cofnij zmiany ({activeRun.modifiedFiles.length})
                    </button>
                  )}
                </div>
              </div>

              {/* 7. JASNY WERDYKT KOŃCOWY */}
              {activeRun.finalResult && (
                <div className={`forge-card ${activeRun.status === "completed" ? "forge-ok" : "forge-warn"}`} data-testid="autopilot-verdict-card">
                  <div className="forge-row-between">
                    <div className="forge-kicker">WYNIK KOŃCOWY</div>
                    {verdictLabel && (
                      <span className={`forge-badge forge-status-${activeRun.status}`}>
                        {verdictLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 4 }}>{activeRun.finalResult}</div>
                  {activeRun.review && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Recenzja: <b>{activeRun.review.reviewer}</b>{" "}
                      {activeRun.review.independentModelReviewed ? "(niezależny cross-model ✓)" : "(weryfikacja pomocnicza)"} · Sekrety: {activeRun.review.secretScanClean ? "czysto ✓" : "UWAGA ⚠"} · {activeRun.review.summary}
                    </div>
                  )}
                  {attemptsList.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="chip" onClick={() => setShowAttempts((v) => !v)}>
                        {showAttempts ? "Ukryj historię prób" : `Historia prób i zmian strategii (${attemptsList.length})`}
                      </button>
                      {showAttempts && (
                        <div className="forge-list" style={{ marginTop: 6 }}>
                          {attemptsList.map((att) => (
                            <div key={`${att.attempt}-${att.at}`} className="forge-list-item">
                              <span>
                                {att.ok ? "✅" : "❌"} Próba #{att.attempt} · strategia <code>{att.strategy}</code> · tier <code>{att.tier}</code> · <code>{att.provider}/{att.model}</code>
                              </span>
                              <span className="muted" style={{ fontSize: 11.5 }}>
                                testy {att.testsPassed}/{att.testsTotal}{att.errorSignature ? ` · ${att.errorSignature}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 4. ZMIENIANE PLIKI */}
              <div className="forge-card">
                <div className="forge-kicker">ZMIENIANE PLIKI ({activeRun.modifiedFiles.length})</div>
                {activeRun.modifiedFiles.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Żaden plik nie został jeszcze zmodyfikowany.</p>
                ) : (
                  <div className="forge-list">
                    {activeRun.modifiedFiles.map((f) => (
                      <div key={f.path} className="forge-subcard">
                        <div className="forge-row-between">
                          <span>
                            <b>{f.path}</b>{" "}
                            <span className="muted">({f.action} · składnia: {f.syntaxOk ? "OK ✓" : "BŁĄD ⚠"})</span>
                          </span>
                          {f.diff && (
                            <button type="button" className="chip" onClick={() => setExpandedDiff((p) => ({ ...p, [f.path]: !p[f.path] }))}>
                              {expandedDiff[f.path] ? "Ukryj diff" : "Pokaż diff"}
                            </button>
                          )}
                        </div>
                        {expandedDiff[f.path] && f.diff && (
                          <pre className="forge-pre">{f.diff}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. WYKONYWANE TESTY */}
              <div className="forge-card">
                <div className="forge-kicker">WYKONYWANE TESTY ({passedTestsCount}/{totalTestsCount} PASS)</div>
                {activeRun.testResults.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Testy uruchomią się automatycznie po wprowadzeniu zmian.</p>
                ) : (
                  <div className="forge-list">
                    {activeRun.testResults.map((t, idx) => {
                      const key = `${t.command}-${idx}`;
                      return (
                        <div key={key} className="forge-subcard">
                          <div className="forge-row-between">
                            <span>{t.ok ? "✅" : "❌"} <code>{t.command}</code> <span className="muted">(exit {t.code}, {t.durationMs} ms)</span></span>
                            <button type="button" className="chip" onClick={() => setExpandedTest((p) => ({ ...p, [key]: !p[key] }))}>
                              {expandedTest[key] ? "Ukryj log" : "Pokaż log"}
                            </button>
                          </div>
                          {expandedTest[key] && (
                            <pre className="forge-pre">{t.output || "(brak wyjścia)"}</pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ETAPY / PLAN PRACY */}
              {activeRun.plan.length > 0 && (
                <div className="forge-card">
                  <div className="forge-kicker">ETAPY PRACY ({activeRun.plan.length})</div>
                  <div className="forge-list">
                    {activeRun.plan.map((s) => (
                      <div key={s.id} className="forge-list-item">
                        <span>{STEP_ICON[s.status] || "○"} <b>{s.id}.</b> {s.title}</span>
                        <span className="muted" style={{ fontSize: 11.5 }}>{s.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OSTATNIE DZIAŁANIA (zwięzły dziennik bez szumu) */}
              {activeRun.recentActions.length > 0 && (
                <div className="forge-card">
                  <div className="forge-kicker">DZIENNIK DZIAŁAŃ ({activeRun.recentActions.length})</div>
                  <div className="forge-log">
                    {activeRun.recentActions.slice(0, 12).map((a, idx) => (
                      <div key={`${a.at}-${idx}`} className="forge-log-row">
                        <span className="muted num-tab">{a.at.slice(11, 19)}</span>
                        <span className="forge-role-tag">{a.role}</span>
                        <span>{a.ok ? "•" : "⚠"} {a.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "memory" && (
        <div className="forge-mission-grid">
          {hardware && (
            <div className="forge-card">
              <div className="forge-kicker">WYKRYTY SPRZĘT I STRATEGIA LOKALNA</div>
              <div style={{ fontSize: 13 }}>
                <b>{hardware.cpuCores} vCPU</b> · <b>{hardware.totalRamGb} GB RAM</b> ({hardware.freeRamGb} GB wolne) ·{" "}
                <b>GPU:</b> {hardware.gpu ? `${hardware.gpu.name} (${hardware.gpu.vramGb} GB VRAM)` : "brak"} · profil <code>{hardware.tier}</code>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{hardware.localStrategy}</div>
            </div>
          )}

          <div className="forge-card">
            <div className="forge-kicker">DOSTĘPNE MODELE ({costPolicy}) — ADAPTIVE INTELLIGENCE</div>
            <div className="forge-list">
              {providers.map((p) => (
                <div key={p.id} className="forge-subcard">
                  <div className="forge-row-between">
                    <span>
                      {p.status === "ready" ? "🟢" : p.status === "blocked_by_policy" ? "🛡" : "⚪"}{" "}
                      <b>{p.label}</b> · <code>{p.defaultModel}</code>
                    </span>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {p.costTier}{p.learnedScore !== null ? ` · skuteczność ${Math.round(p.learnedScore * 100)}%` : ""}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {p.statusReason} · {p.limitsNote}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {memory && (
            <div className="forge-card">
              <div className="forge-kicker">
                PAMIĘĆ PROJEKTU I DOŚWIADCZEŃ ({memory.lessons.length} lekcji · {memory.failedAttempts.length} nieudanych prób · {memory.decisions.length} decyzji)
              </div>
              {memory.lessons.length === 0 && memory.decisions.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  Pamięć wypełnia się automatycznie po każdym zweryfikowanym uruchomieniu oraz czyta ADR-y z <code>project-memory/</code>.
                </p>
              ) : (
                <div className="forge-list">
                  {memory.lessons.slice(0, 8).map((l) => (
                    <div key={l.id} className="forge-subcard">
                      <div><b>✅ [{l.id}]</b> {l.fixSummary}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>Błąd: {l.errorSummary.slice(0, 140)} · utility {Math.round(l.utilityScore * 100)}%</div>
                    </div>
                  ))}
                  {memory.decisions.slice(0, 5).map((d) => (
                    <div key={d.id} className="forge-subcard">
                      <div><b>📌 {d.title}</b></div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{d.rationale} · dowód: {d.testEvidence}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="forge-card">
          <div className="forge-kicker">HISTORIA ZADAŃ I CHECKPOINTÓW ({runs.length})</div>
          {runs.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>Brak zapisanych zadań dla tego repozytorium.</p>
          ) : (
            <div className="forge-list">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="forge-history-btn"
                  onClick={() => { setActiveRun(r); setTab("mission"); }}
                >
                  <div className="forge-row-between" style={{ width: "100%" }}>
                    <strong>{r.goal}</strong>
                    <span className={`forge-badge forge-status-${r.status}`}>{PHASE_LABEL[r.status] || r.status}</span>
                  </div>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {r.id} · {r.progressPct}% · pliki: {r.modifiedFiles.length} · testy: {r.testResults.filter((t) => t.ok).length}/{r.testResults.length}
                    {r.pendingDecision?.required ? " · ⚠ DECYZJA" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
