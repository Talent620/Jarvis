import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import TypeText from "./TypeText";
import { speak } from "../lib/voice";
import { store } from "../lib/store";
import { isDesktop } from "../lib/desktop";
import { isNearBottom, starterSuggestions } from "../lib/chatUx";
import { detectLang, t } from "../lib/i18n";
import { buildChiefBriefing, briefingOneLiner } from "../lib/chiefOfStaff";
import { currentStreak, currentRecap } from "../lib/habit";
import { providerShortName } from "../lib/providerNames";

// Akcje pod odpowiedzią: odsłuchaj + kopiuj (z potwierdzeniem ✓).
function MsgActions({ text, onRegenerate }: { text: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* brak dostępu do schowka */
    }
  };
  return (
    <div className="msg-actions">
      <button onClick={() => speak(text, { ...store.settings, speak: true })} title="Odsłuchaj">
        🔊
      </button>
      <button onClick={copy} title="Kopiuj">
        {copied ? "✓" : "📋"}
      </button>
      {onRegenerate && (
        <button onClick={onRegenerate} title="Inna odpowiedź (regeneruj)">
          🔄
        </button>
      )}
    </div>
  );
}

const CONSENSUS: Record<string, { icon: string; label: string }> = {
  full: { icon: "✅", label: "Pełna zgoda modeli" },
  partial: { icon: "≈", label: "Częściowa zgoda" },
  conflict: { icon: "⚠", label: "Modele się różnią" },
  single: { icon: "•", label: "Jeden model" },
};

// Panel Trybu Konsylium: ocena zgodności + rozwijane odpowiedzi każdego modelu.
function CouncilPanel({ council }: { council: NonNullable<ChatMessage["council"]> }) {
  const c = CONSENSUS[council.consensus] || CONSENSUS.partial;
  return (
    <details className="council">
      <summary>
        ⚖ Konsylium {council.members.length} modeli · {c.icon} {c.label}
      </summary>
      {council.note && <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>{council.note}</p>}
      {council.members.map((mem, i) => (
        <div key={i} className="council-member">
          <b>{mem.label}</b>
          <p>{mem.text}</p>
        </div>
      ))}
    </details>
  );
}

