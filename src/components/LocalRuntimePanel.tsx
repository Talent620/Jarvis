import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, CircleAlert, RefreshCw, Server, Square, Unplug } from "lucide-react";
import Modal from "./Modal";
import { DEFAULT_RUNTIME_URL, displayedRuntimeState, forgetRuntimeConnection, loadRuntimeConnection, normalizeRuntimeUrl, requestRuntimeStart, runtimeRequest, waitForRuntimeConnection,
  saveRuntimeConnection, RuntimeHttpError, type RuntimeArchivePage, type RuntimeArchivedJob, type RuntimeConnection, type RuntimeJob, type RuntimeModel, type RuntimeProfile, type RuntimeStatus } from "../lib/localRuntimeClient";
import { forgetPendingRuntimeSubmission, loadPendingRuntimeSubmission, otherRuntimePendingSubmissions, preparePendingRuntimeSubmission, reconcilePendingRuntimeSubmission, RuntimePendingRecordError, runtimePendingStorageKey, runtimeSubmissionScope, submitPendingRuntimeJob, type RuntimeOtherPendingSubmission, type RuntimePendingSubmission, type RuntimeSubmissionScope } from "../lib/runtimePendingSubmission";
import "../styles/local-runtime.css";

const STATE_LABEL: Record<string, string> = { UNKNOWN: "Jeszcze nie sprawdzono", SETUP: "Wymaga konfiguracji", READY: "Model odpowiada", DEGRADED: "Wymaga sprawdzenia", NEEDS_ACTION: "Potrzebne działanie", OFFLINE: "Brak połączenia" };
const JOB_LABEL: Record<RuntimeJob["status"], string> = { queued: "W kolejce", running: "Analizuję", completed: "Wynik gotowy", failed: "Wymaga uwagi", cancelled: "Anulowano" };
const timeLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pl-PL") : "Brak pomiaru";
const desktopBridge = () => (window as unknown as { jarvisDesktop?: {
  runtimeConnection?: () => Promise<RuntimeConnection | null>;
  runtimeStart?: () => Promise<{ ok: boolean; error?: string }>;
} }).jarvisDesktop;

