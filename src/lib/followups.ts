// === Sugestie dalszych pytań (jak Perplexity) — „zapytaj dalej" po odpowiedzi ===
// Czyste, lekkie podpowiedzi kolejnego kroku na bazie treści odpowiedzi. Najpierw trafne
// tematycznie, potem uzupełnione uniwersalnymi; bez powtórek, maks. kilka.

const GENERIC = ["Rozwiń to", "Podaj przykład", "Krótsze podsumowanie", "Jakie są ryzyka?", "Co dalej?"];

const TOPIC: [RegExp, string][] = [
  [/```|\bfunkcj|\bkod\b|const |=>|def /i, "Dodaj komentarze i testy"],
  [/plan|krok|etap|harmonogram/i, "Rozbij na konkretne kroki"],
  [/\bz[łl]\b|cena|koszt|bud[żz]et|p[łl]ac/i, "Pokaż tańszą opcję"],
  [/mail|e-mail|wiadomo[śs][ćc]|pismo|oferta/i, "Napisz to bardziej formalnie"],
  [/(^|\n)\s*([-•]|\d[.)])\s+/m, "Które są najważniejsze?"],
  [/por[óo]wn|vs\.?|zalet|wad/i, "Co polecasz i dlaczego?"],
];

/** Pure: 0–`limit` sugestii dalszych pytań. Pusto dla bardzo krótkich/pytających odpowiedzi. */
export function followUps(_userText: string, replyText: string, limit = 3): string[] {
  const t = (replyText || "").trim();
  if (t.length < 40) return [];            // za krótkie, by sugerować
  if (/[?？]\s*$/.test(t) && t.length < 160) return []; // to model pyta NAS — nie podpowiadaj
  const out: string[] = [];
  for (const [re, s] of TOPIC) {
    if (out.length >= limit) break;
    if (re.test(t) && !out.includes(s)) out.push(s);
  }
  for (const g of GENERIC) {
    if (out.length >= limit) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.slice(0, limit);
}
