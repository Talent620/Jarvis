import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Flame,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import Modal from "./Modal";
import {
  buildFlowDebriefPrompt,
  computeFlowStats,
  FLOW_PRESETS,
  formatCountdown,
  loadFlowSessions,
  loadParkedThoughts,
  saveFlowSession,
  saveParkedThoughts,
  type FlowPresetId,
  type FlowSession,
  type ParkedThought,
} from "../lib/flowEngine";
import { createFocusAudioController, type FocusAudioController, type FocusSoundMode } from "../lib/flowAudio";
import { store } from "../lib/store";
import { toast } from "../lib/toast";

export interface FlowCockpitProps {
  onClose: () => void;
  onDebrief?: (prompt: string) => void;
}

const SOUND_MODES: { id: FocusSoundMode; label: string }[] = [
  { id: "off", label: "Cisza" },
  { id: "brown", label: "Szum brązowy" },
  { id: "rain", label: "Deszcz" },
  { id: "alpha", label: "Alpha 10 Hz" },
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function FlowCockpit({ onClose, onDebrief }: FlowCockpitProps) {
  const [presetId, setPresetId] = useState<FlowPresetId>("deep");
  const [goal, setGoal] = useState("");
  const [linkedTaskId, setLinkedTaskId] = useState<string>("");

  const activePreset = useMemo(
    () => FLOW_PRESETS.find((p) => p.id === presetId) || FLOW_PRESETS[1],
    [presetId],
  );

  const totalSec = activePreset.minutes * 60;
  const [remainingSec, setRemainingSec] = useState<number>(totalSec);
  const [running, setRunning] = useState(false);

  const [sessions, setSessions] = useState<FlowSession[]>(() => loadFlowSessions());
  const [thoughts, setThoughts] = useState<ParkedThought[]>(() => loadParkedThoughts());
  const [thoughtInput, setThoughtInput] = useState("");
  const [lastFinished, setLastFinished] = useState<FlowSession | null>(null);
  const [taskDoneMarked, setTaskDoneMarked] = useState(false);

  const [soundMode, setSoundMode] = useState<FocusSoundMode>("off");
  const [volume, setVolume] = useState(0.35);
  const audioRef = useRef<FocusAudioController | null>(null);

  const [storeTick, setStoreTick] = useState(0);
  useEffect(() => store.subscribe(() => setStoreTick((n) => n + 1)), []);

  const openTasks = useMemo(() => {
    void storeTick;
    return store.data.tasks.filter((t) => !t.done).slice(0, 6);
  }, [storeTick]);

  const stats = useMemo(() => computeFlowStats(sessions), [sessions]);

  // Czyszczenie generatora Web Audio przy zamknięciu kokpitu.
  useEffect(() => {
    return () => {
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, []);

  const completeSession = (completed: boolean) => {
    setRunning(false);
    const elapsedSec = Math.max(0, totalSec - remainingSec);
    const actualMinutes = completed
      ? activePreset.minutes
      : Math.max(1, Math.round(elapsedSec / 60));
    const finalGoal = goal.trim() || activePreset.label;
    const session: FlowSession = {
      id: makeId("flow"),
      goal: finalGoal,
      presetId: activePreset.id,
      plannedMinutes: activePreset.minutes,
      actualMinutes,
      completed,
      linkedTaskId: linkedTaskId || undefined,
      parkedCount: thoughts.filter((t) => !t.convertedTo).length,
      finishedAt: Date.now(),
    };
    const next = saveFlowSession(session);
    setSessions(next);
    setLastFinished(session);
    setTaskDoneMarked(false);
    setRemainingSec(totalSec);
    if (soundMode !== "off") {
      audioRef.current?.setMode("off");
      setSoundMode("off");
    }
    toast(
      completed
        ? `Sprint domknięty (${actualMinutes} min)! Momentum zaktualizowane.`
        : `Zapisano sesję skupienia (${actualMinutes} min).`,
    );
  };

  // Odliczanie co sekundę, gdy sesja trwa.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // Automatyczne domknięcie po dojściu licznika do 0.
  useEffect(() => {
    if (running && remainingSec === 0) {
      completeSession(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remainingSec]);

  const handleSelectPreset = (id: FlowPresetId) => {
    if (running) return;
    setPresetId(id);
    const p = FLOW_PRESETS.find((x) => x.id === id) || FLOW_PRESETS[1];
    setRemainingSec(p.minutes * 60);
    setLastFinished(null);
  };

  const handleReset = () => {
    setRunning(false);
    setRemainingSec(totalSec);
  };

  const handleSoundMode = (nextMode: FocusSoundMode) => {
    if (!audioRef.current) {
      audioRef.current = createFocusAudioController();
    }
    const ok = audioRef.current.setMode(nextMode, volume);
    if (!ok && nextMode !== "off") {
      toast("Przeglądarka zablokowała Web Audio — kliknij ponownie lub sprawdź dźwięk.");
      setSoundMode("off");
      return;
    }
    setSoundMode(nextMode);
  };

  const handleVolumeChange = (nextVol: number) => {
    setVolume(nextVol);
    audioRef.current?.setVolume(nextVol);
  };

  const handleParkThought = () => {
    const clean = thoughtInput.trim();
    if (!clean) return;
    const next: ParkedThought[] = [
      { id: makeId("park"), text: clean, createdAt: Date.now() },
      ...thoughts,
    ];
    setThoughts(next);
    saveParkedThoughts(next);
    setThoughtInput("");
  };

  const convertThoughtToTask = (item: ParkedThought) => {
    store.setData((d) => {
      d.tasks.unshift({
        id: makeId("task"),
        title: item.text,
        done: false,
        category: "Flow",
        createdAt: Date.now(),
      });
    });
    const next = thoughts.map((t) => (t.id === item.id ? { ...t, convertedTo: "task" as const } : t));
    setThoughts(next);
    saveParkedThoughts(next);
    toast("Przeniesiono myśl do Zadań.");
  };

  const convertThoughtToNote = (item: ParkedThought) => {
    store.setData((d) => {
      d.notes.unshift({
        id: makeId("note"),
        text: `[Flow] ${item.text}`,
        createdAt: Date.now(),
      });
    });
    const next = thoughts.map((t) => (t.id === item.id ? { ...t, convertedTo: "note" as const } : t));
    setThoughts(next);
    saveParkedThoughts(next);
    toast("Zapisano myśl w Notatkach.");
  };

  const removeThought = (id: string) => {
    const next = thoughts.filter((t) => t.id !== id);
    setThoughts(next);
    saveParkedThoughts(next);
  };

  const markLinkedTaskDone = () => {
    if (!lastFinished?.linkedTaskId) return;
    store.setData((d) => {
      const found = d.tasks.find((t) => t.id === lastFinished.linkedTaskId);
      if (found) found.done = true;
    });
    setTaskDoneMarked(true);
    toast("Zadanie oznaczone jako wykonane!");
  };

  const pctDone = totalSec > 0 ? Math.min(1, Math.max(0, (totalSec - remainingSec) / totalSec)) : 0;
  const ringRadius = 64;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - pctDone);
  const elapsedMinutes = Math.floor((totalSec - remainingSec) / 60);

  return (
    <Modal
      title="⚡ JARVIS Flow — Reżyser Skupienia"
      ariaLabel="JARVIS Flow — Reżyser Skupienia"
      className="flow-modal-panel"
      onClose={onClose}
    >
      <div className="flow-stack">
        {/* Pasek Momentum */}
        <section className="flow-momentum-bar">
          <div className="flow-stat">
            <span className="muted">Momentum</span>
            <strong>
              <Sparkles size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
              {stats.momentumScore}/100 · {stats.momentumLabel}
            </strong>
          </div>
          <div className="flow-stat">
            <span className="muted">Dziś</span>
            <strong>{stats.todayMinutes} min ({stats.todaySessions} ses.)</strong>
          </div>
          <div className="flow-stat">
            <span className="muted">Seria</span>
            <strong>
              <Flame size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
              {stats.streakDays} {stats.streakDays === 1 ? "dzień" : "dni"}
            </strong>
          </div>
        </section>

        {/* Presety czasu */}
        <div className="flow-presets" role="group" aria-label="Wybór czasu sprintu">
          {FLOW_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`flow-preset-btn${presetId === p.id ? " active" : ""}`}
              style={{ minHeight: 44 }}
              disabled={running}
              aria-pressed={presetId === p.id}
              onClick={() => handleSelectPreset(p.id)}
            >
              <strong>{p.minutes} min</strong>
              <span>{p.id === "spark" ? "Rozruch" : p.id === "deep" ? "Deep Focus" : p.id === "flow" ? "Strefa Flow" : "Przerwa"}</span>
            </button>
          ))}
        </div>

        {/* Cel sprintu + szybki wybór z Zadań */}
        <section className="flow-goal-box">
          <label htmlFor="flow-goal-input" className="muted">Jedno konkretne zadanie na ten blok</label>
          <input
            id="flow-goal-input"
            type="text"
            value={goal}
            placeholder="np. Domknąć moduł płatności albo napisać 3 oferty…"
            onChange={(e) => {
              setGoal(e.target.value);
              if (!e.target.value.trim()) setLinkedTaskId("");
            }}
          />
          {openTasks.length > 0 && (
            <div className="flow-task-chips">
              {openTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={`flow-task-chip${linkedTaskId === task.id ? " active" : ""}`}
                  style={{ minHeight: 44 }}
                  onClick={() => {
                    setGoal(task.title);
                    setLinkedTaskId(task.id);
                  }}
                >
                  {task.priority ? "★ " : ""}{task.title.slice(0, 36)}{task.title.length > 36 ? "…" : ""}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Zegar pierścieniowy */}
        <section className="flow-timer-card">
          <div className="flow-ring-wrap">
            <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
              <circle cx="80" cy="80" r={ringRadius} className="flow-ring-bg" />
              <circle
                cx="80"
                cy="80"
                r={ringRadius}
                className="flow-ring-fg"
                strokeDasharray={ringCirc}
                strokeDashoffset={ringOffset}
              />
            </svg>
            <div className="flow-ring-center">
              <div className="flow-clock-digits">{formatCountdown(remainingSec)}</div>
              <div className="flow-clock-sub muted">
                {running ? "Głębokie skupienie" : elapsedMinutes > 0 ? `Pauza (${elapsedMinutes} min)` : activePreset.tagline}
              </div>
            </div>
          </div>

          <div className="flow-controls">
            <button
              type="button"
              className="btn-primary"
              style={{ minHeight: 46, flex: 1 }}
              onClick={() => {
                setLastFinished(null);
                setRunning((r) => !r);
              }}
            >
              {running ? (
                <>
                  <Pause size={16} /> Pauza
                </>
              ) : (
                <>
                  <Play size={16} /> {remainingSec < totalSec ? "Wznów sprint" : "Rozpocznij sprint"}
                </>
              )}
            </button>
            {remainingSec < totalSec && (
              <button
                type="button"
                className="btn-secondary"
                style={{ minHeight: 46 }}
                onClick={() => completeSession(false)}
              >
                <Square size={15} /> Zapisz teraz
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 46 }}
              aria-label="Resetuj timer"
              title="Resetuj timer"
              onClick={handleReset}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </section>

        {/* Post-sprint Debrief */}
        {lastFinished && (
          <section className="flow-debrief-card">
            <div className="flow-debrief-head">
              <CheckCircle2 size={16} />
              <strong>
                Sesja zapisana: {lastFinished.actualMinutes} min — {lastFinished.goal}
              </strong>
            </div>
            <div className="flow-debrief-actions">
              {lastFinished.linkedTaskId && !taskDoneMarked && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={markLinkedTaskDone}
                >
                  <CheckCircle2 size={15} /> Oznacz zadanie jako zrobione
                </button>
              )}
              {onDebrief && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ minHeight: 44 }}
                  onClick={() => {
                    const prompt = buildFlowDebriefPrompt(lastFinished, thoughts);
                    onClose();
                    onDebrief(prompt);
                  }}
                >
                  <MessageSquare size={15} /> Podsumuj sesję z JARVIS
                </button>
              )}
            </div>
          </section>
        )}

        {/* Offline generator tła dźwiękowego */}
        <section className="flow-sound-box">
          <div className="flow-sound-head">
            <span>
              {soundMode === "off" ? <VolumeX size={15} style={{ verticalAlign: "middle", marginRight: 6 }} /> : <Volume2 size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />}
              <strong>Dźwięk skupienia</strong> <span className="muted">(100% offline · Web Audio)</span>
            </span>
          </div>
          <div className="flow-sound-modes" role="group" aria-label="Tryb dźwięku skupienia">
            {SOUND_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`flow-sound-btn${soundMode === m.id ? " active" : ""}`}
                style={{ minHeight: 44 }}
                aria-pressed={soundMode === m.id}
                onClick={() => handleSoundMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {soundMode !== "off" && (
            <label className="flow-volume-row">
              <span className="muted">Głośność ({Math.round(volume * 100)}%)</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
              />
            </label>
          )}
        </section>

        {/* Parking Myśli */}
        <section className="flow-parking-box">
          <div className="flow-parking-head">
            <strong>🧠 Parking Myśli</strong>
            <span className="muted">Złap rozpraszacz w 2 sekundy i wróć do pracy</span>
          </div>
          <div className="flow-parking-input-row">
            <input
              type="text"
              value={thoughtInput}
              placeholder="Wpadło coś do głowy? Zaparkuj tutaj…"
              onChange={(e) => setThoughtInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleParkThought();
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              style={{ minHeight: 44 }}
              disabled={!thoughtInput.trim()}
              onClick={handleParkThought}
            >
              <Plus size={15} /> Zaparkuj
            </button>
          </div>
          {thoughts.length > 0 && (
            <div className="flow-parking-list">
              {thoughts.map((item) => (
                <div key={item.id} className={`flow-parking-item${item.convertedTo ? " is-done" : ""}`}>
                  <span className="flow-parking-text">
                    {item.text}
                    {item.convertedTo && (
                      <em className="muted"> ({item.convertedTo === "task" ? "→ Zadanie" : "→ Notatka"})</em>
                    )}
                  </span>
                  <div className="flow-parking-actions">
                    {!item.convertedTo && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ minHeight: 44 }}
                          onClick={() => convertThoughtToTask(item)}
                        >
                          + Zadanie
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ minHeight: 44 }}
                          onClick={() => convertThoughtToNote(item)}
                        >
                          + Notatka
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ minHeight: 44 }}
                      aria-label="Usuń z Parkingu Myśli"
                      onClick={() => removeThought(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
