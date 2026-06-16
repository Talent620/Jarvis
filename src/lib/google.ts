import { store } from "./store";
import { fetchTimeout } from "./http";

function base(): string | null {
  const u = store.settings.syncUrl?.trim();
  return u ? u.replace(/\/$/, "") : null;
}

async function call(path: string, body?: unknown): Promise<any> {
  const b = base();
  const tok = store.settings.syncToken?.trim();
  if (!b || !tok) return { error: "Skonfiguruj backend (⚙ → Synchronizacja) i połącz konto Google." };
  try {
    // Backend robi po stronie serwera kilka zapytań do Google — dajemy zapas czasu (15 s).
    const res = await fetchTimeout(`${b}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }, 15000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Błąd (${res.status}).` };
    return data;
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { error: aborted ? "Przekroczono czas połączenia z backendem." : `Błąd połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

/** URL do rozpoczęcia logowania Google (otwierany w przeglądarce). */
export function googleStartUrl(): string | null {
  const b = base();
  const tok = store.settings.syncToken?.trim();
  return b && tok ? `${b}/v1/google/start?token=${encodeURIComponent(tok)}` : null;
}

/** Czy backend (BFF) jest gotowy — warunek konieczny połączenia z Google. */
export function googleBackendReady(): boolean {
  return !!base() && !!store.settings.syncToken?.trim();
}

/** Otwórz autoryzację Google: na desktopie w systemowej przeglądarce, na webie w nowej karcie. */
export function startGoogleAuth(): boolean {
  const url = googleStartUrl();
  if (!url || typeof window === "undefined") return false;
  try {
    const bridge = (window as { jarvisDesktop?: { open?: (u: string) => void } }).jarvisDesktop;
    if (bridge?.open) bridge.open(url);
    else window.open(url, "_blank", "noopener");
    return true;
  } catch {
    return false;
  }
}

// --- Natywna synchronizacja Kalendarza na DESKTOPIE (.exe) — bez serwera/BFF ---
interface DesktopGoogle {
  googleConnect?: (id: string, secret: string) => Promise<{ ok?: boolean; error?: string }>;
  googleStatus?: () => Promise<{ connected?: boolean }>;
  gcalAdd?: (ev: { summary: string; start: string; end?: string; location?: string }) => Promise<{ ok?: boolean; error?: string }>;
  gcalList?: (opts: { timeMin?: string; timeMax?: string; max?: number }) => Promise<{ events?: { start: string; summary: string; location?: string }[]; error?: string }>;
}
function deskGoogle(): DesktopGoogle | null {
  const b = typeof window !== "undefined" ? (window as { jarvisDesktop?: DesktopGoogle }).jarvisDesktop : null;
  return b && b.gcalList && b.gcalAdd ? b : null;
}

/** Połącz Kalendarz natywnie na tym komputerze (OAuth loopback). Zwraca komunikat dla użytkownika. */
export async function connectDesktopGoogle(): Promise<string> {
  const b = deskGoogle();
  if (!b?.googleConnect) return "Natywna synchronizacja działa w aplikacji na Windows (.exe).";
  const id = store.settings.googleClientId?.trim();
  const secret = store.settings.googleClientSecret?.trim();
  if (!id || !secret) return "Wklej najpierw Client ID i Client Secret w ⚙ → Integracje → Kalendarz Google (z pliku od Google).";
  const r = await b.googleConnect(id, secret);
  return r?.ok ? "✅ Połączono Kalendarz Google na tym komputerze." : `Nie udało się połączyć: ${r?.error || "spróbuj ponownie"}.`;
}

// Gdy backend odpowie „Google niepołączone." — JARVIS SAM otwiera autoryzację (autonomicznie),
// zamiast tylko zgłaszać błąd. Otwieramy najwyżej raz na 20 s, by nie mnożyć kart/okien.
let lastAuthOpenedAt = 0;
function autoConnect(err: string): string | null {
  if (!/google niepo|połącz konto google|reconnect|invalid_grant|reauth/i.test(err)) return null;
  if (!googleBackendReady()) {
    return "Aby JARVIS sam korzystał z Kalendarza i Gmaila, ustaw najpierw backend: ⚙ → Integracje → Synchronizacja (adres + token). Potem połączę konto Google automatycznie.";
  }
  const now = Date.now();
  if (now - lastAuthOpenedAt > 20000) {
    lastAuthOpenedAt = now;
    startGoogleAuth();
  }
  return "🔗 Łączę z Kontem Google — otworzyłem stronę logowania. Kliknij „Zezwól”, a potem poproś ponownie (np. „co mam jutro w kalendarzu”).";
}

export async function gmailSearch(query = ""): Promise<string> {
  const r = await call("/v1/gmail/list", { query, max: 10 });
  if (r.error) return autoConnect(r.error) || r.error;
  const items = r.messages || [];
  return items.length
    ? items.map((m: any) => `• [${m.id}] ${m.from} — ${m.subject}\n  ${m.snippet}`).join("\n")
    : "Brak pasujących wiadomości.";
}

/** Krótkie podsumowanie nieprzeczytanych maili (do porannego briefingu). */
export async function gmailUnreadSummary(max = 5): Promise<string> {
  const r = await call("/v1/gmail/list", { query: "is:unread", max });
  if (r.error) return "";
  const items = r.messages || [];
  if (!items.length) return "Brak nieprzeczytanych maili.";
  return `Nieprzeczytane maile (${items.length}${items.length >= max ? "+" : ""}): ` +
    items.map((m: any) => `${m.from} — ${m.subject}`).join("; ");
}

/** Pełna treść jednego e-maila (po id z gmail_search) — do czytania i odpowiadania. */
export async function gmailRead(id: string): Promise<string> {
  const r = await call("/v1/gmail/get", { id });
  if (r.error) return autoConnect(r.error) || r.error;
  return [
    `Od: ${r.from}`,
    `Temat: ${r.subject}`,
    r.date ? `Data: ${r.date}` : "",
    "",
    r.body || "(pusta treść)",
    "",
    `[id=${r.id}; threadId=${r.threadId}; messageId=${r.messageId}]`,
  ].filter((x) => x !== "").join("\n");
}

export async function gmailSend(to: string, subject: string, body: string): Promise<string> {
  const r = await call("/v1/gmail/send", { to, subject, body });
  if (r.error) return autoConnect(r.error) || r.error;
  return `Wysłano e-mail do ${to}.`;
}

/** Odpowiedz na e-mail w tym samym wątku (threadId + Message-ID z gmail_read). */
export async function gmailReply(to: string, subject: string, body: string, threadId?: string, inReplyTo?: string): Promise<string> {
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const r = await call("/v1/gmail/send", { to, subject: subj, body, threadId, inReplyTo });
  if (r.error) return autoConnect(r.error) || r.error;
  return `Wysłano odpowiedź do ${to}.`;
}

// Desktop niepołączony → spróbuj połączyć natywnie (jeśli są dane), inaczej pokieruj.
async function desktopAutoConnect(): Promise<string> {
  if (store.settings.googleClientId?.trim() && store.settings.googleClientSecret?.trim()) {
    const msg = await connectDesktopGoogle();
    return msg.startsWith("✅") ? `${msg} Poproś ponownie o kalendarz.` : msg;
  }
  return "Aby połączyć Kalendarz na tym komputerze, wklej Client ID i Client Secret w ⚙ → Integracje → Kalendarz Google.";
}

function fmtEvents(events: { start: string; summary: string; location?: string }[]): string {
  return events.length
    ? events.map((e) => `• ${new Date(e.start).toLocaleString("pl-PL")} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : "Brak nadchodzących wydarzeń w Kalendarzu Google.";
}

export async function gcalList(): Promise<string> {
  const b = deskGoogle();
  if (b) {
    if (!(await b.googleStatus?.())?.connected) return await desktopAutoConnect();
    const dr = await b.gcalList!({ max: 10 });
    return dr.error || fmtEvents(dr.events || []);
  }
  const r = await call("/v1/gcal/list", { max: 10 });
  if (r.error) return autoConnect(r.error) || r.error;
  const ev = r.events || [];
  return ev.length
    ? ev.map((e: any) => `• ${new Date(e.start).toLocaleString("pl-PL")} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : "Brak nadchodzących wydarzeń w Kalendarzu Google.";
}

/** Zakres całego dnia (00:00–24:00) w ISO — do odczytu „co mam danego dnia". */
export function dayRangeISO(date = new Date()): { timeMin: string; timeMax: string } {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

/** Wydarzenia z konkretnego dnia (offset: 0=dziś, 1=jutro, -1=wczoraj). */
export async function gcalDay(dayOffset = 0, silent = false): Promise<string> {
  // silent=true (np. poranny briefing): NIE otwieramy autoryzacji w tle — gdy niepołączone
  // zwracamy "" i briefing po prostu pomija kalendarz.
  const d = new Date(); d.setDate(d.getDate() + dayOffset);
  const { timeMin, timeMax } = dayRangeISO(d);
  const label = d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  const b = deskGoogle();
  let ev: { start: string; summary: string; location?: string }[];
  if (b) {
    if (!(await b.googleStatus?.())?.connected) return silent ? "" : await desktopAutoConnect();
    const dr = await b.gcalList!({ max: 25, timeMin, timeMax });
    if (dr.error) return dr.error;
    ev = dr.events || [];
  } else {
    const r = await call("/v1/gcal/list", { max: 25, timeMin, timeMax });
    if (r.error) return silent ? "" : (autoConnect(r.error) || r.error);
    ev = r.events || [];
  }
  return ev.length
    ? `📅 ${label}:\n` + ev.map((e: any) => `• ${new Date(e.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : `📅 ${label}: brak zapisów w kalendarzu.`;
}

// Czas bez strefy (np. „2026-06-20T10:00:00") backend interpretuje w UTC → wydarzenie
// przesunęłoby się o offset użytkownika (w PL o 1–2 h). Dokładamy LOKALNY offset, by godzina
// w kalendarzu była dokładnie ta, którą poda użytkownik. Czas ze strefą (Z lub +/-hh:mm) zostaje.
export function withLocalOffset(s: string): string {
  const t = (s || "").trim();
  if (!t || /([zZ]|[+-]\d{2}:?\d{2})$/.test(t)) return t;
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const off = -d.getTimezoneOffset(); // minuty względem UTC (PL latem = +120)
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  return `${t}${sign}${hh}:${mm}`;
}

export async function gcalAdd(summary: string, start: string, end?: string, location?: string): Promise<string> {
  // Walidacja PRZED wysyłką — model bywa nieprecyzyjny; lepszy jasny komunikat niż surowy błąd Google.
  if (!summary?.trim()) return "Podaj tytuł wydarzenia, które mam dodać do kalendarza.";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test((start || "").trim())) {
    return "Potrzebuję początku w formacie ISO 8601 z godziną, np. 2026-06-20T10:00:00.";
  }
  const payload = { summary: summary.trim(), start: withLocalOffset(start), end: end ? withLocalOffset(end) : undefined, location };
  const b = deskGoogle();
  if (b) {
    if (!(await b.googleStatus?.())?.connected) return await desktopAutoConnect();
    const dr = await b.gcalAdd!(payload);
    return dr.error || `Dodano do Kalendarza Google: „${summary.trim()}".`;
  }
  const r = await call("/v1/gcal/add", payload);
  if (r.error) return autoConnect(r.error) || r.error;
  return `Dodano do Kalendarza Google: „${summary.trim()}".`;
}
