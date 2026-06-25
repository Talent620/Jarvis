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
      "🔗 Linki z pomiarem ROI (UTM) w Generatorze reklam: wklejasz adres strony, wybierasz źródło (Google, Instagram, Facebook, TikTok, LinkedIn, newsletter) i nazwę kampanii — JARVIS robi gotowy link, po którym w Google Analytics widzisz, która reklama/post/link w bio realnie daje ruch i sprzedaż. Działa dla reklam, social i e-maili.",
      "🕘 Studio Obrazów — historia przeróbek: każdy gotowy wynik zapisuje się w historii (przeżywa zamknięcie Studia). Pod wynikiem masz pasek miniatur — dotknij, by wziąć obraz do dalszej edycji, albo usuń ✕. Trzymane ostatnie 16 (w pamięci urządzenia).",
      "📱 Okna mieszczą się na małych ekranach (S9): naprawiono przewijanie palcem wewnątrz okien-paneli — na starszym WebView gest pionowy bywał martwy i wyglądało, jakby okno się nie mieściło. Teraz przewija się płynnie i dosięgasz przycisków na dole.",
      "🖼 Studio Obrazów — Asystent nie zawiesi generacji, gdy mózg offline: jeśli tekstowy mózg nie odpowiada (np. lokalna Ollama nieosiągalna), krok rozumienia polecenia nie czeka już w nieskończoność — po 15 s przechodzi wprost do generacji (fal.ai i tak działa), z podpowiedzią, że Asystenta możesz wyłączyć przyciskiem 💬.",
      "🖥 Czytelny komunikat, gdy lokalny model (Ollama) jest nieosiągalny: zamiast technicznego błędu Failed to connect (adres:11434) zobaczysz po ludzku, że nie ma połączenia z serwerem Ollama — z radą: sprawdź, czy PC jest włączony, Ollama działa i Tailscale połączony, albo przełącz mózg na chmurę. Dotyczy m.in. Kreatora stron.",
      "📢 Generator reklam — audyt jakości i ryzyka odrzucenia: po wygenerowaniu reklamy widzisz wynik 0–100 i konkretne poprawki, zanim wkleisz ją do Google/Meta — sprawdza limity znaków nagłówków, KAPITALIKI, nadmiar wykrzykników, ryzykowne obietnice/superlatywy, emoji w Google (niedozwolone) i obecność CTA. Mniej odrzuceń, mocniejszy przekaz.",
      "📧 Jaśniej, jak dodać e-mail: przy Integracjach Google (najtrudniejsza droga, wymaga backendu) jest teraz podpowiedź kierująca do prostszych dróg — Centrum → ✉ Wyślij e-mail → Otwórz w Gmailu (od ręki, bez kluczy) albo sekcja 📨 Poczta (hasło aplikacji). Koniec utykania na OAuth.",
      "🩺 Diagnostyka startowa sprawdza też fal.ai: gdy masz wpisany klucz fal.ai, przycisk Uruchom diagnostykę raportuje jego stan (działa / zły klucz / brak billingu) obok reszty kluczy — bez kosztu, bez generowania obrazu.",
      "🔑 Test klucza fal.ai jednym kliknięciem (⚙ → AI → Studio premium): przycisk Sprawdź klucz fal.ai od razu mówi, czy klucz jest ważny, czy brakuje billingu/środków, czy działa — bez generowania obrazu i bez kosztu. Koniec zgadywania, czemu premium nie rusza.",
      "🖼 Studio Obrazów — czytelny powód, gdy płatny fal.ai odmówi: dotąd gdy fal.ai odrzucił edycję (np. brak środków/billingu na koncie fal.ai), JARVIS po cichu próbował darmowym Gemini i — gdy ten też miał wyczerpany limit — pokazywał mylący komunikat o limicie Gemini (każąc wybrać fal.ai, który już był wybrany). Teraz widzisz OBA powody, najpierw realny problem fal.ai, z podpowiedzią, że trzeba sprawdzić ważność klucza i billing fal.ai.",
      "✍ Wiele podpisów e-mail z wyborem przed wysyłką: w Wyślij e-mail zapisujesz kilka podpisów (np. Firmowy, Prywatny), nadajesz im nazwy i jednym dotknięciem wybierasz aktywny tuż przed wysłaniem — dokleja się do treści automatycznie. Dodawanie, usuwanie i przełączanie na miejscu; Twój dotychczasowy podpis trafia do biblioteki sam, więc działa jak dotąd.",
      "✉ Ręczna wysyłka e-maila z JARVIS-a: w Centrum (Sprzedaż i biznes) jest Wyślij e-mail — wpisujesz adres, temat i treść, podpis dokleja się sam, widzisz ryzyko spamu i masz akcje AI (skróć/przepisz/CTA…). Wysyłasz jednym przyciskiem (gdy skonfigurowana poczta) albo otwierasz w Gmailu/poczcie. Pełna kontrola, zero automatu.",
      "🖼 Studio Obrazów — fal.ai generuje też z opisu (nie tylko edytuje): masz klucz fal.ai i chcesz stworzyć obraz z samego tekstu? Teraz działa bez klucza Gemini — fal.ai robi i generowanie z opisu, i edycję zdjęć. Wybierz model fal.ai i pisz prompt.",
      "✍ Maile do leadów — akcje AI kompozytora: pod draftem maila masz przyciski Skróć, Rozwiń, Mocniejsze CTA, Formalnie, Luźniej, Personalizuj, Przepisz — jedno dotknięcie przerabia treść; przy błędzie zostaje oryginał. Obok widzisz też ryzyko spamu (dostarczalność).",
      "🎨 Dusza Marki (Brand-kit): ustaw raz tożsamość — ton głosu, paletę kolorów, typografię, słowa kluczowe — a JARVIS użyje jej automatycznie przy tworzeniu stron, treści i obrazów, dla spójnego wyglądu i języka. Znajdziesz ją w Centrum (Sprzedaż i biznes). Puste pola = generacja działa jak dotąd.",
      "🎯 Kreator stron — Conversion AI (CRO): obok audytu jakości masz teraz osobny wynik mocy SPRZEDAŻOWEJ strony (0–100 + ocena A–D) — sprawdza nagłówek z korzyścią, CTA i ich powtórzenia, dowód społeczny, sygnały zaufania, cennik, przechwytywanie leada, język korzyści, FAQ i kontakt. Plus przycisk Podnieś konwersję, który jednym kliknięciem nanosi priorytetowe poprawki.",
      "✨ Dynamiczny follow-up AI: w Planie sprzedaży przycisk AI follow-up pisze unikalne ponaglenie z kontekstu leada (firma, branża, słabe punkty z wywiadu, poprzednia wiadomość, dni od kontaktu, numer próby) — inny kąt za każdym razem, bez szablonu; przy braku mózgu wraca do sprawdzonego szablonu.",
      "📬 Sprzedaż — agent dostarczalności: pod draftem maila do leada widzisz ryzyko spamu (0–100) i konkretne poprawki, zanim wyślesz.",
      "🍱 Kreator stron — sekcje premium na klik: gdy masz gotową stronę, jednym dotknięciem dodasz dopracowaną sekcję (bento, hero 3D/parallax, scroll-storytelling, liczby count-up, cennik, opinie, pasek zaufania, galeria, mocne CTA, kontakt) — model wstawia je spójnie ze stylem Twojej strony.",
      "🧭 Kreator stron — Analityk biznesowy: przed budową jednym kliknięciem dostajesz strategię (branża, grupa docelowa, USP, oferta, kluczowe sekcje, ton), którą możesz podredagować — a generator buduje stronę wprost z niej, więc jest realnie trafiona pod sprzedaż.",
      "🌐 Kreator stron — wielki skok: 11 światowych systemów projektowych (Apple, Stripe, Linear, Notion, Tesla, Airbnb, OpenAI, SaaS, Enterprise, Cyberpunk, Minimal), AUTOMATYCZNY dobór stylu z opisu, pełna autonomiczna specyfikacja (SEO, schema.org, Open Graph, Twitter Cards, FAQ, formularz, cookie banner RODO, polityka prywatności — bez dopytywania), audyt jakości 0–100 (SEO/dostępność/UX) po każdej generacji oraz przycisk samodoskonalenia (krytyka i przebudowa na wyższy poziom jednym kliknięciem).",
      "💣 Głos Kapitana Bomby NAPRAWDĘ zniekształcony: dodałem realny efekt audio (mocny distortion + podbite niskie + ścięte wysokie + niższy ton) na głosie buforowym — premium (ElevenLabs) lub lokalnym (Kokoro). Teraz brzmi charkotliwie i brutalnie, nie tylko nisko. Uwaga: systemowy głos nadal daje tylko głęboki ton (jego sygnału nie da się przerobić), więc do pełnego charkotu wybierz Premium albo Kokoro w ⚙ → Głos.",
      "🎟 Tryb Trial (pod reklamę i sprzedaż): rozdajesz klucze próbne na X dni, a aplikacja pokazuje odbiorcy pasek z liczbą pozostałych dni trialu i delikatnie zachęca do przedłużenia; gdy licencja czasowa dobiega końca (3 dni lub mniej) — wyraźny monit. Przyciskiem przedłużenia wklejasz nowy klucz bez utraty dostępu.",
      "💣 Tryb Szefa — głos Premium (ElevenLabs): trzeci, najbardziej ludzki i ekspresyjny głos agenta, dostrojony pod agresywne, dynamiczne podanie — najbliżej klimatu Kapitana Bomby. Wymaga klucza ElevenLabs i wybranego głębokiego głosu w ⚙ → Głos. Przyciskiem 🎙 Głos krążysz: Kapitan Bomba → Premium → Robot.",
      "💣 Tryb Szefa — głos Kapitana Bomby: domyślnie agent mówi teraz bardzo niskim, twardym głosem w stylu Kapitana Bomby. Jednym przyciskiem (🎙 Głos) przełączysz na klasyczny robotyczny i z powrotem.",
      "🩹 Tryb Szefa — okno mieści się na każdym telefonie: ekran agenta przewija się, gdy treści dużo (S9), i nie ucina już dołu (przyciski/pole zawsze dostępne).",
      "⬢ Tryb Szefa — ciągłość zadania: zamkniesz i wrócisz w ciągu pół godziny, a agent pamięta, na czym skończyliście, i kontynuuje. Przyciskiem Nowy temat zaczynasz od czysta.",
      "⬢ Tryb Szefa — meta-rozkazy głosem bez modelu: powiesz stop albo anuluj i agent natychmiast milknie; powiesz powtórz albo jeszcze raz i powtórzy ostatnią odpowiedź. Działa od ręki, pewnie i za darmo (nie idzie do AI).",
      "⬢ Tryb Szefa — 🔁 Powtórz: jeśli przegapisz odpowiedź agenta (hands-free, telefon w kieszeni), jednym dotknięciem powtórzy ostatni komunikat na głos.",
      "⬢ Tryb Szefa — szybkie rozkazy jednym dotknięciem: na ekranie agenta są teraz kontekstowe przyciski (odprawa, co mam dziś, zadania, co o mnie wiesz) — dotknięcie wykonuje rozkaz natychmiast i niezawodnie, bez ryzyka przesłyszenia głosu, i od razu widać, co można zlecić.",
      "🧠 Proaktywna pamięć w rozmowie na żywo: JARVIS sam nawiązuje do tego, co o Tobie pamięta (wcześniejsze wątki, cele, decyzje) — gdy to naturalnie pasuje, jak znajomy. Bez zmyślania i bez wciskania na siłę. Uczy się lokalnie po każdej wymianie, więc z czasem zna Cię lepiej.",
      "🎭 Łatwe włączenie głosu naturalnego, z emocją: w ⚙ → Głos jest teraz krótki doradca — co daje każdy głos premium, ile kosztuje i jak go wpiąć, plus przycisk wypróbowania DARMOWEGO głosu premium (Gemini TTS) jednym dotknięciem.",
      "🗣 Naturalniejsza wymowa: JARVIS rozwija przy czytaniu skróty i symbole, które silniki głosu literują lub czytają dziwnie (np. na przykład, między innymi, około, numer, procent, stopni) — brzmi bardziej po ludzku na każdym głosie.",
      "🔊 Przycisk czytania przy polu wpisywania: gdy masz coś wpisane lub wklejone, dotknij 🔊 nad polem, a JARVIS odczyta to dosłownie na głos — bez pisania komendy i bez wysyłania do modelu.",
      "🔊 Nowa komenda czytania na głos: napisz przeczytaj na głos: a po dwukropku wklej dowolny tekst — JARVIS odczyta go DOSŁOWNIE (bez przetwarzania, bez kosztu), z czystą mową (bez znaczników i emoji).",
      "🐛 Koniec samoczynnego włączania Trybu Prywatnego: wklejenie długiego tekstu (np. promptu lub dokumentu) ze słowami offline, lokalnie czy nieocenzurowany NIE przełącza już trybu i nie przerywa odpowiedzi — komendą trybu jest tylko krótkie polecenie, a nie treść do przetworzenia.",
      "🧵 Ciągłość rozmowy na żywo: gdy wrócisz do Trybu Słuchawki w ciągu pół godziny, JARVIS pamięta, o czym była mowa, i płynnie kontynuuje wątek — zamiast zaczynać od zera. Po dłuższej przerwie startuje świeżo (a wiedza o Tobie i tak zostaje). Przyciskiem Nowa zaczniesz rozmowę od początku.",
      "🔊 Czystszy głos: JARVIS nie czyta już na głos znaczników, linków, emoji ani kodu — markdown znika, adresy stają się słowem link, a wypowiedź brzmi naturalnie nawet, gdy model wstawi formatowanie. Działa wszędzie, gdzie JARVIS mówi.",
      "⚡ Strumieniowy głos w rozmowie na żywo: JARVIS zaczyna mówić pierwsze zdanie, gdy reszta jeszcze się tworzy — koniec czekania na całą odpowiedź. Możesz mu wejść w słowo (barge-in) i od razu przerywa. Brzmi to jak prawdziwa, płynna rozmowa.",
      "🎙 Rozmowa na żywo jak z człowiekiem: w Trybie Słuchawki JARVIS mówi teraz krótko, naturalnie i z wyczuciem — pełnymi zdaniami do słuchania, bez czytanych na głos list i znaczników. Pamięta kontekst całej rozmowy, korzysta z pamięci o Tobie, narzędzi i dostępu do informacji, myśli o krok do przodu — i odpowiada szybciej (krótkie odpowiedzi = błyskawiczny głos).",
      "🖼 Adres serwera obrazów (Stable Diffusion) też wybacza pomyłki — tak samo jak Ollama: bez http://, ze spacjami, z ukośnikiem, bez portu (dokłada domyślny 7860). Mniej walki z konfiguracją.",
      "🖥 Adres serwera Ollama wybacza pomyłki: wpiszesz w dowolnej formie (bez http://, z wklejonymi spacjami, z końcowym ukośnikiem, nawet bez portu) — JARVIS sam doprowadzi go do działającej postaci (np. 100.64.33.7 → http://100.64.33.7:11434). Dla adresów https (Tailscale serve) portu nie rusza.",
      "🩺 Trafniejsza diagnoza serwera AI w aplikacji: w APK nie pokazujemy już mylącej rady o mixed-content (HTTP zablokowany) — tam HTTP do sieci domowej i Tailscale działa, więc gdy coś nie gra, podpowiadamy realną przyczynę (serwer, adres, CORS). Komunikat o mixed-content zostaje tylko w przeglądarce, gdzie faktycznie obowiązuje.",
      "🖥 Serwer Ollama przez Tailscale działa na Androidzie: koniec błędu o blokadzie nieszyfrowanego HTTP (Cleartext not permitted) dla adresów 100.64.x.x — apka dopuszcza teraz HTTP do Twoich lokalnych serwerów AI (sieć domowa i Tailscale), a ruch do chmury dalej idzie po HTTPS.",
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
