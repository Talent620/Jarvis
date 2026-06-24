// === Instrukcja obsługi / FAQ — jedno źródło prawdy o funkcjach JARVIS-a ===
// Każdy wpis: jak URUCHOMIĆ (how) i DO CZEGO służy (what), z hasłami do wyszukiwania.
// Treść zgodna ze stanem faktycznym (paleta poleceń w App.tsx + FAQ.tsx). Wyszukiwarka
// (searchManual) jest odporna na polskie znaki (ł, ą, ę, ó, ś, ż, ź, ć, ń) i wielkość liter.
// Renderowane w Strażniku (ManualBook). Dodając nową funkcję — dopisz tu jeden wpis.

export interface ManualEntry {
  id: string;
  icon: string;
  title: string;
  category: string;
  how: string; // jak uruchomić
  what: string; // do czego służy
  keywords: string; // dodatkowe hasła do wyszukiwania
}

// Wspólne sposoby uruchamiania (skrót w treści, by nie powtarzać):
//  • Paleta: ⌘K / Ctrl+K → wpisz nazwę.  • Menu „⋯ Więcej".  • Głos: powiedz „Jarvis…".
const PALETTE = "Paleta poleceń (⌘K / Ctrl+K) → wpisz nazwę, albo menu „⋯ Więcej”";

