// Text semantics (mission 5.10). "znaki" are grapheme clusters; "litery" are graphemes whose
// base character is a Unicode letter. Emoji, punctuation, digits and a leading "@" are not
// letters. Offsets are UTF-16 code units so they map directly onto DOM Range offsets.

import { isLetterChar, isMarkChar, isNumberChar } from "./unicode";

export interface Grapheme {
  text: string;
  /** UTF-16 offset of the first code unit. */
  index: number;
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; index: number }>;
}

let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: string }) => SegmenterLike }).Segmenter;
  segmenter = Seg ? new Seg("pl", { granularity: "grapheme" }) : null;
  return segmenter;
}

/** Test hook: force the fallback path. */
export function __setSegmenterForTests(s: SegmenterLike | null | undefined): void {
  segmenter = s;
}


/** Code point extends the previous grapheme: marks, ZWJ, variation selectors, skin tones, tags. */
function isExtend(cp: string): boolean {
  const c = cp.codePointAt(0) ?? 0;
  return isMarkChar(cp) || c === 0x200d || c === 0xfe0f || c === 0xfe0e
    || (c >= 0x1f3fb && c <= 0x1f3ff) || (c >= 0xe0020 && c <= 0xe007f);
}

function isRegional(cp: string): boolean {
  const c = cp.codePointAt(0) ?? 0;
  return c >= 0x1f1e6 && c <= 0x1f1ff;
}

const ZWJ = String.fromCharCode(0x200d);

/** Fallback clustering: base + combining marks, variation selectors, skin tones, ZWJ sequences, flag pairs. */
function fallbackGraphemes(text: string): Grapheme[] {
  const out: Grapheme[] = [];
  let i = 0;
  const cps = Array.from(text);
  let offset = 0;
  while (i < cps.length) {
    const start = offset;
    let g = cps[i];
    offset += cps[i].length;
    i++;
    if (isRegional(g) && i < cps.length && isRegional(cps[i])) { g += cps[i]; offset += cps[i].length; i++; }
    while (i < cps.length && (isExtend(cps[i]) || cps[i - 1] === ZWJ)) {
      g += cps[i];
      offset += cps[i].length;
      i++;
    }
    out.push({ text: g, index: start });
  }
  return out;
}

export function graphemes(text: string): Grapheme[] {
  const seg = getSegmenter();
  if (!seg) return fallbackGraphemes(text);
  const out: Grapheme[] = [];
  for (const s of seg.segment(text)) out.push({ text: s.segment, index: s.index });
  return out;
}

/** A grapheme is a letter when its first code point is a Unicode letter (marks may follow). */
export function isLetter(g: string): boolean {
  const first = g.codePointAt(0);
  if (first === undefined) return false;
  return isLetterChar(String.fromCodePoint(first));
}

export const isWordChar = (g: string): boolean => isLetter(g) || isNumberChar(String.fromCodePoint(g.codePointAt(0) ?? 0));

export interface TextSpan {
  start: number;
  end: number;
  text: string;
  /** False when the text holds fewer units than requested. */
  complete: boolean;
  units: string[];
}

/**
 * Contiguous span from the first letter to the n-th letter (inclusive). Leading non-letters
 * ("@", emoji, spaces) are excluded; non-letters between letters stay inside the span because
 * a visible selection is contiguous (see docs/mission/DECISIONS.md).
 */
export function firstLetters(text: string, n: number): TextSpan {
  const gs = graphemes(text);
  const letters = gs.filter((g) => isLetter(g.text)).slice(0, Math.max(0, n));
  if (!letters.length) return { start: 0, end: 0, text: "", complete: n <= 0, units: [] };
  const first = letters[0];
  const last = letters[letters.length - 1];
  const start = first.index;
  const end = last.index + last.text.length;
  return { start, end, text: text.slice(start, end), complete: letters.length >= n, units: letters.map((g) => g.text) };
}

/** First n graphemes after leading whitespace. */
export function firstChars(text: string, n: number): TextSpan {
  const gs = graphemes(text);
  let i = 0;
  while (i < gs.length && /^\s+$/.test(gs[i].text)) i++;
  const picked = gs.slice(i, i + Math.max(0, n));
  if (!picked.length) return { start: 0, end: 0, text: "", complete: n <= 0, units: [] };
  const start = picked[0].index;
  const last = picked[picked.length - 1];
  const end = last.index + last.text.length;
  return { start, end, text: text.slice(start, end), complete: picked.length >= n, units: picked.map((g) => g.text) };
}

/** First n words (runs of letters/digits); the span covers them contiguously. */
export function firstWords(text: string, n: number): TextSpan {
  const gs = graphemes(text);
  const words: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  for (const g of gs) {
    if (isWordChar(g.text)) {
      if (!cur) cur = { start: g.index, end: g.index + g.text.length };
      else cur.end = g.index + g.text.length;
    } else if (cur) {
      words.push(cur);
      cur = null;
    }
  }
  if (cur) words.push(cur);
  const picked = words.slice(0, Math.max(0, n));
  if (!picked.length) return { start: 0, end: 0, text: "", complete: n <= 0, units: [] };
  const start = picked[0].start;
  const end = picked[picked.length - 1].end;
  return { start, end, text: text.slice(start, end), complete: picked.length >= n, units: picked.map((w) => text.slice(w.start, w.end)) };
}

export function spanFor(text: string, unit: "letter" | "char" | "word", count: number): TextSpan {
  if (unit === "letter") return firstLetters(text, count);
  if (unit === "char") return firstChars(text, count);
  return firstWords(text, count);
}

export const countGraphemes = (text: string): number => graphemes(text).length;
export const countLetters = (text: string): number => graphemes(text).filter((g) => isLetter(g.text)).length;
