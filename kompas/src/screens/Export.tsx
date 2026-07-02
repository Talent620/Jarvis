// W4 — ekran „Eksport”: pobranie pliku markdown, który odzwierciedla PRAWDĘ
// z bazy (liczby = liczby w bazie; „zrobione” wyłącznie z dowodem).
import { one, flush } from "../lib/db";
import { buildMarkdown } from "../lib/exportMd";
import "./Export.css";

function count(sql: string): number {
  const row = one<{ n: number }>(sql);
  return row ? row.n : 0;
}

export default function Export() {
  // Odczyt synchroniczny przy renderze — App re-renderuje po każdej mutacji.
  const entries = count("SELECT COUNT(*) AS n FROM entries");
  const bets = count("SELECT COUNT(*) AS n FROM bets");
  const provenActions = count(
    "SELECT COUNT(*) AS n FROM actions WHERE done_at IS NOT NULL AND proof_id IS NOT NULL"
  );

  async function exportMd() {
    await flush(); // poczekaj, aż wszystkie mutacje trafią trwale do IndexedDB
    const md = buildMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kompas-eksport.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="export-screen">
      <div className="card">
        <h2 className="export-title">Eksport</h2>
        <p className="muted">
          Pobierz plik markdown z wpisami, zakładami i działaniami. Eksport nie kłamie:
          działanie bez artefaktu dowodowego nigdy nie figuruje jako zrobione.
        </p>
        <ul className="list export-stats">
          <li>
            Wpisy: <strong>{entries}</strong>
          </li>
          <li>
            Zakłady: <strong>{bets}</strong>
          </li>
          <li>
            Działania z dowodem: <strong>{provenActions}</strong>
          </li>
        </ul>
        <button
          className="btn primary export-button"
          data-testid="export-md"
          onClick={() => {
            void exportMd();
          }}
        >
          Pobierz eksport (.md)
        </button>
      </div>
    </section>
  );
}
