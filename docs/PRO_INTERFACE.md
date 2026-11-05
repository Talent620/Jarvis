# Classic i PRO NEW

PRO NEW jest domyślnym układem. Przełącznik **Classic / PRO NEW** w górnym pasku lub w **Ustawienia → Wygląd** zapisuje wybór natychmiast. Obie wersje korzystają z tych samych rozmów, projektów, kolejki i ustawień usług. Classic zachowuje dotychczasowe motywy kolorystyczne; PRO oferuje palety **Indygo** (domyślna), **Cyjan** i **Bursztyn**, obejmujące również awatara.

Proste ustawienia zawierają cztery sekcje: Model AI, Autonomia, Głos i Wygląd. Przycisk **Zaawansowane** otwiera pełne ustawienia. **Autonomicznie** włącza kolejkę, maksymalny tryb inteligencji, pogłębioną analizę i weryfikację trudnych odpowiedzi. Nowe instalacje mają te opcje włączone; zapisane preferencje użytkownika pozostają zachowane. Kolejka wykonuje cele przy otwartej aplikacji. Złożone zadania wymagają skonfigurowanego modelu i odpowiednich połączeń.

PRO udostępnia bezpośrednio rozmowę, kolejkę zadań, plan, zlecanie celów, projekty, pamięć i historię. **Centrum funkcji** otwiera pozostałe moduły. **Głos** otwiera rozmowę bez używania rąk, a menu **•••** zawiera dodatkowe opcje rozmowy. Na węższych ekranach nawigację można przewijać poziomo.

## Holograficzny awatar

Awatar jest oryginalną, generowaną matematycznie wizualizacją przestrzennej twarzy i ramion, rysowaną na Canvas. Nie pobiera modeli, filmów ani nowych bibliotek. Kliknięcie lub aktywowanie klawiaturą przełącza mikrofon poprzez dotychczasowy system obsługi głosu.

- Gotowość, nasłuch, analiza i odtwarzanie głosu mają odrębne stany wizualne.
- Odtwarzane audio URL dostarcza rzeczywisty poziom RMS przez istniejący Web Audio AnalyserNode. Poziom wpływa na usta i światło awatara.
- Systemowy SpeechSynthesis dostarcza stan start/pauza/koniec, ale nie udostępnia próbek audio. Nie ma wówczas dokładnej synchronizacji ust z fonemami.
- Obecny most natywnego TTS na Androidzie nie publikuje zdarzeń odtwarzania. Wizualizacja nie zgaduje tego stanu. Linux/Electron oraz Web Speech korzystają z obsługiwanych zdarzeń.
- Awatar nie otwiera drugiego mikrofonu ani kamery. Ruch spojrzenia odpowiada ruchowi wskaźnika w obszarze awatara.
- Ukrycie karty lub wyjście poza widoczny obszar zatrzymuje animację. Tryb ograniczonego ruchu pokazuje statyczny portret i tekst stanu; profil oszczędny zmniejsza szczegółowość i częstotliwość klatek.

Naprawiona obsługa głosu rozdziela przygotowywanie wypowiedzi od faktycznego odtwarzania. Zatrzymanie, błąd i koniec odtwarzania czyszczą sygnał, a spóźnione zdarzenie poprzedniej wypowiedzi nie zmienia stanu nowej.

## Research i decyzje

Sprawdzono oficjalną dokumentację MDN, korzystając również z jej źródeł `mdn/content`:

1. [AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode) — pomiar sygnału w dziedzinie czasu; pomiar rzeczywistej amplitudy zamiast losowej animacji głosu.
2. [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) — animacja sterowana znacznikiem czasu i sprzątanie zaplanowanych klatek.
3. [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) — zastąpienie zbędnego ruchu statyczną reprezentacją.
4. [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — jawne wstrzymywanie pracy po ukryciu aplikacji.

PRO jest częścią produkcyjnego `App`, z istniejącym routerem i rzeczywistymi danymi. Starszy eksperymentalny widok `#neural` pozostaje osobnym prototypem i nie jest używany jako PRO NEW.

## Podgląd i walidacja

[Widok PRO NEW](screenshots/pro-new.png) · [Proste ustawienia](screenshots/pro-settings.png)

Sprawdzono build TypeScript/Vite, ESLint, skan sekretów i 2827 testów Vitest. Testy przeglądarkowe objęły 39 ekranów i sześć zakładek pełnych ustawień na szerokościach 1440, 390 i 320 px. Dodatkowo sprawdzono trzy palety, proste ustawienia, zapis preferencji po przeładowaniu, zachowanie danych przy przełączeniu Classic/PRO oraz wykonanie lokalnego zadania przez kolejkę. Układ rozmowy i dostępność pola pisania sprawdzono przy szerokościach 320, 390, 768, 844, 1100 i 1440 px, w tym w orientacji poziomej.

Testy animacji obejmują cztery stany, ograniczenie ruchu, zatrzymanie klatek poza ekranem i po odmontowaniu oraz profil oszczędny. Automatyczne testy głosu sprawdzają cykl odtwarzania i anulowanie; nie zastępują odsłuchu wybranego silnika TTS na urządzeniu użytkownika.
