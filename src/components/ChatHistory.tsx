import { useState } from "react";
import { loadChats, saveChats, type ChatSession } from "../lib/chats";

export default function ChatHistory({
  activeId,
  onOpen,
  onClose,
}: {
  activeId: string;
  onOpen: (s: ChatSession) => void;
  onClose: () => void;
}) {
  const [chats, setChats] = useState<ChatSession[]>(() => loadChats());

  const remove = (id: string) => {
    const next = chats.filter((c) => c.id !== id);
    saveChats(next);
    setChats(next);
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🕘 Historia rozmów</h2>
        </div>
        <div className="panel-body">
          {chats.length ? (
            chats.map((c) => (
              <div key={c.id} className={`list-item ${c.id === activeId ? "done" : ""}`}>
                <span style={{ cursor: "pointer", flex: 1 }} onClick={() => onOpen(c)}>
                  💬 {c.title}
                  <br />
                  <span className="muted">
                    {new Date(c.updatedAt).toLocaleString("pl-PL")} · {c.messages.length} wiad.
                    {c.id === activeId ? " · aktywna" : ""}
                  </span>
                </span>
                <span className="x" onClick={() => remove(c.id)}>
                  ✕
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Brak zapisanych rozmów.</p>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
