import { useEffect, useState } from "react";
import Modal from "./Modal";
import { loadGoalsNewestFirst } from "../lib/goalRuntime";
import { cancelGoal, loadGoals, newGoal, pauseGoal, subscribeGoals, upsertGoal, type GoalRecord, type GoalStatus } from "../lib/goalState";
import { planAndEnqueueGoal } from "../lib/goalQueue";
import { confirmed, outcomeIcon } from "../lib/actionOutcome";
import { store, uid } from "../lib/store";

const LABEL: Record<GoalStatus, string> = {
  queued: "W kolejce", running: "Wykonuję", waiting_consent: "Potrzebna zgoda",
  waiting_user: "Sprawdź wynik", paused: "Wstrzymane", completed: "Ukończone", failed: "Wymaga uwagi",
};

export default function GoalStatusPanel({ onClose, onRuntime }: { onClose: () => void; onRuntime?: () => void }) {
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [error, setError] = useState("");
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [history, setHistory] = useState(false);
  const [automatic, setAutomatic] = useState(store.settings.autonomousQueue !== false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void loadGoalsNewestFirst().then((items) => { if (!disposed) setGoals(items); }).catch((e: Error) => { if (!disposed) setError(e.message); }); };
    refresh();
    const unsubscribe = subscribeGoals(refresh);
    const timer = setInterval(refresh, 2000);
    return () => { disposed = true; unsubscribe(); clearInterval(timer); };
  }, []);
  const act = async (g: GoalRecord, action: "pause" | "resume" | "cancel") => {
    try {
      const current = (await loadGoals()).find((item) => item.id === g.id);
      if (!current) return;
      await upsertGoal(action === "pause" ? pauseGoal(current, Date.now()) : action === "cancel" ? cancelGoal(current, Date.now()) : { ...current, status: "queued", error: undefined, updatedAt: Date.now() });
    } catch (e) { setError(e instanceof Error ? e.message : "Nie można zapisać zmiany."); }
  };
  const enqueue = async () => {
    if (!goal.trim() || planning) return;
    setPlanning(true); setError("");
    try { await planAndEnqueueGoal(goal); setGoal(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Nie udało się przygotować planu."); }
    finally { setPlanning(false); }
  };
  const confirmStep = async (g: GoalRecord, stepId: string) => {
    try {
      const current = (await loadGoals()).find((item) => item.id === g.id);
      if (!current || current.results[stepId]?.state !== "ATTEMPTED") return;
      await upsertGoal({ ...current, status: "queued", updatedAt: Date.now(), results: { ...current.results, [stepId]: confirmed({ manual: true, confirmedAt: Date.now(), message: "Użytkownik sprawdził i potwierdził wykonanie." }) } });
    } catch (e) { setError(e instanceof Error ? e.message : "Nie można zapisać potwierdzenia."); }
  };
  const quickTask = async () => {
    try {
      await upsertGoal(newGoal("Przegląd moich zadań", { goal: "Przegląd moich zadań", steps: [{ id: "tasks", intent: "Odczytaj zapisane zadania", tool: "list_tasks" }] }, uid(), Date.now()));
    } catch (e) { setError(e instanceof Error ? e.message : "Nie można zapisać zadania."); }
  };
  const visible = goals.filter((g) => history ? g.status === "completed" || g.error === "anulowane przez użytkownika" : g.status !== "completed" && g.error !== "anulowane przez użytkownika")
    .sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : a.createdAt - b.createdAt));
  const active = goals.filter((g) => g.status === "running" || g.status === "queued").length;
  return (
    <Modal title="Kolejka zadań" onClose={onClose} className="work-queue" foot={<button className="btn" onClick={onClose}>Zamknij — zadania mogą działać dalej</button>}>
      <div className="queue-summary">
        <div><span className="queue-eyebrow">CENTRUM PRACY</span><h3>{active ? `${active} zadań do wykonania` : "Gotowy na kolejne zadanie"}</h3><p>Plan, wykonanie i zapisany wynik w jednym miejscu.</p></div>
        <button className={`chip ${automatic ? "on" : ""}`} aria-pressed={automatic} onClick={() => { const next = !automatic; setAutomatic(next); store.setSettings({ autonomousQueue: next }); }}>
          {automatic ? "● Autonomia włączona" : "○ Uruchamianie wstrzymane"}
        </button>
      </div>
      <p className="muted queue-hint">Kolejka działa przy otwartej aplikacji. Po ponownym uruchomieniu podejmuje zapisane zadania. Pauza zatrzymuje pracę przed kolejnym krokiem; rozpoczęta operacja kończy się osobno.</p>
      {onRuntime && <button className="btn" onClick={onRuntime}>Analizy na serwerze — działają po zamknięciu okna</button>}
      <label className="queue-label" htmlFor="queue-goal">Co mam doprowadzić do końca?</label>
      <textarea id="queue-goal" className="ta" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={4000} placeholder="Np. sprawdź pliki projektu, znajdź przyczynę błędu i przygotuj poprawkę wraz z testem." />
      <div className="queue-actions">
        <button className="btn primary" disabled={planning || !goal.trim()} onClick={() => void enqueue()}>{planning ? "Układam plan…" : "Zaplanuj i dodaj do kolejki"}</button>
        <button className="btn" disabled={planning} onClick={() => void quickTask()}>Przegląd moich zadań</button>
      </div>
      {error && <p role="alert" className="notice">{error}</p>}
      <div className="queue-tabs" role="group" aria-label="Widok kolejki">
        <button className={`chip ${!history ? "on" : ""}`} aria-pressed={!history} onClick={() => setHistory(false)}>Aktywne i wstrzymane</button>
        <button className={`chip ${history ? "on" : ""}`} aria-pressed={history} onClick={() => setHistory(true)}>Historia wyników</button>
      </div>
      {!visible.length && <div className="queue-empty"><strong>{history ? "Tu pojawią się zapisane wyniki." : "Kolejka jest pusta."}</strong><p>Dodaj cel powyżej. JARVIS zapisuje postęp po każdym kroku.</p></div>}
      {visible.map((g) => {
        const steps = g.plan.steps;
        const done = steps.filter((s) => g.results[s.id]?.state === "CONFIRMED").length;
        return <article className="queue-card" key={g.id}>
          <div className="queue-card-head"><h3>{g.goal}</h3><span className={`queue-state state-${g.status}`}>{g.error === "anulowane przez użytkownika" ? "Anulowane" : LABEL[g.status]}</span></div>
          <div className="queue-progress-label"><span>{done} z {steps.length} kroków potwierdzonych</span><time>{new Date(g.updatedAt).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</time></div>
          <progress max={Math.max(1, steps.length)} value={done} aria-label={`Postęp: ${g.goal}`} />
          {g.error && <p className="notice">{g.error}</p>}
          <ol className="queue-steps">{steps.map((s) => <li key={s.id}>
            <span aria-hidden="true">{outcomeIcon(g.results[s.id])}</span><div><strong>{s.intent}</strong>
              {g.results[s.id]?.evidence?.message && <p>{g.results[s.id].evidence?.message}</p>}
              {g.outputs?.[s.id] && <details><summary>Pokaż wynik</summary><pre>{g.outputs[s.id]}</pre></details>}
              {g.status === "waiting_user" && g.results[s.id]?.state === "ATTEMPTED" && <button className="btn" onClick={() => void confirmStep(g, s.id)}>Sprawdziłem — krok wykonany</button>}
            </div>
          </li>)}</ol>
          {!history && <div className="queue-actions">
            {["running", "queued"].includes(g.status) && <button className="btn" onClick={() => void act(g, "pause")}>Wstrzymaj</button>}
            {["paused", "failed", "waiting_consent"].includes(g.status) && <button className="btn primary" onClick={() => void act(g, "resume")}>Kontynuuj pozostałe kroki</button>}
            <button className="btn" onClick={() => void act(g, "cancel")}>Anuluj zadanie</button>
          </div>}
        </article>;
      })}
    </Modal>
  );
}
