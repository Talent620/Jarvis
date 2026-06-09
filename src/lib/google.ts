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
    ? items.map((m: any) => `• ${m.from} — ${m.subject}\n  ${m.snippet}`).join("\n")
    : "Brak pasujących wiadomości.";
}

export async function gmailSend(to: string, subject: string, body: string): Promise<string> {
  const r = await call("/v1/gmail/send", { to, subject, body });
  return r.error || `Wysłano e-mail do ${to}.`;
}

export async function gcalList(): Promise<string> {
  const r = await call("/v1/gcal/list", { max: 10 });
  if (r.error) return r.error;
  const ev = r.events || [];
  return ev.length
    ? ev.map((e: any) => `• ${new Date(e.start).toLocaleString("pl-PL")} — ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n")
    : "Brak nadchodzących wydarzeń w Kalendarzu Google.";
}

export async function gcalAdd(summary: string, start: string, end?: string, location?: string): Promise<string> {
  const r = await call("/v1/gcal/add", { summary, start, end, location });
  return r.error || `Dodano do Kalendarza Google: „${summary}".`;
}
