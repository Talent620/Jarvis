// KOD (M12): JARVIS as the operator of coding agents. Backends and their login state (never the
// credentials), the choice AUTO / CODEX / CLAUDE / LOCAL and the cost mode, the user's projects,
// a new task, the live task (stage, file, command, tests, changed files) with STOP / PAUZA /
// WZNÓW / POKAŻ ZMIANY / OTWÓRZ REPO, a readable live log, the diff and the task history.
// Presentation only: every value comes from the coder controller's structured state.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import Modal from "./Modal";
import type { CoderController } from "../lib/runtime/coder/controller";
import type { CoderStoreSnapshot } from "../lib/runtime/coder/live";
import type { WorkspaceInfo } from "../lib/runtime/coder/port";
import type { BackendChoice, BackendProbe, CoderLiveState, CoderResult, CoderTaskRecord, CostMode } from "../lib/runtime/coder/types";
import { LIVE_CODER_STATES } from "../lib/runtime/coder/types";
import { loadCoderSettings, saveCoderSettings } from "../lib/runtime/coder/settings";
import { formatElapsed } from "./RuntimeStatusPanel";

const btn: React.CSSProperties = { fontSize: 12, padding: "4px 12px", minHeight: 44, minWidth: 44, borderRadius: 8 };

export const CODER_STATE_LABEL: Record<string, string> = {
  queued: "czeka", starting: "startuje", running: "pracuje", paused: "wstrzymany", validating: "sprawdzam wynik",
  completed: "skończone", failed: "nie udało się", cancelled: "przerwane", blocked: "zablokowane", interrupted_after_restart: "przerwane restartem",
};
const TRUTH_LABEL: Record<string, string> = {
  CONFIRMED: "potwierdzone testami", ATTEMPTED: "niepotwierdzone", FAILED: "nie przeszło", BLOCKED: "zablokowane",
  NEEDS_CAPABILITY: "brak agenta", NEEDS_PERMISSION: "wymaga logowania", UNKNOWN_AFTER_ATTEMPT: "stan niepewny",
};
const AVAIL_LABEL: Record<BackendProbe["availability"], string> = {
  ready: "gotowy", unknown_auth: "zainstalowany, logowanie niepotwierdzone", needs_auth: "wymaga zalogowania", unavailable: "niedostępny", available: "dostępny",
};
const ROLE_LABEL: Record<string, string> = { planner: "planista", coder: "programista", tester: "tester", debugger: "debugger", reviewer: "recenzent" };
const BACKEND_LABEL: Record<string, string> = { codex: "Codex CLI", claude: "Claude Code", local: "Lokalny model", fake: "Agent testowy" };

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
    <span style={{ color: "var(--muted, #8aa)", minWidth: 96, flexShrink: 0 }}>{label}</span>
    <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{children}</span>
  </div>
);

/** One coding task, live: used in the "Co robię" panel (CODER section) and on the KOD screen. */
export const CoderLiveCard: React.FC<{
  task: CoderLiveState;
  result?: CoderResult;
  now: number;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onDiff?: () => void;
  onOpenRepo?: () => void;
}> = ({ task, result, now, onStop, onPause, onResume, onDiff, onOpenRepo }) => {
  const live = LIVE_CODER_STATES.has(task.state);
  return (
    <div aria-label="Agent programistyczny" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Row label="Agent">{BACKEND_LABEL[task.backend] ?? task.backend}{task.model ? ` (${task.model})` : ""}: {CODER_STATE_LABEL[task.state] ?? task.state}</Row>
      <Row label="Cel">{task.goal}</Row>
      <Row label="Projekt">{task.workspace}{task.branch ? `, gałąź ${task.branch}` : ""}</Row>
      {task.role && live && <Row label="Rola">{ROLE_LABEL[task.role] ?? task.role}</Row>}
      {task.stage && <Row label="Etap">{task.stage}</Row>}
      {live && task.currentFile && <Row label="Plik">{task.currentFile}</Row>}
      {live && task.currentCommand && <Row label="Polecenie"><code>{task.currentCommand}</code></Row>}
      <Row label="Zmienione">{task.changedFiles.length} {task.changedFiles.length === 1 ? "plik" : "plików"}</Row>
      {task.tests && <Row label="Testy">{task.tests.failed ? "FAIL" : "PASS"}: {task.tests.passed} przeszło, {task.tests.failed} nie</Row>}
      {live && <Row label="Czas">{formatElapsed(now - task.startedAt)}</Row>}
      {task.lastCheckpoint && <Row label="Punkt kontrolny">{task.lastCheckpoint}</Row>}
      {result && <Row label="Wynik">{TRUTH_LABEL[result.truth] ?? result.truth}{result.validation?.checks.length ? `: ${result.validation.checks.map((c) => `${c.name} ${c.ok ? "PASS" : "FAIL"}`).join(", ")}` : ""}</Row>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onPause && <button type="button" style={btn} disabled={task.state !== "running"} onClick={onPause}>PAUZA</button>}
        {onResume && <button type="button" style={btn} disabled={task.state !== "paused"} onClick={onResume}>WZNÓW</button>}
        {onStop && <button type="button" style={btn} disabled={!live} onClick={onStop}>STOP</button>}
        {onDiff && <button type="button" style={btn} onClick={onDiff}>POKAŻ ZMIANY</button>}
        {onOpenRepo && <button type="button" style={btn} onClick={onOpenRepo}>OTWÓRZ REPO</button>}
      </div>
    </div>
  );
};

