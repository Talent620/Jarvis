// === Panel celu (autonomia) — co JARVIS prowadzi i na jakim etapie ===
// Pokazuje TRWAŁE cele (goalState/IndexedDB): postęp, kroki z realnym statusem, oczekujące zgody i
// ostatni potwierdzony wynik — bez chain-of-thought. Użytkownik może cel Zatrzymać, Wznowić lub
// Anulować (zmiany utrwalane). Autonomia JARVIS-a jest widoczna i kontrolowalna. Lekki, czytelny na S9.

import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { isGoalRunning, requestGoalPause, requestGoalStop } from "../lib/goalControl";
import { loadGoalsNewestFirst, resumeAndRunGoal } from "../lib/goalRuntime";
import { pauseGoal, removeGoal, upsertGoal, describeGoal, type GoalRecord, type GoalStatus } from "../lib/goalState";
import { outcomeIcon, outcomeLabel } from "../lib/actionOutcome";
import { desktop, monitorCommand, type MonitorResponse, type MonitorSource } from "../lib/desktop";
import { emptyStateSuggestion } from "../lib/simpleFlow";

const STATUS_LABEL: Record<GoalStatus, string> = {
  queued: "w kolejce", running: "w toku", waiting_consent: "czeka na zgodę",
  waiting_user: "czeka na sprawdzenie", paused: "wstrzymany", completed: "ukończony", failed: "nieudany", cancelled: "zatrzymany przez użytkownika",
};
const canStop = (s: GoalStatus) => s === "running" || s === "queued" || s === "waiting_consent" || s === "waiting_user";

