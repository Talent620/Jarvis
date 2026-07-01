// === Walidator i krytyk wygenerowanej strony (siteValidator) ===
// Zanim pozwolimy pobrać/edytować stronę, sprawdzamy ją TWARDO: doctype, ucięcie dokumentu,
// duplikaty ID, martwe kotwice, niebezpieczne URL (javascript:), zewnętrzne skrypty, formularze
// bez endpointu udające „wysłano", brak alt, rozmiar dokumentu. Błędy KRYTYCZNE blokują pobranie
// (albo jawnie ostrzegają). Nigdy nie edytujemy NIEPEŁNEJ strony. Czyste i testowalne.
// S9-safe: używamy lookahead (dozwolony), ZERO lookbehind, /u i \p{L}.

export type IssueSeverity = "critical" | "warning" | "info";
export interface ValidationIssue { severity: IssueSeverity; code: string; message: string }

export interface SiteScores {
  design: number; cro: number; seo: number; accessibility: number; performance: number; integrity: number;
}

export interface SiteValidation {
  issues: ValidationIssue[];
  scores: SiteScores;
  safeToDownload: boolean; // false, gdy są błędy krytyczne
  truncated: boolean;
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/** Pure: wszystkie wartości atrybutu w kodzie (np. id="x") — bez lookbehind. */
function attrValues(html: string, attr: string): string[] {
  const re = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/** Pure: zwaliduj wygenerowaną stronę. Zwraca problemy, wyniki i czy wolno ją pobrać. */
export function validateSite(html: string): SiteValidation {
  const issues: ValidationIssue[] = [];
  const src = html || "";
  const add = (severity: IssueSeverity, code: string, message: string) => issues.push({ severity, code, message });

  // 1) doctype
  if (!/^\s*<!doctype html>/i.test(src)) add("warning", "no_doctype", "Brak <!DOCTYPE html> na początku dokumentu.");

  // 2) ucięcie dokumentu — nigdy nie edytujemy/nie pobieramy niepełnej strony
  const truncated = !!src.trim() && !/<\/html>\s*$/i.test(src.trim());
  if (truncated) add("critical", "truncated", "Dokument wygląda na UCIĘTY (brak zamknięcia </html>) — nie wolno go edytować ani pobierać.");

  // 3) duplikaty ID
  const ids = attrValues(src, "id");
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) { if (seen.has(id)) dupes.add(id); else seen.add(id); }
  if (dupes.size) add("warning", "dup_id", `Zduplikowane ID: ${[...dupes].join(", ")} (niepoprawny HTML, psuje kotwice i JS).`);

  // 4) martwe kotwice (#id bez odpowiadającego id)
  const anchors = attrValues(src, "href").filter((h) => h.startsWith("#") && h.length > 1).map((h) => h.slice(1));
  const dead = anchors.filter((a) => !seen.has(a));
  if (dead.length) add("warning", "dead_anchor", `Martwe kotwice (brak celu): ${[...new Set(dead)].join(", ")}.`);

  // 5) niebezpieczne URL (javascript:)
  if (/(href|src)\s*=\s*["']\s*javascript:/i.test(src)) add("critical", "js_url", "Niebezpieczny URL javascript: w kodzie — usuń przed publikacją.");

  // 6) zewnętrzne skrypty (zależność sieciowa/ryzyko)
  const extScripts = (src.match(/<script[^>]+src\s*=\s*["']https?:\/\//gi) || []).length;
  if (extScripts) add("warning", "ext_script", `Zewnętrzne skrypty (${extScripts}) — zależność od sieci i ryzyko; rozważ osadzenie lokalne.`);

  // 7) formularz bez endpointu udający „wysłano"
  const hasForm = /<form\b/i.test(src);
  const formHasAction = /<form[^>]*\b(action|data-endpoint)\s*=\s*["'][^"']+["']/i.test(src);
  if (hasForm && !formHasAction) {
    add("info", "demo_form", "Formularz bez endpointu — oznaczony jako DEMONSTRACYJNY (nie wysyła).");
    if (/wysłano|wyslano|wiadomość wysłana|wiadomosc wyslana|form-success|dziękujemy za wiadomość|dziekujemy za wiadomosc/i.test(src))
      add("critical", "fake_form", "Formularz bez endpointu pokazuje status wysłano — to fałszywy sukces; usuń komunikat lub podłącz endpoint.");
  }

  // 8) obrazy bez alt (dostępność) — lookahead dozwolony na S9
  const imgsNoAlt = (src.match(/<img(?![^>]*\balt\s*=)[^>]*>/gi) || []).length;
  if (imgsNoAlt) add("warning", "img_no_alt", `Obrazy bez atrybutu alt: ${imgsNoAlt} (dostępność i SEO).`);

  // 9) rozmiar dokumentu (wydajność)
  if (src.length > 500_000) add("warning", "big_doc", `Bardzo duży dokument (${Math.round(src.length / 1024)} KB) — może obciążyć wczytywanie.`);

  // Wyniki: start 100, kara za problemy w danej kategorii.
  const pen = (codes: string[], per: Partial<Record<string, number>> = {}) =>
    clamp100(100 - issues.filter((i) => codes.includes(i.code)).reduce((s, i) => s + (per[i.code] ?? (i.severity === "critical" ? 50 : i.severity === "warning" ? 15 : 3)), 0));

  const scores: SiteScores = {
    design: clamp100(100 - (truncated ? 40 : 0)),
    cro: pen(["fake_form", "demo_form"]),
    seo: pen(["no_doctype", "img_no_alt", "dup_id"]),
    accessibility: pen(["img_no_alt", "dup_id"]),
    performance: pen(["big_doc", "ext_script"]),
    integrity: pen(["truncated", "js_url", "fake_form", "dup_id"]),
  };

  const safeToDownload = !issues.some((i) => i.severity === "critical");
  return { issues, scores, safeToDownload, truncated };
}

/** Pure: krótki werdykt dla użytkownika (blokada vs ostrzeżenie vs OK). */
export function validationVerdict(v: SiteValidation): string {
  const crit = v.issues.filter((i) => i.severity === "critical");
  if (crit.length) return `⛔ Nie pobieraj — błędy krytyczne: ${crit.map((c) => c.message).join(" · ")}`;
  const warn = v.issues.filter((i) => i.severity === "warning");
  if (warn.length) return `⚠ Do pobrania, ale warto poprawić: ${warn.length} ostrzeżeń.`;
  return "✅ Strona przeszła walidację.";
}
