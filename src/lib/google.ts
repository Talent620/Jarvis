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

export async function gcalList(): Promise<string> {
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
export async function gcalDay(dayOffset = 0): Promise<string> {
  const d = new Date(); d.setDate(d.getDate() + dayOffset);
  const { timeMin, timeMax } = dayRangeISO(d);
  const r = await call("/v1/gcal/list", { max: 25, timeMin, timeMax });
  if (r.error) return autoConnect(r.error) || r.error;
  const ev = r.events || [];
  const label = d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  return ev.length
    ? `📅 ${label}:\n` + ev.map((e: any) => `• ${new Date(e.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : `📅 ${label}: brak zapisów w kalendarzu.`;
}

export async function gcalAdd(summary: string, start: string, end?: string, location?: string): Promise<string> {
  const r = await call("/v1/gcal/add", { summary, start, end, location });
  if (r.error) return autoConnect(r.error) || r.error;
  return `Dodano do Kalendarza Google: „${summary}".`;
}
