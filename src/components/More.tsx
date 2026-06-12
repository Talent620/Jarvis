import { useMemo } from "react";
import { useEscape } from "../hooks/useEscape";
import { adaptiveOrder, track, shouldAnnounceAdapt } from "../lib/usage";
import { toast } from "../lib/toast";
import { store } from "../lib/store";

export default function More({
  onProjects,
  onJournal,
  onMoney,
  onSales,
  onHistory,
  onData,
  onGadgets,
  onHud,
  onStudio,
  onWeb,
  onScreen,
  onHelp,
  onAdmin,
  onCards,
  onTranscribe,
  onProfile,
  onClose,
}: {
  onProjects: () => void;
  onJournal: () => void;
  onMoney: () => void;
  onSales: () => void;
  onHistory: () => void;
  onData: () => void;
  onGadgets: () => void;
  onHud: () => void;
  onStudio: () => void;
  onWeb: () => void;
  onScreen?: () => void;
  onHelp: () => void;
  onAdmin: () => void;
  onCards: () => void;
  onTranscribe: () => void;
  onProfile: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const items = [
    { id: "profile", icon: "👤", label: "Mój profil — kim jestem (pamięć)", fn: onProfile },
    { id: "money", icon: "💰", label: "Zarabianie — autopilot dochodu", fn: onMoney },
    { id: "journal", icon: "📔", label: "Mój dziennik (przemyślenia)", fn: onJournal },
    { id: "cards", icon: "🧠", label: "Kapsuły Wiedzy — ucz się i pamiętaj", fn: onCards },
    { id: "transcribe", icon: "🎙", label: "Transkrypcja spotkań (mowa→tekst)", fn: onTranscribe },
    { id: "sales", icon: "📈", label: "Pulpit Sprzedaży (leady, CRM)", fn: onSales },
    { id: "web", icon: "🌐", label: "Kreator stron — zbuduj witrynę", fn: onWeb },
    { id: "hud", icon: "👁", label: "Wizja HUD (kamera) — co widzisz?", fn: onHud },
    ...(onScreen ? [{ id: "screen", icon: "🖥️", label: "Spójrz na mój ekran (analiza)", fn: onScreen }] : []),
    { id: "studio", icon: "🎨", label: "Studio Obrazów — generuj/edytuj", fn: onStudio },
    { id: "projects", icon: "📁", label: "Projekty / dokumenty", fn: onProjects },
    { id: "history", icon: "🕘", label: "Historia rozmów", fn: onHistory },
    { id: "data", icon: "▣", label: "Dane (zadania, targ, audyt…)", fn: onData },
    { id: "gadgets", icon: "🧰", label: "Gadżety (latarka, kompas, QR…)", fn: onGadgets },
    { id: "help", icon: "❓", label: "Pomoc — jak korzystać", fn: onHelp },
    { id: "admin", icon: "🔐", label: "Panel administratora (licencje)", fn: onAdmin },
  ];

  // Adaptive UI: po tygodniu danych menu układa się wg nawyków (pora dnia).
  const ordered = useMemo(() => {
    if (store.settings.adaptiveUi === false) return items;
    const order = adaptiveOrder(items.map((i) => i.id));
    if (!order) return items;
    if (shouldAnnounceAdapt()) {
      toast("Dostosowałem układ menu do Twoich nawyków ✓", {
        label: "Cofnij",
        onClick: () => store.setSettings({ adaptiveUi: false }),
      });
    }
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...items].sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>Menu</h2>
        </div>
        <div className="panel-body">
          {ordered.map((it) => (
            <div
              key={it.id}
              className="list-item"
              style={{ cursor: "pointer", fontSize: 16, padding: "14px 0" }}
              onClick={() => {
                track(it.id);
                onClose();
                it.fn();
              }}
            >
              <span style={{ width: 28, fontSize: 18 }}>{it.icon}</span>
              <span>{it.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
