import { useEffect, useRef, useState } from "react";
import { LiveSession, liveToolDeclarations, type LiveState } from "../lib/liveVoice";
import { toolDefs, runTool } from "../lib/tools";
import { riskOf } from "../lib/permissions";
import { ConversationLoop, type LoopState } from "../lib/voiceLoop";
import { systemPrompt, resolveProvider } from "../lib/brain";
import { PROVIDERS } from "../lib/providers/registry";
import { subscribeLevel } from "../lib/audioLevel";
import { primaryKey } from "../lib/keys";
import { memoryContextBlock, resolveNamespace } from "../lib/memoryService";
import { store } from "../lib/store";
import { brand } from "../lib/brand";

type Engine = "gemini" | "loop";
type AnyState = LiveState | LoopState;

const LABEL: Record<string, string> = {
  connecting: "Łączę…",
  listening: "Słucham…",
  thinking: "Myślę…",
  speaking: "Mówię…",
  closed: "Zakończono",
  error: "Błąd połączenia",
};

export default function LiveOverlay({ onClose }: { onClose: () => void }) {
  const geminiKey = primaryKey("gemini");
  // Domyślnie Gemini Live (gdy jest klucz), inaczej uniwersalny tryb rozmowy.
  const [engine, setEngine] = useState<Engine>(geminiKey ? "gemini" : "loop");
  const [state, setState] = useState<AnyState>("connecting");
  const [detail, setDetail] = useState("");
  const [caption, setCaption] = useState("");
  const [camOn, setCamOn] = useState(false);
  const liveRef = useRef<LiveSession | null>(null);
  const loopRef = useRef<ConversationLoop | null>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  // Token startu: unieważnia asynchroniczne budowanie sesji, gdy w międzyczasie
  // doszło do przełączenia silnika lub zamknięcia (zapobiega „wskrzeszeniu" sesji).
  const genRef = useRef(0);

  // Orb pulsuje w rytm mowy JARVIS-a.
  useEffect(() => {
    return subscribeLevel((v) => {
      const el = coreRef.current;
      if (el) {
        el.style.transform = `scale(${(1 + v * 0.5).toFixed(3)})`;
        el.style.filter = `brightness(${(1 + v * 0.8).toFixed(2)})`;
      }
    });
  }, []);

  const toggleCamera = async () => {
    const s = liveRef.current;
    if (!s) return;
    if (camOn) {
      s.stopCamera();
      setCamOn(false);
    } else {
      try {
        await s.startCamera();
        setCamOn(true);
      } catch {
        setDetail("Brak dostępu do kamery. Zezwól na kamerę w ustawieniach aplikacji.");
      }
    }
  };

  const stopAll = () => {
    genRef.current++; // unieważnij ewentualne trwające async budowanie sesji
    setCamOn(false);
    liveRef.current?.stop();
    liveRef.current = null;
    loopRef.current?.stop();
    loopRef.current = null;
  };

  const startEngine = (which: Engine) => {
    stopAll();
    const myGen = genRef.current;
    setCaption("");
    setDetail("");
    setState("connecting");
    if (which === "gemini") {
      if (!geminiKey) {
        setState("error");
        setDetail("Tryb Gemini Live wymaga klucza Gemini. Możesz użyć trybu rozmowy (dowolny model) poniżej.");
        return;
      }
      // Pamięć długoterminowa (Mem0, Faza 1): pobierz trafny kontekst i wstrzyknij do
      // promptu sesji live — tak jak w czacie tekstowym. Degraduje cicho (pusty blok),
      // gdy serwis pamięci nie jest skonfigurowany/dostępny.
      void (async () => {
        let mem0Block = "";
        try {
          const ns = resolveNamespace(store.settings.activeProjectId);
          mem0Block = await memoryContextBlock("Rozmowa głosowa na żywo z użytkownikiem.", ns);
        } catch {
          /* brak pamięci → czysty prompt */
        }
        if (genRef.current !== myGen) return; // przełączono silnik / zamknięto w międzyczasie
        // Narzędzia (Faza 2 MCP + odczyt/zapis lokalny) — bezpieczny podzbiór dla głosu.
        const liveTools = liveToolDeclarations(toolDefs, riskOf);
        const liveRunTool = async (name: string, args: unknown) => {
          // Defensywnie: outbound (poza MCP) nigdy nie wykonuje się w trybie live (brak zgody).
          if (!name.startsWith("mcp_") && riskOf(name) === "outbound") {
            return "Ta akcja wymaga potwierdzenia — wykonaj ją w czacie tekstowym lub trybie rozmowy.";
          }
          return runTool(name, args);
        };
        const session = new LiveSession(
          geminiKey,
          systemPrompt({ mem0Block }),
          (s, d) => {
            setState(s);
            if (d) setDetail(d);
          },
          (t) => setCaption((c) => (c + t).slice(-300)),
          liveTools,
          liveRunTool,
        );
        liveRef.current = session;
        session.start().catch(() => {
          if (genRef.current === myGen) setState("error");
        });
      })();
    } else {
      if (!resolveProvider()) {
        setState("error");
        setDetail("Brak skonfigurowanego modelu AI. Dodaj klucz w ⚙ Ustawienia.");
        return;
      }
      const loop = new ConversationLoop(
        (s, d) => {
          setState(s);
          if (d) setDetail(d);
        },
        (t) => setCaption(t),
      );
      loopRef.current = loop;
      loop.start();
    }
  };

  useEffect(() => {
    startEngine(engine);
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchEngine = (which: Engine) => {
    setEngine(which);
    startEngine(which);
  };

  const close = () => {
    stopAll();
    onClose();
  };

  const orbClass = state === "speaking" ? "speaking" : state === "listening" ? "listening" : "thinking";
  const failed = state === "error" || state === "closed";
  const providerLabel = (() => {
    const r = resolveProvider();
    return r ? PROVIDERS[r.provider].label.toUpperCase() : "MODEL AI";
  })();

  return (
    <div className="sheet live" onClick={(e) => e.stopPropagation()}>
      <div className="live-inner">
        <div className="brand" style={{ textAlign: "center" }}>
          {brand()}
          <small>ROZMOWA NA ŻYWO · {engine === "gemini" ? "GEMINI LIVE" : providerLabel}</small>
        </div>

        <div className="orb-wrap" style={{ transform: "scale(1.6)", margin: "40px 0" }}>
          <div className={`orb ${orbClass}`}>
            <div className="ring r1" />
            <div className="ring r2" />
            <div className="ring r3" />
            <div className="core" ref={coreRef} />
          </div>
        </div>

        <div className="orb-status" style={{ fontSize: 14 }}>
          {LABEL[state] || state}
        </div>

        {detail && failed && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 340, color: state === "error" ? "var(--danger, #ff6b6b)" : undefined }}>
            {detail}
          </p>
        )}

        {failed && (
          <button className="btn" style={{ maxWidth: 240, marginTop: 14 }} onClick={() => startEngine(engine)}>
            ↻ Połącz ponownie
          </button>
        )}

        {/* Zawsze dostępne przełączenie silnika — dzięki temu rozmowę można włączyć,
            nawet gdy Gemini Live ma limit albo brak klucza. */}
        {engine === "gemini" ? (
          <button className="btn" style={{ maxWidth: 280, marginTop: 10 }} onClick={() => switchEngine("loop")}>
            🎙 Tryb rozmowy (dowolny model)
          </button>
        ) : (
          geminiKey && (
            <button className="btn" style={{ maxWidth: 280, marginTop: 10 }} onClick={() => switchEngine("gemini")}>
              ⚡ Wróć do Gemini Live
            </button>
          )
        )}

        {engine === "gemini" && !failed && (
          <button className="btn" style={{ maxWidth: 280, marginTop: 10 }} onClick={() => void toggleCamera()}>
            {camOn ? "📷 Wyłącz kamerę" : "📷 Pokaż kamerę (JARVIS widzi)"}
          </button>
        )}

        {caption && (
          <p className="muted" style={{ textAlign: "center", maxWidth: 360, marginTop: 18 }}>
            {caption}
          </p>
        )}

        <button className="btn" style={{ maxWidth: 220, marginTop: 24 }} onClick={close}>
          ■ Zakończ rozmowę
        </button>
      </div>
    </div>
  );
}
