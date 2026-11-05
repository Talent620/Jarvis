import { useState } from "react";
import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { rememberFact, deleteFact, setFactPinned, editFact } from "../lib/memory";
import { clearEpisodes, loadEpisodes, type EpisodeKind } from "../lib/episodicMemory";
import { requestScreen } from "../lib/navIntent";
import Modal from "./Modal";
import { toast } from "../lib/toast";
import "../styles/memory-center.css";

const EPISODE_LABEL: Record<EpisodeKind, string> = { chat: "Rozmowa", tool: "Narzędzie", task: "Zadanie", event: "Zdarzenie" };
const readNotes = () => loadEpisodes().filter((episode) => episode && typeof episode.topic === "string" && Number.isFinite(episode.at));

// Fakty, notatki epizodyczne i pozostałe źródła mają odrębne zakresy przechowywania.
export default function MemoryCenter({ onClose }: { onClose: () => void }) {
  useStore();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [episodes, setEpisodes] = useState(readNotes);
  const [episodeError, setEpisodeError] = useState("");

  const facts = [...(store.data.memory || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  const ql = q.trim().toLowerCase();
  const shown = ql ? facts.filter((f) => `${f.key} ${f.value}`.toLowerCase().includes(ql)) : facts;
  const world = store.data.world;
  const serviceConfigured = !!store.settings.memoryServiceUrl?.trim();

  const saveEdit = (id: string) => {
    if (!draft.trim()) return;
    editFact(id, draft.trim()); setEditing(null);
  };
  const add = () => {
    if (!newKey.trim() || !newVal.trim()) return;
    rememberFact(newKey.trim(), newVal.trim());
    setNewKey(""); setNewVal(""); toast("Dodano fakt do tej listy.");
  };
  const removeEpisodes = () => {
    if (!window.confirm("Usunąć wszystkie notatki epizodyczne z tego urządzenia? Nie usuwa to historii rozmów, zapisanych faktów, grafu osób i projektów ani danych Mem0. Nowe rozmowy mogą tworzyć kolejne notatki.")) return;
    const removed = clearEpisodes();
    setEpisodes(readNotes());
    setEpisodeError(removed ? "" : "Nie udało się potwierdzić usunięcia notatek. Sprawdź dostęp do pamięci przeglądarki i spróbuj ponownie.");
    if (removed) toast("Usunięto notatki epizodyczne z tego urządzenia.");
  };

  return (
    <Modal title="Zapisane fakty" onClose={onClose} className="memory-center"
      foot={<button className="btn primary" onClick={onClose}>Zamknij</button>}>
      <p className="muted memory-intro">Fakty na tej liście: {facts.length}. Możesz je edytować, przypinać i usuwać.</p>
      <p className="memory-scope">Usunięcie faktu z tej listy nie usuwa historii rozmów, notatek epizodycznych, grafu osób i projektów ani danych w Mem0. Kopie zapasowe i synchronizacja mają osobny zakres.</p>

      <form className="memory-add" onSubmit={(event) => { event.preventDefault(); add(); }}>
        <label htmlFor="memory-fact-key">Nazwa faktu<input id="memory-fact-key" className="ta" placeholder="np. preferowany język" value={newKey} onChange={(event) => setNewKey(event.target.value)} /></label>
        <label htmlFor="memory-fact-value">Treść faktu<input id="memory-fact-value" className="ta" placeholder="np. polski" value={newVal} onChange={(event) => setNewVal(event.target.value)} /></label>
        <button type="submit" className="btn primary" disabled={!newKey.trim() || !newVal.trim()}>Dodaj fakt</button>
      </form>

      {facts.length > 6 && <label className="memory-search" htmlFor="memory-fact-search">Szukaj w zapisanych faktach<input id="memory-fact-search" className="ta" type="search" value={q} onChange={(event) => setQ(event.target.value)} /></label>}
      {shown.length === 0 && <p className="muted">{facts.length ? "Brak faktów pasujących do wyszukiwania." : "Ta lista jest pusta. Dodaj fakt powyżej lub powiedz „zapamiętaj, że…”. Inne źródła kontekstu znajdziesz niżej."}</p>}

      {shown.map((fact) => <div className="status-row memory-fact" key={fact.id}>
        <div className="status-main">
          <div className="status-title">{fact.pinned ? "📌 " : ""}{fact.key}</div>
          {editing === fact.id ? <div className="memory-edit">
            <input className="ta" aria-label={`Treść faktu: ${fact.key}`} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
            <div className="memory-actions"><button className="btn primary" disabled={!draft.trim()} onClick={() => saveEdit(fact.id)}>Zapisz</button><button className="btn" onClick={() => setEditing(null)}>Anuluj</button></div>
          </div> : <div className="status-detail">{fact.value}</div>}
        </div>
        {editing !== fact.id && <div className="memory-actions">
          <button className="icon-btn" title={fact.pinned ? "Odepnij" : "Przypnij"} aria-label={`${fact.pinned ? "Odepnij" : "Przypnij"} fakt: ${fact.key}`} onClick={() => setFactPinned(fact.id, !fact.pinned)}>{fact.pinned ? "📌" : "📍"}</button>
          <button className="icon-btn" title="Edytuj" aria-label={`Edytuj fakt: ${fact.key}`} onClick={() => { setEditing(fact.id); setDraft(fact.value); }}>✏</button>
          <button className="icon-btn" title="Usuń fakt z listy" aria-label={`Usuń fakt z listy: ${fact.key}`} onClick={() => { deleteFact(fact.id); toast("Usunięto fakt z tej listy."); }}>🗑</button>
        </div>}
      </div>)}

      <section className="memory-sources" aria-labelledby="memory-sources-title">
        <h3 id="memory-sources-title">Inne źródła kontekstu</h3>
        <details className="memory-episodes">
          <summary>Notatki epizodyczne na tym urządzeniu: {episodes.length}</summary>
          <p className="muted">Krótkie tematy zdarzeń i rozmów, używane m.in. do przypomnień o powracających sprawach. To osobny zapis, niezależny od pełnej historii czatu.</p>
          <div className="memory-actions">
            <button className="btn" onClick={() => setEpisodes(readNotes())}>Odśwież notatki</button>
            <button className="btn" onClick={removeEpisodes}>Usuń notatki epizodyczne</button>
          </div>
          {episodeError && <p className="notice" role="alert">{episodeError}</p>}
          {episodes.length ? <ol className="memory-episode-list" aria-label="Zapisane notatki epizodyczne">
            {episodes.map((episode, index) => <li key={`${episode.at}-${index}`}>
              <p>{episode.topic}</p><small className="muted">{EPISODE_LABEL[episode.kind] || "Zdarzenie"} · {new Date(episode.at).toLocaleString("pl-PL")}</small>
            </li>)}
          </ol> : <p className="muted">Nie odczytano zapisanych notatek epizodycznych.</p>}
        </details>

        <ul className="memory-source-list">
          <li><div><strong>Historia rozmów</strong><p className="muted">Pełne wiadomości czatu mają osobny zapis i własne usuwanie.</p></div><button className="btn" onClick={() => requestScreen("history")}>Historia rozmów</button></li>
          <li><div><strong>Graf osób i projektów</strong><p className="muted">Encje: {world?.entities?.length || 0} · powiązania: {world?.relations?.length || 0}. Usunięcie faktu nie zmienia tego grafu. Jego podgląd jest w panelu Umysł.</p></div><button className="btn" onClick={() => requestScreen("mind")}>Otwórz Umysł</button></li>
          <li><div><strong>Pamięć zewnętrzna Mem0</strong><p className="muted">{serviceConfigured ? "Adres usługi jest zapisany w ustawieniach. " : "Brak adresu usługi w aktualnych ustawieniach; wcześniej zapisane tam dane mogą nadal istnieć. "}Administracja i usuwanie jej danych odbywają się w usłudze Mem0. Ten panel nie sprawdza połączenia ani nie usuwa danych z serwera.</p></div><button className="btn" onClick={() => requestScreen("settings")}>Otwórz ustawienia</button></li>
          <li><div><strong>Pozostałe dane, kopie i synchronizacja</strong><p className="muted">Notatki, profil i dane projektów także mogą dostarczać kontekst. JARVIS uwzględnia usunięcie konkretnego faktu przy pobieraniu synchronizacji i przywracaniu kopii. Ta sama treść może zostać zapisana jako nowy fakt. Starsze wersje aplikacji i kopie mają osobny zakres.</p></div><button className="btn" onClick={() => requestScreen("data")}>Moje dane i kopie</button></li>
        </ul>
      </section>
    </Modal>
  );
}
