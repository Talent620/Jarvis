import { useEffect, useRef, useState } from "react";

// Efekt „pisania na żywo" — odpowiedź pojawia się płynnie (jak w JARVIS-ie).
// Animuje tylko, gdy animate=true (świeża odpowiedź); historia wyświetla się od razu.
export default function TypeText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setShown(text);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typing = animate && shown.length < text.length;
  return <span className={typing ? "caret" : ""}>{shown}</span>;
}