const EMPTY: CoderStoreSnapshot = { version: -1, tasks: [], results: {} };
const noop = () => () => undefined;

/** Live store of a controller, re-rendered once per event batch. */
export function useCoderSnapshot(ctl: CoderController | null): CoderStoreSnapshot {
  return useSyncExternalStore(ctl ? (fn) => ctl.store.subscribe(fn) : noop, () => (ctl ? ctl.store.snapshot() : EMPTY));
}

export default function CodePanel({ onClose }: { onClose: () => void }) {
  const [ctl, setCtl] = useState<CoderController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probes, setProbes] = useState<BackendProbe[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [history, setHistory] = useState<CoderTaskRecord[]>([]);
  const [settings, setSettings] = useState(loadCoderSettings);
  const [goal, setGoal] = useState("");
  const [wsId, setWsId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const snap = useCoderSnapshot(ctl);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { desktopCoderPort } = await import("../lib/runtime/coder/port");
      if (!desktopCoderPort()) { setError("Agenci programistyczni działają tylko w aplikacji na komputer."); return; }
      const { getAppRuntime } = await import("../lib/runtime/appRuntime");
      const { runtime } = await getAppRuntime();
      if (cancelled || !runtime.coder) return;
      const c = runtime.coder;
      await c.ready;
      setCtl(c);
      setWorkspaces(c.listWorkspaces());
      setWsId((w) => w || c.listWorkspaces()[0]?.id || "");
      setHistory(await c.history().catch(() => []));
      setProbes(await c.probe().catch(() => []));
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // History follows finished tasks.
  const finished = snap.tasks.filter((t) => !LIVE_CODER_STATES.has(t.state)).length;
  useEffect(() => { if (ctl) void ctl.history().then(setHistory).catch(() => undefined); }, [ctl, finished]);

  const chosen = selected ? snap.tasks.find((t) => t.taskId === selected) : snap.tasks[0];
  const diffId = ctl?.store.diffTaskId;
  const diff = chosen && diffId === chosen.taskId ? ctl?.store.diff(chosen.taskId) : undefined;
  const log = chosen && ctl ? ctl.store.log(chosen.taskId, 200) : [];
  const setChoice = (s: typeof settings) => { setSettings(s); saveCoderSettings(s); };
  const refreshWs = () => { if (ctl) setWorkspaces(ctl.listWorkspaces()); };
  const wsOf = (name: string) => workspaces.find((w) => w.name === name);

  return (
    <Modal title="⌨ Kod: agenci programistyczni" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="muted">
            JARVIS zleca pracę Codexowi, Claude Code albo lokalnemu modelowi, śledzi ją na żywo i sam sprawdza wynik
            testami projektu. „Gotowe” mówi dopiero wtedy, gdy testy przejdą. Możesz też mówić: „napraw testy w projekcie X”,
            „co teraz robi codex?”, „nie rób release”, „dodaj jeszcze …”, „stop”.
          </p>
          {error && <p role="alert">{error}</p>}

          <section aria-label="Agenci">
            <h3 style={{ fontSize: 14 }}>Agenci</h3>
            {!probes && !error && <p className="muted">Sprawdzam, co jest zainstalowane…</p>}
            {probes?.map((p) => (
              <Row key={p.id} label={BACKEND_LABEL[p.id] ?? p.id}>
                {AVAIL_LABEL[p.availability]}{p.version ? `, ${p.version}` : ""}{p.detail && p.availability === "unavailable" ? ` (${p.detail})` : ""}
                {p.availability === "needs_auth" && p.authDetail ? ` (${p.authDetail})` : ""}
              </Row>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }} role="radiogroup" aria-label="Wybór agenta">
              {(["auto", "codex", "claude", "local"] as BackendChoice[]).map((b) => (
                <button key={b} type="button" role="radio" aria-checked={settings.backend === b} style={{ ...btn, fontWeight: settings.backend === b ? 700 : 400 }} onClick={() => setChoice({ ...settings, backend: b })}>
                  {b === "auto" ? "AUTO" : b === "codex" ? "CODEX" : b === "claude" ? "CLAUDE" : "LOCAL"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }} role="radiogroup" aria-label="Tryb kosztów">
              {([["cheap", "TANIO"], ["normal", "NORMALNIE"], ["max", "MAKSIMUM"]] as [CostMode, string][]).map(([m, label]) => (
                <button key={m} type="button" role="radio" aria-checked={settings.mode === m} style={{ ...btn, fontWeight: settings.mode === m ? 700 : 400 }} onClick={() => setChoice({ ...settings, mode: m })}>{label}</button>
              ))}
            </div>
          </section>

          <section aria-label="Projekty">
            <h3 style={{ fontSize: 14 }}>Projekty</h3>
            {!workspaces.length && <p className="muted">Nie ma jeszcze projektów. Agent pracuje tylko w folderach, które tu dodasz.</p>}
            {workspaces.map((w) => (
              <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>{w.name} <span className="muted">{w.root}</span></span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={btn} onClick={() => { void ctl?.openWorkspace(w.id); }}>OTWÓRZ REPO</button>
                  <button type="button" style={btn} aria-label={`Usuń projekt ${w.name}`} onClick={() => { void ctl?.removeWorkspace(w.id).then(refreshWs); }}>Usuń</button>
                </span>
              </div>
            ))}
            <button type="button" style={{ ...btn, marginTop: 6 }} disabled={!ctl} onClick={() => { void ctl?.pickWorkspace().then(() => { refreshWs(); }); }}>Dodaj folder projektu</button>
          </section>

          <section aria-label="Nowe zadanie">
            <h3 style={{ fontSize: 14 }}>Nowe zadanie</h3>
            <select value={wsId} onChange={(e) => setWsId(e.target.value)} aria-label="Projekt" style={{ minHeight: 44 }}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="Na przykład: napraw test, który nie przechodzi" aria-label="Co agent ma zrobić" style={{ width: "100%", marginTop: 6 }} />
            <button type="button" style={btn} disabled={!ctl || !wsId || !goal.trim()} onClick={() => { const t = ctl?.startTask(goal, wsId); if (t?.taskId) { setSelected(t.taskId); setGoal(""); } }}>START</button>
          </section>

          {chosen && ctl && (
            <section aria-label="Zadanie na żywo" role="status" aria-live="polite">
              <h3 style={{ fontSize: 14 }}>Zadanie</h3>
              <CoderLiveCard
                task={chosen}
                result={snap.results[chosen.taskId]}
                now={now}
                onPause={() => ctl.control(chosen.taskId, "pause")}
                onResume={() => ctl.control(chosen.taskId, "resume")}
                onStop={() => ctl.control(chosen.taskId, "stop")}
                onDiff={() => { void ctl.loadDiff(chosen.taskId); }}
                onOpenRepo={wsOf(chosen.workspace) ? () => { void ctl.openWorkspace(wsOf(chosen.workspace)!.id); } : undefined}
              />
              <details open>
                <summary style={{ fontSize: 13, cursor: "pointer" }}>Dziennik na żywo ({log.length})</summary>
                <ol aria-label="Dziennik agenta" style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, maxHeight: 240, overflow: "auto" }}>
                  {log.map((e) => (
                    <li key={e.seq}><span className="muted">{e.kind}</span> {e.text}</li>
                  ))}
                </ol>
              </details>
              {diff !== undefined && (
                <details open>
                  <summary style={{ fontSize: 13, cursor: "pointer" }}>Zmiany (diff)</summary>
                  <pre aria-label="Diff" style={{ fontSize: 11, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>{diff || "Brak zmian."}</pre>
                </details>
              )}
            </section>
          )}

          {!!snap.tasks.length && (
            <section aria-label="Zadania w tej sesji">
              <h3 style={{ fontSize: 14 }}>Zadania w tej sesji</h3>
              {snap.tasks.map((t) => (
                <button key={t.taskId} type="button" style={{ ...btn, display: "block", width: "100%", textAlign: "left", marginBottom: 4 }} onClick={() => setSelected(t.taskId)}>
                  {CODER_STATE_LABEL[t.state] ?? t.state}: {t.goal} ({t.workspace})
                </button>
              ))}
            </section>
          )}

          {!!history.length && (
            <details>
              <summary style={{ fontSize: 13, cursor: "pointer" }}>Historia ({history.length})</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                {history.slice(0, 30).map((r) => (
                  <li key={r.taskId}>
                    {new Date(r.startedAt).toLocaleString("pl-PL")}: {r.goal} ({BACKEND_LABEL[r.backend] ?? r.backend}), {CODER_STATE_LABEL[r.state] ?? r.state}
                    {r.result ? `, ${TRUTH_LABEL[r.result.truth] ?? r.result.truth}` : ""}{r.changedFiles.length ? `, zmienione: ${r.changedFiles.length}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
    </Modal>
  );
}
