import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseMarkdown, parseInline, isSafeHttpUrl } from "../src/lib/markdown";

describe("Markdown parser (XSS-safe, ES2019/Chrome 79)", () => {
  it("parsuje bloki kodu z językiem (w tym niedomknięty blok podczas streamingu)", () => {
    const blocks = parseMarkdown("Oto polecenie:\n```bash\nnpm run build\n```\nI dalej:\n```ts\nconst x = 1;");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code", "paragraph", "code"]);
    expect(blocks[1]).toEqual({ type: "code", lang: "bash", code: "npm run build" });
    expect(blocks[3]).toEqual({ type: "code", lang: "ts", code: "const x = 1;" });
  });

  it("parsuje nagłówki, listy punktowane/numerowane, cytaty i formatowanie liniowe", () => {
    const md = "## Plan\n- **Krok 1**: uruchom `npm test`\n- *Krok 2*: gotowe\n\n1. Pierwszy\n2. Drugi\n\n> Ważna uwaga";
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "ul", "ol", "quote"]);
    if (blocks[1].type === "ul") {
      expect(blocks[1].items[0]).toEqual([
        { type: "strong", text: "Krok 1" },
        { type: "text", text: ": uruchom " },
        { type: "code", text: "npm test" },
      ]);
    }
  });

  it("blokuje XSS w linkach (javascript:, data:, vbscript:) i przepuszcza wyłącznie http/https", () => {
    expect(isSafeHttpUrl("https://github.com/Talent620/Jarvis")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:11434")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);

    const safe = parseInline("Sprawdź [Linux](https://en.wikipedia.org/wiki/Linux_(kernel)) i [zły](javascript:alert(1))");
    expect(safe).toEqual([
      { type: "text", text: "Sprawdź " },
      { type: "link", label: "Linux", href: "https://en.wikipedia.org/wiki/Linux_(kernel)" },
      { type: "text", text: " i " },
      { type: "text", text: "zły" },
    ]);
  });

  it("nie zawiera lookbehind ani \\p{} (zgodność z Chrome 79 / Samsung S9)", () => {
    const src = readFileSync(new URL("../src/lib/markdown.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\(\?<[=!]/);
    expect(src).not.toMatch(/\\p\{/);
  });
});