export default function GoalStatusPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resumeMsg, setResumeMsg] = useState("");
  const [monitorData, setMonitorData] = useState<MonitorResponse | null>(null);
  const [monitorMessage, setMonitorMessage] = useState("");
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [sourceKind, setSourceKind] = useState<MonitorSource["kind"]>("json");
  const [connectorKind, setConnectorKind] = useState<"changedetection" | "ntfy">("changedetection");
  const [connectors, setConnectors] = useState<Array<{ id: string; kind: string; label: string; baseUrl: string }>>([]);
  const [notificationChannel, setNotificationChannel] = useState("");
  const [scheduleKind, setScheduleKind] = useState("interval");
  const [editingMonitor, setEditingMonitor] = useState<string | null>(null);
  const hasMonitors = !!desktop()?.monitorCommand;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = () => { void loadGoalsNewestFirst().then(setGoals).catch((error) => setResumeMsg(String(error))).finally(() => setLoading(false)); };
  const loadMonitors = () => {
    if (!desktop()?.monitorCommand) return;
    void monitorCommand({ action: "list" }).then(setMonitorData).catch((error) => setMonitorMessage(String(error)));
    void desktop()?.monitorSettings?.().then((result) => {
      if (result.ok) setBackgroundEnabled(result.backgroundEnabled === true);
    }).catch((error) => setMonitorMessage(String(error)));
    void desktop()?.monitorConnectorList?.().then((result) => {
      if (result.ok) setConnectors(result.connectors || []);
    }).catch((error) => setMonitorMessage(String(error)));
  };
  const controlMonitor = async (request: Record<string, unknown>) => {
    setMonitorBusy(true); setMonitorMessage("");
    try {
      const result = await monitorCommand(request);
      if (!result.ok) throw new Error(result.error || "Brak potwierdzenia operacji.");
      setMonitorMessage("Zmiana zapisana."); loadMonitors();
    } catch (error) { setMonitorMessage(error instanceof Error ? error.message : String(error)); }
    finally { setMonitorBusy(false); }
  };
  const time = (value?: number) => value ? new Date(value).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "—";
  const sourceLabel = (source: MonitorSource) => source.kind === "json" ? source.url : source.kind === "directory" ? source.path : `changedetection · ${connectors.find(item => item.id === source.connectorId)?.label || source.connectorId} · watch ${source.watchId}`;
  const matchReason = (reason?: string | Record<string, unknown>) => {
    if (typeof reason === "string") return reason;
    if (!reason) return "Dopasowanie do zapisanych kryteriów";
    return [reason.contains ? `Nazwa zawiera: ${reason.contains}` : "", reason.variant ? `wariant: ${reason.variant}` : "", reason.condition ? `stan: ${reason.condition}` : "", reason.maxTotal != null ? `koszt do ${reason.maxTotal} ${reason.currency || ""}` : ""].filter(Boolean).join(" · ");
  };
  const monitorLabel: Record<string, string> = { RUNNING: "sprawdza źródło", WAITING_TIMER: "czeka na termin", WAITING_EVENT: "czeka na zdarzenie", WAITING_INPUT: "czeka na dane", WAITING_APPROVAL: "czeka na zgodę", PAUSED: "wstrzymany", BLOCKED: "zablokowany", COMPLETED: "dopasowanie znalezione — zakończony", CANCELLED: "anulowany", FAILED: "błąd" };
  const resultLabel: Record<string, string> = { NO_MATCH: "brak pasującego wyniku", MATCH: "znaleziono dopasowanie", BASELINE_RECORDED: "zapisano stan początkowy strony", NO_CHANGE: "snapshot strony bez zmian" };
  useEffect(() => {
    load(); loadMonitors();
    const timer = setInterval(() => { load(); loadMonitors(); }, 2500);
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
            Postęp celów jest zapisany. Wykonywanie kroków jednorazowych wymaga otwartego interfejsu.
            Monitory desktopowe mają osobny zegar w procesie aplikacji; nie pracują przy wyłączonym lub uśpionym komputerze.
          </p>

          <section aria-label="Trwały monitoring" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Monitoring i powiadomienia</h3>
            {!hasMonitors ? <p className="muted">Wykonawca monitorów jest dostępny w aktualnej aplikacji desktopowej. Ta sesja web/telefon nie wykonuje cyklicznych sprawdzeń.</p> : <>
              <p role="status">Wykonawca: {monitorData?.runtime?.active === true ? "aktywny w tej aplikacji desktopowej" : "brak potwierdzenia aktywnego zegara"}.</p>
              <p className="muted">Źródła: feed JSON, nazwy plików we wskazanym katalogu (Linux) albo snapshot istniejącego watch w changedetection.io. Pierwszy odczyt strony zapisuje stan początkowy; alert dotyczy kolejnej zmiany. Snapshot nie potwierdza ceny ani dostępności produktu. Przerwa pracy komputera pozostawia lukę obserwacji.</p>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                <input type="checkbox" checked={backgroundEnabled} disabled={monitorBusy} onChange={async (event) => {
                  const enabled = event.target.checked; setMonitorBusy(true);
                  try {
                    const result = await desktop()?.monitorSettings?.({ backgroundEnabled: enabled });
                    if (!result?.ok) throw new Error(result?.error || "Nie zapisano ustawienia.");
                    setBackgroundEnabled(result.backgroundEnabled === true);
                  } catch (error) { setMonitorMessage(String(error)); } finally { setMonitorBusy(false); }
                }} /> Kontynuuj monitoring po zamknięciu okna
              </label>
              <p className="muted" style={{ fontSize: 12 }}>{backgroundEnabled ? "Po zamknięciu okna proces pozostaje aktywny; Ctrl+Alt+J przywołuje okno. Wyjście z menu JARVIS kończy monitoring." : "Zamknięcie ostatniego okna zatrzymuje monitoring."} Autostart jest wyłączony. Czasy: Europe/Warsaw.</p>
              {desktop()?.monitorConnectorConfigure && <details>
                <summary style={{ cursor: "pointer", padding: "8px 0" }}>Połączenia changedetection.io i ntfy</summary>
                <p className="muted">Wymagana działająca usługa i jej dokładny adres. Konfigurację zatwierdzasz w oknie systemowym. Token i temat pozostają w szyfrowanym magazynie tej aplikacji. Usunięcie połączenia blokuje następne odczyty lub wysyłki.</p>
                {connectors.map(connector => <div key={connector.id} style={{ overflowWrap: "anywhere", marginBottom: 8 }}>
                  <strong>{connector.label}</strong> · {connector.kind} · {connector.baseUrl} <button className="btn" disabled={monitorBusy} onClick={async () => {
                    setMonitorBusy(true);
                    try { const result = await desktop()?.monitorConnectorRemove?.(connector.id); if (!result?.ok) throw new Error(result?.error || "Nie usunięto połączenia."); setMonitorMessage("Połączenie usunięte."); loadMonitors(); }
                    catch (error) { setMonitorMessage(String(error)); } finally { setMonitorBusy(false); }
                  }}>Usuń połączenie</button>
                </div>)}
                <form style={{ display: "grid", gap: 10 }} onSubmit={async event => {
                  event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
                  setMonitorBusy(true); setMonitorMessage("");
                  try {
                    const result = await desktop()?.monitorConnectorConfigure?.({ kind: connectorKind, label: String(data.get("label") || "").trim(), baseUrl: String(data.get("baseUrl") || "").trim(), token: String(data.get("token") || ""), ...(connectorKind === "ntfy" ? { topic: String(data.get("topic") || "").trim(), publicTopicConsent: data.get("disclosure") === "on" } : {}), allowLocal: data.get("local") === "on" });
                    if (!result?.ok) throw new Error(result?.error || "Nie zapisano połączenia.");
                    form.reset(); setMonitorMessage("Połączenie zapisane. Wybierz je przy tworzeniu monitora."); loadMonitors();
                  } catch (error) { setMonitorMessage(String(error)); }
                  finally { const tokenInput = form.elements.namedItem("token") as HTMLInputElement | null; if (tokenInput) tokenInput.value = ""; setMonitorBusy(false); }
                }}>
                  <label>Rodzaj usługi<select value={connectorKind} onChange={event => setConnectorKind(event.target.value as "changedetection" | "ntfy")}><option value="changedetection">changedetection.io</option><option value="ntfy">ntfy</option></select></label>
                  <label>Nazwa połączenia<input name="label" required maxLength={100} /></label>
                  <label>Adres usługi<input name="baseUrl" type="url" required placeholder="https://monitor.twoja-domena.pl/" /></label>
                  <label>Token API (jeżeli wymagany)<input name="token" type="password" autoComplete="off" maxLength={1024} /></label>
                  <label><input name="local" type="checkbox" /> Zezwalam temu połączeniu na localhost / loopback</label>
                  {connectorKind === "ntfy" && <>
                    <label>Dokładny temat ntfy<input name="topic" required maxLength={64} pattern="[A-Za-z0-9_-]+" autoComplete="off" /></label>
                    <label><input name="disclosure" type="checkbox" required /> Znam uprawnienia tematu i zgadzam się przekazywać do niego tytuł, link, koszt i identyfikator alertu. Publiczny temat może odczytać inna osoba.</label>
                  </>}
                  <button className="btn" type="submit" disabled={monitorBusy}>Zatwierdź połączenie</button>
                </form>
              </details>}
              <details>
                <summary style={{ cursor: "pointer", padding: "8px 0" }}>Dodaj monitor i zgodę na konkretne źródło</summary>
                <form onSubmit={async (event) => {
                  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
                  const text = (key: string) => String(data.get(key) || "").trim();
                  const source: MonitorSource = sourceKind === "json" ? { kind: "json", url: text("source") } : sourceKind === "directory" ? { kind: "directory", path: text("source") } : { kind: "changedetection", connectorId: text("sourceConnector"), watchId: text("source") };
                  const desktopNotification = notificationChannel === "desktop";
                  const ntfyNotification = notificationChannel && notificationChannel !== "desktop" ? notificationChannel : undefined;
                  setMonitorBusy(true); setMonitorMessage("");
                  try {
                    const grant = await desktop()?.monitorGrant?.({ source, desktopNotification, ...(ntfyNotification ? { ntfyNotification } : {}) });
                    if (!grant?.ok) throw new Error(grant?.error || "Nie zapisano zgody źródła.");
                    const criteria = { contains: text("contains"), ...(text("variant") ? { variant: text("variant") } : {}), ...(text("condition") ? { condition: text("condition") } : {}), ...(text("maxTotal") ? { maxTotal: Number(text("maxTotal")), currency: text("currency") } : {}) };
                    const result = await monitorCommand({ action: "create", title: text("title"), originalCommand: text("title"), source, criteria,
                      intervalMs: Number(text("minutes")) * 60000, timezone: "Europe/Warsaw", stopAfterFirst: data.get("continue") !== "on",
                      ...(scheduleKind !== "interval" ? { schedule: { kind: scheduleKind, time: text("scheduleTime"), ...(scheduleKind === "weekly" ? { weekdays: data.getAll("weekday").map(Number) } : scheduleKind === "monthly" ? { day: Number(text("monthDay")) } : {}) } } : {}),
                      notification: { desktop: desktopNotification, ...(ntfyNotification ? { ntfy: ntfyNotification } : {}), ...(data.get("quiet") === "on" ? { quietHours: { start: "22:00", end: "07:00" } } : {}) } });
                    if (!result.ok) throw new Error(result.error || "Nie utworzono monitora.");
                    setMonitorMessage("Monitor zapisany. Wynik pierwszego sprawdzenia pojawi się poniżej."); form.reset(); loadMonitors();
                  } catch (error) { setMonitorMessage(error instanceof Error ? error.message : String(error)); }
                  finally { setMonitorBusy(false); }
                }} style={{ display: "grid", gap: 10, paddingTop: 8 }}>
                  <label>Nazwa celu<input name="title" required maxLength={200} /></label>
                  <label>Źródło<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as MonitorSource["kind"])}><option value="json">Feed JSON</option><option value="directory">Katalog plików</option><option value="changedetection">changedetection.io — watch</option></select></label>
                  {sourceKind === "changedetection" && <label>Połączenie changedetection<select name="sourceConnector" required defaultValue=""><option value="" disabled>Wybierz skonfigurowane połączenie</option>{connectors.filter(item => item.kind === "changedetection").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
                  <label>{sourceKind === "json" ? "Dokładny adres JSON" : sourceKind === "directory" ? "Pełna ścieżka katalogu" : "UUID istniejącego watch"}<input name="source" required type={sourceKind === "json" ? "url" : "text"} /></label>
                  <label>{sourceKind === "changedetection" ? "Tekst w zmienionym snapshotcie (* oznacza każdą zmianę)" : "Wymagany tekst nazwy"}<input name="contains" required maxLength={200} /></label>
                  <label>Wariant (opcjonalnie)<input name="variant" /></label>
                  <label>Stan (opcjonalnie)<input name="condition" /></label>
                  <label>Maksymalny koszt z dostawą (opcjonalnie)<input name="maxTotal" type="number" min="0" step="0.01" /></label>
                  <label>Waluta<input name="currency" defaultValue="PLN" maxLength={3} /></label>
                  <label>Harmonogram<select value={scheduleKind} onChange={event => setScheduleKind(event.target.value)}><option value="interval">Co określony czas</option><option value="daily">Codziennie</option><option value="weekly">W wybrane dni tygodnia</option><option value="monthly">W określony dzień miesiąca</option></select></label>
                  <label>{scheduleKind === "interval" ? "Sprawdzaj co (minuty)" : "Minimalny odstęp ponawiania po błędzie (minuty)"}<input name="minutes" required type="number" defaultValue="15" min="1" /></label>
                  {scheduleKind !== "interval" && <>
                    <label>Godzina Europe/Warsaw<input name="scheduleTime" type="time" required defaultValue="09:00" /></label>
                    {scheduleKind === "weekly" && <fieldset><legend>Dni tygodnia</legend>{["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"].map((day, index) => <label key={day} style={{ display: "inline-block", marginRight: 12 }}><input name="weekday" type="checkbox" value={index} defaultChecked={index === 1} /> {day}</label>)}</fieldset>}
                    {scheduleKind === "monthly" && <label>Dzień miesiąca<input name="monthDay" type="number" required min="1" max="31" defaultValue="1" /></label>}
                    <p className="muted">Pierwszy odczyt nastąpi w najbliższym terminie. Nieistniejąca godzina przy zmianie czasu i brakujący dzień miesiąca są pomijane; powtórzona godzina wykona się raz. Po przerwie komputer wykona jedno zaległe sprawdzenie.</p>
                  </>}
                  <label><input name="continue" type="checkbox" /> Śledź dalej po pierwszym dopasowaniu</label>
                  <label>Dodatkowy kanał powiadomień<select value={notificationChannel} onChange={event => setNotificationChannel(event.target.value)}><option value="">Tylko centrum zdarzeń JARVIS</option><option value="desktop">Powiadomienia systemowe</option>{connectors.filter(item => item.kind === "ntfy").map(item => <option key={item.id} value={item.id}>ntfy · {item.label}</option>)}</select></label>
                  <label><input name="quiet" type="checkbox" defaultChecked /> Cisza nocna 22:00–07:00</label>
                  <button type="submit" className="btn primary" disabled={monitorBusy}>Zatwierdź źródło i utwórz monitor</button>
                </form>
              </details>
              {monitorData && !monitorData.ok && <p role="alert">{monitorData.error}</p>}
              {monitorMessage && <p role="status">{monitorMessage}</p>}
              {(monitorData?.goals || []).map((monitor) => <article key={monitor.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
                <strong>{monitor.title}</strong> · {monitorLabel[monitor.state] || monitor.state}
                <div style={{ overflowWrap: "anywhere" }}>{sourceLabel(monitor.source)}</div>
                <div>Wynik: {resultLabel[monitor.lastResult || ""] || monitor.lastResult || "jeszcze nie sprawdzono"}</div>
                <div>Ostatnie sprawdzenie: {time(monitor.lastCheckAt)} · udane: {time(monitor.lastSuccessAt)}</div>
                {monitor.source.kind === "changedetection" && <div>Ostatnie sprawdzenie strony przez changedetection: {time(monitor.lastSourceCheckAt)}</div>}
                <div>Następne: {time(monitor.nextCheckAt)} · {monitor.schedule ? `${({ daily: "codziennie", weekly: "dni tygodnia", monthly: "dzień miesiąca" })[monitor.schedule.kind]} ${monitor.schedule.weekdays?.join(", ") || monitor.schedule.day || ""} ${monitor.schedule.time} Europe/Warsaw` : `co ${monitor.intervalMs / 60000} min`}</div>
                {(monitor.lastError || monitor.error) && <p role="alert">{monitor.lastError?.message || monitor.error}</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {!["CANCELLED", "COMPLETED", "PAUSED"].includes(monitor.state) && <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "pause", id: monitor.id })}>Pauza</button>}
                  {["PAUSED", "BLOCKED", "WAITING_INPUT", "WAITING_APPROVAL"].includes(monitor.state) && <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "resume", id: monitor.id })}>Wznów</button>}
                  {!["CANCELLED", "COMPLETED"].includes(monitor.state) && <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "cancel", id: monitor.id })}>Anuluj monitor</button>}
                  {!["CANCELLED", "COMPLETED"].includes(monitor.state) && <button className="btn" disabled={monitorBusy} onClick={() => setEditingMonitor(editingMonitor === monitor.id ? null : monitor.id)}>Zmień kryteria</button>}
                  <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "mute", id: monitor.id, muted: true })}>Wycisz</button>
                  <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "mute", id: monitor.id, muted: false })}>Włącz alerty</button>
                </div>
                {editingMonitor === monitor.id && <form onSubmit={(event) => {
                  event.preventDefault(); const data = new FormData(event.currentTarget);
                  const text = (key: string) => String(data.get(key) || "").trim();
                  void controlMonitor({ action: "update", id: monitor.id, criteria: { contains: text("contains"), ...(text("variant") ? { variant: text("variant") } : {}), ...(text("condition") ? { condition: text("condition") } : {}), ...(text("maxTotal") ? { maxTotal: Number(text("maxTotal")), currency: text("currency") } : {}) } });
                }}>
                  <label>Wymagany tekst<input name="contains" required defaultValue={monitor.criteria.contains} /></label>
                  <label>Wariant<input name="variant" defaultValue={monitor.criteria.variant} /></label>
                  <label>Stan<input name="condition" defaultValue={monitor.criteria.condition} /></label>
                  <label>Koszt z dostawą<input name="maxTotal" type="number" min="0" step="0.01" defaultValue={monitor.criteria.maxTotal} /></label>
                  <label>Waluta<input name="currency" defaultValue={monitor.criteria.currency || "PLN"} maxLength={3} /></label>
                  <button className="btn" disabled={monitorBusy}>Zapisz nową wersję kryteriów</button>
                </form>}
                <details><summary>Szczegóły</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(monitor, null, 2)}</pre></details>
              </article>)}
              <details><summary>Zakresowe zgody źródeł</summary>
                {(monitorData?.grants || []).map((grant) => <div key={grant.id} style={{ overflowWrap: "anywhere", marginTop: 8 }}>{sourceLabel(grant.source)} {grant.revokedAt ? "— cofnięta" : <button className="btn" disabled={monitorBusy} onClick={() => void controlMonitor({ action: "revoke", id: grant.id })}>Cofnij zgodę</button>}</div>)}
              </details>
              <details><summary>Centrum powiadomień ({monitorData?.events?.length || 0})</summary>
                {(monitorData?.events || []).map((event) => <article key={event.id} style={{ marginTop: 10 }}>
                  <strong>{event.title}</strong> · {time(event.observedAt)}
                  <div>{matchReason(event.reason)} {event.total != null && `${event.total} ${event.currency || ""}`}</div>
                  {event.url && /^https?:\/\//i.test(event.url) && <a href={event.url} target="_blank" rel="noreferrer">Otwórz źródło dopasowania</a>}
                  <div>Alert: {event.state === "ACCEPTED" ? "przyjęty przez kanał; brak potwierdzenia doręczenia i odczytu" : event.state === "UNCERTAIN" ? "niepewny skutek wysyłki — wymaga sprawdzenia" : event.state}</div>
                  <div>Cel: {event.goalId} · zdarzenie: {event.id}</div>
                  {event.readAt ? <span>Przeczytane: {time(event.readAt)}</span> : <button className="btn" disabled={monitorBusy} onClick={async () => {
                    setMonitorBusy(true);
                    try { const result = await desktop()?.monitorReadEvent?.(event.id); if (!result?.ok) throw new Error(result?.error || "Nie zapisano odczytu."); loadMonitors(); }
                    catch (error) { setMonitorMessage(String(error)); } finally { setMonitorBusy(false); }
                  }}>Oznacz jako przeczytane</button>}
                </article>)}
              </details>
            </>}
          </section>

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
                    <button className="btn" style={{ width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, minHeight: 44 }} onClick={() => void doPause(g)}>⏸ Pauza</button>
                  )}
                  {canStop(g.status) && <button type="button" className="btn" style={{ width: "auto", marginTop: 0, minHeight: 44 }} onClick={() => {
                    if (requestGoalStop(g.id)) setResumeMsg("STOP przyjęty. Bieżący skutek może wymagać sprawdzenia.");
                    else void upsertGoal({ ...g, status: "cancelled", updatedAt: now() }).then(load).catch((e) => setResumeMsg(String(e)));
                  }}>STOP</button>}
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
