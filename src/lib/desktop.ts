// Most do sterowania komputerem (Windows/desktop) wystawiony przez Electron preload.
// Na Androidzie/web window.jarvisDesktop nie istnieje — funkcje zwracają komunikat.

export interface SystemDiagnosticItem {
  id: string;
  label: string;
  status: "available" | "missing" | "disabled" | "error";
  detail: string;
  fixHint?: string;
}

export interface SystemDiagnosticsReport {
  ok: boolean;
  platform: string;
  distro?: string;
  sessionType?: string;
  gpu?: string;
  vramGb?: number;
  items: SystemDiagnosticItem[];
  error?: string;
}

export interface JarvisDesktop {
  platform: string;
  ensureLocalSiteOs?(url: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; token?: string; error?: string }>;
  ensureLocalForge?(url?: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; url?: string; token?: string; error?: string }>;
  ensureLocalOllama?(url: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; error?: string }>;
  agentTool?(tool: string, input?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
  mcpStdioConnect?(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string; tools?: unknown[] }>;
  mcpStdioCall?(server: string, tool: string, input?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; result?: unknown }>;
  mcpStdioDisconnect?(server: string): Promise<{ ok: boolean; error?: string }>;
  hardwareInfo?(): Promise<{ ok: boolean; platform?: string; distro?: string; sessionType?: string; cpu?: string; cores?: number; ramGb?: number; gpu?: string; vramGb?: number; error?: string }>;
  systemDiagnostics?(): Promise<SystemDiagnosticsReport>;
  secureStorageAvailable?(): Promise<boolean>;
  encryptSecret?(plaintext: string): Promise<{ ok: boolean; data?: string; error?: string }>;
  decryptSecret?(b64: string): Promise<{ ok: boolean; text?: string; error?: string }>;
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
  // OMNI-PILOT
  pilotCursorPos?(): Promise<{ ok: boolean; x?: number; y?: number; estimated?: boolean; error?: string }>;
  pilotMove?(payload: { mode?: "relative" | "absolute" | "named"; dx?: number; dy?: number; x?: number; y?: number; preset?: string; smooth?: boolean }): Promise<{ ok: boolean; x?: number; y?: number; error?: string }>;
  pilotMouse?(payload: { action?: "click" | "left" | "double" | "right" | "middle"; x?: number; y?: number; smooth?: boolean }): Promise<{ ok: boolean; action?: string; error?: string }>;
  pilotScroll?(payload: { direction?: "up" | "down" | "left" | "right"; amount?: number }): Promise<{ ok: boolean; direction?: string; amount?: number; error?: string }>;
  pilotDrag?(payload: { x1: number; y1: number; x2: number; y2: number }): Promise<{ ok: boolean; error?: string }>;
  pilotWindows?(): Promise<{ ok: boolean; windows?: { id: string; title: string }[]; error?: string }>;
  pilotFocus?(query: string): Promise<{ ok: boolean; window?: { id: string; title: string }; error?: string }>;
  pilotTypeUnicode?(text: string): Promise<{ ok: boolean; chars?: number; error?: string }>;
  pilotHotkey?(combo: string): Promise<{ ok: boolean; combo?: string; error?: string }>;
  pilotAbort?(): Promise<{ ok: boolean; seq?: number }>;
  screenshotDetailed?(): Promise<{ ok: boolean; data?: string; mediaType?: string; width?: number; height?: number; screenWidth?: number; screenHeight?: number; cursorX?: number; cursorY?: number; error?: string }>;
  pilotUiTree?(maxNodes?: number): Promise<{ ok: boolean; backend?: string; windowTitle?: string; nodes?: UiTreeNode[]; error?: string }>;
  pilotUiFind?(query: string): Promise<{ ok: boolean; found?: boolean; backend?: string; windowTitle?: string; node?: UiTreeNode; score?: number; error?: string }>;
  desktopDiagnose?(): Promise<DesktopDoctorReport>;
  onOmniAbort?(cb: () => void): () => void;
}

export function desktop(): JarvisDesktop | null {
  return (typeof window !== "undefined" && (window as any).jarvisDesktop) || null;
}

export const isDesktop = (): boolean => !!desktop();
export const isLinuxDesktop = (): boolean => desktop()?.platform === "linux";

/** Pobierz ujednolicony raport diagnostyczny systemu (W1: available/missing/disabled/error). */
export async function desktopDiagnostics(): Promise<SystemDiagnosticsReport | null> {
  const d = desktop();
  if (!d?.systemDiagnostics) return null;
  try { return await d.systemDiagnostics(); } catch { return null; }
}

/** Sprawdź, czy pęk kluczy systemu (Linux Secret Service / KWallet / Windows DPAPI) jest dostępny. */
export async function desktopKeyringAvailable(): Promise<boolean> {
  const d = desktop();
  if (!d?.secureStorageAvailable) return false;
  try { return await d.secureStorageAvailable(); } catch { return false; }
}

const NOT_DESKTOP = "Ta akcja działa tylko w aplikacji desktopowej JARVIS (Linux / Windows).";

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
  if (r === "err:unsupported") return "Akcje zasilania są dostępne tylko na desktopie (Linux / Windows).";
  return `Nie udało się wykonać akcji „${a}" (${r}).`;
}

