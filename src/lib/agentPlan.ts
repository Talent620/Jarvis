// === Tryb agenta wielokrokowego — plan + odhaczanie kroków (jak Operator) ===
// Pure: wyłuskanie planu z wypowiedzi modelu i wykrycie, który krok trwa. Dzięki temu
// Tryb Szefa może pokazać plan na ekranie i odhaczać kroki na żywo, mówiąc „Krok N z M".

/** Wyłuskaj ponumerowany plan z tekstu (lista „1) …" albo JSON-owa tablica stringów). */
export function parsePlan(text: string): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  // 1) Spróbuj JSON-owej tablicy stringów.
  const arr = t.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      const parsed = JSON.parse(arr[0]);
      if (Array.isArray(parsed)) {
        const steps = parsed.map((x) => String(x).trim()).filter(Boolean);
        if (steps.length) return steps.slice(0, 12);
      }
    } catch { /* nie JSON — próbuj listy niżej */ }
  }
  // 2) Ponumerowane linie: „1. …", „2) …", „3 - …".
  const steps: string[] = [];
  for (const line of t.split(/\n+/)) {
    const m = line.match(/^\s*\d+\s*[.)–:-]\s*(.+)$/);
    if (m && m[1].trim()) steps.push(m[1].trim());
  }
  // 3) Plan w jednej linii: „Plan: 1) a 2) b 3) c".
  if (steps.length < 2) {
    const inline = t.replace(/^.*?plan[-:]?\s*/i, "");
    const parts = inline.split(/\s*\d+\s*[.)]\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 12);
  }
  return steps.slice(0, 12);
}

/** Który krok aktualnie trwa wg wypowiedzi („Krok 2 z 4", „krok 3:"). 1-indeksowany; 0 = brak. */
export function currentStep(text: string): number {
  const m = (text || "").match(/krok\s+(\d+)/i);
  const n = m ? parseInt(m[1], 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
