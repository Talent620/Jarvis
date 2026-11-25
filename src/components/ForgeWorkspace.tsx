// === JARVIS FORGE — Proste, profesjonalne centrum autonomicznego programowania ===
// Jedno główne polecenie („Co mam zbudować, naprawić lub ulepszyć?"), zero narzutu konfiguracji,
// pełna widoczność celu, planu, etapu, wykonawcy, postępu, działań, testów, diffów, blokad i rezultatu.
// Używa kanonicznego <Modal> (focus-trap, ARIA, Escape) i zachowuje zgodność ES2019 (Chrome 79 / S9).

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import {
  cancelForgeRun,
  connectForge,
  getForgeMemory,
  getForgeProviders,
  getForgeRun,
  listForgeRuns,
  pauseForgeRun,
  resumeForgeRun,
  rollbackForgeRunClient,
  startForgeRun,
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
  planning: "Planowanie (Architect)",
  executing: "Implementacja (Developer)",
  verifying: "Weryfikacja testami",
  debugging: "Debugowanie i samonaprawa",
  reviewing: "Niezależna recenzja",
  completed: "Ukończono i zweryfikowano",
  paused: "Wstrzymano (checkpoint zapisany)",
  blocked: "Zablokowano — wymaga uwagi",
  failed: "Błąd wykonania",
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
  "Zrefaktoryzuj obsługę błędów sieciowych z zachowaniem 100% testów",
];

function isRunActive(status?: string): boolean {
  return status === "queued" || status === "scouting" || status === "planning"
    || status === "executing" || status === "verifying" || status === "debugging" || status === "reviewing";
}

