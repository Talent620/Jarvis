// === Benchmark szybkości modeli Ollamy na TWOIM sprzęcie ===
// Dla każdego modelu odpala krótkie generowanie i mierzy realną prędkość (tokeny/s) + czas.
// Dzięki temu wiesz, ile który model wyrobi na Twoim PC — i możesz ustawić najszybszy jako „Refleks".
import { store } from "./store";
import { fetchTimeout } from "./http";

export interface BenchResult {
  model: string;
  ok: boolean;
  tokPerSec: number; // tokeny/s (im więcej, tym szybciej)
  ms: number; // całkowity czas tury (ms)
  error?: string;
}

/** Wylicz prędkość z pól czasowych /api/generate Ollamy (nanosekundy). Czysta. */
export function parseOllamaTiming(json: unknown): { tokPerSec: number; evalCount: number; ms: number } {
  const d = (json || {}) as { eval_count?: number; eval_duration?: number; total_duration?: number };
  const evalCount = d.eval_count || 0;
  const evalDur = d.eval_duration || 0;
  const tokPerSec = evalCount > 0 && evalDur > 0 ? Math.round((evalCount / (evalDur / 1e9)) * 10) / 10 : 0;
  const ms = d.total_duration ? Math.round(d.total_duration / 1e6) : 0;
  return { tokPerSec, evalCount, ms };
}

/** Krótka, ludzka ocena prędkości. Czysta. */
export function speedLabel(tokPerSec: number): string {
  if (tokPerSec <= 0) return "—";
  if (tokPerSec >= 40) return "🚀 błyskawiczny";
  if (tokPerSec >= 20) return "✅ szybki";
  if (tokPerSec >= 10) return "🙂 ok";
  return "🐢 wolny";
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Zmierz jeden model: krótkie generowanie → tokeny/s + czas. */
export async function benchmarkModel(model: string, base?: string): Promise<BenchResult> {
  const url = (base ?? store.settings.ollamaUrl ?? "").trim().replace(/\/+$/, "");
  if (!url) return { model, ok: false, tokPerSec: 0, ms: 0, error: "Brak adresu Ollamy." };
  try {
    const res = await fetchTimeout(
      `${url}/api/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "Napisz jedno krótkie zdanie o pogodzie.", stream: false, keep_alive: "30m", options: { num_predict: 48 } }),
      },
      90000,
    );
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { model, ok: false, tokPerSec: 0, ms: 0, error: `HTTP ${res.status}` };
    const t = parseOllamaTiming(d);
    return { model, ok: true, tokPerSec: t.tokPerSec, ms: t.ms };
  } catch (e) {
    return { model, ok: false, tokPerSec: 0, ms: 0, error: errMsg(e) };
  }
}

/** Zmierz listę modeli po kolei (pierwszy bieg ładuje model — uczciwie). Zwraca posortowane wg prędkości. */
export async function benchmarkModels(models: string[], onProgress?: (msg: string, partial: BenchResult[]) => void): Promise<BenchResult[]> {
  const out: BenchResult[] = [];
  const list = models.slice(0, 8); // rozsądny limit
  for (const m of list) {
    onProgress?.(`Mierzę ${m}…`, out.slice());
    out.push(await benchmarkModel(m));
  }
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || b.tokPerSec - a.tokPerSec);
}
