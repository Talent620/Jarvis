// Auto-weryfikacja trudnych odpowiedzi — model sam sprawdza swój wynik drugim, krótkim przebiegiem
// (szczególnie liczenie i logika) i poprawia, jeśli znajdzie błąd. Czyste funkcje (prompt + werdykt)
// są testowalne; samo wywołanie modelu robi caller (brain.ts), by działało z dowolnym dostawcą.

export const VERIFY_SYSTEM = [
  "Jesteś rygorystycznym weryfikatorem odpowiedzi. Sprawdź, czy poniższa odpowiedź na pytanie jest POPRAWNA",
  "i kompletna — ze szczególną uwagą na liczenie (przelicz krok po kroku), logikę i fałszywe założenia.",
  "ZASADY ODPOWIEDZI:",
  "- Jeśli odpowiedź jest poprawna — zwróć DOKŁADNIE: OK",
  "- Jeśli jest BŁĄD lub braki — zwróć POPRAWIONĄ, pełną, finalną odpowiedź dla użytkownika (po polsku,",
  "  bez wzmianki, że coś poprawiasz, bez słowa „OK” na początku). Sama gotowa odpowiedź.",
].join("\n");

/** Pure: treść do weryfikacji (pytanie + odpowiedź do sprawdzenia). */
export function buildVerifyUser(question: string, answer: string): string {
  return `Pytanie:\n${(question || "").slice(0, 4000)}\n\nOdpowiedź do sprawdzenia:\n${(answer || "").slice(0, 6000)}`;
}

// Krótkie potwierdzenie poprawności (model nie zwrócił dosłownie „OK").
const CONFIRM = /^(ok\b|poprawn|zgadza|wszystko si[ęe] zgadza|wszystko (ok|dobrze|poprawn)|brak b[łl][ęe]d|bez b[łl][ęe]d|nie ma b[łl][ęe]d|jest (ok|dobr|poprawn)|prawid[łl]ow|tak,? (poprawn|dobrze|zgadza))/i;
// Sygnały, że to jednak KOREKTA (a nie potwierdzenie zaczynające się od „poprawny…").
// Uwaga: świadomie bez gołego „nie"/„błąd" — występują też w potwierdzeniach („nic nie trzeba",
// „nie ma błędu") i powodowały fałszywą podmianę dobrej odpowiedzi.
const CORRECTION_SIGNAL = /\bzamiast\b|powinno|w rzeczywisto|poprawny wynik|popraw(iam|ka|iona)|b[łl][ęe]dn|w istocie|jednak (jest|powinno|wynik)/i;

/** Pure: zinterpretuj werdykt weryfikatora. „OK"/potwierdzenie → bez zmian; inaczej → poprawiona treść. */
export function verifyVerdict(raw: string, original: string): { corrected: boolean; text: string } {
  const t = (raw || "").trim();
  if (!t) return { corrected: false, text: original };
  if (/^ok\b/i.test(t)) return { corrected: false, text: original };
  // Potwierdzenie poprawności (krótkie, z frazą aprobującą, BEZ sygnału realnej korekty) → bez zmian.
  if (t.length <= 80 && CONFIRM.test(t) && !CORRECTION_SIGNAL.test(t)) return { corrected: false, text: original };
  // Zbyt krótki/niepewny werdykt nie zastępuje sensownej odpowiedzi (ochrona przed regresją).
  if (t.length < 8) return { corrected: false, text: original };
  if (original.trim().length > 40 && t.length < 0.3 * original.trim().length && /nie wiem|trudno|brak danych/i.test(t)) {
    return { corrected: false, text: original };
  }
  return { corrected: true, text: t };
}
