// W3 One Active Bet + W4 Action Verification — ekran „Zakład” (Wykonawca B).
// Dane czytane synchronicznie przy renderze (App re-renderuje po każdej mutacji db);
// tu tylko stan lokalny UI (modale, wybór typu dowodu, panel rozstrzygania).
import { useEffect, useState } from "react";
import {
  activeBet,
  listActions,
  addAction,
  closeAction,
  getProof,
  resolveBet,
  betHistory,
  ProofRequiredError,
  type ProofInput,
} from "../lib/bets";
import "./Bet.css";

type ProofKind = "note" | "link" | "file";
type Outcome = "hit" | "miss" | "unclear";

const VERDICT: Record<Outcome, string> = {
  hit: "sprawdziło się",
  miss: "nie sprawdziło się",
  unclear: "nierozstrzygnięte",
};

/** Data + godzina lokalna — wszystkie czasy w bazie nadaje now() z db.ts. */
function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + p(d.getMonth() + 1) +
    "-" + p(d.getDate()) +
    " " + p(d.getHours()) +
    ":" + p(d.getMinutes())
  );
}

export default function Bet() {
  // Dodawanie działania.
  const [addingAction, setAddingAction] = useState(false);
  const [actionText, setActionText] = useState("");

  // Modal dowodu (JEDYNA droga do „zrobione”). Domyślnie ŻADEN typ nie jest wybrany.
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [proofKind, setProofKind] = useState<ProofKind | null>(null);
  const [proofNote, setProofNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  // Podgląd artefaktu.
  const [viewProofId, setViewProofId] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  // Panel rozstrzygania.
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [learned, setLearned] = useState("");

  // Odczyt synchroniczny z bazy przy każdym renderze.
  const bet = activeBet();
  const actions = bet ? listActions(bet.id) : [];
  const history = betHistory();
  const viewProof = viewProofId ? getProof(viewProofId) : null;

  // Escape zamyka modale (keydown na window).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setViewProofId(null);
        closeProofForm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Podgląd obrazka z bloba: URL tworzony przy otwarciu, zwalniany przy zamknięciu.
  useEffect(() => {
    if (!viewProofId) return;
    const p = getProof(viewProofId);
    if (p && p.kind === "file" && p.file_blob) {
      const url = URL.createObjectURL(
        new Blob([p.file_blob as BlobPart], { type: p.file_mime ?? "application/octet-stream" })
      );
      setImgUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setImgUrl(null);
      };
    }
  }, [viewProofId]);

  function saveAction() {
    if (!bet) return;
    const text = actionText.trim();
    if (!text) return;
    addAction(bet.id, text);
    setActionText("");
    setAddingAction(false);
  }

  function openProofForm(actionId: string) {
    setProofFor(actionId);
    setProofKind(null); // świadomie: użytkownik sam wybiera typ dowodu
    setProofNote("");
    setProofUrl("");
    setProofFile(null);
    setProofError(null);
  }

  function closeProofForm() {
    setProofFor(null);
    setProofKind(null);
    setProofNote("");
    setProofUrl("");
    setProofFile(null);
    setProofError(null);
  }

  async function submitProof() {
    if (!proofFor) return;
    try {
      let input: ProofInput;
      if (proofKind === "note") {
        input = { kind: "note", note: proofNote };
      } else if (proofKind === "link") {
        input = { kind: "link", url: proofUrl };
      } else if (proofKind === "file" && proofFile) {
        const buf = await proofFile.arrayBuffer();
        input = {
          kind: "file",
          name: proofFile.name,
          mime: proofFile.type || "application/octet-stream",
          bytes: new Uint8Array(buf),
        };
      } else {
        // Brak wybranego typu albo brak pliku — dowodu nie ma.
        throw new ProofRequiredError(
          "Bez artefaktu dowodowego nie ma „zrobione” — dodaj plik, notatkę albo link."
        );
      }
      closeAction(proofFor, input);
      closeProofForm(); // sukces — modal znika, status zmienia się na „zrobione”
    } catch (err) {
      if (err instanceof ProofRequiredError) setProofError(err.message);
      else setProofError("Nie udało się zapisać dowodu — spróbuj ponownie.");
    }
  }

  function saveResolve() {
    if (!bet || !outcome) return;
    resolveBet(bet.id, outcome, learned.trim());
    setResolving(false);
    setOutcome(null);
    setLearned("");
  }

  return (
    <section className="bet-screen">
      {!bet ? (
        <div className="card" data-testid="bet-empty">
          <p>Brak aktywnego zakładu — dodaj go na ekranie Tydzień.</p>
        </div>
      ) : (
        <div className="card" data-testid="bet-active">
          <div className="bet-head">
            <span className="badge ok" data-testid="bet-status">aktywny</span>
            <span className="time">od {fmt(bet.created_at)}</span>
          </div>
          <h2 className="bet-title" data-testid="bet-text">{bet.text}</h2>
          {/* ORYGINALNE przewidywanie z bazy — widoczne też podczas rozstrzygania. */}
          <p className="bet-prediction" data-testid="bet-prediction">
            Przewidywanie: {bet.prediction}
          </p>

          <h3 className="section-title">Działania</h3>
          {actions.length === 0 && (
            <p className="muted">Jeszcze żadnych działań — dodaj pierwsze.</p>
          )}
          <ul className="list">
            {actions.map((a) => {
              const done = a.done_at != null && a.proof_id != null;
              return (
                <li key={a.id} data-testid="action-item" className="action-item">
                  <div className="action-main">
                    <span className="action-text">{a.text}</span>
                    <span data-testid="action-status" className={done ? "badge ok" : "badge"}>
                      {done ? "zrobione" : "do zrobienia"}
                    </span>
                  </div>
                  {done ? (
                    <button
                      className="btn"
                      data-testid="proof-view"
                      onClick={() => setViewProofId(a.proof_id)}
                    >
                      Zobacz dowód
                    </button>
                  ) : (
                    <button
                      className="btn"
                      data-testid="action-done"
                      onClick={() => openProofForm(a.id)}
                    >
                      Domknij z dowodem
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {addingAction ? (
            <div className="action-form">
              <label className="label">Nowe działanie</label>
              <input
                className="input"
                data-testid="action-text"
                value={actionText}
                onChange={(e) => setActionText(e.target.value)}
                placeholder="Co konkretnie zrobisz?"
              />
              <div className="row action-form-buttons">
                <button className="btn primary" data-testid="action-save" onClick={saveAction}>
                  Zapisz działanie
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setAddingAction(false);
                    setActionText("");
                  }}
                >
                  Anuluj
                </button>
              </div>
            </div>
          ) : (
            <button className="btn" data-testid="action-add" onClick={() => setAddingAction(true)}>
              Dodaj działanie
            </button>
          )}

          <h3 className="section-title">Rozstrzygnięcie</h3>
          {!resolving ? (
            <button className="btn primary" data-testid="bet-resolve" onClick={() => setResolving(true)}>
              Rozstrzygnij zakład
            </button>
          ) : (
            <div className="resolve-panel">
              <p className="muted">
                Porównaj wynik z przewidywaniem z dnia startu (powyżej) i wybierz werdykt.
              </p>
              <div className="row outcome-row">
                <button
                  className={outcome === "hit" ? "btn primary" : "btn"}
                  data-testid="bet-outcome-hit"
                  aria-pressed={outcome === "hit"}
                  onClick={() => setOutcome("hit")}
                >
                  Sprawdziło się
                </button>
                <button
                  className={outcome === "miss" ? "btn primary" : "btn"}
                  data-testid="bet-outcome-miss"
                  aria-pressed={outcome === "miss"}
                  onClick={() => setOutcome("miss")}
                >
                  Nie sprawdziło się
                </button>
                <button
                  className={outcome === "unclear" ? "btn primary" : "btn"}
                  data-testid="bet-outcome-unclear"
                  aria-pressed={outcome === "unclear"}
                  onClick={() => setOutcome("unclear")}
                >
                  Nierozstrzygnięte
                </button>
              </div>
              <label className="label">Czego się nauczyłem</label>
              <textarea
                className="input"
                data-testid="bet-learned"
                rows={3}
                value={learned}
                onChange={(e) => setLearned(e.target.value)}
              />
              <div className="row resolve-buttons">
                <button
                  className="btn primary"
                  data-testid="bet-resolve-save"
                  disabled={!outcome}
                  onClick={saveResolve}
                >
                  Zapisz rozstrzygnięcie
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setResolving(false);
                    setOutcome(null);
                    setLearned("");
                  }}
                >
                  Anuluj
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="card" data-testid="bet-history">
          <h3 className="section-title">Historia zakładów</h3>
          <ul className="list">
            {history.map((b) => (
              <li key={b.id} data-testid="bet-history-item" className="history-item">
                <p className="history-text">{b.text}</p>
                <p className="history-prediction">Przewidywanie: {b.prediction}</p>
                <p className="history-verdict">
                  Werdykt: {VERDICT[(b.outcome ?? "unclear") as Outcome]}
                </p>
                {b.learned ? <p className="history-learned">Czego się nauczyłem: {b.learned}</p> : null}
                {b.resolved_at != null && (
                  <span className="time">rozstrzygnięto {fmt(b.resolved_at)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal dowodu — jedyna droga do „zrobione”. */}
      {proofFor && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeProofForm();
          }}
        >
          <div className="modal" data-testid="proof-form">
            <h3>Dowód wykonania</h3>
            <p className="muted">
              Stan „zrobione” istnieje tylko z artefaktem dowodowym. Czas dowodu nadaje system.
            </p>
            <div className="row proof-types">
              <button
                className={proofKind === "note" ? "btn primary" : "btn"}
                data-testid="proof-type-note"
                onClick={() => setProofKind("note")}
              >
                Notatka
              </button>
              <button
                className={proofKind === "link" ? "btn primary" : "btn"}
                data-testid="proof-type-link"
                onClick={() => setProofKind("link")}
              >
                Link
              </button>
              <button
                className={proofKind === "file" ? "btn primary" : "btn"}
                data-testid="proof-type-file"
                onClick={() => setProofKind("file")}
              >
                Plik
              </button>
            </div>
            {proofKind === "note" && (
              <>
                <label className="label">Notatka dowodowa</label>
                <textarea
                  className="input"
                  data-testid="proof-note-text"
                  rows={3}
                  value={proofNote}
                  onChange={(e) => setProofNote(e.target.value)}
                />
              </>
            )}
            {proofKind === "link" && (
              <>
                <label className="label">Adres URL (http:// lub https://)</label>
                <input
                  className="input"
                  data-testid="proof-link-url"
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  placeholder="https://…"
                />
              </>
            )}
            {proofKind === "file" && (
              <>
                <label className="label">Plik dowodowy</label>
                <input
                  className="input"
                  type="file"
                  data-testid="proof-file-input"
                  onChange={(e) => setProofFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                />
              </>
            )}
            {proofError && (
              <div className="alert" data-testid="proof-required">
                {proofError}
              </div>
            )}
            <div className="row proof-buttons">
              <button
                className="btn primary"
                data-testid="proof-submit"
                onClick={() => {
                  void submitProof();
                }}
              >
                Zapisz dowód
              </button>
              <button className="btn" onClick={closeProofForm}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal podglądu artefaktu dowodowego. */}
      {viewProof && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewProofId(null);
          }}
        >
          <div className="modal" data-testid="proof-artifact">
            <h3>Artefakt dowodowy</h3>
            {viewProof.kind === "file" && (
              <>
                <p className="proof-file-name">{viewProof.file_name}</p>
                {imgUrl && (
                  <img
                    className="proof-image"
                    src={imgUrl}
                    alt={"Podgląd pliku: " + (viewProof.file_name ?? "dowód")}
                  />
                )}
              </>
            )}
            {viewProof.kind === "note" && <p className="proof-note">{viewProof.note}</p>}
            {viewProof.kind === "link" && (
              <p>
                <a href={viewProof.url ?? "#"} target="_blank" rel="noreferrer">
                  {viewProof.url}
                </a>
              </p>
            )}
            {/* Timestamp systemowy — tekst, nigdy pole edycji. */}
            <p className="time">Dowód zapisany: {fmt(viewProof.created_at)}</p>
            <button className="btn" onClick={() => setViewProofId(null)}>
              Zamknij
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
