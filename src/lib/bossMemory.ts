// === Pamięć decyzji Szefa — ciągłość między sesjami ===
// Co ustaliliście z Szefem (decyzje/zobowiązania) zostaje zapisane lokalnie i wraca do jego
// briefingu w kolejnych sesjach — dzięki temu nie zaczynacie od zera i Szef pamięta ustalenia.

import { loadJson, saveJson } from "./lsJson";

export interface BossDecision { text: string; at: number }

const KEY = "jarvis.boss.decisions.v1";
const MAX = 40;

export function loadBossDecisions(): BossDecision[] {
  return loadJson<BossDecision[]>(KEY, []);
}

/** Zapisz decyzję (dedup po treści, najnowsze na górze, limit). */
export function recordBossDecision(text: string, at = Date.now()): void {
  const t = (text || "").trim();
  if (t.length < 4) return;
  const list = loadBossDecisions().filter((d) => d.text.toLowerCase() !== t.toLowerCase());
  list.unshift({ text: t.slice(0, 200), at });
  saveJson(KEY, list.slice(0, MAX));
}

export function recentBossDecisions(n = 6): BossDecision[] {
  return loadBossDecisions().slice(0, n);
}

/** Blok do briefingu Szefa — co już ustaliliście (pusto, gdy brak). Pure. */
export function bossMemoryDigest(): string {
  const list = recentBossDecisions(6);
  if (!list.length) return "";
  const when = (at: number) => {
    try { return new Date(at).toLocaleDateString("pl-PL", { day: "2-digit", month: "short" }); } catch { return ""; }
  };
  const lines = list.map((d) => `• ${d.text}${when(d.at) ? ` (${when(d.at)})` : ""}`);
  return ["WASZE USTALENIA (pamiętaj o nich i nawiązuj, gdy pasują):", ...lines].join("\n");
}
