import { AnimatePresence, motion } from "framer-motion";
import { Terminal } from "lucide-react";

export interface ThoughtLine {
  id: string;
  text: string;
  /** Wpływa na kolor markera: info (cyan), ok (green), warn (amber). */
  kind?: "info" | "ok" | "warn";
}

interface CognitiveStreamProps {
  /** Linie strumienia myśli — najnowsze na dole. Podłącz do errorLog.ts / logiki czatu. */
  lines: ThoughtLine[];
  /** Ile linii pokazywać (starsze wygaszają się u góry). */
  max?: number;
}

const DOT: Record<NonNullable<ThoughtLine["kind"]>, string> = {
  info: "#22d3ee",
  ok: "#34d399",
  warn: "#fbbf24",
};

/**
 * „Strumień poznawczy" — terminalowy log myśli JARVIS-a. Nowe wpisy wsuwają się
 * od dołu, starsze wygaszają u góry (Framer Motion AnimatePresence).
 */
export default function CognitiveStream({ lines, max = 12 }: CognitiveStreamProps) {
  const visible = lines.slice(-max);

  return (
    <div className="scanline relative flex h-full flex-col overflow-hidden rounded-2xl border border-neural-line bg-neural-glass backdrop-blur-xl">
      {/* Pasek tytułu */}
      <div className="flex items-center gap-2 border-b border-neural-line px-4 py-2.5">
        <Terminal size={14} className="text-neural-cyan" />
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-400">Strumień poznawczy</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: "#34d399" }} />
          <span className="font-mono text-[10px] text-zinc-500">live</span>
        </span>
      </div>

      {/* Log */}
      <div className="flex flex-1 flex-col justify-end gap-1 overflow-hidden p-3">
        <AnimatePresence initial={false}>
          {visible.map((l) => (
            <motion.div
              key={l.id}
              layout
              initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, height: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="flex items-start gap-2 font-mono text-[12px] leading-relaxed text-zinc-300"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT[l.kind ?? "info"] }} />
              <span className="text-zinc-600">›</span>
              <span className="break-words">{l.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