export async function volumePc(action: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const a = action.toLowerCase().trim();
  const r = await d.volume(a).catch((e) => `err:${e}`);
  if (r === "ok") return a === "mute" ? "Przełączam wyciszenie." : a === "up" ? "Głośniej." : a === "down" ? "Ciszej." : `Głośność ustawiona (${a}).`;
  if (r === "err:unsupported") return "Sterowanie głośnością jest dostępne tylko na desktopie (Linux / Windows).";
  if (r === "err:not-found") return "Brak narzędzia audio (zainstaluj wpctl / pactl / amixer).";
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
  if (r === "err:unsupported") return "Sterowanie multimediami jest dostępne tylko na desktopie (Linux / Windows).";
  if (r === "err:not-found") return "Brak playerctl (zainstaluj: sudo apt install playerctl).";
  return `Nie udało się sterować odtwarzaniem (${r}).`;
}

/** Natywne powiadomienie systemowe (Linux / Windows; false poza desktopem). */
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

// === OMNI-PILOT: płynny kursor, mysz, przewijanie, drag, okna, UTF-8, szczegółowy zrzut ===

export interface DetailedScreenshot {
  data: string;
  mediaType: string;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  cursorX: number;
  cursorY: number;
}

export function formatPilotError(code?: string): string {
  const c = String(code || "");
  if (c === "err:wayland-ydotool-missing") return "Na sesji Wayland zainstaluj ydotool (sudo apt install ydotool && sudo systemctl enable --now ydotoold) albo przełącz sesję na X11.";
  if (c === "err:linux-xdotool-missing") return "Brak xdotool — zainstaluj: sudo apt install -y xdotool wmctrl.";
  if (c === "err:window-not-found") return "Nie znaleziono otwartego okna pasującego do tej nazwy.";
  if (c === "err:aborted") return "Przerwano sterowanie pulpitem.";
  if (c === "err:no-window-manager") return "Brak menedżera okien EWMH w tej sesji X11 (np. czysty Xvfb) — okno istnieje, ale system nie obsługuje przełączania fokusu.";
  return linuxInputError(c) || c || "nieznany błąd";
}

export async function captureScreenDetailed(): Promise<DetailedScreenshot | null> {
  const d = desktop();
  if (!d) return null;
  if (d.screenshotDetailed) {
    const r = await d.screenshotDetailed().catch(() => ({ ok: false as const }));
    if (r.ok && "data" in r && r.data) {
      return {
        data: r.data,
        mediaType: r.mediaType || "image/png",
        width: r.width || 1440,
        height: r.height || 810,
        screenWidth: r.screenWidth || 1920,
        screenHeight: r.screenHeight || 1080,
        cursorX: r.cursorX ?? 0,
        cursorY: r.cursorY ?? 0,
      };
    }
  }
  const fb = await captureScreen();
  if (!fb) return null;
  return {
    data: fb.data,
    mediaType: fb.mediaType,
    width: 1600,
    height: 900,
    screenWidth: typeof window !== "undefined" ? window.screen?.width || 1920 : 1920,
    screenHeight: typeof window !== "undefined" ? window.screen?.height || 1080 : 1080,
    cursorX: 0,
    cursorY: 0,
  };
}

export async function moveCursorOnPc(payload: {
  mode?: "relative" | "absolute" | "named";
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
  preset?: string;
  smooth?: boolean;
}): Promise<{ ok: boolean; x?: number; y?: number; message: string }> {
  const d = desktop();
  if (!d?.pilotMove) return { ok: false, message: NOT_DESKTOP };
  const r: { ok: boolean; x?: number; y?: number; error?: string } = await d
    .pilotMove(payload)
    .catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) return { ok: true, x: r.x, y: r.y, message: `Przesunięto kursor (${r.x ?? 0}, ${r.y ?? 0}).` };
  return { ok: false, message: `Nie udało się przesunąć kursora: ${formatPilotError(r.error)}` };
}

