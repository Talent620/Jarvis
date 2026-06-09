export default function More({
  onProjects,
  onHistory,
  onData,
  onGadgets,
  onHud,
  onStudio,
  onHelp,
  onClose,
}: {
  onProjects: () => void;
  onHistory: () => void;
  onData: () => void;
  onGadgets: () => void;
  onHud: () => void;
  onStudio: () => void;
  onHelp: () => void;
  onClose: () => void;
}) {
  const items = [
    { icon: "👁", label: "Wizja HUD (kamera) — co widzisz?", fn: onHud },
    { icon: "🎨", label: "Studio Obrazów — generuj/edytuj", fn: onStudio },
    { icon: "📁", label: "Projekty / dokumenty", fn: onProjects },
    { icon: "🕘", label: "Historia rozmów", fn: onHistory },
    { icon: "▣", label: "Dane (zadania, targ, audyt…)", fn: onData },
    { icon: "🧰", label: "Gadżety (latarka, kompas, QR…)", fn: onGadgets },
    { icon: "❓", label: "Pomoc — jak korzystać", fn: onHelp },
  ];
  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>Menu</h2>
        </div>
        <div className="panel-body">
          {items.map((it) => (
            <div
              key={it.label}
              className="list-item"
              style={{ cursor: "pointer", fontSize: 16, padding: "14px 0" }}
              onClick={() => {
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
