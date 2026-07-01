// === Panel „Plan dnia" — co dziś najbardziej ruszy biznes ===
// Widoczny ekran dla Growth Orchestratora: pokazuje do 3 rekomendacji (wartość, dowody, koszt,
// ryzyko, wymagana zgoda, oczekiwany efekt) i uruchamia bezpieczny plan JEDNYM kliknięciem przez
// prawdziwego wykonawcę (executeGoalPlan). Działania zewnętrzne przechodzą przez bramkę zgód
// (runTool). Wynik pokazujemy UCZCIWIE (werdykt: potwierdzone / rozpoczęte / wstrzymane / nieudane).
// Orkiestrator uczy się z akceptacji/odrzucenia (wagi trwałe w localStorage). Lekki, czytelny na S9.

import { useMemo, useState } from "react";
import { useStore } from "../hooks/useStore";
import { useEscape } from "../hooks/useEscape";
import { loadJson, saveJson } from "../lib/lsJson";
import {
  planDailyGrowth, actionToPlan, recordDecision, DEFAULT_ORCH_WEIGHTS,
  type GrowthAction, type OrchestratorWeights,
} from "../lib/growthOrchestrator";
import { emptyStateSuggestion } from "../lib/simpleFlow";
import { startAndRunGoal } from "../lib/goalRuntime";
import { dayInsights, statusView, recordTrace, learnedProcedure } from "../lib/cognitiveRuntime";
import type { ExecutionTrace } from "../lib/workflowLearning";
import CognitiveStatus from "./CognitiveStatus";
import type { CognitiveStatusView } from "../lib/cognitiveStatus";

const WEIGHTS_KEY = "jarvis.growthDay.weights.v1";
const TRACES_KEY = "jarvis.workflow.traces.v1"; // ślady wykonań (workflowLearning)
const riskLabel: Record<GrowthAction["risk"], string> = { low: "niskie", medium: "średnie", high: "wysokie" };

