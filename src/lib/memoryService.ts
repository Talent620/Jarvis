// === Warstwa pamięci długoterminowej (Mem0 + Qdrant) ===
// Klient PWA rozmawia z self-hostowanym serwerem Mem0 (REST) — patrz `server/docker-compose.yml`.
// Kontrakt celowo cienki i wymienny. Gdy serwis nie jest skonfigurowany lub nieosiągalny,
// WSZYSTKO degraduje się łagodnie (search→[], add→false) — JARVIS działa dalej bez pamięci.
//
// Dwa namespace'y (Mem0 `user_id`): "personal" (o użytkowniku) i "business" (klienci/projekty) —
// bez mieszania. Wybór namespace robi warstwa wywołująca (brain.ts).

import { fetchTimeout, appTokenHeader } from "./http";
import { store } from "./store";

export type MemNamespace = "personal" | "business";

export interface Memory {
  id: string;
  memory: string;
  score?: number;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function baseUrl(): string {
  return (store.settings.memoryServiceUrl || "").trim().replace(/\/$/, "");
}
function authHeaders(): Record<string, string> {
  const t = (store.settings.memoryServiceToken || "").trim();
  return { "content-type": "application/json", ...appTokenHeader(), ...(t ? { authorization: `Bearer ${t}` } : {}) };
}

/** Czy pamięć długoterminowa jest skonfigurowana (adres serwera Mem0 podany). */
export function memoryServiceAvailable(): boolean {
  return !!baseUrl();
}

/** Namespace dla bieżącego kontekstu: aktywny projekt → "business", inaczej "personal". Czysta. */
export function resolveNamespace(activeProjectId?: string): MemNamespace {
  return activeProjectId && activeProjectId.trim() ? "business" : "personal";
}

/** Wyniki Mem0 → zwięzły blok do wstrzyknięcia w system prompt. Czysta, testowalna. */
export function memoriesToBlock(memories: Memory[], max = 8): string {
  const items = memories
    .filter((m) => m && typeof m.memory === "string" && m.memory.trim())
    .slice(0, max)
    .map((m) => `• ${m.memory.trim()}`);
  if (!items.length) return "";
  return `Trwała pamięć o użytkowniku (wykorzystaj naturalnie, nie cytuj wprost):\n${items.join("\n")}`;
}

/** Normalizuj różne kształty odpowiedzi Mem0 ({results:[...]}|[...]) do Memory[]. Czysta. */
export function parseMemories(data: unknown): Memory[] {
  const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.results) ? (data as any).results : [];
  return (arr as any[])
    .map((r) => ({ id: String(r?.id ?? ""), memory: String(r?.memory ?? r?.text ?? ""), score: typeof r?.score === "number" ? r.score : undefined }))
    .filter((m) => m.memory);
}

/** Dodaj parę user/assistant do pamięci (po odpowiedzi). Nie rzuca — degraduje do false. */
export async function addMemory(turns: ChatTurn[], namespace: MemNamespace): Promise<boolean> {
  const url = baseUrl();
  if (!url || !turns.length) return false;
  try {
    const res = await fetchTimeout(`${url}/memories`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ messages: turns, user_id: namespace }),
    }, 12000);
    return res.ok;
  } catch {
    return false;
  }
}

/** Wyszukaj trafne wspomnienia (przed modelem). Nie rzuca — degraduje do []. */
export async function searchMemory(query: string, namespace: MemNamespace, limit = 6): Promise<Memory[]> {
  const url = baseUrl();
  if (!url || !query.trim()) return [];
  try {
    const res = await fetchTimeout(`${url}/search`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query, user_id: namespace, limit }),
    }, 12000);
    if (!res.ok) return [];
    return parseMemories(await res.json().catch(() => null));
  } catch {
    return [];
  }
}

/** Pobierz wszystkie wspomnienia z namespace (panel/debug). Degraduje do []. */
export async function getAllMemories(namespace: MemNamespace): Promise<Memory[]> {
  const url = baseUrl();
  if (!url) return [];
  try {
    const res = await fetchTimeout(`${url}/memories?user_id=${encodeURIComponent(namespace)}`, { headers: authHeaders() }, 12000);
    if (!res.ok) return [];
    return parseMemories(await res.json().catch(() => null));
  } catch {
    return [];
  }
}

/** Zaktualizuj treść wspomnienia. Degraduje do false. */
export async function updateMemory(id: string, text: string): Promise<boolean> {
  const url = baseUrl();
  if (!url || !id) return false;
  try {
    const res = await fetchTimeout(`${url}/memories/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    }, 12000);
    return res.ok;
  } catch {
    return false;
  }
}

/** Usuń wspomnienie. Degraduje do false. */
export async function deleteMemory(id: string): Promise<boolean> {
  const url = baseUrl();
  if (!url || !id) return false;
  try {
    const res = await fetchTimeout(`${url}/memories/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }, 12000);
    return res.ok;
  } catch {
    return false;
  }
}

/** Pobierz i sformatuj trafne wspomnienia jako blok do promptu (wygodny skrót dla brain.ts). */
export async function memoryContextBlock(query: string, namespace: MemNamespace): Promise<string> {
  if (!memoryServiceAvailable()) return "";
  return memoriesToBlock(await searchMemory(query, namespace));
}
