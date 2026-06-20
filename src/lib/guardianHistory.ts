// === 🗂 Pamięć Strażnika (Tryb opiekuna) ===
// Lekki dziennik tego, co Strażnik robił/zalecał — żeby pamiętał najczęstsze naprawy i pokazywał
// historię. Trzymany w localStorage jako pierścień (ostatnie N). Czysta logika dodawania/cappowania
// jest testowalna; I/O cienkie.

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

function read(): GuardianEvent[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Zapisz zdarzenie Strażnika do historii (best-effort). */
export function recordGuardianEvent(kind: GuardianEvent["kind"], message: string): void {
  try {
    const next = appendEvent(read(), { at: Date.now(), kind, message });
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* brak localStorage — pomijamy */
  }
}

/** Odczytaj historię Strażnika (najnowsze pierwsze). */
export function getGuardianHistory(): GuardianEvent[] {
  return read();
}

/** Wyczyść historię Strażnika. */
export function clearGuardianHistory(): void {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(KEY); } catch { /* ignore */ }
}
