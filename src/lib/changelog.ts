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
      "🎧 Tryb Słuchawki działa na Androidzie — naprawiono ciche milczenie bez klucza Groq (Web Speech nie działa w aplikacji; teraz zawsze nagrywamy, a transkrypcję robi lokalny Whisper lub darmowy Groq).",
      "🗣 Wyraźny „domyślny STAŁY głos" jednym guzikiem — głos nie zmienia się już sam.",
      "🧠 Mądrzejszy dobór modelu: pytania wyjaśniające („jak działa…", „na czym polega…") idą na mocniejszy model.",
      "🖥 Ollama: „Znajdź serwer" testuje wpisany adres (np. Tailscale), nie tylko localhost; jaśniejsze błędy.",
      "📲 Łatwiejszy serwer Ollama na PC: pilnowanie 24/7 (auto-restart), instrukcja na telefon, kod QR.",
      "🍏 Pełne przygotowanie pod iOS (build .ipa) i przeglądalna instrukcja obsługi w Strażniku.",
      "🔑 Generator licencji offline (własny klucz, właściciele, przedłużanie jednym kliknięciem).",
      "♿ Dostępność: przyciski „usuń/edytuj" działają z klawiatury i czytników ekranu.",
      "🐛 Naprawiono ucinanie ekranu Ustawień na wąskich telefonach oraz ostrzeżenie przy braku miejsca/trybie prywatnym.",
    ],
  },
];

/** Najnowsza wersja na liście (do plakietki „nowość" / nagłówka). */
export function latestChangelog(): ChangelogEntry | null {
  return CHANGELOG[0] || null;
}
