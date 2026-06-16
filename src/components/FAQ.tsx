import type { ReactNode } from "react";
import { useEscape } from "../hooks/useEscape";
import Guide from "./Guide";

// FAQ — „do czego służy każda funkcja", napisane ciekawie, ale zgodnie ze stanem
// faktycznym kodu (żadnych obietnic bez pokrycia). Każda pozycja to zwijane <details>.
function Q({ q, children }: { q: string; children: ReactNode }) {
  return <Guide title={`❓ ${q}`}>{children}</Guide>;
}

export default function FAQ({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>❓ FAQ — co potrafi każda funkcja</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Krótko i konkretnie: do czego służy każda część JARVIS-a. Dotknij pytania, by rozwinąć.
          </p>

          <h3>🗣 Rozmowa z JARVIS-em</h3>
          <Q q="Jak z nim rozmawiać — pisać czy mówić?">
            Jedno i drugie. Piszesz w polu czatu albo mówisz — powiedz słowo-klucz <b>„Jarvis"</b>, a zacznie słuchać.
            Odpowiada głosem (możesz mu przerwać w pół słowa) i tekstem na żywo, jak na ekranie z filmu.
          </Q>
          <Q q="Czym różni się od zwykłego chatbota?">
            JARVIS jest <b>agentem</b> — nie tylko odpowiada, ale <b>wykonuje</b>: dodaje zadania, pisze i (po konfiguracji)
            wysyła maile, szuka leadów, sprawdza pogodę, steruje domem. Sam dobiera narzędzia do tego, co powiesz.
          </Q>
          <Q q="Co to „Rozmowa na żywo” (☎) i Tryb Słuchawki?">
            <b>Rozmowa na żywo</b> to pełny dupleks audio (przez Gemini Live): mówisz i słyszysz odpowiedź bez czekania,
            z przerywaniem. <b>Tryb Słuchawki</b> to obsługa głosem bez patrzenia na ekran — wygodne za kierownicą czy na spacerze.
          </Q>
          <Q q="Skąd bierze wiedzę o świecie (aktualności)?">
            Z wyszukiwania w sieci: tryb <b>research z cytatami</b> (Tavily — wymaga darmowego klucza) oraz wbudowane
            wyszukiwanie modeli Claude. Pod odpowiedzią pokazują się źródła [1], [2], żebyś mógł sprawdzić.
          </Q>

          <h3>📈 Sprzedaż i biznes</h3>
          <Q q="Pulpit Sprzedaży / CRM — co realnie robi?">
            To centrum pozyskiwania klientów. <b>Znajduje firmy</b> z OpenStreetMap (z telefonami, bez żadnego klucza),
            buduje <b>teczkę klienta</b> (audyt strony, słabe punkty, gotowy e-mail i skrypt rozmowy, scoring 0–100),
            a Ty prowadzisz ich przez statusy: <b>✅ Klienci · 📞 Do dzwonienia · ✉ Mailowani · ❌ Odrzucili</b>. Import/eksport CSV w komplecie.
          </Q>
          <Q q="Czy naprawdę wysyła maile automatycznie?">
            Tak — po jednorazowej konfiguracji poczty. Na komputerze przez <b>SMTP</b> (hasło aplikacji), na telefonie przez
            <b> backend</b> lub <b>Gmaila</b>. Bez konfiguracji nadal wyślesz: przycisk <b>„📧 Napisz i otwórz pocztę"</b> otwiera
            gotową wiadomość w Twojej aplikacji pocztowej. Każda wysyłka ląduje w <b>Skrzynce wysłanych</b>.
          </Q>
          <Q q="Maszynka do kontentu — do czego?">
            Wpisujesz temat, a JARVIS pisze gotowy <b>post na Instagram, Facebooka, TikToka lub LinkedIn</b> — w wybranym tonie,
            z Twoją marką, hashtagami i CTA. Kopiuj / Udostępnij / „Inna wersja", a wszystko trafia do historii postów.
          </Q>
          <Q q="Generator reklam — czym jest?">
            Tworzy gotowe zestawy reklam: <b>Google Ads</b> (15 nagłówków, opisy, słowa kluczowe, budżet) i <b>Meta</b>
            (tekst, nagłówki, CTA, pomysły na kreację, grupa docelowa). Bez żadnego API — kopiujesz i wklejasz w panelu Google/Meta.
          </Q>
          <Q q="Kreator stron i „Zarabianie” — po co dwa?">
            <b>Kreator stron</b> buduje gotową witrynę (demo dla klienta). <b>Zarabianie</b> to kokpit modelu „agencja stron":
            ile masz potencjału w toku, ile zarobione, ile ofert gotowych — plus uczciwa instrukcja, jak to spina się w pieniądze.
          </Q>

          <h3>✅ Praca i organizacja</h3>
          <Q q="Zadania Pro, Plan Dnia — czym się różnią?">
            <b>Zadania Pro</b> to pełne GTD: projekty, priorytety, terminy. <b>Plan Dnia</b> to prosty, dzienny widok „co dziś"
            plus notatnik. Wybierz to, co pasuje do Twojego stylu — oba zapisują się lokalnie.
          </Q>
          <Q q="Projekty / dokumenty — kiedy używać?">
            Gdy chcesz, by JARVIS pamiętał <b>kontekst</b>: wrzucasz dokumenty (PDF/tekst), własne instrukcje i pamięć dla danego
            projektu, a on używa ich jako tła rozmowy. Idealne do jednego klienta, tematu czy sprawy.
          </Q>
          <Q q="Kapsuły Wiedzy — co to?">
            Generator <b>fiszek</b>: z dowolnego materiału JARVIS robi pytania i odpowiedzi do nauki (aktywne przypominanie).
            Świetne do szybkiego opanowania nowego tematu czy oferty.
          </Q>
          <Q q="Mój dziennik — do czego?">
            Miejsce na przemyślenia i notatki osobiste. JARVIS potrafi układać udostępnione wpisy według trafności do tematu,
            o który pytasz — to „pamięć ewoluująca".
          </Q>

          <h3>🛒 Zakupy i okazje</h3>
          <Q q="Łowca Okazji — jak działa?">
            Wpisujesz przedmiot (nazwa, model lub numer części), a JARVIS znajduje go <b>najtaniej</b> — osobno najtańszy
            <b> nowy</b> i <b>używany</b>, z medianą ceny i ostrzeżeniem przed podejrzanie tanimi ofertami. Linki do serwisów
            działają od ręki; inteligentna agregacja włącza się z kluczem researchu.
          </Q>
          <Q q="Gdzie kupię w pobliżu — co pokazuje?">
            Miejsca, gdzie kupisz to, czego szukasz: <b>najbliżej</b> oraz „taniej, ale dalej". Zawsze daje linki do map i
            wyszukiwarki, a z kluczem AI — zestawienie z odległością i ceną.
          </Q>
          <Q q="Lista zakupów — coś więcej niż lista?">
            Tak: spisujesz, co kupić, a JARVIS pomaga kupić to <b>najtaniej</b> (łączy się z Łowcą Okazji). Lista żyje między sesjami.
          </Q>

          <h3>🎙 Narzędzia AI</h3>
          <Q q="Tłumacz na żywo — jak to wygląda?">
            Rozmowa dwóch osób w <b>dwóch językach</b>: mówisz po polsku, druga osoba słyszy/widzi tłumaczenie i odwrotnie.
            Przydaje się przy kliencie z zagranicy czy w podróży.
          </Q>
          <Q q="Transkrypcja spotkań — co dostaję?">
            Zamienia <b>mowę na tekst</b> — nagrywasz spotkanie albo mówisz, a dostajesz zapis do skopiowania. Koniec ręcznego notowania.
          </Q>
          <Q q="Wizja HUD i „Spójrz na ekran” — różnica?">
            <b>Wizja HUD</b> patrzy przez <b>aparat</b> („co to jest?", „przetłumacz tę etykietę"). <b>Spójrz na ekran</b> (na komputerze)
            analizuje to, co masz na monitorze. Oba wymagają modelu z obsługą obrazu.
          </Q>
          <Q q="Studio Obrazów — co generuje?">
            <b>Tworzy i edytuje obrazy</b> z opisu (np. grafika do posta czy reklamy). Wymaga modelu graficznego — jakość zależy od wybranego dostawcy.
          </Q>

          <h3>🧠 Ja, pamięć i bezpieczeństwo</h3>
          <Q q="Profil i Pamięć — czym się różnią?">
            <b>Profil</b> to kim jesteś (imię, styl, preferencje). <b>Pamięć</b> to konkretne fakty, które JARVIS sam zapamiętuje
            w rozmowie — możesz je <b>podejrzeć, edytować i usunąć</b>. Pełna kontrola, nic nie dzieje się w ukryciu.
          </Q>
          <Q q="Czy moje dane są bezpieczne?">
            Tak. Klucze i dane żyją <b>lokalnie na urządzeniu</b>. Możesz włączyć <b>blokadę PIN/hasłem</b> oraz robić
            <b> kopię zapasową zaszyfrowaną AES-256</b> — bezpieczną nawet, gdyby plik wpadł w niepowołane ręce.
          </Q>
          <Q q="Integracje Google (Gmail, Kalendarz) — co umożliwiają?">
            Po podłączeniu konta w backendzie JARVIS <b>czyta i streszcza maile</b>, <b>odpowiada w wątku</b>, oraz
            <b> czyta i dodaje wydarzenia</b> w Kalendarzu Google. Poranny briefing dorzuca nieprzeczytane maile i plan dnia.
          </Q>
          <Q q="Po co licencja i jak działa?">
            Klucz licencyjny (kryptograficznie podpisany) chroni własność programu i <b>działa na każdym Twoim urządzeniu</b>
            — telefonie i komputerze. Aktywujesz raz, wklejając klucz na starcie.
          </Q>
          <Q q="Sterowanie komputerem (Windows) — co potrafi?">
            W wersji na komputer JARVIS otwiera aplikacje, reguluje głośność, steruje multimediami i pisze za Ciebie —
            przydatne jako asystent „bez rąk" przy biurku.
          </Q>
        </div>
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