export async function mouseActionOnPc(payload: {
  action?: "click" | "left" | "double" | "right" | "middle";
  x?: number;
  y?: number;
  smooth?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (!d?.pilotMouse) return { ok: false, message: NOT_DESKTOP };
  const r = await d.pilotMouse(payload).catch((e) => ({ ok: false, error: String(e) }));
  const labels: Record<string, string> = { click: "Kliknięto", left: "Kliknięto", double: "Kliknięto dwukrotnie", right: "Kliknięto prawym", middle: "Kliknięto środkowym" };
  if (r.ok) return { ok: true, message: `${labels[payload.action || "click"] || "Kliknięto"}.` };
  return { ok: false, message: `Nie udało się kliknąć: ${formatPilotError(r.error)}` };
}

export async function scrollOnPc(direction: "up" | "down" | "left" | "right", amount = 5): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (!d?.pilotScroll) return { ok: false, message: NOT_DESKTOP };
  const r = await d.pilotScroll({ direction, amount }).catch((e) => ({ ok: false, error: String(e) }));
  const labels: Record<string, string> = { up: "w górę", down: "w dół", left: "w lewo", right: "w prawo" };
  if (r.ok) return { ok: true, message: `Przewinięto ${labels[direction] || direction}.` };
  return { ok: false, message: `Nie udało się przewinąć: ${formatPilotError(r.error)}` };
}

export async function dragOnPc(x1: number, y1: number, x2: number, y2: number): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (!d?.pilotDrag) return { ok: false, message: NOT_DESKTOP };
  const r = await d.pilotDrag({ x1, y1, x2, y2 }).catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) return { ok: true, message: `Przeciągnięto z (${x1}, ${y1}) do (${x2}, ${y2}).` };
  return { ok: false, message: `Nie udało się przeciągnąć: ${formatPilotError(r.error)}` };
}

export async function listWindowsOnPc(): Promise<{ ok: boolean; windows: { id: string; title: string }[]; message: string }> {
  const d = desktop();
  if (!d?.pilotWindows) return { ok: false, windows: [], message: NOT_DESKTOP };
  const r: { ok: boolean; windows?: { id: string; title: string }[]; error?: string } = await d
    .pilotWindows()
    .catch((e) => ({ ok: false, windows: [], error: String(e) }));
  if (r.ok) {
    const list = r.windows || [];
    const preview = list.slice(0, 12).map((w) => w.title).join(", ");
    return { ok: true, windows: list, message: list.length ? `Otwarte okna (${list.length}): ${preview}.` : "Brak wykrytych otwartych okien." };
  }
  return { ok: false, windows: [], message: `Nie udało się pobrać listy okien: ${formatPilotError(r.error)}` };
}

export async function focusWindowOnPc(query: string): Promise<{ ok: boolean; title?: string; message: string }> {
  const d = desktop();
  if (!d?.pilotFocus) return { ok: false, message: NOT_DESKTOP };
  const r: { ok: boolean; window?: { id: string; title: string }; error?: string } = await d
    .pilotFocus(query)
    .catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) return { ok: true, title: r.window?.title, message: `Przełączono na okno: ${r.window?.title || query}.` };
  return { ok: false, message: `Nie udało się przełączyć okna „${query}": ${formatPilotError(r.error)}` };
}

export async function typeUnicodeOnPc(text: string): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (!d?.pilotTypeUnicode) return { ok: false, message: NOT_DESKTOP };
  const r = await d.pilotTypeUnicode(text).catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) return { ok: true, message: `Wpisano tekst (${text.length} znaków).` };
  return { ok: false, message: `Nie udało się wpisać tekstu: ${formatPilotError(r.error)}` };
}

export async function pilotHotkeyOnPc(combo: string): Promise<{ ok: boolean; message: string }> {
  const d = desktop();
  if (!d?.pilotHotkey) return { ok: false, message: NOT_DESKTOP };
  const r = await d.pilotHotkey(combo).catch((e) => ({ ok: false, error: String(e) }));
  if (r.ok) return { ok: true, message: `Wysłano skrót ${combo}.` };
  return { ok: false, message: `Nie udało się wysłać skrótu ${combo}: ${formatPilotError(r.error)}` };
}

