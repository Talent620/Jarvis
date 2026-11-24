// === Lekki, bezpieczny parser Markdown dla odpowiedzi JARVIS-a (zero zależności, XSS-safe, ES2019/Chrome 79) ===
// NIE używa lookbehind ani klas Unicode property. Zwraca czyste AST bloków i elementów liniowych do bezpiecznego
// renderu w React (zero dangerouslySetInnerHTML). Linki wyłącznie http:// lub https://.

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "link"; label: string; href: string };

export type MdBlock =
  | { type: "code"; lang: string; code: string }
  | { type: "heading"; level: 1 | 2 | 3; tokens: InlineToken[] }
  | { type: "ul"; items: InlineToken[][] }
  | { type: "ol"; items: InlineToken[][] }
  | { type: "quote"; tokens: InlineToken[] }
  | { type: "hr" }
  | { type: "paragraph"; tokens: InlineToken[] };

/** Pure: dopuszczamy wyłącznie bezpieczne protokoły http/https (blokuje javascript:, data:, vbscript:). */
export function isSafeHttpUrl(raw: string): boolean {
  const s = (raw || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Pure: parsuj formatowanie liniowe (`code`, **bold**, *italic*, [etykieta](https://...)). */
export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  const src = String(text || "");
  // Kolejność alternatyw: kod inline → link (z obsługą 1 poziomu nawiasów w URL) → pogrubienie → kursywa.
  const re = /`([^`\n]+)`|\[([^\]\n]+)\]\(((?:[^()\s]+|\([^()\s]*\))+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ type: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ type: "code", text: m[1] });
    } else if (m[2] !== undefined && m[3] !== undefined) {
      if (isSafeHttpUrl(m[3])) {
        out.push({ type: "link", label: m[2], href: m[3] });
      } else {
        out.push({ type: "text", text: m[2] });
      }
    } else if (m[4] !== undefined) {
      out.push({ type: "strong", text: m[4] });
    } else if (m[5] !== undefined) {
      out.push({ type: "em", text: m[5] });
    }
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ type: "text", text: src.slice(last) });
  return out.length ? out : [{ type: "text", text: "" }];
}

/** Pure: parsuj tekst Markdown (również nieukończony podczas streamingu) do listy bloków. */
export function parseMarkdown(raw: string): MdBlock[] {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Puste linie oddzielają bloki
    if (!line.trim()) {
      i++;
      continue;
    }

    // Ogrodzony blok kodu ```lang (obsługuje też niedomknięty blok w trakcie streamingu!)
    const fence = line.match(/^\s*```([a-zA-Z0-9_+-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] || "").toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && /^\s*```\s*$/.test(lines[i])) i++;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // Linia pozioma
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Nagłówek # / ## / ###
    const h = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, tokens: parseInline(h[2].trim()) });
      i++;
      continue;
    }

    // Cytat > ...
    if (/^\s*>\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", tokens: parseInline(qLines.join("\n")) });
      continue;
    }

    // Lista punktowana (- / * / •)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*[-*•]\s+/, "")));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Lista numerowana (1. / 2) ...)
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*\d+[.)]\s+/, "")));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Zwykły akapit (zbieramy ciągłe linie aż do pustej linii lub początku innego bloku)
    const pLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", tokens: parseInline(pLines.join("\n")) });
  }

  return blocks;
}
