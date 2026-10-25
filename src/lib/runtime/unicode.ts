// Unicode character classes without regex literals that use the /u flag or \p{...}: the S9
// contract (old Chrome 79 WebView, tests/s9RegexGuard.test.ts) forbids them because a syntax
// error there kills the whole bundle. Property escapes are built at runtime inside try/catch
// and fall back to explicit ranges when the engine cannot compile them.

function tryRegex(source: string, flags: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

const LETTER = tryRegex("^\\p{L}$", "u");
const MARK = tryRegex("^\\p{M}$", "u");
const NUMBER = tryRegex("^\\p{N}$", "u");

const MARK_RANGES: [number, number][] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f],
  [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20ff], [0xfe20, 0xfe2f],
];

const inRanges = (c: number, ranges: [number, number][]): boolean => ranges.some(([a, b]) => c >= a && c <= b);

/** Letter test used when the engine cannot compile \\p{L} (exported for tests). */
export function letterFallback(ch: string): boolean {
  if (ch.toLowerCase() !== ch.toUpperCase()) return true;
  const c = ch.codePointAt(0) ?? 0;
  // Uncased scripts: CJK, Hiragana/Katakana, Hangul, Arabic, Hebrew, Thai, Devanagari.
  return inRanges(c, [[0x4e00, 0x9fff], [0x3040, 0x30ff], [0xac00, 0xd7af], [0x0620, 0x064a], [0x05d0, 0x05ea], [0x0e01, 0x0e30], [0x0904, 0x0939]]);
}

export const markFallback = (ch: string): boolean => inRanges(ch.codePointAt(0) ?? 0, MARK_RANGES);

/** One code point (string of 1-2 UTF-16 units). */
export function isLetterChar(ch: string): boolean {
  return LETTER ? LETTER.test(ch) : letterFallback(ch);
}

export function isMarkChar(ch: string): boolean {
  return MARK ? MARK.test(ch) : markFallback(ch);
}

export function isNumberChar(ch: string): boolean {
  if (NUMBER) return NUMBER.test(ch);
  return /^[0-9]$/.test(ch);
}