export default function ForgeWorkspace({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"mission" | "memory" | "history">("mission");
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [goal, setGoal] = useState("");
  const [costPolicy, setCostPolicy] = useState<ForgeCostPolicy>("zero_cost");
  const [launching, setLaunching] = useState(false);

  const [hardware, setHardware] = useState<ForgeHardwareProfile | null>(null);
  const [providers, setProviders] = useState<ForgeProviderStatus[]>([]);
  const [memory, setMemory] = useState<ForgeMemorySnapshot | null>(null);
  const [runs, setRuns] = useState<ForgeRunState[]>([]);
  const [activeRun, setActiveRun] = useState<ForgeRunState | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<Record<string, boolean>>({});
  const [expandedTest, setExpandedTest] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");

  const refreshState = useCallback(async (targetRepo?: string, policy: ForgeCostPolicy = costPolicy) => {
    try {
      const sess = await connectForge();
      setConnected(true);
      setConnError("");
      const resolvedRepo = (targetRepo ?? repoPath) || sess.defaultRepoRoot;
      if (!repoPath && resolvedRepo) setRepoPath(resolvedRepo);

      const [provRes, runsRes, memRes] = await Promise.all([
        getForgeProviders(policy),
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

  // Żywa subskrypcja SSE dla aktywnego zadania + lekki fallback polling co 3 s
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
      const started = await startForgeRun({ goal: g, repoPath: repoPath.trim() || undefined, costPolicy });
      if (started.run) {
        setActiveRun(started.run);
        setRuns((prev) => [started.run as ForgeRunState, ...prev.filter((r) => r.id !== started.run?.id)]);
      } else if (started.runId) {
        const fetched = await getForgeRun(started.runId, repoPath.trim() || undefined);
        setActiveRun(fetched.run);
      }
      setTab("mission");
      setGoal("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Nie udało się uruchomić zadania.");
    } finally {
      setLaunching(false);
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

  return (
    <Modal
      title="⚒ Jarvis Forge"
      ariaLabel="Jarvis Forge — autonomiczne środowisko programistyczne"
      className="panel-wide forge-panel"
      onClose={onClose}
      foot={
        <div className="forge-foot-row">
          <span className="muted" style={{ fontSize: 12 }}>
            {connected
              ? `Połączono · ${readyCount} gotowych modeli (${costPolicy === "zero_cost" ? "0 USD" : costPolicy})`
              : "Lokalny silnik Forge offline"}
          </span>
          <button type="button" className="btn" style={{ width: "auto", marginTop: 0 }} onClick={onClose}>
            Zamknij
          </button>
        </div>
      }
    >
      {/* Zakładki robocze — maksymalna prostota */}
      <div className="forge-tabs" role="tablist" aria-label="Widoki Jarvis Forge">
        <button type="button" role="tab" aria-selected={tab === "mission"} className={`menu-filter-pill ${tab === "mission" ? "on" : ""}`} onClick={() => setTab("mission")}>
          ⚡ Zadanie
        </button>
        <button type="button" role="tab" aria-selected={tab === "memory"} className={`menu-filter-pill ${tab === "memory" ? "on" : ""}`} onClick={() => setTab("memory")}>
          🧠 Pamięć i modele ({readyCount})
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
          {/* JEDNO GŁÓWNE POLECENIE */}
          <div className="forge-card forge-hero">
            <label htmlFor="forge-goal-input" className="forge-hero-label">
              Co mam zbudować, naprawić lub ulepszyć?
            </label>
            <textarea
              id="forge-goal-input"
              className="ta forge-goal-ta"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Opisz konkretny cel inżynierski — Forge sam zbada repozytorium, zaplanuje kroki, dobierze darmowy/lokalny model, napisze kod, uruchomi testy i zweryfikuje wynik…"
              disabled={launching}
            />
            <div className="forge-hero-controls">
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
                title="Przełącz politykę kosztu"
                onClick={() => {
                  const next: ForgeCostPolicy = costPolicy === "zero_cost" ? "local_only" : "zero_cost";
                  setCostPolicy(next);
                  void refreshState(repoPath, next);
                }}
              >
                {costPolicy === "zero_cost" ? "🛡 Tryb 0 USD (Local + Free API)" : "💻 Tylko lokalnie (Ollama)"}
              </button>
              <button
                type="button"
                className="btn primary"
                style={{ width: "auto", marginTop: 0, minHeight: 44, padding: "8px 18px" }}
                disabled={!connected || launching || !goal.trim()}
                onClick={() => void handleLaunch()}
              >
                {launching ? "⏳ Uruchamiam…" : "▶ Uruchom Forge"}
              </button>
            </div>
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

          {/* WIDOK AKTYWNEGO / OSTATNIEGO ZADANIA — 10 WYMAGANYCH ELEMENTÓW */}
          {activeRun && (
            <div className="forge-mission-grid">
              {/* 1. Aktualny cel, 3. Aktualny etap, 4. Wykonawca, 5. Postęp */}
              <div className="forge-card">
                <div className="forge-row-between">
                  <div>
                    <div className="forge-kicker">1. AKTUALNY CEL</div>
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
                  <span><b>Etap:</b> {PHASE_LABEL[activeRun.phase] || activeRun.phase}</span>
                  <span><b>Postęp:</b> {activeRun.progressPct}% (iteracja {activeRun.iteration}/{activeRun.maxIterations})</span>
                  <span><b>Strategia:</b> <code>{activeRun.strategy}</code></span>
                </div>

                {activeRun.activeExecutor && (
                  <div className="forge-executor-box">
                    <span className="forge-kicker">WYKONAWCA:</span>{" "}
                    <b>{activeRun.activeRole}</b> → <code>{activeRun.activeExecutor.provider}/{activeRun.activeExecutor.model}</code>{" "}
                    <span className="muted">
                      ({activeRun.activeExecutor.costTier === "local" || activeRun.activeExecutor.costTier === "free_api" ? "$0.00" : activeRun.activeExecutor.costTier} · {activeRun.activeExecutor.reason})
                    </span>
                  </div>
                )}

                <div className="forge-actions-row">
                  {activeBusy && (
                    <>
                      <button type="button" className="btn" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => void handlePause()}>⏸ Pauza</button>
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

              {/* 10. Końcowy rezultat & Recenzja */}
              {activeRun.finalResult && (
                <div className={`forge-card ${activeRun.status === "completed" ? "forge-ok" : "forge-warn"}`}>
                  <div className="forge-kicker">KOŃCOWY REZULTAT</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{activeRun.finalResult}</div>
                  {activeRun.review && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Recenzent: <b>{activeRun.review.reviewer}</b> · Sekrety: {activeRun.review.secretScanClean ? "czysto ✓" : "UWAGA ⚠"} · {activeRun.review.summary}
                    </div>
                  )}
                </div>
              )}

              {/* 2. Plan pracy */}
              <div className="forge-card">
                <div className="forge-kicker">PLAN PRACY ({activeRun.plan.length} kroków)</div>
                {activeRun.plan.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Plan w trakcie przygotowania przez Architecta…</p>
                ) : (
                  <div className="forge-list">
                    {activeRun.plan.map((s) => (
                      <div key={s.id} className="forge-list-item">
                        <span>{STEP_ICON[s.status] || "○"} <b>{s.id}.</b> {s.title}</span>
                        <span className="muted" style={{ fontSize: 11.5 }}>{s.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 7. Wyniki testów */}
              <div className="forge-card">
                <div className="forge-kicker">WYNIKI TESTÓW I WERYFIKACJI ({activeRun.testResults.length})</div>
                {activeRun.testResults.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Brak uruchomionych komend weryfikacyjnych na tym etapie.</p>
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

              {/* 8. Zmodyfikowane pliki + podgląd diffu */}
              <div className="forge-card">
                <div className="forge-kicker">ZMODYFIKOWANE PLIKI ({activeRun.modifiedFiles.length})</div>
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

              {/* 9. Problemy i blokady */}
              <div className="forge-card">
                <div className="forge-kicker">PROBLEMY I BLOKADY ({activeRun.problems.length})</div>
                {activeRun.problems.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>Brak zgłoszonych błędów ani blokad.</p>
                ) : (
                  <div className="forge-list">
                    {activeRun.problems.map((p, idx) => (
                      <div key={`${p.at}-${idx}`} className="forge-list-item">
                        <span>
                          {p.severity === "blocker" ? "🛑" : p.severity === "error" ? "⚠" : "ℹ"} {p.message}
                          {p.strategyPivot ? <span className="muted"> · zmiana strategii → <code>{p.strategyPivot}</code></span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. Ostatnie działania */}
              <div className="forge-card">
                <div className="forge-kicker">OSTATNIE DZIAŁANIA ({activeRun.recentActions.length})</div>
                <div className="forge-log">
                  {activeRun.recentActions.slice(0, 18).map((a, idx) => (
                    <div key={`${a.at}-${idx}`} className="forge-log-row">
                      <span className="muted num-tab">{a.at.slice(11, 19)}</span>
                      <span className="forge-role-tag">{a.role}</span>
                      <span>{a.ok ? "•" : "⚠"} {a.text}</span>
                    </div>
                  ))}
                </div>
              </div>
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
            <div className="forge-kicker">PULA DOSTAWCÓW AI ({costPolicy}) — WYMIENIALNE MODELE</div>
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
                PAMIĘĆ DOŚWIADCZEŃ ({memory.lessons.length} zweryfikowanych lekcji · {memory.failedAttempts.length} nieudanych prób · {memory.decisions.length} decyzji)
              </div>
              {memory.lessons.length === 0 && memory.decisions.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>
                  Pamięć wypełnia się automatycznie po każdym zweryfikowanym uruchomieniu (FAIL → PASS) oraz decyzji architektonicznej.
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
