// === Panel celu (autonomia) — co JARVIS prowadzi i na jakim etapie ===
// Pokazuje TRWAŁE cele (goalState/IndexedDB): postęp, kroki z realnym statusem, oczekujące zgody i
// ostatni potwierdzony wynik — bez chain-of-thought. Użytkownik może cel Zatrzymać, Wznowić lub
// Anulować (zmiany utrwalane). Autonomia JARVIS-a jest widoczna i kontrolowalna. Lekki, czytelny na S9.

import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { isGoalRunning, requestGoalPause } from "../lib/goalControl";
import { loadGoalsNewestFirst, resumeAndRunGoal } from "../lib/goalRuntime";
import { pauseGoal, removeGoal, upsertGoal, describeGoal, type GoalRecord, type GoalStatus } from "../lib/goalState";
import { outcomeIcon, outcomeLabel } from "../lib/actionOutcome";
import { emptyStateSuggestion } from "../lib/simpleFlow";

const STATUS_LABEL: Record<GoalStatus, string> = {
  queued: "w kolejce", running: "w toku", waiting_consent: "czeka na zgodę",
  waiting_user: "czeka na sprawdzenie", paused: "wstrzymany", completed: "ukończony", failed: "nieudany",
};
const canStop = (s: GoalStatus) => s === "running" || s === "queued" || s === "waiting_consent" || s === "waiting_user";

export default function GoalStatusPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resumeMsg, setResumeMsg] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = () => { setLoading(true); void loadGoalsNewestFirst().then((g) => { setGoals(g); setLoading(false); }); };
  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, []);

  const now = () => Date.now();
  const doPause = async (g: GoalRecord) => {
    if (requestGoalPause(g.id)) {
      setResumeMsg("Pauza zlecona — bieżący krok może się zakończyć, kolejne nie ruszą.");
      return;
    }
    await upsertGoal(pauseGoal(g, now())); load();
  };
  const doCancel = async (g: GoalRecord) => { if (isGoalRunning(g.id)) { setResumeMsg("Najpierw wstrzymaj i zaczekaj na zakończenie bieżącego kroku."); return; } await removeGoal(g.id); load(); };
  // Wznów i DOKOŃCZ — dograj pozostałe kroki (pomijając potwierdzone, bez podwójnych działań).
  const doResume = async (g: GoalRecord) => {
    setBusyId(g.id); setResumeMsg("");
    try {
      const { result } = await resumeAndRunGoal(g, { now: now(), onStatus: (s) => setResumeMsg(s) });
      setResumeMsg(result.verdict.summary);
    } catch (e) {
      setResumeMsg(e instanceof Error ? e.message : "błąd wznowienia");
    } finally { setBusyId(null); load(); }
  };
  const canResume = (s: GoalStatus) => s === "paused" || s === "waiting_consent" || s === "waiting_user" || s === "failed";

  const empty = emptyStateSuggestion("leads");

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🎯 Cele — co JARVIS prowadzi</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Trwałe cele przeżywają zamknięcie aplikacji. Widzisz postęp, kroki i oczekujące zgody —
            możesz zatrzymać, wznowić albo anulować.
          </p>

          {loading && <p className="muted" style={{ fontSize: 12 }}>⏳ Wczytuję cele…</p>}

          {!loading && goals.length === 0 && (
            <div className="row" style={{ borderLeft: "3px solid var(--cyan)", paddingLeft: 10, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <span style={{ fontSize: 14 }}>Brak aktywnych celów. Uruchom działanie z „Planu dnia”, aby JARVIS zaczął prowadzić cel.</span>
              <span className="muted" style={{ fontSize: 12 }}>Sugerowane: {empty.action}</span>
            </div>
          )}

          {goals.map((g) => {
            const steps = g.plan.steps || [];
            const done = steps.filter((s) => g.results[s.id]?.state === "CONFIRMED").length;
            const pending = steps.filter((s) => { const st = g.results[s.id]?.state; return st === "DRAFT" || (s.requiresConsent && st !== "CONFIRMED"); });
            const lastConfirmed = [...steps].reverse().find((s) => g.results[s.id]?.state === "CONFIRMED");
            return (
              <div key={g.id} style={{ border: "1px solid var(--line, #234)", borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{g.goal}</strong>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{STATUS_LABEL[g.status]}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{describeGoal(g)} · {done}/{steps.length} kroków</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {steps.map((s) => (
                    <div key={s.id} style={{ fontSize: 12 }}>
                      {outcomeIcon(g.results[s.id])} {s.intent}
                      {s.requiresConsent && g.results[s.id]?.state !== "CONFIRMED" && <span style={{ color: "var(--gold, #d9a400)" }}> · 🔒 zgoda</span>}
                    </div>
                  ))}
                </div>

                {pending.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--gold, #d9a400)" }}>⏳ Oczekuje: {pending.map((s) => s.intent).join(", ")}</div>
                )}
                {lastConfirmed && (
                  <div style={{ fontSize: 12 }}>✅ Ostatnio potwierdzone: {lastConfirmed.intent}</div>
                )}

                {expanded[g.id] && (
                  <section aria-label="Wyniki zadania" style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}>
                    <strong>Dotychczasowe wyniki</strong>
                    {steps.filter((step) => g.results[step.id]).length === 0 && <p className="muted">Brak zapisanych wyników.</p>}
                    {steps.filter((step) => g.results[step.id]).map((step) => {
                      const result = g.results[step.id];
                      return <div key={step.id} style={{ marginTop: 6, fontSize: 12 }}>
                        <b>{step.intent}</b> · {outcomeLabel(result)}
                        {result.evidence?.message && <div>{result.evidence.message}</div>}
                        {result.evidence?.source && <div className="muted">Źródło: {result.evidence.source}</div>}
                      </div>;
                    })}
                    <p className="muted" style={{ marginBottom: 0 }}>Niepotwierdzone wyniki wymagają sprawdzenia.</p>
                  </section>
                )}
                {resumeMsg && (busyId === g.id || isGoalRunning(g.id)) && <div style={{ fontSize: 12 }}>⏳ {resumeMsg}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button type="button" className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, minHeight: 44 }} aria-expanded={!!expanded[g.id]} onClick={() => setExpanded((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}>{expanded[g.id] ? "Ukryj wyniki" : "Pokaż wyniki"}</button>
                  {canStop(g.status) && (
                    <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, minHeight: 44 }} onClick={() => void doPause(g)}>⏸ Zatrzymaj</button>
                  )}
                  {canResume(g.status) && (
                    <button className="btn primary" style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, minHeight: 44 }} disabled={busyId === g.id} onClick={() => void doResume(g)}>
                      {busyId === g.id ? "…" : "▶ Wznów i dokończ"}
                    </button>
                  )}
                  <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, minHeight: 44 }} disabled={busyId === g.id || isGoalRunning(g.id)} onClick={() => void doCancel(g)}>🗑 Anuluj</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
