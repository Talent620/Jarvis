import { BookOpen, FolderOpen, LayoutGrid, ListTodo, MessageCircle, Settings2, Target, History, Search, Server } from "lucide-react";

const PRIMARY = [
  { id: null, label: "Rozmowa", icon: MessageCircle },
  { id: "goalStatus", label: "Kolejka zadań", icon: ListTodo },
  { id: "runtime", label: "Analizy w tle", icon: Server },
  { id: "more", label: "Centrum funkcji", icon: LayoutGrid },
];
const WORKSPACE = [
  { id: "tasks", label: "Moja lista", icon: Target },
  { id: "projects", label: "Projekty", icon: FolderOpen },
  { id: "memory", label: "Pamięć", icon: BookOpen },
  { id: "history", label: "Historia rozmów", icon: History },
];

export default function ProNavigation({ screen, onNavigate, onSearch, online, autonomous }: {
  screen: string | null;
  onNavigate: (screen: string | null) => void;
  onSearch: () => void;
  online: boolean;
  autonomous: boolean;
}) {
  return (
    <nav className="pro-nav" aria-label="Główna nawigacja">
      <div className="pro-nav-brand"><span aria-hidden="true">◈</span><div><strong>JARVIS</strong><small>PERSONAL WORKSPACE</small></div></div>
      <button type="button" className="pro-nav-item pro-nav-search" onClick={onSearch}>
        <Search size={18} aria-hidden="true" /><span>Polecenia</span><kbd>Ctrl K</kbd>
      </button>
      <div className="pro-nav-group">
        <p className="pro-nav-heading">Praca</p>
        {PRIMARY.map(({id, label, icon: Icon}) => (
          <button type="button" key={id ?? "conversation"} className={`pro-nav-item${screen === id ? " is-active" : ""}`}
            aria-current={screen === id ? "page" : undefined} onClick={() => onNavigate(id)}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="pro-nav-group pro-nav-secondary">
        <p className="pro-nav-heading">Biblioteka</p>
        {WORKSPACE.map(({id, label, icon: Icon}) => (
          <button type="button" key={id} className={`pro-nav-item${screen === id ? " is-active" : ""}`}
            aria-current={screen === id ? "page" : undefined} onClick={() => onNavigate(id)}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="pro-nav-footer">
        <button type="button" className={`pro-nav-item${screen === "settings" ? " is-active" : ""}`}
          aria-current={screen === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}>
          <Settings2 size={19} aria-hidden="true" /><span>Ustawienia</span>
        </button>
        <div className="pro-nav-status"><span>{online ? "Sieć dostępna" : "Tryb offline"}</span><small>{autonomous ? "Kolejka · auto" : "Kolejka · wstrzymana"}</small></div>
      </div>
    </nav>
  );
}
