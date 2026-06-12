import { store } from "./store";
import type { AppData } from "../types";

// Kolekcje objęte synchronizacją (bez dziennika audytu — lokalny).
const COLLECTIONS: (keyof AppData)[] = [
  "tasks", "notes", "reminders", "shopping", "calendar",
  "memory", "scenes", "projects", "projectFiles", "tally", "journal", "leads", "flashcards",
];

function endpoint(): string | null {
  const { syncUrl, syncToken } = store.settings;
  if (!syncUrl?.trim() || !syncToken?.trim()) return null;
  return `${syncUrl.replace(/\/$/, "")}/v1/sync`;
}

/** Sprawdza, czy backend (proxy/sync) odpowiada i co ma włączone. */
export async function testBackend(rawUrl: string): Promise<string> {
  const url = rawUrl?.trim();
  if (!url) return "Najpierw wpisz adres backendu.";
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/health`);
    if (!res.ok) return `❌ Backend odpowiedział błędem (${res.status}).`;
    const d = await res.json().catch(() => ({}));
    if (!d?.ok) return "❌ To nie wygląda na backend JARVIS.";
    const f = d.features || {};
    const on = (b: boolean) => (b ? "✓" : "—");
    return `✅ Backend działa. KV ${on(d.kv)} · research ${on(f.search)} · embeddingi ${on(f.embed)} · Google ${on(f.google)}.`;
  } catch (e) {
    return `❌ Brak połączenia z backendem: ${e instanceof Error ? e.message : e}`;
  }
}

export async function pushSync(): Promise<string> {
  const url = endpoint();
  if (!url) return "Najpierw uzupełnij adres i token synchronizacji.";
  const data: Record<string, unknown> = {};
  for (const c of COLLECTIONS) data[c] = store.data[c];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${store.settings.syncToken}`, "content-type": "application/json" },
      body: JSON.stringify({ data, updatedAt: Date.now() }),
    });
    if (res.status === 409) return "Na serwerze jest nowsza wersja — najpierw pobierz.";
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return `Błąd wysyłki: ${(e as any).error || res.status}.`;
    }
    return "✅ Dane wysłane do chmury.";
  } catch (e) {
    return `Błąd połączenia: ${e instanceof Error ? e.message : e}`;
  }
}

export async function pullSync(): Promise<string> {
  const url = endpoint();
  if (!url) return "Najpierw uzupełnij adres i token synchronizacji.";
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${store.settings.syncToken}` } });
    if (!res.ok) return `Błąd pobierania: ${res.status}.`;
    const { data } = await res.json();
    if (!data) return "Brak danych w chmurze.";
    store.setData((d) => {
      for (const c of COLLECTIONS) if (data[c]) (d as any)[c] = data[c];
    });
    return "✅ Dane pobrane z chmury.";
  } catch (e) {
    return `Błąd połączenia: ${e instanceof Error ? e.message : e}`;
  }
}
