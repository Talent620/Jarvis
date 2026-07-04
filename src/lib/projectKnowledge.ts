// === Developer Copilot — wyszukiwarka intencji po bazie wiedzy projektu (ETAP 3+4) ===
// CZYSTA, klient-side. Mapuje pytanie naturalnym językiem (np. „gdzie liczone są pieniądze?")
// na pliki projektu z indeksu (audit/knowledge-index.json, generator: scripts/gen-knowledge.mjs).
// Nie wymaga znajomości nazw plików — rozpoznaje DOMENĘ z polskich pojęć. S9-safe (bez /u).

export interface FileQuality {
  complexity: string;
  criticality: string;
  hasTests: boolean;
  risk: string;
  refactorPriority: string;
  fanIn: number;
}
export interface KnowledgeFile {
  path: string;
  kind: string;
  loc: number;
  exports: string[];
  summary: string;
  uses?: string[];
  usedBy?: string[];
  quality?: FileQuality;
}
export interface KnowledgeIndex {
  fileCount: number;
  byKind: Record<string, number>;
  files: KnowledgeFile[];
}
export interface KnowledgeHit {
  path: string;
  kind: string;
  score: number;
  summary: string;
  why: string;
}

// Mapa: polskie pojęcia (triggers) → słowa-klucze szukane w ścieżce/eksportach/opisie.
const DOMAINS: { triggers: string[]; keywords: string[] }[] = [
  { triggers: ["pieniądze", "pieniadze", "finanse", "finansowy", "koszt", "koszty", "przychód", "przychod", "zysk", "marża", "marza", "faktura", "budżet", "budzet", "kasa"], keywords: ["finance", "money", "invoice", "cost", "kpi", "cashflow"] },
  { triggers: ["głos", "glos", "voice", "mowa", "mówi", "mowi", "tts", "stt", "mikrofon", "mic", "kapitan"], keywords: ["voice", "tts", "stt", "speech", "mic", "whisper", "kapitan"] },
  { triggers: ["pamięć", "pamiec", "pamięta", "pamieta", "memory", "embedding", "embeddingi"], keywords: ["memory", "episodic", "recall", "embed", "worldmodel", "contextfusion"] },
  { triggers: ["ustawienia", "settings", "konfiguracja", "opcje"], keywords: ["settings"] },
  { triggers: ["ocr", "ekran", "screen", "wzrok", "vision", "hud"], keywords: ["ocr", "vision", "hud", "screen", "documents"] },
  { triggers: ["lead", "leady", "crm", "sprzedaż", "sprzedaz", "klient", "klienci", "teczka"], keywords: ["lead", "sales", "crm", "prospect", "salesos", "leadintel", "leadnotes"] },
  { triggers: ["obraz", "obrazy", "zdjęcie", "zdjecie", "grafika", "studio"], keywords: ["image", "studio", "fal", "pollinations", "imagehistory"] },
  { triggers: ["strona", "strony", "www", "web", "kreator"], keywords: ["webgen", "webstudio", "site", "seopreview", "conversion"] },
  { triggers: ["mail", "maile", "email", "poczta", "oferta", "wysyłka", "wysylka", "podpis"], keywords: ["mail", "mailer", "glinks", "smtp", "gmail", "offer", "signature"] },
  { triggers: ["ai", "mózg", "mozg", "model", "modele", "dostawca", "llm"], keywords: ["brain", "provider", "model", "council", "modelrouter"] },
  { triggers: ["dane", "store", "baza", "zapis", "trwałość", "trwalosc", "indexeddb"], keywords: ["store", "db", "backup"] },
  { triggers: ["agent", "narzędzia", "narzedzia", "tool", "tools", "komendy", "szef"], keywords: ["tools", "guardian", "boss"] },
  { triggers: ["automatyzacja", "automatyzować", "workflow", "trigger"], keywords: ["n8n", "proactive", "guardian", "scenes"] },
  { triggers: ["licencja", "klucz", "klucze", "aktywacja", "ecdsa"], keywords: ["license", "admin", "keys", "revoked"] },
];

