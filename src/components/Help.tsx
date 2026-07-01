import { useEscape } from "../hooks/useEscape";
export default function Help({ onClose, onFaq }: { onClose: () => void; onFaq?: () => void }) {
  useEscape(onClose);
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>❓ Pomoc — co potrafi JARVIS</h2>
        </div>
        <div className="panel-body help">
          <p className="muted">
            JARVIS rozumie naturalny język — po prostu pisz lub mów, czego potrzebujesz. Poniżej
            wszystkie funkcje i jak z nich korzystać.
          </p>
          {onFaq && (
            <button type="button" className="btn" style={{ marginBottom: 14 }} onClick={onFaq}>
              ❓ Pełne FAQ — pytania i odpowiedzi o każdej funkcji
            </button>
          )}

          <h3>🚀 Start</h3>
          <ul>
            <li>Wejdź w <b>⚙ Ustawienia → Szybki start</b> i <b>wklej dowolny klucz API</b> — JARVIS sam rozpozna dostawcę i sprawdzi połączenie.</li>
            <li>Nie masz klucza? Najłatwiejszy i darmowy: <b>Gemini</b> z aistudio.google.com/apikey (1 min, bez karty).</li>
            <li>Tryb <b>auto</b> sam wybiera najlepszego dostępnego dostawcę; gdy jeden zawiedzie (np. brak kredytów), przeskakuje na innego.</li>
            <li><b>🩺 Diagnostyka</b> (⚙ → AI) — jedno kliknięcie sprawdza internet, wszystkie klucze, research, głos, mikrofon i backend, z podpowiedzią co naprawić.</li>
          </ul>

          <h3>💬 Czat i 🎤 głos</h3>
          <ul>
            <li>Pisz w polu na dole lub kliknij <b>🎤</b>, żeby mówić.</li>
            <li><b>👂</b> w nagłówku = ciągłe nasłuchiwanie słowa „<b>Jarvis</b>".</li>
            <li>Odpowiedzi są czytane na głos (można wyłączyć w ⚙). Włączenie mikrofonu przerywa mówienie.</li>
          </ul>

          <h3>☎ Rozmowa na żywo</h3>
          <ul>
            <li>Przycisk <b>☎</b> — rozmowa głosowa w czasie rzeczywistym. Z kluczem Gemini używa <b>Gemini Live</b>; bez niego (lub gdy limit) przełącz na <b>🎙 Tryb rozmowy</b> — działa z dowolnym modelem (mów → JARVIS odpowiada głosem → znów słucha).</li>
            <li>Z trybem tłumacza (⚙) działa jak tłumacz symultaniczny.</li>
          </ul>

          <h3>🎧 Tryb Słuchawki (centrum dowodzenia)</h3>
          <ul>
            <li>Przycisk <b>🎙</b> w nagłówku (albo podłącz słuchawki Bluetooth) otwiera <b>Tryb Słuchawki</b> — rozmowa hands-free jak z kolegą. Telefon możesz schować, ekran trzyma się sam (Wake Lock).</li>
            <li><b>Klik na słuchawkach</b> (play/pause) = „mów" — bez dotykania telefonu. Albo powiedz „<b>Jarvis…</b>". Krótkie dźwięki mówią, kiedy słucha/myśli/gotowe.</li>
            <li><b>Naturalna rozmowa</b> — JARVIS <b>nie przerywa</b>, gdy się zacieniesz albo robisz pauzę na myślenie (czeka, aż zdanie się domknie). Gdy zaczniesz mówić w trakcie jego odpowiedzi — natychmiast milknie (barge-in).</li>
            <li><b>🔒 Tylko mój głos</b> — w ⚙ → Głos „Naucz JARVIS-a mojego głosu" (3 próbki). Wtedy odsiewa inne osoby, telewizor i tło — reaguje tylko na Ciebie. Działa lokalnie i prywatnie. (Na części Androida równoległa analiza głosu bywa niedostępna — wtedy słucha normalnie.)</li>
            <li>Wydawaj polecenia: „<b>zadzwoń do…</b>" (telefon dzwoni, słuchasz w słuchawkach), „<b>puść muzykę</b>", „następna piosenka", „głośniej", „dodaj zadanie", „co mam dziś?". Na komputerze ⏮⏯⏭ sterują odtwarzaczem.</li>
            <li>Tryb „<b>Po Jarvis</b>" reaguje dopiero po słowie-kluczu (mniej pomyłek), „<b>Ciągła</b>" słucha non-stop.</li>
            <li><i>Uwaga:</i> przy <b>całkowicie zgaszonym</b> ekranie Android ogranicza nasłuch aplikacji — trzymaj ekran włączony (czarny, w kieszeni) dla pełnej niezawodności.</li>
          </ul>

          <h3>🗣 Lepszy darmowy głos</h3>
          <ul>
            <li>⚙ → Głos → <b>Darmowy głos premium (Gemini TTS)</b> — naturalny, wysokiej jakości głos na darmowym kluczu Gemini. Domyślny „Charon" brzmi jak JARVIS; do wyboru kilka głosów.</li>
          </ul>

          <h3>🔎 Wiedza i research</h3>
          <ul>
            <li>„Jaka jest pogoda?", „Co nowego w…?" — JARVIS sięga do sieci.</li>
            <li>Z kluczem <b>Tavily</b> (⚙ → Research) dostajesz odpowiedzi ze <b>źródłami [1][2]</b> pod wiadomością.</li>
          </ul>

          <h3>⚖ Tryb Konsylium</h3>
          <ul>
            <li>Przy ważnym pytaniu kliknij <b>⚖</b> przy polu pisania — JARVIS zapyta <b>kilka różnych modeli naraz</b> (np. Gemini + Groq + Cerebras), a sędzia złoży jedną odpowiedź i pokaże, czy modele się zgadzają.</li>
            <li>Pod odpowiedzią rozwiniesz panel „⚖ Konsylium" i zobaczysz, co powiedział każdy model. Chcesz to zawsze przy złożonych pytaniach? Włącz w <b>⚙ → AI</b>. (Wymaga kluczy ≥ 2 dostawców.)</li>
          </ul>

          <h3>📔 Mój dziennik</h3>
          <ul>
            <li><b>⋯ → Mój dziennik</b> — Twoja prywatna baza przemyśleń. Osobne wpisy (nie jeden ciąg), z tytułem, tagami i wyszukiwaniem.</li>
            <li>Możesz dyktować: „Jarvis, zapisz w dzienniku, że…". Eksport do pliku <b>.md</b> (np. pod książkę o sobie).</li>
            <li><b>Prywatność:</b> wpisy są domyślnie prywatne. Ikoną 🔒/👁 (lub przełącznikiem w edycji) decydujesz, <b>które</b> wpisy czat może czytać — JARVIS widzi tylko te udostępnione.</li>
            <li>Dziennik jest objęty kopią zapasową i synchronizacją.</li>
          </ul>

          <h3>💸 Zarabianie (Pulpit Sprzedaży)</h3>
          <ul>
            <li>Powiedz: „<b>znajdź leady</b>" (albo „znajdź fryzjerów w Krakowie", „firmy bez strony w Gdańsku") — JARVIS znajdzie realne firmy z <b>telefonami</b> (darmowe, OpenStreetMap) i sam wypełni <b>⋯ → 📈 Pulpit Sprzedaży</b>.</li>
            <li>Dla wybranej firmy: <b>⋯ → 🌐 Kreator stron</b> zbuduje demo, a JARVIS napisze ofertę. Ty tylko wysyłasz i rozmawiasz.</li>
            <li>Pulpit śledzi statusy (nowy → kontakt → oferta → klient), wartość w toku i zarobione.</li>
            <li><b>Automat:</b> ⚙ → Zachowanie → „Automat sprzedaży" — JARVIS sam kilka razy dziennie szuka leadów, a z „Auto-szkice ofert" pisze gotowe maile, które czekają w Pulpicie. Ty klikasz <b>📧 Wyślij</b>.</li>
          </ul>

          <h3>📁 Projekty / dokumenty</h3>
          <ul>
            <li><b>📁</b> — twórz projekty z własnymi instrukcjami i <b>dokumentami (PDF/tekst)</b>.</li>
            <li>W aktywnym projekcie JARVIS używa jego dokumentów jako kontekstu („streść ten plik").</li>
          </ul>

          <h3>✅ Produktywność</h3>
          <ul>
            <li>„Dodaj zadanie…", „Przypomnij mi o… jutro o 18", „Dodaj mleko do zakupów", „Zapisz notatkę…".</li>
            <li>„Dodaj spotkanie do kalendarza", „Zadzwoń do Marka", „Wyślij SMS do mamy".</li>
            <li>„Przedstaw <b>raport poranny</b>" — pogoda + kalendarz + zadania. Możesz też włączyć <b>automatyczny briefing</b> o stałej porze (⚙ → Głos i zachowanie).</li>
            <li>Wszystko w panelu <b>▣</b> (zakładki: zadania, notatki, kalendarz, zakupy…).</li>
          </ul>

          <h3>🏠 Smart home</h3>
          <ul>
            <li>⚙ → Home Assistant (adres + token). „Zgaś światło w salonie".</li>
            <li>Sceny: „Utwórz scenę Dobranoc: zgaś light.salon i włącz switch.alarm" → potem „Jarvis, dobranoc".</li>
          </ul>

          <h3>📷 Wizja</h3>
          <ul>
            <li><b>📷</b> przy polu tekstu — zrób/wybierz zdjęcie i zapytaj „co to jest?".</li>
          </ul>

          <h3>📧 Integracje Google</h3>
          <ul>
            <li>Po wdrożeniu backendu i połączeniu konta (⚙ → Integracje Google): „Pokaż nieprzeczytane maile", „Wyślij mail do…", „Co mam w Kalendarzu Google?".</li>
          </ul>

          <h3>🔐 Bezpieczeństwo</h3>
          <ul>
            <li><b>🗝 Sejf haseł</b> (⋯ → Gadżety → Sejf): zapisz loginy i hasła, zaszyfrowane Twoim hasłem głównym (AES-256, lokalnie). Kopiuj jednym kliknięciem; na komputerze „⌨ Wpisz (3s)" autouzupełni login i hasło. Hasła <b>nigdy</b> nie trafiają do AI ani do chmury.</li>
            <li><b>🔒 Blokada PIN</b> (⚙ → Dane): bez PIN-u apka jest bezużyteczna dla niepowołanych.</li>
            <li>Akcje (dzwonienie, SMS, smart home, zapisy) <b>proszą o zgodę</b>; możesz ją zapamiętać.</li>
            <li>Zakładka <b>Audyt</b> (▣) — dziennik akcji z <b>↶ cofnij</b>.</li>
          </ul>

          <h3>🧠 Pamięć autonomiczna</h3>
          <ul>
            <li>JARVIS <b>sam uczy się</b> trwałych faktów o Tobie z rozmów (imiona bliskich, adres, praca, dieta, upodobania) — bez podawania komend.</li>
            <li>Przy każdym pytaniu przypomina sobie <b>to, co istotne dla tematu</b> (pamięć semantyczna — wymaga klucza <b>Gemini</b>; bez niego działa wg najnowszych wpisów).</li>
            <li>Zarządzaj wpisami w ▣ → Pamięć (📌 przypnij = zawsze w kontekście / ✕ usuń).</li>
          </ul>

          <h3>🕘 Historia i ☁️ synchronizacja</h3>
          <ul>
            <li><b>🕘</b> — wszystkie rozmowy; <b>＋</b> nowa rozmowa.</li>
            <li>⚙ → Synchronizacja — współdziel dane między urządzeniami (wymaga backendu).</li>
          </ul>

          <h3>🖥️ Sterowanie komputerem (Windows)</h3>
          <ul>
            <li>W wersji desktopowej (.exe) JARVIS steruje komputerem komendami: „Otwórz notatnik / kalkulator / eksplorator", „Uruchom Spotify", „Otwórz folder Pobrane", „Zrób ciszej / wycisz", „Pauza / następny utwór", „Zablokuj komputer".</li>
            <li><b>Pisanie i skróty:</b> „Otwórz notatnik i wpisz…", „Naciśnij Ctrl+S" (poda tytuł okna, by pisać do wybranej aplikacji).</li>
            <li><b>Widzi Twój ekran:</b> zapytaj „Co mam na ekranie?" albo ⋯ → „Spójrz na mój ekran" — JARVIS zrobi zrzut i go przeanalizuje.</li>
            <li>Akcje zasilania (uśpij/wyłącz/restart) i uruchamianie programów <b>proszą o zgodę</b>.</li>
          </ul>

          <h3>🖥️ Wersje</h3>
          <ul>
            <li>Android (APK), Windows (EXE) i iOS — wszystkie z linku Releases na GitHubie.</li>
            <li><b>🛡 Tryb Prywatny:</b> powiedz „włącz tryb prywatny" lub kliknij w ⚙ → AI — JARVIS działa w 100% lokalnie (Ollama), offline, bez polityki dostawcy. Nic nie wychodzi z urządzenia.</li>
            <li><b>🔓 Tryb bez ograniczeń:</b> powiedz „wyłącz cenzurę / tryb bez ograniczeń" — JARVIS przestaje moralizować. Pełny brak granic tylko z modelem lokalnym (Ollama) lub Dolphin.</li>
          </ul>

          <p className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}>
            JARVIS · © 2026 Marcin Kubicki (serwer256). Wszelkie prawa zastrzeżone.
          </p>
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
