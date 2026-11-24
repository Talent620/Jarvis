import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { parseMarkdown, type InlineToken } from "../lib/markdown";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* brak dostępu do schowka */
    }
  };
  return (
    <div className="md-code-wrap">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || "kod"}</span>
        <button type="button" className="md-copy" onClick={copy} aria-label="Kopiuj kod">
          {copied ? "✓ Skopiowano" : "📋 Kopiuj"}
        </button>
      </div>
      <pre className="md-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInline(tokens: InlineToken[]) {
  return tokens.map((tok, idx) => {
    if (tok.type === "code") return <code key={idx} className="md-inline-code">{tok.text}</code>;
    if (tok.type === "strong") return <strong key={idx}>{tok.text}</strong>;
    if (tok.type === "em") return <em key={idx}>{tok.text}</em>;
    if (tok.type === "link") {
      return (
        <a key={idx} className="md-link" href={tok.href} target="_blank" rel="noopener noreferrer">
          {tok.label}
        </a>
      );
    }
    return <Fragment key={idx}>{tok.text}</Fragment>;
  });
}

// Efekt „pisania na żywo" + bezpieczny renderer Markdown (bloki kodu z 1-klikowym Kopiuj, listy, cytaty, pogrubienia).
// Animuje tylko, gdy animate=true (świeża odpowiedź niestrumieniowana); streaming i historia renderują się od razu.
export default function TypeText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setShown(text);
      return;
    }
    setShown(""); // restart animacji od zera, gdy zmieni się text/animate
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 120)); // skok, by długie odpowiedzi nie ciągnęły się wiecznie
    ref.current = window.setInterval(() => {
      i += step;
      setShown(text.slice(0, i));
      if (i >= text.length && ref.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    }, 16);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [text, animate]);

  const typing = animate && shown.length < text.length;
  const blocks = useMemo(() => (typing ? null : parseMarkdown(shown)), [shown, typing]);

  if (typing || !blocks) {
    return <span className={typing ? "caret" : ""}>{shown}</span>;
  }

  return (
    <div className="md-body">
      {blocks.map((b, idx) => {
        if (b.type === "code") return <CodeBlock key={idx} lang={b.lang} code={b.code} />;
        if (b.type === "hr") return <hr key={idx} className="md-hr" />;
        if (b.type === "heading") {
          const cls = `md-h md-h${b.level}`;
          if (b.level === 1) return <h3 key={idx} className={cls}>{renderInline(b.tokens)}</h3>;
          if (b.level === 2) return <h4 key={idx} className={cls}>{renderInline(b.tokens)}</h4>;
          return <h5 key={idx} className={cls}>{renderInline(b.tokens)}</h5>;
        }
        if (b.type === "quote") return <blockquote key={idx} className="md-quote">{renderInline(b.tokens)}</blockquote>;
        if (b.type === "ul") {
          return (
            <ul key={idx} className="md-list">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} className="md-list md-ol">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          );
        }
        return <p key={idx} className="md-p">{renderInline(b.tokens)}</p>;
      })}
    </div>
  );
}
