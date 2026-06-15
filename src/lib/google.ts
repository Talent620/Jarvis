import { store } from "./store";

function base(): string | null {
  const u = store.settings.syncUrl?.trim();
  return u ? u.replace(/\/$/, "") : null;
}

async function call(path: string, body?: unknown): Promise<any> {
  const b = base();
  const tok = store.settings.syncToken?.trim();
  if (!b || !tok) return { error: "Skonfiguruj backend (⚙ → Synchronizacja) i połącz konto Google." };
  try {
    const res = await fetch(`${b}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Błąd (${res.status}).` };
    return data;
  } catch (e) {
    return { error: `Błąd połączenia: ${e instanceof Error ? e.message : e}` };
  }
}

/** URL do rozpoczęcia logowania Google (otwierany w przeglądarce). */
export function googleStartUrl(): string | null {
  const b = base();
  const tok = store.settings.syncToken?.trim();
  return b && tok ? `${b}/v1/google/start?token=${encodeURIComponent(tok)}` : null;
}

export async function gmailSearch(query = ""): Promise<string> {
  const r = await call("/v1/gmail/list", { query, max: 10 });
  if (r.error) return r.error;
  const items = r.messages || [];
  return items.length
    ? items.map((m: any) => `• [${m.id}] ${m.from} — ${m.subject}\n  ${m.snippet}`).join("\n")
    : "Brak pasujących wiadomości.";
}

/** Pełna treść jednego e-maila (po id z gmail_search) — do czytania i odpowiadania. */
export async function gmailRead(id: string): Promise<string> {
  const r = await call("/v1/gmail/get", { id });
  if (r.error) return r.error;
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
  return r.error || `Wysłano e-mail do ${to}.`;
}

/** Odpowiedz na e-mail w tym samym wątku (threadId + Message-ID z gmail_read). */
export async function gmailReply(to: string, subject: string, body: string, threadId?: string, inReplyTo?: string): Promise<string> {
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const r = await call("/v1/gmail/send", { to, subject: subj, body, threadId, inReplyTo });
  return r.error || `Wysłano odpowiedź do ${to}.`;
}

export async function gcalList(): Promise<string> {
  const r = await call("/v1/gcal/list", { max: 10 });
  if (r.error) return r.error;
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
  if (r.error) return r.error;
  const ev = r.events || [];
  const label = d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  return ev.length
    ? `📅 ${label}:\n` + ev.map((e: any) => `• ${new Date(e.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : `📅 ${label}: brak zapisów w kalendarzu.`;
}

export async function gcalAdd(summary: string, start: string, end?: string, location?: string): Promise<string> {
  const r = await call("/v1/gcal/add", { summary, start, end, location });
  return r.error || `Dodano do Kalendarza Google: „${summary}".`;
}
