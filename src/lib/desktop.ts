// Most do sterowania komputerem (Windows/desktop) wystawiony przez Electron preload.
// Na Androidzie/web window.jarvisDesktop nie istnieje — funkcje zwracają komunikat.
import { store } from "./store";
import { abortable } from "./abort";

export interface JarvisDesktop {
  platform: string;
  skillCommand?(request: Record<string, unknown>, taskId?: string, allowNetwork?: boolean, executionId?: string): Promise<NativeSkillResponse>;
  skillPolicy?(request: Record<string, unknown>): Promise<NativeSkillResponse>;
  skillCancel?(taskId: string, executionId?: string): Promise<{ ok: boolean }>;
  skillRelease?(taskId: string): Promise<{ ok: boolean }>;
  browserCommand?(request: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
  browserGrant?(request: { origin: string; actions: string[]; allowLocal: boolean }): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
  monitorConnectorList?(): Promise<{ ok: boolean; connectors?: Array<{ id: string; kind: string; label: string; baseUrl: string; configured: boolean }>; error?: string }>;
  monitorConnectorConfigure?(request: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
  monitorConnectorRemove?(id: string): Promise<{ ok: boolean; error?: string }>;
  monitorReadEvent?(id: string): Promise<MonitorResponse>;
  clipboardRead?(): Promise<{ ok: boolean; text?: string; truncated?: boolean; error?: string }>;
  monitorCommand?(request: Record<string, unknown>): Promise<MonitorResponse>;
  monitorGrant?(request: { source: MonitorSource; desktopNotification: boolean; ntfyNotification?: string }): Promise<MonitorResponse>;
  monitorSettings?(request?: { backgroundEnabled?: boolean }): Promise<{ ok: boolean; backgroundEnabled?: boolean; error?: string }>;
  listWindows?(): Promise<{ ok: boolean; windows?: { id: string; title: string }[]; truncated?: boolean; error?: string }>;
  focusWindow?(id: string, title: string): Promise<{ ok: boolean; id?: string; title?: string; error?: string }>;
  stopWorkspaceProcesses?(): Promise<{ ok: boolean; requested?: number; error?: string }>;
  ensureLocalSiteOs?(url: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; error?: string }>;
  ensureLocalOllama?(url: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; error?: string }>;
  agentTool?(tool: string, input?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
  mcpStdioConnect?(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string; tools?: unknown[] }>;
  mcpStdioCall?(server: string, tool: string, input?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; result?: unknown }>;
  mcpStdioDisconnect?(server: string): Promise<{ ok: boolean; error?: string }>;
  hardwareInfo?(): Promise<{ ok: boolean; platform?: string; cpu?: string; cores?: number; ramGb?: number; gpu?: string; vramGb?: number; error?: string }>;
  open(target: string): Promise<string>;
  launch(appName: string): Promise<string>;
  power(action: string): Promise<string>;
  volume(action: string): Promise<string>;
  media(action: string): Promise<string>;
  screenshot(): Promise<string>;
  notify(title: string, body: string): Promise<string>;
  activeWindow?(): Promise<{ ok: boolean; title?: string; error?: string }>;
  click?(x: number, y: number, window: string): Promise<string>;
  type(text: string, window?: string): Promise<string>;
  hotkey(combo: string, window?: string): Promise<string>;
  clipWatch(enabled: boolean): Promise<boolean>;
  onClipboard(cb: (text: string) => void): () => void;
  onVoiceMode(cb: () => void): () => void;
}

export function desktop(): JarvisDesktop | null {
  return (typeof window !== "undefined" && (window as any).jarvisDesktop) || null;
}

export const isDesktop = (): boolean => !!desktop();

export interface NativeSkillRecord {
  id: string; publisher: string; name: string; version: string; description: string;
  state: string; hash: string; license: string; permissions: string[]; codeKind: string;
  source: { kind?: string; repo?: string; commit?: string; localRoot?: string; path?: string };
  test?: unknown;
}
export interface NativeSkillResponse {
  ok: boolean; error?: string; skills?: NativeSkillRecord[]; candidates?: Array<Record<string, unknown>>;
  policies?: Array<Record<string, unknown>>; sources?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
const skillTasks = new WeakMap<AbortSignal, string>();
const skillTaskParents = new WeakMap<AbortSignal, AbortSignal>();
const skillExecutions = new WeakMap<AbortSignal, string>();
const skillTaskChildren = new WeakMap<AbortSignal, Set<AbortSignal>>();
export function linkNativeSkillAttempt(parent: AbortSignal | undefined, child: AbortSignal): void {
  if (!parent) return;
  skillTaskParents.set(child, parent);
  if (!skillTaskChildren.has(parent)) skillTaskChildren.set(parent, new Set());
  skillTaskChildren.get(parent)!.add(child);
}
/** Goal identity comes from the persisted executor, never from model tool input. */
export async function bindNativeSkillGoal(signal: AbortSignal, goalId: string): Promise<void> {
  if (!desktop()?.skillCommand) return;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(goalId)));
  skillTasks.set(signal, `skill-goal-${Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")}`);
}
const skillActions = new Set(["list", "search", "search_mcp", "watch_create", "scan", "inspect", "stage", "test", "activate", "disable", "revoke", "remove", "rollback", "resource", "run", "update", "assert_task", "author"]);
function skillTask(signal?: AbortSignal): string {
  if (!signal) return `skill-single-${crypto.randomUUID()}`;
  let id = skillTasks.get(signal);
  if (!id) { const parent = skillTaskParents.get(signal); id = parent ? skillTask(parent) : `skill-task-${crypto.randomUUID()}`; skillTasks.set(signal, id); }
  return id;
}
export async function nativeSkillCommand(request: Record<string, unknown>, signal?: AbortSignal): Promise<NativeSkillResponse> {
  if (!skillActions.has(String(request.action))) throw new Error("Zgody umiejętności nadaje właściciel w ustawieniach.");
  if (signal?.aborted) throw new DOMException("Zatrzymano zadanie", "AbortError");
  const bridge = desktop();
  if (!bridge?.skillCommand) return { ok: false, error: "Menedżer umiejętności wymaga aktualnej aplikacji desktopowej." };
  const taskId = skillTask(signal);
  let executionId = signal ? skillExecutions.get(signal) : undefined;
  if (!executionId) { executionId = `skill-exec-${crypto.randomUUID()}`; if (signal) skillExecutions.set(signal, executionId); }
  const cancel = () => { void bridge.skillCancel?.(taskId, executionId).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    // The model cannot supply trusted context or steal another task's pin.
    const { taskId: _task, trustedUserAction: _trusted, signal: _signal, ...safe } = request;
    const result = await abortable(bridge.skillCommand(safe, taskId, !store.settings.onDeviceOnly, executionId), signal);
    if (signal?.aborted) throw new DOMException("Zatrzymano zadanie", "AbortError");
    if (!result.ok) throw new Error(result.error || "Operacja umiejętności nie została potwierdzona.");
    return result;
  } finally { signal?.removeEventListener("abort", cancel); }
}
export async function assertNativeSkillTask(signal?: AbortSignal): Promise<void> {
  if (!signal || !desktop()?.skillCommand) return;
  let current: AbortSignal | undefined = signal;
  while (current && !skillTasks.has(current)) current = skillTaskParents.get(current);
  if (current) await nativeSkillCommand({ action: "assert_task" }, signal);
}
export async function releaseNativeSkillTask(signal?: AbortSignal): Promise<void> {
  if (!signal) return;
  const taskId = skillTasks.get(signal);
  const forget = (current: AbortSignal) => {
    for (const child of skillTaskChildren.get(current) || []) forget(child);
    skillTasks.delete(current); skillTaskChildren.delete(current); skillTaskParents.delete(current); skillExecutions.delete(current);
  };
  forget(signal);
  if (taskId) await desktop()?.skillRelease?.(taskId).catch(() => {});
}

const NOT_DESKTOP = "Ta akcja działa tylko w aplikacji desktopowej JARVIS (Windows .exe).";

export async function launchApp(appName: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const r = await d.launch(appName).catch((e) => `err:${e}`);
  return r === "ok" ? `Uruchamiam: ${appName}.` : `Nie udało się uruchomić „${appName}" (${r}).`;
}

export async function openOnPc(target: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const r = await d.open(target).catch((e) => `err:${e}`);
  return r === "ok" ? `Otwieram: ${target}.` : `Nie udało się otworzyć „${target}" (${r}).`;
}

const POWER_LABEL: Record<string, string> = {
  lock: "Blokuję komputer.",
  sleep: "Usypiam komputer.",
  restart: "Uruchamiam ponownie komputer.",
  shutdown: "Wyłączam komputer.",
  logoff: "Wylogowuję użytkownika.",
};

export async function powerPc(action: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const a = action.toLowerCase().trim();
  const r = await d.power(a).catch((e) => `err:${e}`);
  if (r === "ok") return POWER_LABEL[a] || `Wykonano: ${a}.`;
  if (r === "err:unsupported") return "Akcje zasilania są dostępne tylko na Windows.";
  return `Nie udało się wykonać akcji „${a}" (${r}).`;
}

export async function volumePc(action: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const a = action.toLowerCase().trim();
  const r = await d.volume(a).catch((e) => `err:${e}`);
  if (r === "ok") return a === "mute" ? "Przełączam wyciszenie." : a === "up" ? "Głośniej." : "Ciszej.";
  if (r === "err:unsupported") return "Sterowanie głośnością jest dostępne tylko na Windows.";
  return `Nie udało się zmienić głośności (${r}).`;
}

const MEDIA_LABEL: Record<string, string> = {
  playpause: "Odtwarzam/pauzuję.", play: "Odtwarzam.", pause: "Pauzuję.",
  next: "Następny utwór.", prev: "Poprzedni utwór.", previous: "Poprzedni utwór.", stop: "Zatrzymuję.",
};

export async function mediaPc(action: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const a = action.toLowerCase().trim();
  const r = await d.media(a).catch((e) => `err:${e}`);
  if (r === "ok") return MEDIA_LABEL[a] || "Gotowe.";
  if (r === "err:unsupported") return "Sterowanie multimediami jest dostępne tylko na Windows.";
  return `Nie udało się sterować odtwarzaniem (${r}).`;
}

/** Natywne powiadomienie Windows (lub false poza desktopem / starszym .exe). */
export async function desktopNotify(title: string, body: string): Promise<boolean> {
  const d = desktop();
  if (!d?.notify) return false;
  const r = await d.notify(title, body).catch(() => "err");
  return r === "ok";
}

/** Zrzut ekranu komputera → obraz do analizy wizyjnej (lub null poza desktopem). */
export async function captureScreen(): Promise<{ data: string; mediaType: string } | null> {
  const d = desktop();
  if (!d) return null;
  const r = await d.screenshot().catch(() => "err");
  if (!r || r.startsWith("err")) return null;
  return { data: r, mediaType: "image/png" };
}

function linuxInputError(r: string): string | null {
  const labels: Record<string, string> = {
    "err:owner-confirmation-pending": "Właściciel podejmuje decyzję o zakresie zgody. Automatyczne sterowanie pulpitem czeka na zamknięcie tego okna.",
    "err:linux-session": "Sterowanie klawiaturą wymaga sesji X11. Sesja Wayland wymaga portalu i zgody systemowej; ta funkcja nie jest tu jeszcze dostępna.",
    "err:linux-window-required": "Podaj fragment tytułu aktywnego okna docelowego.",
    "err:linux-window-mismatch": "Aktywne okno nie odpowiada wskazanemu tytułowi lub fokus się zmienił. Nie wysłano zdarzenia.",
    "err:linux-no-window": "Nie udało się ustalić aktywnego okna.",
    "err:linux-xdotool-missing": "Brakuje programu xdotool. Zainstaluj go w systemie, aby korzystać ze sterowania X11.",
    "err:linux-text-unsupported": "Wpisywanie X11 obsługuje obecnie tylko zwykły tekst ASCII do 2000 znaków.",
    "err:linux-pointer-mismatch": "Wskaźnik nie znajduje się nad wskazanym aktywnym oknem. Nie kliknięto.",
    "err:linux-coordinates": "Nieprawidłowe współrzędne albo punkt poza aktywnym oknem. Nie kliknięto.",
    "err:linux-input-failed": "Nie udało się wysłać zdarzenia klawiatury do okna X11.",
  };
  return labels[r] || null;
}

export async function activeWindowOnPc(): Promise<string> {
  const d = desktop();
  if (!d?.activeWindow) return "Odczyt aktywnego okna wymaga aplikacji desktopowej z obsługą X11.";
  const r = await d.activeWindow().catch(() => ({ ok: false, error: "err:linux-input-failed" }));
  if (r.ok && "title" in r && r.title) return `Aktywne okno: ${r.title}`;
  return linuxInputError(r.error || "") || `Nie udało się odczytać aktywnego okna (${r.error || "brak odpowiedzi"}).`;
}

export async function clickOnPc(x: number, y: number, window: string): Promise<string> {
  const d = desktop();
  if (!d?.click) return "Klikanie przez tę funkcję jest dostępne w aplikacji desktopowej z obsługą X11.";
  const r = await d.click(x, y, window).catch(() => "err:linux-input-failed");
  if (r === "ok") return "Wysłano kliknięcie do wskazanego okna. Sprawdź rezultat na ekranie.";
  return linuxInputError(r) || `Nie udało się kliknąć (${r}).`;
}

export async function typeText(text: string, window?: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const r = await d.type(text, window).catch((e) => `err:${e}`);
  if (r === "ok") return `Wpisuję tekst${window ? ` w „${window}"` : ""}.`;
  if (r === "err:unsupported") return "Pisanie tekstu jest dostępne tylko na Windows lub X11.";
  const detail = linuxInputError(r);
  if (detail) return detail;
  return `Nie udało się wpisać tekstu (${r}).`;
}

/**
 * Obserwator schowka (desktop, opt-in): włącza nasłuch w procesie głównym i
 * subskrybuje świeżo skopiowane teksty. Zwraca funkcję sprzątającą (lub null
 * poza desktopem / gdy preload nie wspiera tej funkcji — starszy .exe).
 */
export function watchClipboard(onText: (text: string) => void): (() => void) | null {
  const d = desktop();
  if (!d?.clipWatch || !d?.onClipboard) return null;
  void d.clipWatch(true);
  const off = d.onClipboard(onText);
  return () => {
    void d.clipWatch(false);
    off();
  };
}

export async function hotkey(combo: string, window?: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const r = await d.hotkey(combo, window).catch((e) => `err:${e}`);
  if (r === "ok") return `Skrót: ${combo}${window ? ` w „${window}"` : ""}.`;
  if (r === "err:unsupported") return "Skróty klawiszowe są dostępne tylko na Windows lub X11.";
  const detail = linuxInputError(r);
  if (detail) return detail;
  if (r === "err:unknown") return `Nie rozpoznałem skrótu „${combo}".`;
  return `Nie udało się wysłać skrótu (${r}).`;
}


export type MonitorSource = { kind: "json"; url: string } | { kind: "directory"; path: string } | { kind: "changedetection"; connectorId: string; watchId: string };
export interface MonitorRecord {
  id: string; title: string; state: string; source: MonitorSource;
  criteria: { contains: string; variant?: string; condition?: string; maxTotal?: number; currency?: string };
  criteriaVersion: number; nextCheckAt?: number; lastCheckAt?: number; lastSuccessAt?: number; lastSourceCheckAt?: number;
  lastResult?: string; lastError?: { code: string; at: number; message: string } | null; error?: string; intervalMs: number;
  schedule?: { kind: "daily" | "weekly" | "monthly"; time: string; weekdays?: number[]; day?: number } | null;
}
export interface MonitorEvent {
  id: string; goalId: string; title: string; state: string; reason?: string | Record<string, unknown>; url?: string;
  total?: number; currency?: string; observedAt: number; readAt?: number;
}
export interface MonitorGrant { id: string; source: MonitorSource; revokedAt?: number; expiresAt?: number }
export interface MonitorResponse {
  ok: boolean; error?: string; goals?: MonitorRecord[]; events?: MonitorEvent[];
  grants?: MonitorGrant[]; runtime?: Record<string, unknown>; goal?: MonitorRecord;
}

/** Only scoped commands are available to model tools. Grants have a separate native UI. */
export async function monitorCommand(request: Record<string, unknown>): Promise<MonitorResponse> {
  const command = desktop()?.monitorCommand;
  if (!command) return { ok: false, error: "Trwały monitoring wymaga aktualnej aplikacji desktopowej. Web i telefon nie uruchamiają wykonawcy w tle." };
  if (!["list", "create", "pause", "resume", "cancel", "update", "revoke", "mute", "stop_all"].includes(String(request.action)))
    return { ok: false, error: "Niedozwolona komenda monitora. Zgody nadaje właściciel w panelu Celów." };
  return command(request);
}

export async function listWindowsOnPc(): Promise<string> {
  const result = await desktop()?.listWindows?.();
  return result ? JSON.stringify(result) : "Lista okien wymaga aktualnego JARVIS Desktop i sesji X11.";
}
export async function focusWindowOnPc(id: string, title: string): Promise<string> {
  const result = await desktop()?.focusWindow?.(id, title);
  return result ? JSON.stringify(result) : "Wybór okna wymaga aktualnego JARVIS Desktop i sesji X11.";
}

export async function readClipboardOnPc(): Promise<string> {
  const result = await desktop()?.clipboardRead?.();
  return result ? JSON.stringify(result) : "Odczyt schowka wymaga aplikacji desktopowej.";
}
