// W2 Typed Memory — ekran „Tydzień” (Wykonawca A).
// Uczciwość danych: przy za małej próbce mówimy wprost „za mało” (S04),
// bez klucza API statystyka jest jawnie „bez AI” (S06),
// propozycja AI wymaga ludzkiej akceptacji — nic nie aktywuje się samo (S05).
import { useState } from "react";
import { flush, now } from "../lib/db";
import { weekStats } from "../lib/week";
import { analyzeWeek, getApiKey, setApiKey, type AiProposal } from "../lib/ai";
import { createBet, BetConflictError } from "../lib/bets";
import "./Week.css";

// Propozycja trzymana poza komponentem, żeby przetrwała przełączanie zakładek
// (to stan ulotny UI — celowo NIE trafia do bazy ani do localStorage).
let zapamietanaPropozycja: AiProposal | null = null;

export default function Week() {
  const stats = weekStats(now());

  const [hasKey, setHasKey] = useState<boolean>(() => getApiKey() !== null);
  const [keyInput, setKeyInput] = useState("");

  const [proposal, setProposalState] = useState<AiProposal | null>(zapamietanaPropozycja);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [manualText, setManualText] = useState("");
  const [manualPred, setManualPred] = useState("");
  const [manualOk, setManualOk] = useState(false);

  function ustawPropozycje(p: AiProposal | null) {
    zapamietanaPropozycja = p;
    setProposalState(p);
  }

  function zapiszKlucz() {
    const k = keyInput.trim();
    if (!k) return;
    setApiKey(k);
    setHasKey(true);
    setKeyInput("");
  }

  async function analizuj() {
    if (analyzing) return;
    setAiError(null);
    setConflict(null);
    setAnalyzing(true);
    try {
      const p = await analyzeWeek();
      ustawPropozycje(p);
    } catch (e) {
      // analyzeWeek rzuca czytelne komunikaty po polsku — bez surowego stacka.
      setAiError(e instanceof Error ? e.message : "Nieznany błąd analizy AI — spróbuj ponownie.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function akceptuj() {
    if (!proposal) return;
    setConflict(null);
    setSaveError(null);
    try {
      createBet(proposal.bet, proposal.prediction, "ai");
      await flush(); // sukces ogłaszamy dopiero po trwałym zapisie (P1/P5)
      ustawPropozycje(null);
    } catch (e) {
      if (e instanceof BetConflictError) setConflict(e.message);
      else setSaveError(e instanceof Error ? e.message : "Nie udało się zapisać zakładu — spróbuj ponownie.");
    }
  }

  function odrzuc() {
    // Odrzucenie: nic nie trafia do bazy, propozycja znika (S05b).
    ustawPropozycje(null);
    setConflict(null);
    setSaveError(null);
  }

  async function zapiszReczny() {
    const t = manualText.trim();
    const p = manualPred.trim();
    if (!t || !p) return;
    setConflict(null);
    setSaveError(null);
    setManualOk(false);
    try {
      createBet(t, p, "manual");
      await flush(); // sukces ogłaszamy dopiero po trwałym zapisie (P1/P5)
      setManualText("");
      setManualPred("");
      setManualOk(true);
    } catch (e) {
      if (e instanceof BetConflictError) setConflict(e.message);
      else setSaveError(e instanceof Error ? e.message : "Nie udało się zapisać zakładu — spróbuj ponownie.");
    }
  }

  return (
    <div className="week">
      {!stats.enough ? (
        <div className="card" data-testid="week-too-few">
          <p className="week-too-few-text">
            Za mało danych: potrzeba co najmniej 5 wpisów z 3 różnych dni — nie zmyślam wzorca.
          </p>
          <p className="muted">Masz {stats.count} wpisów w ostatnich 7 dniach.</p>
        </div>
      ) : (
        <div className="card" data-testid="week-pattern">
          <p className="label">Wzorzec ostatnich 7 dni</p>
          <p data-testid="week-entry-count" className="week-count">
            Wpisów łącznie: {stats.count}
          </p>
          <ul className="list">
            {stats.days.map((d) => (
              <li key={d.label} data-testid="week-day-row" className="week-day-row">
                <span className="week-day-label">{d.label}</span>
                <span>wpisów: {d.count}</span>
                <span className="muted">
                  {d.avgScore !== null ? "średnia: " + d.avgScore : "brak ocen"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasKey && (
        <p>
          <span className="badge" data-testid="local-stats-badge">
            Statystyka lokalna — bez AI
          </span>
        </p>
      )}

      <div className="card">
        <label className="label" htmlFor="api-key-input">
          Klucz API Anthropic (opcjonalny — tylko do analizy AI)
        </label>
        <div className="row">
          <input
            id="api-key-input"
            data-testid="api-key-input"
            className="input"
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-…"
          />
          <button type="button" data-testid="api-key-save" className="btn" onClick={zapiszKlucz}>
            Zapisz
          </button>
        </div>
        {hasKey && <span className="badge ok">klucz zapisany</span>}
      </div>

      {hasKey && (
        <div className="card">
          <button
            type="button"
            data-testid="ai-analyze"
            className="btn primary"
            disabled={analyzing}
            onClick={analizuj}
          >
            {analyzing ? "Analizuję…" : "Analiza tygodnia (AI)"}
          </button>
          {aiError && <div className="alert">{aiError}</div>}
          {proposal && (
            <div className="ai-proposal" data-testid="ai-proposal">
              <p className="label">Propozycja zakładu (AI)</p>
              <p data-testid="ai-proposal-text" className="ai-proposal-text">
                {proposal.bet}
              </p>
              <p className="label">Przewidywanie</p>
              <p data-testid="ai-proposal-prediction" className="ai-proposal-text">
                {proposal.prediction}
              </p>
              <div className="row">
                <button type="button" data-testid="ai-accept" className="btn primary" onClick={akceptuj}>
                  Akceptuję
                </button>
                <button type="button" data-testid="ai-reject" className="btn" onClick={odrzuc}>
                  Odrzuć
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {conflict && (
        <div className="alert" data-testid="bet-conflict">
          {conflict}
        </div>
      )}
      {saveError && <div className="alert">{saveError}</div>}

      <div className="card">
        <p className="label">Ręczny zakład (zawsze dostępny)</p>
        <label className="label" htmlFor="bet-manual-text">
          Zakład behawioralny
        </label>
        <textarea
          id="bet-manual-text"
          data-testid="bet-manual-text"
          className="input"
          rows={2}
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Co zrobisz w nadchodzącym tygodniu?"
        />
        <label className="label" htmlFor="bet-manual-prediction">
          Przewidywanie (po czym poznasz, że zadziałało?)
        </label>
        <textarea
          id="bet-manual-prediction"
          data-testid="bet-manual-prediction"
          className="input"
          rows={2}
          value={manualPred}
          onChange={(e) => setManualPred(e.target.value)}
          placeholder="Falsyfikowalne przewidywanie…"
        />
        <button
          type="button"
          data-testid="bet-manual-save"
          className="btn primary week-manual-save"
          onClick={zapiszReczny}
        >
          Zapisz zakład
        </button>
        {manualOk && <p className="muted">Zakład zapisany — jest teraz aktywny.</p>}
      </div>
    </div>
  );
}
