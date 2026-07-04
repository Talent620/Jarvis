import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// === Kontrakt Samsung S9 (stary WebView / Chrome 79) ===
// Stary silnik wywala się na regexach z flagą /u, \p{...} (wymaga /u), oraz na lookbehind
// (?<=) / (?<!). Ten test skanuje WYŁĄCZNIE literały wyrażeń regularnych (przez parser
// TypeScripta), więc komentarze i zwykłe stringi go nie ruszają. Blokuje regresję S9.

const SRC = join(__dirname, "..", "src");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "generated" || name === "node_modules") continue; // pliki generowane pomijamy
      out.push(...listFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Zwraca surowe teksty literałów regex w pliku (np. "/foo/u"), pomijając komentarze/stringi. */
function regexLiterals(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const walk = (node: ts.Node) => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      found.push((node as ts.LiteralLikeNode).text || node.getText(sf));
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

/** Czy literał regex jest niebezpieczny dla S9? (flaga u, \p{...}, lookbehind) */
export function isUnsafeS9Regex(literal: string): boolean {
  // literal np. "/wzór/gimu" — wydziel flagi po ostatnim slashu
  const lastSlash = literal.lastIndexOf("/");
  const flags = lastSlash >= 0 ? literal.slice(lastSlash + 1) : "";
  const body = lastSlash >= 0 ? literal.slice(0, lastSlash) : literal;
  if (flags.includes("u")) return true; // flaga /u — Chrome 79 ją zna, ale w parze z \p{} pada; blokujemy z ostrożności
  if (body.includes("\\p{") || body.includes("\\P{")) return true; // klasy Unicode — wymagają /u
  if (body.includes("(?<=") || body.includes("(?<!")) return true; // lookbehind — brak w Chrome 79
  return false;
}

describe("Kontrakt S9 — skaner regexów (literały, bez komentarzy)", () => {
  it("żaden plik src nie używa /u, \\p{...} ani lookbehind", () => {
    const offenders: string[] = [];
    for (const file of listFiles(SRC)) {
      for (const lit of regexLiterals(file)) {
        if (isUnsafeS9Regex(lit)) offenders.push(`${file.replace(SRC, "src")}: ${lit}`);
      }
    }
    expect(offenders, `Niedozwolone na S9 regexy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("detektor łapie kontrolne niedozwolone wzorce", () => {
    expect(isUnsafeS9Regex("/\\p{L}+/u")).toBe(true);
    expect(isUnsafeS9Regex("/foo/gu")).toBe(true);
    expect(isUnsafeS9Regex("/(?<=x)y/")).toBe(true);
    expect(isUnsafeS9Regex("/(?<!x)y/")).toBe(true);
  });

  it("detektor przepuszcza jawną klasę PL i zwykłe wzorce", () => {
    expect(isUnsafeS9Regex("/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/")).toBe(false);
    expect(isUnsafeS9Regex("/^[a-z0-9_]+$/i")).toBe(false);
    expect(isUnsafeS9Regex("/\\d{2,4}/g")).toBe(false);
  });
});
