import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// === Strażnik „pułapki cudzysłowów" ===
// „ (U+201E) domknięte PROSTYM " zamiast ” (U+201D) w literale "…" wysadza esbuild
// (historycznie psuło build/CI ≥4×). Detekcja przez parser TypeScripta: prawdziwa pułapka
// zostawia błąd składni na linii z „ (string zamyka się za wcześnie, reszta to „śmieci"),
// natomiast tekst JSX, klasy znaków w regex i stringi-ograniczniki ("„»«") parsują się
// czysto → ZERO fałszywych alarmów. Skanuje src/**, blokując regresję w bramce vitest/CI.

const SRC = join(__dirname, "..", "src");

export interface QuoteTrapHit {
  line: number; // 1-indeksowany
  text: string; // przycięta treść linii
}

/**
 * Pure: wykryj pułapkę cudzysłowów w źródle TS/TSX. Zwraca linie z „ , na których parser
 * zgłasza błąd składni (czyli „ zostało domknięte prostym " i rozbiło literał).
 */
export function scanQuoteTrap(src: string, kind: ts.ScriptKind = ts.ScriptKind.TSX): QuoteTrapHit[] {
  const sf = ts.createSourceFile("scan.tsx", src, ts.ScriptTarget.Latest, false, kind);
  // parseDiagnostics nie jest w publicznych typach, ale jest zawsze obecne na SourceFile.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics || [];
  const lines = src.split("\n");
  const hits: QuoteTrapHit[] = [];
  const seen = new Set<number>();
  for (const d of diags) {
    if (typeof d.start !== "number") continue;
    const { line } = sf.getLineAndCharacterOfPosition(d.start);
    const text = lines[line] || "";
    // Zawężamy do pułapki cudzysłowów: błąd MUSI być na linii zawierającej „ (U+201E).
    if (text.indexOf("„") < 0) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    hits.push({ line: line + 1, text: text.trim().slice(0, 100) });
  }
  return hits;
}

export function hasQuoteTrap(src: string): boolean {
  return scanQuoteTrap(src).length > 0;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      out.push(...listFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("quoteGuard — detektor pułapki cudzysłowów", () => {
  it("łapie „ domknięte prostym \" w literale \"…\"", () => {
    expect(hasQuoteTrap('const x = "tag „latest" koniec";')).toBe(true);
    const hits = scanQuoteTrap('const x = "tag „latest" i tyle";');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].line).toBe(1);
  });

  it("NIE flaguje poprawnego „…” w literale \"…\"", () => {
    expect(hasQuoteTrap('const x = "tag „latest” koniec";')).toBe(false);
  });

  it("NIE flaguje komentarzy (esbuild je usuwa)", () => {
    expect(hasQuoteTrap('// === tag „latest" ===')).toBe(false);
    expect(hasQuoteTrap('const x = 1; // „latest" w komentarzu')).toBe(false);
    expect(hasQuoteTrap('/** JSDoc: „Ja", „Marek", „klient". */\nconst x = 1;')).toBe(false);
  });

  it("NIE flaguje template-literali ani stringów '…' (tam \" jest bezpieczne)", () => {
    expect(hasQuoteTrap("const x = `tag „latest\" koniec`;")).toBe(false);
    expect(hasQuoteTrap("const x = 'tag „latest\" koniec';")).toBe(false);
  });

  it("NIE flaguje klas znaków w regex ani stringów-ograniczników", () => {
    expect(hasQuoteTrap('const t = s.replace(/^["\'„]+/, "").replace(/["”]+$/, "");')).toBe(false);
    expect(hasQuoteTrap('const OPEN = "„"; const SET = "„»«";')).toBe(false);
  });

  it("NIE flaguje tekstu JSX z „…\" (poza literałem \")", () => {
    expect(hasQuoteTrap('const el = <span className="muted">mówisz „tak"/„nie" w oknie</span>;')).toBe(false);
  });

  it("podaje numer linii pułapki przy wielu liniach", () => {
    const src = ['const a = "ok";', 'const b = "zły „x" tu";'].join("\n");
    const hits = scanQuoteTrap(src);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].line).toBe(2);
  });
});

describe("quoteGuard — skan całego src/**", () => {
  it("żaden plik src nie zawiera pułapki cudzysłowów", () => {
    const offenders: string[] = [];
    for (const file of listFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      for (const h of scanQuoteTrap(src, kind)) {
        offenders.push(`${file.replace(SRC, "src")}:${h.line}  ${h.text}`);
      }
    }
    expect(offenders, `Pułapka cudzysłowów (uzyj znaku zamykajacego zamiast prostego cudzyslowu):\n${offenders.join("\n")}`).toEqual([]);
  });
});
