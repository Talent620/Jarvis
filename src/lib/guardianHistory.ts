// === 🗂 Pamięć Strażnika (Tryb opiekuna) ===
// Lekki dziennik tego, co Strażnik robił/zalecał — żeby pamiętał najczęstsze naprawy i pokazywał
// historię. Trzymany w localStorage jako pierścień (ostatnie N). Czysta logika dodawania/cappowania
// jest testowalna; I/O cienkie.

import { loadJson, saveJson } from "./lsJson";

export interface GuardianEvent {
  at: number;            // timestamp
  kind: "fix" | "recommend" | "scan";
  message: string;       // czytelny opis
}

const KEY = "jarvis.guardian.history";
const MAX = 20;

/** Pure: dołóż zdarzenie na początek i przytnij do MAX (bez duplikatu identycznej, świeżej wiadomości). */
export function appendEvent(list: GuardianEvent[], ev: GuardianEvent, max = MAX): GuardianEvent[] {
  // Nie dubluj tej samej wiadomości, jeśli padła w ciągu 5 s (np. podwójne kliknięcie).
  if (list[0] && list[0].message === ev.message && ev.at - list[0].at < 5000) return list;
  return [ev, ...list].slice(0, max);
}

/** Pure: zlicz najczęstsze naprawy (do „opiekuna" — co psuje się najczęściej). */
export function topFixes(list: GuardianEvent[], n = 3): { message: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of list) if (e.kind === "fix") counts.set(e.message, (counts.get(e.message) || 0) + 1);
  return [...counts.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

export interface RecurringHint { count: number; problem: string; advice: string }
/** Pure: jeśli ta sama naprawa powtarza się ≥ `min` razy, zaproponuj TRWAŁE rozwiązanie. */
export function recurringHint(list: GuardianEvent[], min = 3): RecurringHint | null {
  const top = topFixes(list, 1)[0];
  if (!top || top.count < min) return null;
  const m = top.message.toLowerCase();
  let advice: string;
  if (/ollama|serwer|połącz|polacz|lokaln/.test(m)) advice = "Włącz autostart serwera Ollama przy starcie Windows (JARVIS-Ollama-Server) — przestaniesz łączyć ręcznie.";
  else if (/głos|glos|voice/.test(m)) advice = "Przypnij głos na stałe (🚀 Używaj głosu JARVISA), żeby nie wracał do systemowego.";
  else if (/szybk|od ręki|od reki/.test(m)) advice = "Ustaw tryb szybki jako domyślny w ⚙ → AI, żeby nie włączać go za każdym razem.";
  else if (/model|mądr|madr|pobra/.test(m)) advice = "Trzymaj komplet modeli lokalnych zainstalowany na stałe (tryb Mądrzej raz, potem zostają).";
  else advice = "Ten problem wraca — rozważ trwałe rozwiązanie zamiast powtarzać naprawę.";
  return { count: top.count, problem: top.message, advice };
}

function read(): GuardianEvent[] {
  const arr = loadJson<GuardianEvent[]>(KEY, []);
  return Array.isArray(arr) ? arr : [];
}

/** Zapisz zdarzenie Strażnika do historii (best-effort). */
export function recordGuardianEvent(kind: GuardianEvent["kind"], message: string): void {
  saveJson(KEY, appendEvent(read(), { at: Date.now(), kind, message }));
}

/** Odczytaj historię Strażnika (najnowsze pierwsze). */
export function getGuardianHistory(): GuardianEvent[] {
  return read();
}

/** Wyczyść historię Strażnika. */
export function clearGuardianHistory(): void {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(KEY); } catch { /* ignore */ }
}
