import { store } from "./store";
import { fetchTimeout } from "./http";
import type { AppData } from "../types";

// Kolekcje objęte synchronizacją (bez dziennika audytu — lokalny).
const COLLECTIONS: (keyof AppData)[] = [
  "tasks", "notes", "reminders", "shopping", "calendar",
  "memory", "scenes", "projects", "projectFiles", "tally", "journal", "leads", "flashcards",
];

/**
 * Scal dwie listy po `id`, zachowując NOWSZY wpis (po `updatedAt`, w razie braku
 * `createdAt`). Suma obu stron — edycje lokalne nowsze niż w chmurze nie giną
 * (poprzednio pull hurtowo nadpisywał, kasując zmiany z tego urządzenia).
 * Uwaga: bez tombstone'ów usunięcia mogą „wrócić" — i tak lepsze niż utrata edycji.
 * Czysta, testowalna.
 */
export function mergeById<T extends { id?: string; updatedAt?: number; createdAt?: number }>(local: T[], remote: T[]): T[] {
  const recency = (x: T) => x.updatedAt ?? x.createdAt ?? 0;
  const byId = new Map<string, T>();
  const noId: T[] = [];
  for (const item of local) {
    if (item && typeof item.id === "string") byId.set(item.id, item);
    else if (item) noId.push(item);
  }
  for (const item of remote) {
    if (!item) continue;
    if (typeof item.id !== "string") { noId.push(item); continue; }
    const existing = byId.get(item.id);
    if (!existing || recency(item) >= recency(existing)) byId.set(item.id, item);
  }
  return [...byId.values(), ...noId].sort((a, b) => recency(b) - recency(a));
}

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
    const res = await fetchTimeout(`${url.replace(/\/$/, "")}/v1/health`, {}, 10000);
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
    const res = await fetchTimeout(url, {
      method: "POST",
      headers: { authorization: `Bearer ${store.settings.syncToken}`, "content-type": "application/json" },
      body: JSON.stringify({ data, updatedAt: Date.now() }),
    }, 20000);
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
    const res = await fetchTimeout(url, { headers: { authorization: `Bearer ${store.settings.syncToken}` } }, 20000);
    if (!res.ok) return `Błąd pobierania: ${res.status}.`;
    const { data } = await res.json();
    if (!data) return "Brak danych w chmurze.";
    store.setData((d) => {
      // Twardo waliduj: bierzemy tylko tablice, by uszkodzone dane z chmury nie
      // skorumpowały lokalnego store. Scalamy po id (nowsze wygrywa) zamiast nadpisywać,
      // żeby nie gubić lokalnych edycji nowszych niż w chmurze.
      for (const c of COLLECTIONS) if (Array.isArray(data[c])) (d as any)[c] = mergeById((d as any)[c] || [], data[c]);
    });
    return "✅ Dane scalone z chmurą (nowsze wpisy wygrywają).";
  } catch (e) {
    return `Błąd połączenia: ${e instanceof Error ? e.message : e}`;
  }
}