export default function GrowthDayPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data } = useStore();
  const [weights, setWeights] = useState<OrchestratorWeights>(() => loadJson<OrchestratorWeights>(WEIGHTS_KEY, DEFAULT_ORCH_WEIGHTS));
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<Record<string, { icon: string; text: string }>>({});
  const [cogView, setCogView] = useState<CognitiveStatusView | null>(null); // co JARVIS robi i dlaczego
  const [procNote, setProcNote] = useState(""); // wykryta powtarzalna procedura (workflowLearning)

  const actions = useMemo(
    () => planDailyGrowth({ leads: data.leads, finance: data.financeProjects, now: Date.now(), weights }).filter((a) => !dismissed.has(a.id)),
    [data.leads, data.financeProjects, weights, dismissed],
  );

  // 🧭 Proaktywne wnioski (OODA) + największy bloker przychodu (cyfrowy bliźniak) — z realnych danych.
  const insights = useMemo(
    () => dayInsights({ leads: data.leads, finance: data.financeProjects }, Date.now()),
    [data.leads, data.financeProjects],
  );

  const persistWeights = (w: OrchestratorWeights) => { setWeights(w); saveJson(WEIGHTS_KEY, w); };

  const doAction = async (a: GrowthAction) => {
    setBusyId(a.id);
    setStatus(`${a.title} — startuję…`);
    setResults((r) => ({ ...r, [a.id]: { icon: "⏳", text: "w toku…" } }));
    try {
      // Uruchom jako TRWAŁY cel — pojawi się w „Panelu celu" i przeżyje restart.
      const now = Date.now();
      const { record, result: run } = await startAndRunGoal({ goal: a.title, plan: actionToPlan(a), correlationId: `${a.id}:${now}`, now, onStatus: (s) => setStatus(s) });
      const v = run.verdict;
      const icon = v.canClaimSuccess ? "✅" : v.state === "attempted" ? "⏳" : v.state === "blocked" ? "⏸" : v.state === "failed" ? "❌" : "✍";
      setResults((r) => ({ ...r, [a.id]: { icon, text: v.summary } }));
      // Uczciwy widok stanu poznawczego: cel, krok, zgody, ostatni POTWIERDZONY wynik (bez sekretów).
      setCogView(statusView({ goal: record, run, confidence: run.verdict.canClaimSuccess ? 0.9 : 0.5 }));
      // workflowLearning: zapisz ślad (kolejność narzędzi) i wykryj powtarzalną procedurę.
      const tools = run.steps.map((s) => s.tool || "").filter(Boolean);
      const traces = recordTrace(loadJson<ExecutionTrace[]>(TRACES_KEY, []), tools, { id: `${a.id}:${now}`, now });
      saveJson(TRACES_KEY, traces);
      const proc = learnedProcedure(traces);
      if (proc) setProcNote(`🔁 Wykryto powtarzalną procedurę: ${proc.tools.join(" → ")} (${proc.count}×) — mogę ją zapamiętać jako gotowy przepis.`);
      persistWeights(recordDecision(weights, a.kind, true)); // wykonane = akceptacja
    } catch (e) {
      setResults((r) => ({ ...r, [a.id]: { icon: "❌", text: e instanceof Error ? e.message : "błąd wykonania" } }));
    } finally {
      setBusyId(null);
      setStatus("");
    }
  };

  const dismiss = (a: GrowthAction, hard: boolean) => {
    setDismissed((d) => new Set(d).add(a.id));
    if (hard) persistWeights(recordDecision(weights, a.kind, false)); // „Nie proponuj" = odrzucenie (uczy)
  };

  const empty = emptyStateSuggestion("leads");

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>📅 Plan dnia — co dziś ruszy biznes</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Do trzech działań o największym oczekiwanym efekcie, z Twoich danych. Działania na zewnątrz
            (wysyłka, publikacja, wydatek) zawsze proszą o zgodę.
          </p>

          {status && <p className="muted" style={{ fontSize: 12 }}>⏳ {status}</p>}

          {/* 🔎 Największy bloker przychodu (cyfrowy bliźniak biznesu) — z realnych finansów/leadów. */}
          <div className="row" style={{ borderLeft: "3px solid var(--gold, #d9a400)", paddingLeft: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>🔎 Bloker: <b>{insights.blocker.blocker}</b> — {insights.blocker.reason}</span>
          </div>

          {/* 🧭 Proaktywna sugestia (OODA) — jedna, najtrafniejsza rzecz do zrobienia teraz. */}
          {insights.suggestion && (
            <div className="row" style={{ borderLeft: "3px solid var(--cyan)", paddingLeft: 10, marginBottom: 8, flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <span style={{ fontSize: 13 }}>🧭 {insights.suggestion.what}</span>
              <span className="muted" style={{ fontSize: 11 }}>{insights.suggestion.whyNow} · pewność {Math.round(insights.suggestion.confidence * 100)}%</span>
            </div>
          )}

          {/* 🧠 Co JARVIS robi i dlaczego — po uruchomieniu działania. */}
          {cogView && <CognitiveStatus view={cogView} />}

          {/* 🔁 Powtarzalna procedura wykryta z realnych przebiegów (workflowLearning). */}
          {procNote && <p style={{ fontSize: 12, color: "var(--cyan, #6ce7ff)" }}>{procNote}</p>}

          {actions.length === 0 && (
            <div className="row" style={{ borderLeft: "3px solid var(--cyan)", paddingLeft: 10, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <span style={{ fontSize: 14 }}>{empty.message}</span>
              <span className="muted" style={{ fontSize: 12 }}>Sugerowane: {empty.action}</span>
            </div>
          )}

          {actions.map((a) => {
            const res = results[a.id];
            return (
              <div key={a.id} style={{ border: "1px solid var(--line, #234)", borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{a.title}</strong>
                  {a.requiredPermission === "consent" && (
                    <span style={{ fontSize: 11, color: "var(--gold, #d9a400)", whiteSpace: "nowrap" }}>🔒 wymaga zgody</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Efekt: {a.expectedEffect} · Koszt: {a.cost} · Ryzyko: {riskLabel[a.risk]}
                </div>
                {a.evidence.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {a.evidence.map((ev, i) => (
                      <span key={i} className="chip" style={{ fontSize: 11 }}>{ev}</span>
                    ))}
                  </div>
                )}
                {res && (
                  <div style={{ fontSize: 13, marginTop: 2 }}>{res.icon} {res.text}</div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <button className="btn primary" style={{ width: "auto", marginTop: 0, padding: "8px 14px", minHeight: 44 }} disabled={busyId === a.id} onClick={() => void doAction(a)}>
                    {busyId === a.id ? "…" : "Zrób"}
                  </button>
                  <button className="btn" style={{ width: "auto", marginTop: 0, padding: "8px 12px", minHeight: 44 }} disabled={busyId === a.id} onClick={() => dismiss(a, false)}>
                    Później
                  </button>
                  <button className="btn" style={{ width: "auto", marginTop: 0, padding: "8px 12px", minHeight: 44 }} disabled={busyId === a.id} onClick={() => dismiss(a, true)}>
                    Nie proponuj
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
