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
  ensureLocalSiteOs?(url: string): Promise<{ ok: boolean; started?: boolean; skipped?: boolean; error?: string }>;
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