export const MANUAL: ManualEntry[] = [
  // — Rozmowa —
  {
    id: "chat", icon: "💬", title: "Rozmowa z JARVIS-em", category: "Rozmowa",
    how: "Pisz w polu na dole ekranu albo powiedz słowo-klucz „Jarvis”, żeby zaczął słuchać.",
    what: "Główny tryb: JARVIS to agent — nie tylko odpowiada, ale WYKONUJE (dodaje zadania, pisze maile, szuka leadów, sprawdza pogodę, steruje domem). Sam dobiera narzędzia do tego, co powiesz.",
    keywords: "czat rozmowa pisz mów asystent agent pole tekst",
  },
  {
    id: "live", icon: "☎", title: "Rozmowa na żywo", category: "Rozmowa",
    how: `Ikona ☎ przy polu czatu, albo ${PALETTE} → „Rozmowa na żywo”. Głosem: „Jarvis, rozmowa na żywo”.`,
    what: "Pełny dupleks audio (Gemini Live): mówisz i słyszysz odpowiedź bez czekania, z przerywaniem w pół słowa. Wymaga klucza Gemini.",
    keywords: "live duplex telefon gemini głos rozmowa na żywo audio",
  },
  {
    id: "voicemode", icon: "🎧", title: "Tryb Słuchawki", category: "Rozmowa",
    how: `${PALETTE} → „Tryb Słuchawki”. Wygodne przez słuchawki Bluetooth.`,
    what: "Obsługa wyłącznie głosem, bez patrzenia na ekran — za kierownicą, na spacerze. JARVIS słucha, odpowiada głosem i czeka na kolejne polecenie.",
    keywords: "słuchawki hands-free bluetooth głos kierownica spacer headset",
  },
  {
    id: "boss", icon: "⬢", title: "Tryb Szefa", category: "Rozmowa",
    how: "Przeciągalna ikona ⬢ na ekranie głównym (możesz ją przesunąć), powiedz „szef”, albo paleta → „Tryb Szefa”.",
    what: "Centralny agent głosowy w stylu Matrix — wydajesz rozkazy, a JARVIS je wykonuje. W tym trybie działa auto-zgoda na akcje (wygasa po 15 min).",
    keywords: "szef boss matrix rozkaz agent głos ⬢ przeciągaj ikona",
  },
  {
    id: "newchat", icon: "＋", title: "Nowa rozmowa", category: "Rozmowa",
    how: `${PALETTE} → „Nowa rozmowa”.`,
    what: "Czyści bieżący wątek i zaczyna od zera (poprzednie rozmowy zostają w historii / Recall).",
    keywords: "nowa wyczyść reset czat wątek",
  },
  {
    id: "private", icon: "🕶", title: "Czat prywatny", category: "Rozmowa",
    how: `${PALETTE} → „Czat prywatny (przełącz)”.`,
    what: "Tryb incognito: rozmowa nie jest zapisywana do historii ani pamięci. Dobre do jednorazowych, wrażliwych pytań.",
    keywords: "prywatny incognito bez zapisu poufny",
  },
  {
    id: "mic", icon: "🎤", title: "Mikrofon", category: "Rozmowa",
    how: "Ikona mikrofonu przy polu czatu, albo paleta → „Mikrofon (przełącz)”.",
    what: "Włącza/wyłącza nasłuch mowy. Po włączeniu możesz dyktować zamiast pisać.",
    keywords: "mikrofon mów dyktuj nasłuch słuchaj mic",
  },

  // — Sprzedaż i biznes —
  {
    id: "sales", icon: "📈", title: "Pulpit Sprzedaży / CRM", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Pulpit Sprzedaży”.`,
    what: "Centrum pozyskiwania klientów: znajduje firmy z OpenStreetMap (z telefonami, bez klucza), buduje teczkę klienta (audyt strony, słabe punkty, gotowy e-mail, skrypt rozmowy, scoring 0–100), prowadzi przez statusy: ✅ Klienci · 📞 Do dzwonienia · ✉ Mailowani · ❌ Odrzucili. Import/eksport CSV.",
    keywords: "leady crm sprzedaż klienci oferty teczka audyt scoring osm firmy",
  },
  {
    id: "goal", icon: "🎯", title: "Zleć cel (wieloetapowy)", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Zleć cel”.`,
    what: "Opisujesz cel, a JARVIS rozbija go na kroki i prowadzi projekt wieloetapowo (do-it-for-me).",
    keywords: "cel projekt plan wieloetapowe do-for-me zlecenie autopilot",
  },
  {
    id: "money", icon: "💰", title: "Zarabianie", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Zarabianie”.`,
    what: "Kokpit modelu „agencja stron”: ile masz potencjału w toku, ile zarobione, ile ofert gotowych — plus uczciwa instrukcja, jak to spina się w pieniądze.",
    keywords: "dochód pieniądze autopilot zarabianie agencja przychód",
  },
  {
    id: "web", icon: "🌐", title: "Kreator stron", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Kreator stron”.`,
    what: "Buduje gotową witrynę (np. demo dla klienta agencji stron) z opisu.",
    keywords: "strona witryna www kreator landing demo",
  },
  {
    id: "content", icon: "📱", title: "Maszynka do kontentu", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Maszynka do kontentu”.`,
    what: "Wpisujesz temat, a JARVIS pisze gotowy post na Instagram, Facebooka, TikToka lub LinkedIn — w wybranym tonie, z Twoją marką, hashtagami i CTA. Wszystko trafia do historii postów.",
    keywords: "posty social media instagram facebook tiktok linkedin treści content",
  },
  {
    id: "ads", icon: "📢", title: "Generator reklam", category: "Sprzedaż i biznes",
    how: `${PALETTE} → „Generator reklam”.`,
    what: "Gotowe zestawy reklam: Google Ads (15 nagłówków, opisy, słowa kluczowe, budżet) i Meta (tekst, nagłówki, CTA, pomysły na kreację, grupa docelowa). Bez API — kopiujesz i wklejasz.",
    keywords: "reklamy google ads meta facebook kampania nagłówki budżet",
  },

  // — Praca i organizacja —
  {
    id: "tasks", icon: "✅", title: "Zadania (GTD)", category: "Praca i organizacja",
    how: `${PALETTE} → „Zadania”. Głosem: „Jarvis, dodaj zadanie…”.`,
    what: "Pełne GTD: projekty, priorytety, terminy. Zapisywane lokalnie. JARVIS sam może dodawać zadania w rozmowie.",
    keywords: "zadania gtd todo projekty priorytety terminy lista",
  },
  {
    id: "journal", icon: "📔", title: "Dziennik", category: "Praca i organizacja",
    how: `${PALETTE} → „Dziennik”.`,
    what: "Miejsce na przemyślenia i notatki osobiste. Udostępnione wpisy JARVIS układa według trafności do tematu pytania („pamięć ewoluująca”).",
    keywords: "dziennik notatki przemyślenia journal zapiski",
  },
  {
    id: "cards", icon: "🃏", title: "Kapsuły Wiedzy (fiszki)", category: "Praca i organizacja",
    how: `${PALETTE} → „Kapsuły Wiedzy”.`,
    what: "Z dowolnego materiału JARVIS robi pytania i odpowiedzi do nauki (aktywne przypominanie). Szybkie opanowanie nowego tematu czy oferty.",
    keywords: "fiszki nauka ucz kapsuły wiedza powtórki flashcards",
  },

  // — Zakupy i okazje —
  {
    id: "bargain", icon: "🏷", title: "Łowca Okazji", category: "Zakupy i okazje",
    how: `${PALETTE} → „Łowca Okazji”.`,
    what: "Wpisujesz przedmiot (nazwa/model/numer części), a JARVIS znajduje go najtaniej — osobno najtańszy nowy i używany, z medianą ceny i ostrzeżeniem przed podejrzanie tanimi ofertami.",
    keywords: "okazja tanio cena kup nowy używany łowca przedmiot zakupy",
  },
  {
    id: "wheretobuy", icon: "📍", title: "Gdzie kupię w pobliżu", category: "Zakupy i okazje",
    how: "Z poziomu „Zarabianie” / Łowcy Okazji, albo zapytaj głosem „gdzie kupię…”.",
    what: "Pokazuje miejsca, gdzie kupisz to, czego szukasz: najbliżej oraz „taniej, ale dalej”. Daje linki do map i wyszukiwarki.",
    keywords: "gdzie kupić sklep pobliże mapa lokalnie najbliżej",
  },
  {
    id: "shopping", icon: "🛒", title: "Lista zakupów", category: "Zakupy i okazje",
    how: "Z poziomu „Zarabianie” / MoneyHub → Lista zakupów.",
    what: "Spisujesz, co kupić, a JARVIS pomaga kupić to najtaniej (łączy się z Łowcą Okazji). Lista żyje między sesjami.",
    keywords: "lista zakupów koszyk kup najtaniej shopping",
  },

  // — Narzędzia AI —
  {
    id: "studio", icon: "🎨", title: "Studio Obrazów", category: "Narzędzia AI",
    how: `${PALETTE} → „Studio Obrazów”.`,
    what: "Tworzy i edytuje obrazy z opisu (np. grafika do posta czy reklamy). Wymaga modelu graficznego.",
    keywords: "obraz grafika generuj edytuj zdjęcie foto studio dall-e",
  },
  {
    id: "translator", icon: "🌍", title: "Tłumacz na żywo", category: "Narzędzia AI",
    how: `${PALETTE} → „Tłumacz na żywo”.`,
    what: "Rozmowa dwóch osób w dwóch językach: mówisz po polsku, druga osoba słyszy/widzi tłumaczenie i odwrotnie. Klient z zagranicy, podróż.",
    keywords: "tłumacz język translacja rozmowa zagranica dwujęzyczny",
  },
  {
    id: "transcribe", icon: "🎙", title: "Transkrypcja", category: "Narzędzia AI",
    how: `${PALETTE} → „Transkrypcja”.`,
    what: "Zamienia mowę na tekst — nagrywasz spotkanie albo mówisz, a dostajesz zapis do skopiowania. Koniec ręcznego notowania.",
    keywords: "transkrypcja mowa tekst spotkanie nagranie notatki whisper",
  },
  {
    id: "hud", icon: "👁", title: "Wizja (kamera) / HUD", category: "Narzędzia AI",
    how: `${PALETTE} → „Wizja (kamera)”.`,
    what: "Patrzy przez aparat („co to jest?”, „przetłumacz tę etykietę”). Na komputerze „Spójrz na ekran” analizuje monitor. Wymaga modelu z obsługą obrazu.",
    keywords: "kamera wizja hud obraz aparat widzi etykieta ekran",
  },
  {
    id: "recall", icon: "🔎", title: "Recall — znajdź wszystko", category: "Narzędzia AI",
    how: `${PALETTE} → „Recall”.`,
    what: "Globalna wyszukiwarka po wszystkim: historia czatów, dziennik, pamięć, notatki. Wpisujesz hasło i znajdujesz, gdziekolwiek to było.",
    keywords: "recall szukaj znajdź wyszukiwarka historia pamięć notatki",
  },

  // — Ja, pamięć i bezpieczeństwo —
  {
    id: "profile", icon: "👤", title: "Mój profil", category: "Ja, pamięć i bezpieczeństwo",
    how: `${PALETTE} → „Mój profil”.`,
    what: "Kim jesteś: imię, styl, preferencje. JARVIS używa tego, by odpowiadać po Twojemu.",
    keywords: "profil kim jestem imię preferencje styl ja",
  },
  {
    id: "memory", icon: "🧠", title: "Co JARVIS o mnie wie (Pamięć)", category: "Ja, pamięć i bezpieczeństwo",
    how: `${PALETTE} → „Co JARVIS o mnie wie”.`,
    what: "Konkretne fakty, które JARVIS sam zapamiętuje w rozmowie — możesz je podejrzeć, edytować i usunąć. Pełna kontrola, nic w ukryciu.",
    keywords: "pamięć fakty wiedza edytuj usuń kontrola memory",
  },
  {
    id: "mind", icon: "🧠", title: "Umysł JARVISA", category: "Ja, pamięć i bezpieczeństwo",
    how: `${PALETTE} → „Umysł JARVISA”.`,
    what: "Wgląd w „głowę” asystenta: poranna odprawa, model świata, wykryte wzorce i samoocena.",
    keywords: "umysł odprawa świat wzorce samoocena mind briefing",
  },
  {
    id: "data", icon: "🗄", title: "Dane i kopia zapasowa", category: "Ja, pamięć i bezpieczeństwo",
    how: `${PALETTE} → „Dane i kopia”. Lub Ustawienia → Dane.`,
    what: "Eksport/import danych i kopia zapasowa zaszyfrowana AES-256 — bezpieczna nawet, gdyby plik wpadł w niepowołane ręce. Tu też wyczyścisz dane.",
    keywords: "dane backup kopia eksport import szyfrowanie aes bezpieczeństwo",
  },
  {
    id: "google", icon: "📧", title: "Integracje Google (Gmail, Kalendarz)", category: "Ja, pamięć i bezpieczeństwo",
    how: "Ustawienia (⚙) → Integracje → podłącz konto Google.",
    what: "JARVIS czyta i streszcza maile, odpowiada w wątku, czyta i dodaje wydarzenia w Kalendarzu. Poranny briefing dorzuca nieprzeczytane maile i plan dnia.",
    keywords: "google gmail kalendarz maile wydarzenia integracja briefing",
  },
  {
    id: "license", icon: "🔑", title: "Licencja / aktywacja", category: "Ja, pamięć i bezpieczeństwo",
    how: "Wklej klucz licencyjny na ekranie startowym (Brama licencji). Raz na urządzenie.",
    what: "Kryptograficznie podpisany klucz chroni własność programu i działa na każdym Twoim urządzeniu — telefonie i komputerze.",
    keywords: "licencja klucz aktywacja activate własność",
  },
  {
    id: "desktop", icon: "🖥", title: "Sterowanie komputerem (Windows)", category: "Ja, pamięć i bezpieczeństwo",
    how: "Tylko w wersji na komputer (EXE). Po prostu poproś, np. „otwórz przeglądarkę”, „ścisz”.",
    what: "JARVIS otwiera aplikacje, reguluje głośność, steruje multimediami i pisze za Ciebie — asystent „bez rąk” przy biurku.",
    keywords: "windows komputer sterowanie głośność aplikacje desktop exe",
  },

  // — System i diagnostyka —
  {
    id: "settings", icon: "⚙", title: "Ustawienia", category: "System i diagnostyka",
    how: "Ikona ⚙, albo paleta → „Ustawienia”.",
    what: "Klucze API, wybór modelu, głos, motyw, konto, integracje, blokada PIN, dane. Centrum konfiguracji całej aplikacji.",
    keywords: "ustawienia klucze api model głos motyw konto pin konfiguracja settings",
  },
  {
    id: "guardian", icon: "🩺", title: "Diagnoza i naprawa (Strażnik)", category: "System i diagnostyka",
    how: `${PALETTE} → „Diagnoza i naprawa”.`,
    what: "Centralny panel dowodzenia: ocena zdrowia 0–100, „Napraw wszystko” (wykrycie serwerów i wybór działającego mózgu), auto-konfiguracja pod sprzęt, tryb doradcy/wykonawcy, autopilot oraz TA instrukcja obsługi.",
    keywords: "strażnik guardian diagnoza napraw zdrowie autopilot pomoc instrukcja",
  },
  {
    id: "status", icon: "🩺", title: "Stan systemu", category: "System i diagnostyka",
    how: `${PALETTE} → „Stan systemu”.`,
    what: "Szybki podgląd, co działa, a co nie (mózg, klucze, serwery, integracje).",
    keywords: "stan status diagnostyka co działa zdrowie system",
  },
  {
    id: "exportmd", icon: "📤", title: "Eksport rozmowy (Markdown)", category: "System i diagnostyka",
    how: `${PALETTE} → „Eksportuj rozmowę”.`,
    what: "Zapisuje bieżącą rozmowę do pliku Markdown — do archiwum lub udostępnienia.",
    keywords: "eksport markdown zapisz rozmowa udostępnij kopiuj",
  },
];

// Normalizacja odporna na polskie znaki: małe litery + usunięcie znaków diakrytycznych
// (NFD rozkłada ą/ę/ó/ś/ż/ź/ć/ń; „ł” trzeba podmienić ręcznie, bo NFD go nie rozkłada).
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // usuń łączone znaki diakrytyczne (ą→a, ś→s, …)
    .replace(/ł/g, "l"); // „ł” NFD nie rozkłada — podmień ręcznie
}

/**
 * Wyszukiwarka instrukcji. Puste zapytanie → cała lista (w oryginalnej kolejności).
 * Inaczej: zwraca wpisy, w których KAŻDE słowo zapytania pojawia się gdziekolwiek
 * (tytuł / opis / sposób uruchomienia / hasła / kategoria). Odporna na polskie znaki.
 */
export function searchManual(query: string, entries: ManualEntry[] = MANUAL): ManualEntry[] {
  const q = norm(query).trim();
  if (!q) return entries;
  const tokens = q.split(/\s+/);
  return entries.filter((e) => {
    const hay = norm(`${e.title} ${e.what} ${e.how} ${e.keywords} ${e.category}`);
    return tokens.every((t) => hay.includes(t));
  });
}

/** Lista kategorii w kolejności pierwszego wystąpienia (do nagłówków sekcji). */
export function manualCategories(entries: ManualEntry[] = MANUAL): string[] {
  const seen: string[] = [];
  for (const e of entries) if (!seen.includes(e.category)) seen.push(e.category);
  return seen;
}