/** Pure: tokenizacja pytania (litery PL + cyfry, ≥2 znaki). S9-safe — bez flagi /u. */
export function tokenize(q: string): string[] {
  return (q || "").toLowerCase().split(/[^a-z0-9ąćęłńóśźż]+/).filter((t) => t.length > 1);
}

/** Pure: rozszerz tokeny pytania o słowa-klucze pasujących domen. */
export function expandTerms(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const d of DOMAINS) if (d.triggers.some((t) => tokens.includes(t))) for (const k of d.keywords) out.add(k);
  return [...out];
}

/**
 * Pure: znajdź najtrafniejsze pliki dla pytania. Punktacja: trafienie w ścieżkę (5) > eksport (3) >
 * opis (2). Testy pomijane (to nawigacja po kodzie). Zwraca top `limit` z uzasadnieniem („why").
 */
export function searchKnowledge(index: KnowledgeIndex, query: string, limit = 8): KnowledgeHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const terms = expandTerms(tokens);
  const hits: KnowledgeHit[] = [];
  for (const f of index.files || []) {
    if (f.kind === "test") continue;
    const pathL = f.path.toLowerCase();
    const sumL = (f.summary || "").toLowerCase();
    const expL = f.exports.map((e) => e.toLowerCase());
    let score = 0;
    const reasons: string[] = [];
    for (const t of terms) {
      if (pathL.includes(t)) { score += 5; reasons.push(`ścieżka~${t}`); }
      else if (expL.some((e) => e.includes(t))) { score += 3; reasons.push(`eksport~${t}`); }
      else if (sumL.includes(t)) { score += 2; }
    }
    if (score > 0) hits.push({ path: f.path, kind: f.kind, score, summary: f.summary, why: reasons.slice(0, 3).join(", ") });
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/**
 * Developer Copilot: odpowiedz na pytanie o projekt po polsku. Zwraca listę najtrafniejszych
 * modułów + AUTO-DORADZTWO dla #1 (publiczne API, liczba zależności = ryzyko zmiany, jakość, testy).
 * Pure — gotowy tekst do pokazania w czacie. Gdy brak trafień, prosi o doprecyzowanie.
 */
export function answerProjectQuestion(index: KnowledgeIndex, query: string, limit = 6): string {
  const hits = searchKnowledge(index, query, limit);
  if (!hits.length) {
    return "Nie znalazłem w bazie wiedzy modułu pasującego do pytania. Doprecyzuj domenę — np. finanse, głos, leady/CRM, pamięć, obrazy, strony, e-mail, ustawienia, licencja.";
  }
  const lines: string[] = ["Najbardziej pasujące moduły (z bazy wiedzy projektu):"];
  hits.forEach((h, i) => lines.push(`${i + 1}. ${h.path}${h.summary ? ` — ${h.summary}` : ""}${h.why ? `  [${h.why}]` : ""}`));
  const top = (index.files || []).find((f) => f.path === hits[0].path);
  if (top) {
    const q = top.quality;
    lines.push("", `🔎 ${top.path}`);
    if (top.exports?.length) lines.push(`• Publiczne API: ${top.exports.slice(0, 12).join(", ")}`);
    if (top.usedBy?.length) {
      const risky = q && (q.criticality === "krytyczny" || q.criticality === "wysoki");
      lines.push(`• Używany przez ${top.usedBy.length} plik(ów) → zmiana ${risky ? "RYZYKOWNA (dużo zależności — przetestuj szeroko)" : "względnie bezpieczna"}.`);
    }
    if (top.uses?.length) lines.push(`• Wykorzystuje: ${top.uses.slice(0, 8).map((p) => p.replace(/^src\/lib\//, "")).join(", ")}`);
    if (q) lines.push(`• Jakość: złożoność ${q.complexity}, krytyczność ${q.criticality}, ryzyko zmian ${q.risk}, testy: ${q.hasTests ? "są ✓" : "BRAK — dodaj test przed zmianą"}.`);
  }
  return lines.join("\n");
}
