// „Wszczepiona" wiedza ekspercka — destylowane modele mentalne i heurystyki.
// Dobierane do pytania lokalnie (bez API, za darmo) i wstrzykiwane do promptu,
// dzięki czemu JARVIS rozumuje z eksperckim rusztowaniem niezależnie od modelu.

interface Insight {
  title: string;
  tags: string; // słowa-klucze (PL) do dopasowania
  body: string;
}

export const KNOWLEDGE: Insight[] = [
  { title: "Wartość oczekiwana", tags: "decyzja decyzje ryzyko wybór wybierać szansa prawdopodobieństwo zysk strata inwestycja zakład hazard", body: "Oceniaj decyzje przez (prawdopodobieństwo × skutek), nie przez sam wynik. Dobra decyzja przy złym losie wciąż jest dobra. Maksymalizuj oczekiwaną wartość, nie unikaj każdego ryzyka." },
  { title: "Drzwi jedno- i dwukierunkowe", tags: "decyzja decyzje odwracalne nieodwracalne ryzyko szybko wolno wybór zmiana", body: "Decyzje odwracalne podejmuj szybko (można wrócić). Nieodwracalne — wolno i ostrożnie. Większość wyborów jest odwracalna; nie paraliżuj się nimi." },
  { title: "Koszt utopiony", tags: "decyzja pieniądze czas rezygnacja porzucić kontynuować szkoda strata zainwestowałem", body: "To, co już wydane (czas, pieniądze, wysiłek), nie wraca i nie powinno wpływać na decyzję. Liczy się tylko przyszła wartość. Nie kontynuuj złej drogi tylko dlatego, że już tyle włożyłeś." },
  { title: "Pierwsze zasady", tags: "myślenie problem innowacja kreatywność rozwiązanie od podstaw fundamenty założenia", body: "Rozłóż problem na podstawowe prawdy, których jesteś pewien, i buduj od nich — zamiast kopiować to, jak robią inni. Tak powstają nieoczywiste rozwiązania." },
  { title: "Inwersja", tags: "myślenie problem cel unikać porażka błąd plan strategia odwrotnie", body: "Zamiast pytać, jak osiągnąć cel, spytaj raczej: co gwarantuje porażkę — i tego unikaj. Odwracanie problemu często ujawnia rozwiązanie." },
  { title: "Teoria ograniczeń (wąskie gardło)", tags: "produktywność proces wydajność optymalizacja problem usprawnienie firma projekt przepustowość", body: "System jest tak szybki, jak jego najwęższe miejsce. Popraw wąskie gardło, a nie losowe elementy — usprawnianie reszty nic nie da, dopóki ono blokuje." },
  { title: "Zasada Pareto 80/20", tags: "produktywność priorytety czas efektywność skup ważne klienci przychód wysiłek", body: "Zwykle ~80% efektów pochodzi z ~20% przyczyn. Znajdź te kluczowe 20% (zadań, klientów, nawyków) i skup na nich energię; resztę odetnij lub odłóż." },
  { title: "Aktualizacja bayesowska", tags: "myślenie prawdopodobieństwo opinia zmiana zdania dowody fakty przekonania pewność", body: "Zaczynaj od bazowej częstości (jak często to prawda ogólnie), potem aktualizuj w miarę dowodów. Silne twierdzenie wymaga silnych dowodów. Zmieniaj zdanie proporcjonalnie do nowych faktów." },
  { title: "Brzytwa Ockhama i Hanlona", tags: "myślenie wyjaśnienie przyczyna prostota intencje ludzie podejrzenie spisek błąd", body: "Najprostsze wyjaśnienie pasujące do faktów jest zwykle trafne. I nie przypisuj złej woli temu, co wystarczająco tłumaczy zwykły błąd lub niedopatrzenie." },
  { title: "Premortem", tags: "plan projekt ryzyko porażka przygotowanie strategia decyzja zabezpieczenie", body: "Zanim ruszysz, wyobraź sobie, że projekt spektakularnie padł — i wypisz dlaczego. Te przyczyny zaadresuj z góry. Wyłapuje ryzyka, które optymizm ukrywa." },
  { title: "Margines bezpieczeństwa", tags: "ryzyko plan finanse inżynieria bufor rezerwa zapas niepewność błąd", body: "Planuj z zapasem — czasu, pieniędzy, wytrzymałości. Świat jest bardziej niepewny, niż się wydaje. Bufor zamienia katastrofę w niedogodność." },
  { title: "Antykruchość", tags: "ryzyko stres rozwój system odporność zmienność chaos uczenie wzrost", body: "Dąż do rzeczy, które zyskują na zmienności i stresie, zamiast tylko je przetrwać. Małe, częste, odwracalne błędy budują siłę; unikaj ryzyk, które mogą zrujnować całkowicie." },
  { title: "Procent składany", tags: "pieniądze finanse inwestycja oszczędności czas nawyk rozwój nauka długoterminowo", body: "Małe, powtarzalne przyrosty kumulują się wykładniczo w czasie — w pieniądzach, wiedzy i nawykach. Zacznij wcześnie, bądź konsekwentny, daj czasowi działać." },
  { title: "Fundusz awaryjny i dywersyfikacja", tags: "pieniądze finanse oszczędności bezpieczeństwo ryzyko inwestycje budżet poduszka", body: "Trzymaj 3–6 miesięcy wydatków w gotówce na nieprzewidziane. Nie stawiaj wszystkiego na jedną kartę — rozkładaj ryzyko. Płynność daje spokój i opcje." },
  { title: "Koszt alternatywny", tags: "decyzja czas pieniądze wybór priorytety rezygnacja okazja", body: "Każde tak to nie dla wszystkiego innego, co mógłbyś zrobić z tym czasem/pieniędzmi. Oceniaj opcje względem najlepszej odrzuconej alternatywy, nie względem zera." },
  { title: "Macierz Eisenhowera", tags: "produktywność priorytety czas pilne ważne zadania organizacja planowanie", body: "Dziel zadania na pilne/ważne. Ważne-niepilne (rozwój, zdrowie, relacje) robój zanim staną się kryzysem. Pilne-nieważne deleguj; resztę odetnij." },
  { title: "Głęboka praca i wsadowość", tags: "produktywność skupienie koncentracja praca efektywność rozproszenie multitasking", body: "Najwartościowsza praca wymaga długich bloków bez przerwań. Grupuj podobne drobne zadania (maile, telefony) w jeden blok. Przełączanie kontekstu kosztuje więcej, niż się wydaje." },
  { title: "Reguła 2 minut i Parkinsona", tags: "produktywność nawyk prokrastynacja zadania czas deadline odkładanie start", body: "Jeśli coś zajmuje <2 min — zrób od razu. Praca rozszerza się na dostępny czas, więc wyznaczaj krótsze, konkretne terminy, by wymusić tempo." },
  { title: "Technika Feynmana", tags: "nauka uczenie rozumienie wiedza wyjaśnianie pamięć studia zrozumienie", body: "Wyjaśnij temat prostym językiem, jakbyś uczył dziecko. Miejsca, gdzie się zacinasz, to luki w Twoim rozumieniu — wróć do nich. Prostota = prawdziwe zrozumienie." },
  { title: "Powtórki rozłożone i przeplatanie", tags: "nauka uczenie pamięć zapamiętywanie egzamin nauka trening ćwiczenie", body: "Powtarzaj materiał w rosnących odstępach (dziś, za 2 dni, za tydzień) i mieszaj tematy zamiast wkuwać blokami. Trudniejsze w trakcie, ale dużo trwalsze." },
  { title: "Świadoma praktyka", tags: "nauka umiejętność trening rozwój talent doskonalenie sport muzyka ćwiczenie", body: "Postęp daje praktyka na granicy możliwości, z natychmiastowym feedbackiem i poprawą konkretnych słabości — nie samo powtarzanie tego, co już umiesz." },
  { title: "BATNA w negocjacjach", tags: "negocjacje rozmowa umowa biznes cena sprzedaż kupno warunki praca pensja", body: "Twoja siła to najlepsza alternatywa, jeśli nie dogadasz się tutaj. Im lepsza i lepiej znana Tobie BATNA, tym pewniej negocjujesz. Nigdy nie negocjuj bez planu B." },
  { title: "Pytania kalibrowane i aktywne słuchanie", tags: "negocjacje komunikacja rozmowa konflikt empatia sprzedaż wpływ relacje", body: "Pytania jak? i co? angażują drugą stronę do rozwiązywania problemu i ujawniają informacje. Powtórz własnymi słowami to, co usłyszałeś — buduje zaufanie i wyłapuje nieporozumienia." },
  { title: "Kotwiczenie", tags: "negocjacje cena psychologia decyzja pieniądze wpływ pierwszy liczba oferta", body: "Pierwsza podana liczba zniekształca cały zakres rozmowy. Świadomie ustawiaj kotwicę (rozsądnie ambitną) i bądź czujny, gdy ktoś kotwiczy Ciebie." },
  { title: "Błędy poznawcze", tags: "psychologia myślenie decyzja błąd uprzedzenie obiektywizm pułapka racjonalność", body: "Uważaj na: potwierdzenia (szukasz tego, co pasuje), dostępności (przeceniasz to, co łatwo przychodzi na myśl), zakotwiczenia i nadmierną pewność. Świadomość to pierwszy krok do korekty." },
  { title: "Pętla nawyku", tags: "nawyk zmiana rozwój dyscyplina motywacja zdrowie cel rutyna uzależnienie", body: "Nawyk = wyzwalacz → rutyna → nagroda. By zmienić, zostaw wyzwalacz i nagrodę, podmień rutynę. Projektuj środowisko tak, by dobre wybory były łatwe, a złe trudne." },
  { title: "Myślenie systemowe i pętle sprzężeń", tags: "system myślenie przyczyna skutek złożoność organizacja proces zależności równowaga", body: "Skutek rzadko ma jedną przyczynę — szukaj pętli sprzężeń zwrotnych i opóźnień. Punktowa naprawa często przesuwa problem gdzie indziej. Patrz na strukturę, nie tylko na zdarzenia." },
  { title: "Mapa to nie terytorium", tags: "myślenie model rzeczywistość pewność opinia teoria praktyka uproszczenie", body: "Każdy model to uproszczenie rzeczywistości — przydatny, ale niepełny. Nie myl swojej mapy z terenem; gdy rzeczywistość przeczy modelowi, wygrywa rzeczywistość." },
  { title: "Skutki drugiego rzędu", tags: "decyzja konsekwencje przyszłość plan strategia myślenie efekt skutki długoterminowo", body: "Pytaj: i co dalej? — co najmniej dwa razy. Wiele decyzji wygląda dobrze w pierwszym rzędzie, a szkodzi w drugim (np. szybkie ulgi, które tworzą większy problem)." },
  { title: "MVP i szybkie pętle", tags: "biznes produkt projekt start firma pomysł test rynek iteracja klient", body: "Zbuduj najmniejszą wersję, która daje realny feedback, i ucz się szybko z prawdziwych użytkowników. Tempo uczenia bije perfekcję w izolacji." },
  { title: "Ekonomia jednostkowa i product-market fit", tags: "biznes firma startup przychód koszt zysk produkt rynek klient skalowanie", body: "Zanim skalujesz, upewnij się, że jeden klient/transakcja zarabia więcej, niż kosztuje, i że ludzie naprawdę chcą produktu (mocno go używają/polecają). Skalowanie strat tylko je powiększa." },
  { title: "Podstawy zdrowia i energii", tags: "zdrowie sen energia stres dieta ruch samopoczucie kondycja koncentracja", body: "Sen (7–9 h), regularny ruch, białko i warzywa, światło dzienne i nawodnienie dają największy zwrot z energii i jasności umysłu. Fundamenty przed suplementami i trikami." },
];

// Lokalna normalizacja (małe litery, bez polskich znaków) do dopasowania.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
}

// Zbiór 4-znakowych rdzeni słów (radzi sobie z polską odmianą: pensja≈pensji).
function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(text).split(/\s+/)) if (w.length >= 4) out.add(w.slice(0, 4));
  return out;
}

// Wstępnie zindeksowane rdzenie dla każdej wkładki (tagi liczą się podwójnie).
const INDEX = KNOWLEDGE.map((k) => ({ k, stems: stems(`${k.title} ${k.tags} ${k.tags} ${k.body}`) }));

/** Dobiera najtrafniejsze modele mentalne do zapytania (offline, bez API). */
export function retrieveKnowledge(query: string, max = 3): string {
  const q = [...stems(query)];
  if (!q.length) return "";
  const scored = INDEX.map(({ k, stems: st }) => {
    let score = 0;
    for (const s of q) if (st.has(s)) score += 1;
    return { k, score };
  })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  if (!scored.length) return "";
  return (
    "\n\nWiedza ekspercka (modele mentalne — zastosuj te, które pasują, nie cytuj ich nazw mechanicznie):\n" +
    scored.map(({ k }) => `- ${k.title}: ${k.body}`).join("\n")
  );
}
