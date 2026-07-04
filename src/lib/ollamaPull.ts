// Pobieranie modeli Ollamy z poziomu aplikacji (`POST /api/pull`, strumień NDJSON postępu).
// Dzięki temu użytkownik wybiera i ściąga model bez wchodzenia do terminala. Tylko lokalny serwer.
import { store } from "./store";

export interface PullProgress {
  status: string; // np. „pulling manifest", „downloading…", „success", „błąd: …"
  percent?: number; // 0..100 gdy znany rozmiar
  error?: string; // ustawione, gdy Ollama zwróciła błąd (np. zła nazwa modelu)
}

interface PullLine {
  status?: string;
  total?: number;
  completed?: number;
  error?: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const normUrl = (raw: string): string => raw.trim().replace(/\/+$/, "");

/** Sparsuj jedną linię NDJSON z `/api/pull` do postępu. Czysta (testowalna). */
export function parsePullLine(line: string): PullProgress | null {
  const t = line.trim();
  if (!t) return null;
  let obj: PullLine;
  try {
    obj = JSON.parse(t) as PullLine;
  } catch {
    return null;
  }
  if (obj.error) return { status: `błąd: ${obj.error}`, error: obj.error };
  const percent = obj.total && obj.total > 0 ? Math.round(((obj.completed || 0) / obj.total) * 100) : undefined;
  return { status: String(obj.status || ""), percent };
}

/**
 * Pobierz model na lokalny serwer Ollamy, raportując postęp przez `onProgress`.
 * Zwraca `{ok}` albo `{ok:false, error}`. `signal` pozwala anulować pobieranie.
 */
export async function pullOllamaModel(
  model: string,
  onProgress: (p: PullProgress) => void,
  rawUrl?: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const base = normUrl(rawUrl ?? store.settings.ollamaUrl ?? "");
  const name = model.trim();
  if (!base) return { ok: false, error: "Brak adresu Ollamy — ustaw go w polu poniżej." };
  if (!name) return { ok: false, error: "Podaj nazwę modelu (np. qwen3.5:4b)." };

  let res: Response;
  try {
    res = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name, stream: true }),
      signal,
    });
  } catch (e) {
    return { ok: false, error: `Nie połączono z Ollamą: ${errMsg(e)}` };
  }
  if (!res.ok || !res.body) return { ok: false, error: `Ollama odrzuciła pobranie (HTTP ${res.status}).` };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let lastError = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // ostatni fragment może być niekompletny
      for (const line of lines) {
        const p = parsePullLine(line);
        if (!p) continue;
        if (p.error) lastError = p.error;
        onProgress(p);
      }
    }
    const tail = parsePullLine(buf);
    if (tail) {
      if (tail.error) lastError = tail.error;
      onProgress(tail);
    }
  } catch (e) {
    return { ok: false, error: `Pobieranie przerwane: ${errMsg(e)}` };
  }

  if (lastError) return { ok: false, error: lastError };
  return { ok: true };
}
