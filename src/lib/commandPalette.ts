// === ⌘K Command Palette — rdzeń rankingu (czysty, testowalny) ===
// Spotlight do WSZYSTKIEGO w JARVISIE: panele, ustawienia, narzędzia, akcje. Ranking hybrydowy:
// dopasowanie podciągu (silne) + fuzzy subsequence (jak VS Code) + słowa kluczowe. Jeden skrót,
// natychmiastowy dostęp — czego ChatGPT/Gemini nie mają. Klasy klasy „kunszt": szybkie, deterministyczne.

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  keywords?: string;      // dodatkowe słowa do dopasowania (np. synonimy, EN)
  group?: string;         // sekcja (np. „Otwórz", „Ustawienia", „Akcje")
  icon?: string;
  run: () => void;
}

// Normalizacja PL: ł→l (nie rozkłada się w NFKD) + zdjęcie diakrytyków (ą→a, ę→e, ó→o, ś→s…).
const norm = (s: string) => (s || "").toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Pure: wynik dopasowania zapytania do tekstu w skali ~0..1 (−1 = brak dopasowania).
 *  • podciąg → silny wynik (bonus za początek słowa/całości),
 *  • inaczej fuzzy subsequence (wszystkie znaki q w kolejności) z premią za serie i początki słów.
 * Puste zapytanie → 0 (neutralne — pokazujemy wszystko w naturalnej kolejności).
 */
export function fuzzyScore(query: string, text: string): number {
  const q = norm(query).trim();
  if (!q) return 0;
  const t = norm(text);
  if (!t) return -1;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const atStart = idx === 0;
    const atWord = idx > 0 && /[\s·—\-/(]/.test(t[idx - 1]);
    return 0.75 + (atStart ? 0.25 : atWord ? 0.15 : 0.05) + Math.min(0.1, (q.length / t.length) * 0.1);
  }

  // Fuzzy subsequence: wszystkie znaki q muszą wystąpić po kolei.
  let qi = 0, score = 0, streak = 0, prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak = ti === prev + 1 ? streak + 1 : 1;
      const wordStart = ti === 0 || /[\s·—\-/(]/.test(t[ti - 1]);
      score += 1 + streak * 0.6 + (wordStart ? 1.2 : 0);
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1; // nie wszystkie znaki dopasowane
  // Normalizuj poniżej progu podciągu, krótszy tekst = czytelniejsze trafienie.
  const lenPenalty = 1 - Math.min(0.3, (t.length - q.length) / 120);
  return Math.min(0.7, (score / (q.length * 3)) * lenPenalty);
}

/** Pure: najlepszy wynik dopasowania zapytania do elementu (tytuł ma największą wagę). */
export function scoreCommand(query: string, c: CommandItem): number {
  const inTitle = fuzzyScore(query, c.title);
  const inKw = c.keywords ? fuzzyScore(query, c.keywords) * 0.85 : -1;
  const inHint = c.hint ? fuzzyScore(query, c.hint) * 0.7 : -1;
  return Math.max(inTitle, inKw, inHint);
}

/**
 * Pure: posortowana lista komend wg trafności. Puste zapytanie → naturalna kolejność (do `limit`).
 * Stabilne: przy remisie zachowuje kolejność wejścia (przewidywalne dla użytkownika).
 */
export function rankCommands(query: string, items: CommandItem[], limit = 9): CommandItem[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  return items
    .map((c, i) => ({ c, s: scoreCommand(q, c), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}
