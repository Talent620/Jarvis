// === Samoweryfikacja + eskalacja — drugi, świeży (mocniejszy) przebieg sprawdza wynik ===
// Dla trudnych/agentowych zadań Szef nie ufa pierwszej odpowiedzi: woła weryfikatora
// MOCNIEJSZYM modelem (askModel heavy → najwyższa ranga z dostępnych, też w Trybie darmowym).
// Weryfikator albo potwierdza, albo zwraca poprawioną treść — to jednocześnie eskalacja.
import { askModel } from "./brain";
import { VERIFY_SYSTEM, buildVerifyUser, verifyVerdict } from "./verify";

/** Pure: czy zadanie jest na tyle „trudne", że warto sprawdzić wynik drugim modelem. */
export function needsVerification(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (t.length < 24) return false;
  // Liczenie, kod, logika, plany wieloetapowe, daty/pieniądze, analiza, dowodzenie.
  return /(oblicz|policz|ile (to|wynosi|kosztuje)|wzór|równani|kod|napisz (kod|funkcj|skrypt)|zaplanuj|krok po kroku|porównaj|przeanalizuj|dlaczego|udowodnij|kalori|procent|%|kwot|budżet|termin|deadline|harmonogram|ile dni|która godzina|przelicz)/.test(t);
}

/** Zweryfikuj i ewentualnie popraw odpowiedź. Zwraca finalną treść + czy poprawiono. */
export async function verifyAndCorrect(question: string, answer: string): Promise<{ corrected: boolean; text: string }> {
  try {
    const raw = await askModel({
      system: VERIFY_SYSTEM,
      history: [{ role: "user", content: buildVerifyUser(question, answer) }],
      heavy: true, // eskalacja: sprawdza najmocniejszym dostępnym modelem
    });
    return verifyVerdict(raw, answer);
  } catch {
    return { corrected: false, text: answer }; // weryfikacja best-effort — błąd jej nie wywala odpowiedzi
  }
}
