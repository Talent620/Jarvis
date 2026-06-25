// === Historia zmian (changelog) — „co nowego" w aplikacji ===
// Pokazywane w ⚙ → Dane → Aktualizacja. Najnowsze na górze. Krótko, po ludzku — co realnie
// poprawiono. Dopisując nową wersję, dodaj wpis NA GÓRZE z datą buildu (zgodną z __APP_BUILD__).

export interface ChangelogEntry {
  version: string; // krótka etykieta wersji/daty
  date: string; // YYYY-MM-DD
  items: string[]; // co poprawiono (zwięźle)
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "Czerwiec 2026",
    date: "2026-06-24",
    items: [
      "💳 Studio Obrazów — jasne koszty: każdy model pokazuje cenę na przycisku (🆓 darmowy / ⭐ ~$0.04–0.08 za obraz) oraz status klucza (✅ gotowe / ⚙ wymaga klucza), a przy płatnym modelu widać wprost koszt następnej generacji — żadnej niespodzianki z kasą.",
      "🎨 Studio Obrazów: gdy masz klucz fal.ai i dołączasz zdjęcie do edycji — JARVIS używa teraz fal.ai (płatny, który skonfigurowałeś), zamiast pytać o pusty klucz Gemini. Generowanie z opisu zostaje darmowe; w każdej chwili przełączysz na 🆓 Gemini.",
      "🐛 Koniec ucinania prawej krawędzi okien na wąskich telefonach (S9): panel nie rozpycha się już poza ekran, a w listach (zakupy, dziennik, sprzedaż, wyceny) wartości/przyciski po prawej są zawsze widoczne — długie nazwy ustępują im miejsca, a nie odwrotnie.",
      "🐛 Strażnik (Diagnoza): koniec ucinania ocen po prawej stronie — wynik (np. 100/85) jest zawsze widoczny, a długie opisy podagentów skracają się wielokropkiem zamiast rozpychać wiersz poza ekran.",
      "🐛 Koniec wiecznego komunikatu o nowej wersji: aktualizacja porównuje teraz dokładnie ten sam znacznik buildu co zainstalowany (wcześniej czas wgrania pliku był o parę minut późniejszy niż build, więc apka po świeżej instalacji i tak ciągle widziała aktualizację).",
      "✨ Nowe Centrum (dawne menu pod ⋯): wszystkie funkcje jako nowoczesne kafelki z ikoną, krótką nazwą i opisem, pogrupowane w sekcje — plus wyszukiwarka na górze (wpisz np. zakupy albo tłumacz i od razu masz wynik; ignoruje polskie znaki i wielkość liter).",
      "🎨 Studio Obrazów — przejrzystość i pewność: przy każdym modelu plakietka ✅ gotowy / ⚙ wymaga klucza; auto-fallback (gdy płatny fal.ai padnie na braku środków, dokańczamy DARMOWYM Gemini); asystent pisze lepsze prompty (zostaw resztę bez zmian + jedna zmiana na raz — wg oficjalnych wytycznych Nano Banana).",
      "🐛 Koniec powielania szturchańca o zadaniach przy każdym otwarciu oraz ucinania górnego paska na wąskich telefonach.",
      "💬 Studio Obrazów: asystent edycji — rozumie polecenie po ludzku i DOPYTUJE, jeśli coś niejasne, ZANIM wyda kasę na płatną generację (mniej zmarnowanych prób).",
      "⚡ Aktualizacje błyskawiczne (OTA): apka pobiera sam web-bundle (~1–2 MB) zamiast całego APK i podmienia go bez instalatora; zła paczka sama się cofa.",
      "🎧 Tryb Słuchawki działa na Androidzie — koniec cichego milczenia bez klucza Groq (Web Speech nie działa w aplikacji; teraz zawsze nagrywamy, a transkrypcję robi lokalny Whisper lub darmowy Groq).",
      "🗣 Wyraźny domyślny STAŁY głos jednym guzikiem — głos nie zmienia się już sam.",
      "🧠 Mądrzejszy dobór modelu: pytania wyjaśniające (jak działa…, na czym polega…) idą na mocniejszy model.",
      "🖥 Ollama: przycisk znajdowania serwera testuje wpisany adres (np. Tailscale), nie tylko localhost; jaśniejsze błędy.",
      "📲 Łatwiejszy serwer Ollama na PC: pilnowanie 24/7 (auto-restart), instrukcja na telefon, kod QR.",
      "🍏 Pełne przygotowanie pod iOS (build .ipa) i przeglądalna instrukcja obsługi w Strażniku.",
      "🔑 Generator licencji offline (własny klucz, właściciele, przedłużanie jednym kliknięciem).",
      "♿ Dostępność: przyciski usuwania/edycji działają z klawiatury i czytników ekranu.",
      "🐛 Naprawiono ucinanie ekranu Ustawień na wąskich telefonach oraz ostrzeżenie przy braku miejsca/trybie prywatnym.",
    ],
  },
];

/** Najnowsza wersja na liście (do plakietki „nowość" / nagłówka). */
export function latestChangelog(): ChangelogEntry | null {
  return CHANGELOG[0] || null;
}
