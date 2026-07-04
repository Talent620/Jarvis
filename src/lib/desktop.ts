// Most do sterowania komputerem (Windows/desktop) wystawiony przez Electron preload.
// Na Androidzie/web window.jarvisDesktop nie istnieje — funkcje zwracają komunikat.

export interface JarvisDesktop {
  platform: string;
  open(target: string): Promise<string>;
  launch(appName: string): Promise<string>;
  power(action: string): Promise<string>;
  volume(action: string): Promise<string>;
  media(action: string): Promise<string>;
  screenshot(): Promise<string>;
  notify(title: string, body: string): Promise<string>;
  type(text: string, window?: string): Promise<string>;
  hotkey(combo: string, window?: string): Promise<string>;
  clipWatch(enabled: boolean): Promise<boolean>;
  onClipboard(cb: (text: string) => void): () => void;
  onVoiceMode(cb: () => void): () => void;
  /** Project Horizon — token/status lokalnego węzła EXE (tylko własna ramka). */
  horizonToken?(): Promise<string | null>;
  horizonStatus?(): Promise<{ listening: boolean; port?: number; hasToken?: boolean; paired?: boolean; host?: string; lan?: boolean }>;
  /** Parowanie QR: zwraca ładunek { v, url, secret, name } do wyświetlenia jako QR. */
  horizonPair?(lanUrl?: string, name?: string): Promise<{ v: number; url: string; secret: string; name: string } | null>;
  horizonUnpair?(): Promise<{ ok: boolean }>;
  /** Kontrolowane wyjście na LAN (jawna zgoda); zwraca { ok, host?/reason }. */
  horizonLan?(enable: boolean, ip?: string): Promise<{ ok: boolean; host?: string; port?: number; reason?: string }>;
}

export function desktop(): JarvisDesktop | null {
  return (typeof window !== "undefined" && (window as any).jarvisDesktop) || null;
}

export const isDesktop = (): boolean => !!desktop();

/** Token lokalnego węzła EXE (null poza desktopem / gdy listener nie stoi). */
export async function horizonExeToken(): Promise<string | null> {
  const d = desktop();
  if (!d || typeof d.horizonToken !== "function") return null;
  try { return await d.horizonToken(); } catch { return null; }
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

export async function typeText(text: string, window?: string): Promise<string> {
  const d = desktop();
  if (!d) return NOT_DESKTOP;
  const r = await d.type(text, window).catch((e) => `err:${e}`);
  if (r === "ok") return `Wpisuję tekst${window ? ` w „${window}"` : ""}.`;
  if (r === "err:unsupported") return "Pisanie tekstu jest dostępne tylko na Windows.";
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
  if (r === "err:unsupported") return "Skróty klawiszowe są dostępne tylko na Windows.";
  if (r === "err:unknown") return `Nie rozpoznałem skrótu „${combo}".`;
  return `Nie udało się wysłać skrótu (${r}).`;
}
