// === Pamięć refleksyjna (warstwa 7) — JARVIS zauważa wzorce o Tobie ===
// Spojrzenie WSTECZ (w odróżnieniu od predykcji patrzących w przód): z epizodów, modelu świata
// i zadań wyłania powracające tematy, dominujące relacje, dyscyplinę i rytm dnia. Czysta,
// deterministyczna, bez konfabulacji (mówi tylko to, co wynika z danych).
import type { Episode } from "./episodicMemory";
import { topTopics } from "./episodicMemory";
import type { WorldEntity, Task } from "../types";

export type ReflectionKind = "topic" | "relationship" | "productivity" | "rhythm";
export interface Reflection { id: string; kind: ReflectionKind; text: string }

export interface ReflectInput {
  episodes: Episode[];
  people: WorldEntity[]; // encje z modelu świata (person/project/company…)
  tasks: Task[];
}

const DAY = 86_400_000;

/** Pure: wyłoń obserwacje (wzorce) z danych użytkownika. Pusto, gdy za mało sygnałów. */
export function reflect(input: ReflectInput, now = Date.now()): Reflection[] {
  const out: Reflection[] = [];

  // 1) Powracające tematy (słowa-klucze z epizodów z ostatnich 30 dni).
  const topics = topTopics(input.episodes, now - 30 * DAY, 3).filter((t) => t.count >= 2);
  if (topics.length) {
    out.push({ id: "topics", kind: "topic", text: `🔁 Często wracasz do: ${topics.map((t) => `${t.word} (×${t.count})`).join(", ")}.` });
  }

  // 2) Dominujące relacje/wątki z modelu świata.
  const dominant = [...input.people].filter((e) => e.mentions >= 2).sort((a, b) => b.mentions - a.mentions).slice(0, 3);
  if (dominant.length) {
    out.push({ id: "relationships", kind: "relationship", text: `🌐 Twój świat kręci się wokół: ${dominant.map((e) => e.name).join(", ")}.` });
  }

  // 3) Dyscyplina — odsetek domkniętych zadań (przy wystarczającej próbce).
  if (input.tasks.length >= 5) {
    const done = input.tasks.filter((t) => t.done).length;
    const pct = Math.round((done / input.tasks.length) * 100);
    if (pct >= 70) out.push({ id: "productivity", kind: "productivity", text: `✅ Domykasz ${pct}% zadań — niezła dyscyplina.` });
    else if (pct < 40) out.push({ id: "productivity", kind: "productivity", text: `⚠ Domykasz ${pct}% zadań — może rozbij je na mniejsze kroki?` });
  }

  // 4) Rytm dnia — najaktywniejsza pora (z czasów epizodów).
  if (input.episodes.length >= 5) {
    const buckets = { rano: 0, popołudnie: 0, wieczór: 0 };
    for (const e of input.episodes) { const h = new Date(e.at).getHours(); if (h < 12) buckets.rano++; else if (h < 18) buckets.popołudnie++; else buckets.wieczór++; }
    const top = (Object.entries(buckets) as [keyof typeof buckets, number][]).sort((a, b) => b[1] - a[1])[0];
    if (top[1] >= 4) out.push({ id: "rhythm", kind: "rhythm", text: `🕐 Najaktywniejszy jesteś: ${top[0]}.` });
  }

  return out;
}

/** Pure: obserwacje jako jeden tekst (do referowania / „co o mnie zauważyłeś"). */
export function reflectionSummary(input: ReflectInput, now = Date.now()): string {
  return reflect(input, now).map((r) => r.text).join("\n");
}