export async function abortDesktopPilot(): Promise<void> {
  const d = desktop();
  try { await d?.pilotAbort?.(); } catch { /* ignore */ }
}

// === OMNI-FRONTIER: Semantyczne Drzewo UI (AT-SPI2 / UIA) + Diagnostyka „Znajdź i Napraw” ===

export interface UiTreeNode {
  name: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  isPassword?: boolean;
}

export interface UiFindResult {
  ok: boolean;
  found: boolean;
  backend?: string;
  windowTitle?: string;
  node?: UiTreeNode;
  score?: number;
  error?: string;
}

export interface DesktopDoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
  fixHint?: string;
}

export interface DesktopDoctorReport {
  ok: boolean;
  platform: string;
  sessionType?: string;
  checks: DesktopDoctorCheck[];
  generatedAt?: string;
  error?: string;
}

export async function queryUiTreeOnPc(maxNodes = 160): Promise<{ ok: boolean; backend?: string; windowTitle?: string; nodes: UiTreeNode[]; message: string }> {
  const d = desktop();
  if (!d?.pilotUiTree) return { ok: false, nodes: [], message: NOT_DESKTOP };
  const r: { ok: boolean; backend?: string; windowTitle?: string; nodes?: UiTreeNode[]; error?: string } = await d
    .pilotUiTree(maxNodes)
    .catch((e) => ({ ok: false, nodes: [], error: String(e) }));
  if (r.ok) {
    const nodes = r.nodes || [];
    const sample = nodes.slice(0, 15).map((n) => `[${n.role}] ${n.name} (${n.centerX},${n.centerY})`).join(" | ");
    return {
      ok: true,
      backend: r.backend,
      windowTitle: r.windowTitle,
      nodes,
      message: `Drzewo UI (${r.backend || "os"}, okno „${r.windowTitle || "?"}”, ${nodes.length} elementów): ${sample || "brak widocznych etykiet"}.`,
    };
  }
  return { ok: false, nodes: [], message: `Drzewo dostępności UI niedostępne (${r.error || "brak"}) — przechodzę na analizę wizyjną.` };
}

export async function findUiNodeOnPc(query: string): Promise<UiFindResult> {
  const d = desktop();
  if (!d?.pilotUiFind) return { ok: false, found: false, error: "err:not-desktop" };
  const r: UiFindResult = await d
    .pilotUiFind(query)
    .then((res) => ({
      ok: !!res.ok,
      found: !!res.found,
      backend: res.backend,
      windowTitle: res.windowTitle,
      node: res.node,
      score: res.score,
      error: res.error,
    }))
    .catch((e) => ({ ok: false, found: false, error: String(e) }));
  return r;
}

export function formatDesktopDoctorReport(rep: DesktopDoctorReport): string {
  if (!rep.ok) return `Nie udało się uruchomić diagnostyki systemu (${rep.error || "brak danych"}).`;
  const icon = (s: DesktopDoctorCheck["status"]) => (s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌");
  const lines = [
    `🩺 **Diagnostyka systemu (${rep.platform}${rep.sessionType ? ` · ${rep.sessionType}` : ""}):**`,
    ...rep.checks.map((c) => `- ${icon(c.status)} **${c.label}:** ${c.detail}${c.fixHint ? `\n  → Naprawa: \`${c.fixHint}\`` : ""}`),
  ];
  return lines.join("\n");
}

export async function diagnoseDesktopOnPc(): Promise<{ ok: boolean; report?: DesktopDoctorReport; message: string; spokenText: string }> {
  const d = desktop();
  if (!d?.desktopDiagnose) {
    return { ok: false, message: NOT_DESKTOP, spokenText: "Diagnostyka systemu działa na komputerze z aplikacją JARVIS." };
  }
  const rep: DesktopDoctorReport = await d
    .desktopDiagnose()
    .catch((e) => ({ ok: false, platform: d.platform || "unknown", checks: [], error: String(e) }));
  const warns = (rep.checks || []).filter((c) => c.status !== "ok");
  const spokenText = !rep.ok
    ? "Nie udało się pobrać diagnostyki systemu."
    : warns.length === 0
      ? "System wygląda zdrowo: dźwięk, dysk i narzędzia OMNI-PILOT działają prawidłowo."
      : `Wykryłem ${warns.length} rzeczy do sprawdzenia: ${warns.map((w) => w.label).join(", ")}. Szczegóły i komendy naprawcze wypisałem na ekranie.`;
  return { ok: rep.ok, report: rep, message: formatDesktopDoctorReport(rep), spokenText };
}