export default function LocalRuntimePanel({ onClose }: { onClose: () => void }) {
  const [connection, setConnection] = useState<RuntimeConnection | null>(loadRuntimeConnection);
  const [automaticConnection, setAutomaticConnection] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [url, setUrl] = useState(connection?.url || DEFAULT_RUNTIME_URL);
  const [token, setToken] = useState(connection?.token || "");
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [profile, setProfile] = useState<RuntimeProfile | null>(null);
  const [models, setModels] = useState<RuntimeModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsError, setModelsError] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [jobs, setJobs] = useState<RuntimeJob[]>([]);
  const [online, setOnline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [action, setAction] = useState("");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState(false);
  const [view, setView] = useState<"tasks" | "configuration" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<RuntimePendingSubmission | null>(null);
  const [pendingRecordId, setPendingRecordId] = useState("");
  const [pendingError, setPendingError] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [loadedPendingScope, setLoadedPendingScope] = useState("");
  const [otherPending, setOtherPending] = useState<RuntimeOtherPendingSubmission[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveJobs, setArchiveJobs] = useState<RuntimeArchivedJob[]>([]);
  const [archiveCursor, setArchiveCursor] = useState<string | null>(null);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveDetails, setArchiveDetails] = useState<Record<string, RuntimeJob>>({});
  const [archiveDetailError, setArchiveDetailError] = useState<Record<string, string>>({});
  const [archiveDetailLoading, setArchiveDetailLoading] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const discoveryController = useRef<AbortController | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  const archiveController = useRef<AbortController | null>(null);
  const archiveDetailController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const desktop = desktopBridge();
  const serverId = status?.serverId;
  const scope = useMemo(() => {
    if (!connection || !serverId) return null;
    try { return runtimeSubmissionScope(connection.url, serverId); } catch { return null; }
  }, [connection, serverId]);
  const scopeKey = scope ? runtimePendingStorageKey(scope) : "";
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; refreshController.current?.abort(); actionController.current?.abort(); discoveryController.current?.abort(); recoveryController.current?.abort(); archiveController.current?.abort(); archiveDetailController.current?.abort(); };
  }, []);

  const discoverConnection = useCallback(async (signal?: AbortSignal) => {
    const bridge = desktopBridge();
    if (!bridge?.runtimeConnection) return;
    setDiscovering(true); setStartupError("");
    try {
      const automatic = await waitForRuntimeConnection(() => bridge.runtimeConnection!(), { signal });
      if (signal?.aborted || !mounted.current) return;
      if (!automatic) return;
      setConnection(automatic); setAutomaticConnection(true); setUrl(automatic.url); setToken(automatic.token);
      setStatus(null); setProfile(null); setJobs([]); setModels([]); setModel(""); setModelsError(""); setModelsLoaded(false); setOnline(false); setError(""); setConnectionError("");
    } finally { if (!signal?.aborted && mounted.current) setDiscovering(false); }
  }, []);

  useEffect(() => {
    if (loadRuntimeConnection()) return;
    const controller = new AbortController();
    discoveryController.current = controller;
    void discoverConnection(controller.signal);
    return () => controller.abort();
  }, [discoverConnection]);

  const startAndConnect = async () => {
    if (starting || discovering || !desktop?.runtimeStart) return;
    discoveryController.current?.abort();
    const controller = new AbortController(); discoveryController.current = controller;
    setStarting(true); setStartupError(""); setError(""); setConnectionError("");
    try {
      const result = await requestRuntimeStart(() => desktop.runtimeStart!(), { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (!result.ok) { setStartupError(result.error || "Nie udało się uruchomić lokalnej usługi. Spróbuj ponownie."); return; }
      await discoverConnection(controller.signal);
    } catch { if (!controller.signal.aborted && mounted.current) setStartupError("Nie udało się uruchomić lokalnej usługi. Spróbuj ponownie."); }
    finally { if (!controller.signal.aborted && mounted.current) setStarting(false); }
  };

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    if (!connection) return;
    try {
      const response = await runtimeRequest<{ models: RuntimeModel[] }>(connection, "/v1/models", { signal });
      if (!Array.isArray(response.models) || response.models.some((item) => !item || typeof item.name !== "string")) throw new Error("Nieprawidłowa lista modeli.");
      if (signal?.aborted || !mounted.current) return;
      setModels(response.models); setModelsError("");
    } catch (e) { if (!signal?.aborted && mounted.current) setModelsError(e instanceof Error ? e.message : "Nie można odczytać listy modeli."); }
    finally { if (!signal?.aborted && mounted.current) setModelsLoaded(true); }
  }, [connection]);

  useEffect(() => {
    const controller = new AbortController();
    void loadModels(controller.signal);
    return () => controller.abort();
  }, [loadModels]);

  const refresh = useCallback(async () => {
    if (!connection || refreshController.current) return;
    const controller = new AbortController(); refreshController.current = controller;
    setRefreshing(true);
    try {
      const [nextStatus, nextProfile, nextJobs] = await Promise.all([
        runtimeRequest<RuntimeStatus>(connection, "/v1/status", { signal: controller.signal }),
        runtimeRequest<RuntimeProfile>(connection, "/v1/profile", { signal: controller.signal }),
        runtimeRequest<{ jobs: RuntimeJob[] }>(connection, "/v1/jobs", { signal: controller.signal }),
      ]);
      if (!nextStatus.readiness || !nextStatus.queue || !nextStatus.serverId || !nextProfile.active || !Array.isArray(nextJobs.jobs)) throw new Error("Serwer zwrócił niepełny stan. Sprawdź zgodność wersji usługi.");
      if (controller.signal.aborted || !mounted.current) return;
      setStatus(nextStatus); setProfile(nextProfile); setJobs(nextJobs.jobs); setOnline(true); setConnectionError(""); setNow(Date.now());
    } catch (e) {
      if (controller.signal.aborted || !mounted.current) return;
      setOnline(false); setConnectionError(e instanceof Error ? e.message : "Nie udało się pobrać stanu serwera.");
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, [connection]);

  useEffect(() => {
    void refresh();
    const tick = () => { if (!document.hidden) { setNow(Date.now()); void refresh(); } };
    const timer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); refreshController.current?.abort(); refreshController.current = null; };
  }, [refresh]);

  const checkPending = useCallback(async () => {
    if (!connection || !scope || actionController.current || recoveryController.current) return;
    let saved: RuntimePendingSubmission | null;
    try {
      setOtherPending(otherRuntimePendingSubmissions(scope));
      saved = loadPendingRuntimeSubmission(scope);
      setPending(saved); setPendingRecordId(saved?.idempotencyKey || ""); setPendingError(""); setLoadedPendingScope(scopeKey);
    } catch (e) { setPendingRecordId(e instanceof RuntimePendingRecordError ? e.idempotencyKey : ""); setPendingError(e instanceof Error ? e.message : "Nie można odczytać zgłoszenia."); setLoadedPendingScope(scopeKey); return; }
    if (!saved) { setPendingNote(""); return; }
    const controller = new AbortController(); recoveryController.current = controller;
    setPendingNote("Sprawdzam, czy serwer przyjął zapisane zgłoszenie…");
    try {
      const found = await reconcilePendingRuntimeSubmission(connection, scope, saved, { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (found) {
        const next = loadPendingRuntimeSubmission(scope);
        setPending(next); setPendingRecordId(next?.idempotencyKey || ""); setPrompt(current => current === saved.prompt ? "" : current);
        setPendingNote(next ? "Serwer potwierdził poprzednie zgłoszenie. Poniżej kolejna zachowana lokalna kopia; nie została automatycznie wysłana." : "Serwer potwierdził przyjęcie. Tymczasowa kopia polecenia została usunięta z tego urządzenia.");
        await refresh();
      } else setPendingNote("Serwer nie znalazł tego identyfikatora. Możesz ponowić dokładnie to samo zgłoszenie; zachowamy jego identyfikator.");
    } catch (e) { if (!controller.signal.aborted && mounted.current) setPendingNote(e instanceof Error ? e.message : "Nie udało się potwierdzić przyjęcia. Zapis pozostaje zachowany."); }
    finally { if (recoveryController.current === controller) recoveryController.current = null; }
  }, [connection, scope, scopeKey, refresh]);

  useEffect(() => {
    setPending(null); setPendingRecordId(""); setPendingError(""); setPendingNote(""); setLoadedPendingScope(""); setOtherPending([]);
    setArchiveOpen(false); setArchiveJobs([]); setArchiveCursor(null); setArchiveTotal(null); setArchiveError(""); setArchiveDetails({}); setArchiveDetailError({}); setArchiveLoading(false); setArchiveDetailLoading("");
    void checkPending();
    return () => { recoveryController.current?.abort(); recoveryController.current = null; archiveController.current?.abort(); archiveController.current = null; archiveDetailController.current?.abort(); archiveDetailController.current = null; actionController.current?.abort(); };
  }, [checkPending]);

  const forgetPending = (target: RuntimeSubmissionScope | null = scope, idempotencyKey = pending?.idempotencyKey || pendingRecordId) => {
    if (!target || !idempotencyKey || actionController.current || recoveryController.current) return;
    if (!window.confirm("Usunąć tymczasową kopię zgłoszenia z tego urządzenia? To NIE anuluje zadania na serwerze. Ponowne wpisanie tego samego polecenia może utworzyć duplikat. Przed usunięciem sprawdź wyniki i historię serwera.")) return;
    try {
      forgetPendingRuntimeSubmission(target, idempotencyKey);
      if (runtimePendingStorageKey(target) === scopeKey) { const next = loadPendingRuntimeSubmission(target); setPending(next); setPendingRecordId(next?.idempotencyKey || ""); setPendingError(""); setLoadedPendingScope(scopeKey); }
      else setOtherPending(current => current.filter(item => runtimePendingStorageKey(item.scope, item.idempotencyKey) !== runtimePendingStorageKey(target, idempotencyKey)));
      setPendingNote("Usunięto tylko lokalną kopię. Zadanie na serwerze mogło pozostać aktywne.");
    }
    catch (e) { setPendingError(e instanceof Error ? e.message : "Nie można usunąć lokalnej kopii."); }
  };

  const loadArchive = async (more = false) => {
    if (!connection || !online || !status?.capabilities?.archivedResults || archiveController.current) return;
    const controller = new AbortController(); archiveController.current = controller;
    setArchiveLoading(true); setArchiveError("");
    try {
      const page = await runtimeRequest<RuntimeArchivePage>(connection, "/v1/jobs/archive", { signal: controller.signal, query: { limit: 20, ...(more && archiveCursor ? { cursor: archiveCursor } : {}) } });
      if (!Array.isArray(page.jobs) || page.jobs.some(job => !job || typeof job.id !== "string" || typeof job.promptPreview !== "string") || !(page.nextCursor === null || typeof page.nextCursor === "string") || !Number.isFinite(page.total)) throw new Error("Serwer zwrócił nieprawidłową stronę archiwum.");
      if (controller.signal.aborted || !mounted.current) return;
      setArchiveJobs(current => [...new Map([...(more ? current : []), ...page.jobs].map(job => [job.id, job])).values()]);
      setArchiveCursor(page.nextCursor); setArchiveTotal(page.total);
    } catch (e) {
      if (!controller.signal.aborted && mounted.current) setArchiveError(e instanceof RuntimeHttpError && e.status === 404 ? "Ta wersja serwera nie udostępnia archiwum. Bieżąca kolejka pozostaje dostępna." : e instanceof Error ? e.message : "Nie można odczytać archiwum.");
    } finally { if (archiveController.current === controller) archiveController.current = null; if (mounted.current && !controller.signal.aborted) setArchiveLoading(false); }
  };

  const loadArchivedJob = async (id: string) => {
    if (!connection || !online || archiveDetailController.current || archiveDetails[id]) return;
    const controller = new AbortController(); archiveDetailController.current = controller;
    setArchiveDetailLoading(id); setArchiveDetailError(current => ({ ...current, [id]: "" }));
    try {
      const { job } = await runtimeRequest<{ job: RuntimeJob }>(connection, `/v1/jobs/archive/${id}`, { signal: controller.signal });
      if (!job || job.id !== id || typeof job.prompt !== "string") throw new Error("Serwer zwrócił nieprawidłowy zapis archiwalny.");
      if (!controller.signal.aborted && mounted.current) setArchiveDetails(current => ({ ...current, [id]: job }));
    } catch (e) { if (!controller.signal.aborted && mounted.current) setArchiveDetailError(current => ({ ...current, [id]: e instanceof Error ? e.message : "Nie można pobrać wyniku." })); }
    finally { if (archiveDetailController.current === controller) archiveDetailController.current = null; if (mounted.current && !controller.signal.aborted) setArchiveDetailLoading(""); }
  };

  const connect = () => {
    try {
      const saved = saveRuntimeConnection({ url, token });
      discoveryController.current?.abort(); setDiscovering(false); setStartupError("");
      setStatus(null); setProfile(null); setJobs([]); setModels([]); setModel(""); setModelsLoaded(false); setOnline(false); setError(""); setConnectionError(""); setAutomaticConnection(false); setConnection(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "Nie można zapisać połączenia."); }
  };
  const changeUrl = (next: string) => {
    try { if (normalizeRuntimeUrl(next) !== normalizeRuntimeUrl(url)) setToken(""); }
    catch { setToken(""); }
    setUrl(next);
  };
  const disconnect = () => {
    try { forgetRuntimeConnection(); } catch { /* connection still gets cleared from this view */ }
    refreshController.current?.abort(); refreshController.current = null;
    discoveryController.current?.abort(); setDiscovering(false); setStartupError("");
    setConnection(null); setAutomaticConnection(false); setToken(""); setStatus(null); setProfile(null); setJobs([]); setModels([]); setModel(""); setModelsError(""); setModelsLoaded(false); setOnline(false); setError(""); setConnectionError("");
  };
  const runAction = async (name: string, run: (signal: AbortSignal) => Promise<void>) => {
    if (actionController.current || !connection) return;
    const controller = new AbortController(); actionController.current = controller; setAction(name); setError("");
    try { await run(controller.signal); if (!controller.signal.aborted && mounted.current && currentScope.current === scopeKey) await refresh(); }
    catch (e) {
      if (!controller.signal.aborted && mounted.current) {
        const message = e instanceof Error ? e.message : "Operacja nie powiodła się.";
        if (name === "enqueue") setPendingNote(message); else setError(message);
      }
    }
    finally { if (actionController.current === controller) actionController.current = null; if (mounted.current) setAction(""); }
  };
  const enqueue = () => {
    if (!connection || !scope || !online || !profile?.active.model || !status?.capabilities?.serverIdentityGuard || actionController.current || recoveryController.current || loadedPendingScope !== scopeKey || pendingError) return;
    try {
      const saved = pending ?? preparePendingRuntimeSubmission(scope, prompt);
      setPending(saved); setPendingRecordId(saved.idempotencyKey); setPendingNote("");
      void runAction("enqueue", async (signal) => {
        await submitPendingRuntimeJob(connection, scope, saved, { signal });
        if (!signal.aborted && mounted.current && currentScope.current === scopeKey) { const next = loadPendingRuntimeSubmission(scope); setPrompt(""); setPending(next); setPendingRecordId(next?.idempotencyKey || ""); setPendingNote(next ? "Serwer potwierdził poprzednie zgłoszenie. Poniżej kolejna zachowana lokalna kopia; nie została automatycznie wysłana." : "Serwer potwierdził przyjęcie. Tymczasowa kopia polecenia została usunięta z tego urządzenia."); }
      });
    } catch (e) { setPendingRecordId(e instanceof RuntimePendingRecordError ? e.idempotencyKey : ""); setPendingError(e instanceof Error ? e.message : "Nie można bezpiecznie zapisać zgłoszenia."); }
  };
  const state = !status && refreshing || online && status?.readiness.inProgress ? "UNKNOWN" : displayedRuntimeState(status?.readiness, online, now);
  const configurationVisible = view ? view === "configuration" : !profile?.active.model;
  const manualConnection = !!connection && !automaticConnection;
  const canStartLocal = !!desktop?.runtimeStart && !manualConnection;
  const visibleError = !starting && !discovering ? error || (!canStartLocal ? connectionError : "") : "";
  const visibleJobs = jobs.filter((job) => history ? !["queued", "running"].includes(job.status) : ["queued", "running"].includes(job.status))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return <Modal title="Analizy w tle" onClose={onClose} className="runtime-panel" foot={<button className="btn" onClick={onClose}>Zamknij panel</button>}>
    <div className="runtime-intro"><Server size={18} aria-hidden="true" /><p>Analizy lokalnym modelem · zadania trwają po zamknięciu aplikacji, gdy usługa serwera działa.</p></div>
    {visibleError && <p className="notice" role="alert">{visibleError}</p>}
    {!online && canStartLocal && <section className="runtime-startup runtime-startup--automatic" aria-labelledby="runtime-startup-title" aria-busy={starting || discovering}>
      <h3 id="runtime-startup-title">{starting || discovering ? "Łączę lokalną usługę…" : "Połącz JARVIS-a z tym komputerem"}</h3>
      <p>{starting || discovering ? "Aplikacja czeka na uruchomienie serwera. Istniejący model zostanie wykryty i sprawdzony automatycznie." : "Uruchom usługę i połącz ją z aplikacją. Adres oraz dostęp zostaną ustawione automatycznie."}</p>
      {startupError && <p role="alert">{startupError}</p>}
      <button className="btn primary" onClick={() => void startAndConnect()} disabled={!!action || starting || discovering}><Server size={17} aria-hidden="true" />{starting || discovering ? "Łączę…" : "Uruchom i połącz"}</button>
      <p className="muted">Korzystamy z modeli już zainstalowanych na komputerze.</p>
    </section>}
    {connection && <>
      <section className={`runtime-health runtime-health--${state.toLowerCase()}`} aria-label="Rzeczywisty stan modelu">
        <div className="runtime-health-title">{state === "READY" ? <CheckCircle2 size={22} aria-hidden="true" /> : <CircleAlert size={22} aria-hidden="true" />}<strong role="status">{online && status?.readiness.inProgress ? "Sprawdzam lokalny model…" : STATE_LABEL[state] || "Nieznany stan"}</strong><span className="runtime-active-model">{profile?.active.model || (status?.readiness.inProgress ? "Wykrywanie modelu" : "Brak wybranego modelu")}</span></div>
        <div className="runtime-actions"><button className="btn primary" disabled={!!action || !online || !profile?.active.model} onClick={() => void runAction("probe", async (signal) => { await runtimeRequest(connection, "/v1/probe", { method: "POST", signal, timeoutMs: 130_000 }); })}>{action === "probe" ? "Sprawdzam odpowiedź modelu…" : "Test lokalnego modelu"}</button><button className="btn" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} aria-hidden="true" />{refreshing ? "Odświeżam…" : "Odśwież"}</button></div>
        <details className="runtime-measurement"><summary>Pomiar i profil modelu</summary>
        <p>{online ? state === "DEGRADED" && status?.readiness.state === "READY" ? "Wynik poprzedniego testu wygasł. Uruchom test modelu ponownie." : status?.readiness.reason : "Stan modelu jest niepotwierdzony do czasu połączenia z serwerem."}</p>
        <dl className="runtime-facts"><div><dt>Ostatni test modelu</dt><dd>{timeLabel(status?.readiness.checkedAt)}</dd></div><div><dt>Ważny do</dt><dd>{timeLabel(status?.readiness.expiresAt)}</dd></div><div><dt>Aktywny model</dt><dd>{profile?.active.model || "Nie wybrano modelu"}</dd></div><div><dt>Profil</dt><dd>{profile ? `${profile.active.policy} · wersja ${profile.active.version}` : "Nie odczytano"}</dd></div></dl>
        {profile && <div><p>Żądany: {profile.requested.model || "brak modelu"}, {profile.requested.policy}, wersja {profile.requested.version}.</p><p>Aktywny: {profile.active.model || "brak modelu"}, {profile.active.policy}, wersja {profile.active.version}.</p><p className="muted">Test odpowiedzi dotyczy modelu analizy. Kodowanie, głos i izolacja procesów wymagają osobnej konfiguracji i weryfikacji.</p></div>}
        </details>
      </section>
    </>}
    {online && !status?.capabilities?.serverIdentityGuard && <section className="runtime-upgrade" aria-labelledby="runtime-upgrade-title"><h3 id="runtime-upgrade-title">Zaktualizuj usługę serwera</h3><p>Ta wersja usługi pozwala odczytać bieżące zadania, ale nie obsługuje bezpiecznego ponawiania zgłoszeń. Nowe polecenia nie są zapisywane ani wysyłane.</p>{!configurationVisible && <button className="btn" onClick={() => setView("configuration")}>Jak zaktualizować usługę</button>}</section>}
    {(pending || pendingError) && <section className="runtime-pending" aria-labelledby="runtime-pending-title">
      <h3 id="runtime-pending-title">Niepotwierdzone zgłoszenie</h3>
      <p>{pending ? "Zapisaliśmy lokalną kopię dla tej instancji serwera. Zadanie mogło już zostać przyjęte. Otwarcie panelu sprawdza stan, ale nie wysyła polecenia ponownie." : "Nie można potwierdzić lokalnego zapisu zgłoszenia. Nowe zadania są wstrzymane do czasu sprawdzenia lub świadomego usunięcia tej kopii."}</p>
      {pending && <details><summary>Zapisane polecenie · {new Date(pending.createdAt).toLocaleString("pl-PL")}</summary><pre>{pending.prompt}</pre><p className="muted">Identyfikator: {pending.idempotencyKey}</p></details>}
      {pendingError && <p role="alert">{pendingError}</p>}
      {pendingNote && <p role="status">{pendingNote}</p>}
      <div className="runtime-actions">
        <button className="btn" disabled={!!action || !online || !!recoveryController.current} onClick={() => void checkPending()}>Sprawdź przyjęcie</button>
        {pending && <button className="btn primary" disabled={!!action || !!pendingError || !online || !profile?.active.model || !status?.capabilities?.serverIdentityGuard || !!recoveryController.current} onClick={enqueue}>{action === "enqueue" ? "Ponawiam…" : "Ponów to samo zgłoszenie"}</button>}
        <button className="btn" disabled={!!action || !!recoveryController.current || !(pending?.idempotencyKey || pendingRecordId)} onClick={() => forgetPending()}>Usuń lokalną kopię</button>
      </div>
    </section>}
    {!pending && !pendingError && pendingNote && <p className="muted runtime-recovery-note" role="status">{pendingNote}</p>}
    {otherPending.length > 0 && <details className="runtime-other-pending"><summary>Lokalne kopie z poprzedniej instancji serwera · {otherPending.length}</summary>
      <p>Pod tym adresem działa teraz inny serwer. Poniższe zgłoszenia nie są do niego wysyłane. Wróć do pierwotnej instancji, aby sprawdzić przyjęcie, lub usuń tylko lokalną kopię.</p>
      {otherPending.map(item => <div key={`${item.scope.serverId}:${item.idempotencyKey}`}><p className="muted">Instancja: {item.scope.serverId}</p>{item.pending ? <details><summary>Zachowane polecenie</summary><pre>{item.pending.prompt}</pre></details> : <p>Nie można odczytać treści lokalnego zapisu.</p>}<button className="btn" disabled={!!action || !!recoveryController.current} onClick={() => forgetPending(item.scope, item.idempotencyKey)}>Usuń lokalną kopię poprzedniej instancji</button></div>)}
    </details>}
    <div className="runtime-view-switch" role="group" aria-label="Widok serwera lokalnego">
      <button className={`btn${!configurationVisible ? " primary" : ""}`} aria-pressed={!configurationVisible} onClick={() => setView("tasks")}>Zadania{status ? ` · ${status.queue.queued + status.queue.running}` : ""}</button>
      <button className={`btn${configurationVisible ? " primary" : ""}`} aria-pressed={configurationVisible} onClick={() => setView("configuration")}>Konfiguracja</button>
    </div>
    {configurationVisible ? <div className="runtime-configuration">
    {online && !status?.capabilities?.serverIdentityGuard && <section className="runtime-upgrade-steps"><h3>Aktualizacja lokalnej usługi na Linuksie</h3><p><strong>Instalacja ze źródeł:</strong> w aktualnej kopii projektu uruchom <code>bash scripts/install-runtime.sh</code>. Instalator wymienia pliki serwera i ponownie uruchamia usługę użytkownika systemd. Pełną aplikację aktualizuje <code>bash scripts/install-linux-source.sh</code>.</p><p><strong>Proces uruchomiony z AppImage:</strong> zamknij okno starej aplikacji i zatrzymaj jej serwer, używając <code>~/.local/bin/jarvis-runtime stop</code>, jeśli masz zainstalowane CLI, albo <code>npm run runtime -- stop</code> z katalogu projektu. Następnie otwórz aktualny AppImage. Samo ponowne otwarcie okna może wykorzystać nadal działającą starą usługę.</p><p className="muted">Po aktualizacji kliknij „Odśwież”. Dane zadań pozostają w dotychczasowym katalogu serwera.</p></section>}
    <details className="runtime-connection" open={!desktop?.runtimeConnection && !connection || manualConnection && !online && !refreshing}>
      <summary>Połączenie ręczne · zaawansowane {connection ? automaticConnection ? "· desktop" : "· zapisane" : ""}</summary>
      <p className="muted">Aplikacja desktopowa odczytuje adres i token lokalnej usługi automatycznie. Ręcznie wpisany token zostanie zapisany w tym kliencie dopiero po kliknięciu „Zapisz i połącz”. Zmiana adresu usuwa token z formularza — wpisz dostęp do nowego serwera.</p>
      <label htmlFor="runtime-url">Adres serwera</label><input id="runtime-url" type="url" value={url} onChange={(e) => changeUrl(e.target.value)} autoComplete="off" spellCheck={false} />
      <label htmlFor="runtime-token">Token dostępu</label><input id="runtime-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
      <div className="runtime-actions"><button className="btn primary" onClick={connect} disabled={!!action || starting || discovering || !token.trim()}>Zapisz i połącz</button>{connection && <button className="btn" onClick={disconnect} disabled={!!action || starting || discovering}><Unplug size={16} aria-hidden="true" />Zapomnij połączenie</button>}</div>
    </details>
    {!online && !desktop?.runtimeStart && <section className="runtime-startup" aria-labelledby="runtime-startup-title"><h3 id="runtime-startup-title">Uruchom lokalny serwer</h3><p>Po instalacji na Linuksie uruchom usługę w terminalu:</p><code>systemctl --user start jarvis-runtime.service</code><details><summary>Uruchamianie z kodu projektu i ręczne połączenie</summary><p>W katalogu projektu uruchom <code>npm run runtime -- start</code>. Pozostaw ten proces włączony. Adres i token są zapisane w pliku <code>~/.local/share/jarvis/runtime/connection.json</code> lub katalogu wskazanym przez ustawienia instalacji.</p></details></section>}
      {connection && online && <>
      {!profile?.active.model && !models.length && modelsLoaded && !status?.readiness.inProgress && <section className="runtime-model-setup" aria-labelledby="runtime-model-setup-title">
        <h3 id="runtime-model-setup-title">Przygotuj lokalny model</h3><p>Serwer działa. Potrzebuje jeszcze działającej Ollamy i modelu do analizy tekstu.</p>
        <ol><li>Zainstaluj lub uruchom <a href="https://ollama.com/download/linux" target="_blank" rel="noreferrer">Ollamę dla Linuksa</a>.</li><li>Wybierz <a href="https://ollama.com/library" target="_blank" rel="noreferrer">model odpowiedni do pamięci swojego komputera</a>. Pobierz go poleceniem <code>ollama pull NAZWA_MODELU</code>, zastępując nazwę wybranym modelem.</li><li>Kliknij „Odśwież modele”, wybierz pobrany model i sprawdź jego odpowiedź.</li></ol>
        {modelsError && <details><summary>Szczegóły wykrywania</summary><p>{modelsError}</p></details>}
      </section>}
      <section className="runtime-models" aria-labelledby="runtime-model-title"><h3 id="runtime-model-title">Model na serwerze</h3><p className="muted">Wybierz zainstalowany model. Po zapisaniu sprawdź jego rzeczywistą odpowiedź.</p>
        <label htmlFor="runtime-model">Dostępne modele</label><select id="runtime-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={!!action || !online}><option value="">Wybierz model…</option>{models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>
        {modelsError && !!profile?.active.model && <p className="muted">{modelsError}</p>}
        <div className="runtime-actions"><button className="btn primary" disabled={!!action || !online || !model} onClick={() => void runAction("model", async (signal) => { await runtimeRequest(connection, "/v1/profile", { method: "PUT", body: { model }, signal }); })}>{action === "model" ? "Zapisuję…" : "Użyj wybranego modelu"}</button><button className="btn" disabled={!!action} onClick={() => void loadModels()}>Odśwież modele</button></div>
      </section>
      </>}
      {profile?.active.model && <button className="btn runtime-to-tasks" onClick={() => setView("tasks")}>Przejdź do zadań</button>}
    </div> : <div className="runtime-workspace">
      {connection ? <>
      <section className="runtime-compose" aria-labelledby="runtime-queue-title"><h3 id="runtime-queue-title">Zleć analizę lokalnemu modelowi</h3><label htmlFor="runtime-prompt">Co przeanalizować?</label><textarea id="runtime-prompt" className="ta" value={prompt} disabled={!!pending || !!action} maxLength={16000} onChange={(e) => setPrompt(e.target.value)} placeholder="Opisz problem lub wklej tekst do przeanalizowania." /><button className="btn primary" onClick={enqueue} disabled={!!action || !online || !profile?.active.model || !status?.capabilities?.serverIdentityGuard || !scope || loadedPendingScope !== scopeKey || !!pending || !!pendingError || !prompt.trim()}><ArrowUpRight size={17} aria-hidden="true" />{action === "enqueue" ? "Dodaję…" : "Dodaj do kolejki serwera"}</button><p className="muted runtime-retention">Przed wysłaniem zapisujemy na tym urządzeniu tymczasową kopię polecenia i identyfikator dla tego serwera, bez tokenu. Usuwamy kopię po potwierdzeniu przyjęcia. Zadanie i wynik pozostają na serwerze.</p>{online && !status?.capabilities?.serverIdentityGuard && <p className="muted">Wysyłanie wymaga nowszej wersji lokalnej usługi. Bieżące zadania nadal możesz odczytywać.</p>}</section>
      <div className="runtime-queue-heading"><h3>Kolejka serwera {status && <small>{status.queue.queued} oczekuje · {status.queue.running} trwa</small>}</h3><div className="runtime-actions" role="group" aria-label="Widok zadań serwera"><button className={`chip${!history ? " on" : ""}`} aria-pressed={!history} onClick={() => setHistory(false)}>Aktywne</button><button className={`chip${history ? " on" : ""}`} aria-pressed={history} onClick={() => setHistory(true)}>Wyniki i historia</button></div></div>
      {!online && jobs.length > 0 && <p className="muted">Poniżej ostatnio pobrane zadania. Ich bieżący stan może się różnić.</p>}
      {!visibleJobs.length && <p className="runtime-empty">{online ? history ? "Brak zakończonych zadań." : "Brak aktywnych zadań na serwerze." : "Połącz się z serwerem, aby pobrać zadania."}</p>}
      {visibleJobs.map((job) => <article className="runtime-job" key={job.id}><div className="runtime-job-heading"><h4>{job.prompt.slice(0, 110)}{job.prompt.length > 110 ? "…" : ""}</h4><span className={`runtime-job-status runtime-job-status--${job.status}`}>{JOB_LABEL[job.status]}</span></div><p className="muted">{timeLabel(job.updatedAt)} · próba {job.attempt} · model: {job.model || "nie zapisano"}</p>{job.prompt.length > 110 && <details><summary>Pełne polecenie</summary><pre>{job.prompt}</pre></details>}{job.error && <p className="notice">{job.error}</p>}{job.result && <details open><summary>Wynik analizy</summary><pre>{job.result}</pre></details>}{["queued", "running"].includes(job.status) && <button className="btn" disabled={!!action || !online} onClick={() => void runAction(job.id, async (signal) => { await runtimeRequest(connection, `/v1/jobs/${job.id}/cancel`, { method: "POST", signal }); })}><Square size={14} aria-hidden="true" />{action === job.id ? "Anuluję…" : "Anuluj zadanie"}</button>}</article>)}
      {history && <details className="runtime-archive" open={archiveOpen} onToggle={event => {
        const open = event.currentTarget.open; setArchiveOpen(open);
        if (open && archiveTotal === null && !archiveController.current) void loadArchive();
      }}><summary>Archiwum wcześniejszych wyników{archiveTotal !== null ? ` · ${archiveTotal}` : ""}</summary>
        {!status?.capabilities?.archivedResults ? <p className="muted">Ta wersja serwera nie udostępnia archiwum. Zaktualizuj usługę, aby odczytać wcześniejsze wyniki. Bieżąca kolejka pozostaje dostępna.</p> : <>
          <p className="muted">Odczyt z serwera. Pełne polecenie i wynik pobieramy dopiero po wybraniu „Pokaż zapisany wynik”.</p>
          {!online && <p className="muted">Połącz się z serwerem, aby pobrać archiwum. Widoczne wcześniej odczytane wpisy mogą być nieaktualne.</p>}
          {archiveError && <p role="alert">{archiveError}</p>}
          {archiveLoading && <p role="status">Wczytuję archiwum…</p>}
          {archiveTotal === 0 && <p className="muted">Archiwum nie zawiera wcześniejszych wyników.</p>}
          {archiveJobs.map(job => <article className="runtime-job" key={job.id}>
            <div className="runtime-job-heading"><h4>{job.promptPreview}</h4><span className={`runtime-job-status runtime-job-status--${job.status}`}>{JOB_LABEL[job.status] || job.status}</span></div>
            <p className="muted">{timeLabel(job.updatedAt)} · model: {job.model || "nie zapisano"}{job.profileVersion !== undefined ? ` · profil ${job.profileVersion}` : ""}</p>
            {archiveDetails[job.id] ? <details open><summary>Zapisany wynik</summary><h4>Polecenie</h4><pre>{archiveDetails[job.id].prompt}</pre>{archiveDetails[job.id].result && <><h4>Wynik analizy</h4><pre>{archiveDetails[job.id].result}</pre></>}{archiveDetails[job.id].error && <p className="notice">{archiveDetails[job.id].error}</p>}{!archiveDetails[job.id].result && !archiveDetails[job.id].error && <p className="muted">W tym wpisie nie zapisano treści wyniku.</p>}</details> : <button className="btn" disabled={!online || !!archiveDetailLoading} onClick={() => void loadArchivedJob(job.id)}>{archiveDetailLoading === job.id ? "Pobieram wynik…" : "Pokaż zapisany wynik"}</button>}
            {archiveDetailError[job.id] && <p role="alert">{archiveDetailError[job.id]}</p>}
          </article>)}
          <div className="runtime-actions"><button className="btn" disabled={!online || archiveLoading} onClick={() => void loadArchive()}>Odśwież archiwum</button>{archiveCursor && <button className="btn" disabled={!online || archiveLoading} onClick={() => void loadArchive(true)}>Wczytaj więcej</button>}</div>
        </>}
      </details>}
      </> : <p className="runtime-empty">Najpierw połącz lokalną usługę w zakładce Konfiguracja.</p>}
    </div>}
  </Modal>;
}