// Pojedynczy bąbel — zmemoizowany: podczas streamingu zmienia się TYLKO ostatnia wiadomość
// (nowy obiekt), reszta zachowuje referencję `m` → memo pomija ich re-render. Komparator ignoruje
// tożsamość `onRetry` (zachowanie „ponów ostatnią" jest stałe), by memo realnie działało.
const MessageBubble = memo(
  function MessageBubble({ m, isLive, isLastAssistant, onRetry }: {
    m: ChatMessage;
    isLive: boolean;
    isLastAssistant: boolean;
    onRetry?: () => void;
  }) {
    return (
      <div className={`bubble ${m.role}`}>
        {m.image && (
          <img
            className="bubble-img"
            src={`data:${m.image.mediaType || "image/png"};base64,${m.image.data}`}
            alt="załączone zdjęcie"
          />
        )}
        {m.role === "assistant" ? <TypeText text={m.text} animate={isLive && !m.streamed} /> : m.text}
        {m.tools && m.tools.length > 0 && (
          <div className="tools">
            {m.tools.map((t) => (
              <span className="tag" key={t}>{t}</span>
            ))}
          </div>
        )}
        {m.council && m.council.members.length > 1 && <CouncilPanel council={m.council} />}
        {m.role === "assistant" && m.text?.startsWith("⚠") && onRetry && (
          <button className="btn" style={{ marginTop: 8, padding: "6px 12px", fontSize: 13, width: "auto" }} onClick={onRetry}>
            🔄 Ponów
          </button>
        )}
        {m.role === "assistant" && m.text && (
          <MsgActions
            text={m.text}
            onRegenerate={isLastAssistant && !m.text.startsWith("⚠") && onRetry ? onRetry : undefined}
          />
        )}
        {/* Transparentność: który dostawca odpowiedział (multi-provider — czego ChatGPT/Gemini nie pokażą). */}
        {m.role === "assistant" && m.via && (
          <div className="msg-via" style={{ fontSize: 10.5, color: "var(--text-dim)", opacity: 0.7, marginTop: 2, letterSpacing: 0.2 }}>
            via {providerShortName(m.via)}{m.fellBack ? " · zapasowy" : ""}
          </div>
        )}
        {m.citations && m.citations.length > 0 && (
          <div className="citations">
            <div className="cit-head">Źródła</div>
            {m.citations.map((c, i) => (
              <a key={c.url} className="cit" href={c.url} target="_blank" rel="noopener">
                [{i + 1}] {c.title}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  },
  (a, b) => a.m === b.m && a.isLive === b.isLive && a.isLastAssistant === b.isLastAssistant,
);

export default function Conversation({
  messages,
  interim,
  liveId,
  onSuggest,
  onRetry,
  thinking,
  needsSetup,
  onOpenKeys,
  onMemory,
  onBoss,
  onVoice,
  tasksToday,
}: {
  messages: ChatMessage[];
  interim: string;
  liveId: string | null;
  onSuggest: (text: string) => void;
  onRetry?: () => void;
  thinking?: boolean;
  needsSetup?: boolean;
  onOpenKeys?: () => void;
  onMemory?: () => void;
  onBoss?: () => void;
  onVoice?: () => void;
  tasksToday?: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // czy użytkownik jest na dole (czytalny bez re-renderu)
  const [showJump, setShowJump] = useState(false); // przycisk „↓ nowe", gdy przewinął w górę
  // Ostatnia odpowiedź asystenta — przy niej pokażemy „Regeneruj".
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    atBottomRef.current = near;
    setShowJump(!near);
  };
  const jumpToLatest = () => { atBottomRef.current = true; setShowJump(false); endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); };

  useEffect(() => {
    // Auto-przewijaj TYLKO, gdy użytkownik jest na dole — nie wyrywaj go z czytania historii.
    if (atBottomRef.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, interim, liveId, thinking]);

  if (!messages.length && !interim) {
    const lang = detectLang(store.settings.lang, typeof navigator !== "undefined" ? navigator.language : undefined);
    const suggestions = starterSuggestions(new Date(), { tasksToday, desktop: isDesktop(), lang });
    // Proaktywny one-liner + nawyk (streak/recap). Liczone DEFENSYWNIE: ekran startowy jest w rdzeniu
    // (poza ScreenBoundary), więc dowolny wyjątek tutaj wywaliłby CAŁĄ apkę — degradujemy do cichego ⌀.
    const d = store.data;
    let proactive = "", streak = 0, recap = "";
    if (!needsSetup) {
      try { proactive = briefingOneLiner(buildChiefBriefing({ tasks: d.tasks || [], reminders: d.reminders || [], calendar: d.calendar || [], leads: d.leads || [], people: d.world?.entities || [] }, Date.now())); } catch { /* ignore */ }
      try { streak = currentStreak(); } catch { /* ignore */ }
      try { recap = currentRecap().line; } catch { /* ignore */ }
    }
    return (
      <div className="convo">
        <div className="empty">
          {t("empty.greeting", lang)}
          <br />
          {t("empty.prompt", lang)}
          {proactive && (
            <div className="journal-card" style={{ marginTop: 14, padding: "10px 12px", textAlign: "left", borderLeft: "3px solid var(--cyan)" }}>
              <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>🧭 {proactive}</span>
            </div>
          )}
          {/* Pozycjonowanie: JEDNA idea — AI, które Cię zna, pamięta i działa. Trzy filary. */}
          {!needsSetup && (onMemory || onBoss || onVoice) && (
            <div className="pillars">
              <div className="pillars-tag">Jedno AI, które Cię zna, pamięta Twoje życie i działa za Ciebie.</div>
              <div className="pillars-row">
                {onBoss && (
                  <button className="pillar" onClick={onBoss}>
                    <span className="pillar-ico">⬢</span><b>Działa</b><small>agent: zrób za mnie</small>
                  </button>
                )}
                {onMemory && (
                  <button className="pillar" onClick={onMemory}>
                    <span className="pillar-ico">🧠</span><b>Pamięta</b><small>zna Twoje życie</small>
                  </button>
                )}
                {onVoice && (
                  <button className="pillar" onClick={onVoice}>
                    <span className="pillar-ico">🎙</span><b>Rozmawia</b><small>naturalnie, głosem</small>
                  </button>
                )}
              </div>
            </div>
          )}
          {needsSetup ? (
            <div style={{ marginTop: 16 }}>
              <p className="notice" style={{ marginBottom: 10 }}>{t("empty.needsSetup", lang)}</p>
              <button className="btn primary" style={{ width: "auto" }} onClick={() => onOpenKeys?.()}>{t("empty.addKey", lang)}</button>
            </div>
          ) : (
            <div className="chips" style={{ justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
              {suggestions.map((sg) => (
                <button key={sg} className="chip" onClick={() => onSuggest(sg)}>
                  {sg}
                </button>
              ))}
            </div>
          )}
          <p className="muted" style={{ marginTop: 18, fontSize: 13, lineHeight: 1.6 }}>
            {t("empty.hint", lang)}
          </p>
          {/* Nawyk: seria dni + dowód, że inwestycja procentuje. */}
          {(streak >= 2 || recap) && (
            <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--text-dim)" }}>
              {streak >= 2 && <b style={{ color: "var(--gold)" }}>🔥 {streak} dni z rzędu</b>}
              {streak >= 2 && recap ? " · " : ""}
              {recap}
            </p>
          )}
          {/* Przewagi nad ChatGPT/Gemini — widoczne od pierwszej sekundy (research: ludzie nie wiedzą, że to mają). */}
          <p style={{ marginTop: 14, fontSize: 12, letterSpacing: 0.3, color: "var(--cyan-dim)", opacity: 0.85 }}>
            {t("edge.badges", lang)}
          </p>
        </div>
        <div ref={endRef} />
      </div>
    );
  }

  return (
    <div className="convo" ref={scrollRef} onScroll={onScroll}>
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          m={m}
          isLive={m.id === liveId}
          isLastAssistant={m.id === lastAssistantId}
          onRetry={onRetry}
        />
      ))}
      {interim && <div className="bubble user">{interim}</div>}
      {thinking && !interim && (
        <div className="bubble assistant typing" aria-label="JARVIS pisze">
          <span className="typing-dots"><i /><i /><i /></span>
        </div>
      )}
      <div ref={endRef} />
      {showJump && (
        <button
          className="btn"
          onClick={jumpToLatest}
          style={{ position: "sticky", bottom: 8, alignSelf: "center", width: "auto", padding: "6px 14px", fontSize: 13, borderRadius: 999, boxShadow: "0 2px 10px rgba(0,0,0,.3)" }}
          aria-label="Przewiń do najnowszej wiadomości"
        >
          ↓ Najnowsze
        </button>
      )}
    </div>
  );
}
