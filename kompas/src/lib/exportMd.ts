// W4 — budowa eksportu markdown BEZPOŚREDNIO z bazy (all/one z db.ts).
// Zasada zerowa w eksporcie: „- [x]” pojawia się WYŁĄCZNIE gdy działanie ma
// done_at ORAZ proof_id — działanie bez dowodu nigdy nie figuruje jako zrobione.
import { all, one } from "./db";
import type { BetRow } from "./bets";

interface EntryRow {
  id: string;
  text: string;
  score: number;
  created_at: number;
}

interface ActionExportRow {
  id: string;
  text: string;
  created_at: number;
  done_at: number | null;
  proof_id: string | null;
  proof_kind: "file" | "note" | "link" | null;
  proof_created_at: number | null;
}

const KIND_WORD: Record<string, string> = {
  note: "notatka",
  file: "plik",
  link: "link",
};

const VERDICT: Record<string, string> = {
  hit: "sprawdziło się",
  miss: "nie sprawdziło się",
  unclear: "nierozstrzygnięte",
};

/** Data + godzina lokalna (czasy w bazie zawsze od now() z db.ts). */
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

/** Linie działań zakładu: „[x]” tylko z dowodem, inaczej „[ ]”. */
function actionLines(betId: string): string[] {
  const rows = all<ActionExportRow>(
    "SELECT a.id, a.text, a.created_at, a.done_at, a.proof_id, " +
      "p.kind AS proof_kind, p.created_at AS proof_created_at " +
      "FROM actions a LEFT JOIN proofs p ON p.id = a.proof_id " +
      "WHERE a.bet_id = ? ORDER BY a.created_at ASC",
    [betId]
  );
  return rows.map((a) => {
    const done = a.done_at != null && a.proof_id != null;
    if (!done) return "- [ ] " + a.text;
    const kind = KIND_WORD[a.proof_kind ?? ""] ?? "artefakt";
    const when = fmt(a.proof_created_at ?? (a.done_at as number));
    return "- [x] " + a.text + " — dowód: " + kind + " (" + when + ")";
  });
}

/** Zbuduj pełny eksport markdown — liczby zawsze zgodne z bazą. */
export function buildMarkdown(): string {
  const lines: string[] = [];
  lines.push("# KOMPAS — eksport", "");

  const entries = all<EntryRow>(
    "SELECT id, text, score, created_at FROM entries ORDER BY created_at ASC"
  );
  lines.push("Wpisy: " + entries.length, "");

  lines.push("## Wpisy", "");
  for (const e of entries) {
    lines.push("- " + fmt(e.created_at) + " — ocena " + e.score + "/5 — " + e.text);
  }
  if (entries.length === 0) lines.push("Brak wpisów.");
  lines.push("", "## Zakłady", "");

  const active = one<BetRow>("SELECT * FROM bets WHERE status = 'active' LIMIT 1");
  if (active) {
    lines.push("### Aktywny zakład: " + active.text, "");
    lines.push("Przewidywanie: " + active.prediction, "");
    const acts = actionLines(active.id);
    if (acts.length) lines.push("Działania:", ...acts, "");
  }

  const history = all<BetRow>(
    "SELECT * FROM bets WHERE status = 'resolved' ORDER BY resolved_at DESC"
  );
  for (const b of history) {
    lines.push("### Rozstrzygnięty zakład: " + b.text, "");
    lines.push("Przewidywanie: " + b.prediction);
    lines.push("Werdykt: " + (VERDICT[b.outcome ?? ""] ?? "nierozstrzygnięte"));
    lines.push("Czego się nauczyłem: " + (b.learned ?? ""), "");
    const acts = actionLines(b.id);
    if (acts.length) lines.push("Działania:", ...acts, "");
  }

  if (!active && history.length === 0) lines.push("Brak zakładów.", "");

  return lines.join("\n") + "\n";
}
