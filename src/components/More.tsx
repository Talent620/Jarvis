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
  onGuardian,
  onMind,
  onGoal,
  onCommand,
  onStudio,
  onWeb,
  onScreen,
  onHelp,
  onAdmin,
  onCards,
  onTranscribe,
  onProfile,
  onDayPlan,
  onTasks,
  onTranslator,
  onBargain,
  onWhereToBuy,
  onShoppingList,
  onNotifications,
  onStatus,
  onCosts,
  onMemory,
  onAudit,
  onSent,
  onContent,
  onAds,
  onFaq,
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
  onGuardian: () => void;
  onMind: () => void;
  onGoal: () => void;
  onCommand: () => void;
  onStudio: () => void;
  onWeb: () => void;
  onScreen?: () => void;
  onHelp: () => void;
  onAdmin: () => void;
  onCards: () => void;
  onTranscribe: () => void;
  onProfile: () => void;
  onDayPlan: () => void;
  onTasks: () => void;
  onTranslator: () => void;
  onBargain: () => void;
  onWhereToBuy: () => void;
  onShoppingList: () => void;
  onNotifications: () => void;
  onStatus: () => void;
  onCosts: () => void;
  onMemory: () => void;
  onAudit: () => void;
  onSent: () => void;
  onContent: () => void;
  onAds: () => void;
  onFaq: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const items = [
    { id: "command", icon: "⌘", label: "Szybkie polecenia — znajdź/otwórz wszystko (⌘K)", fn: onCommand },
    { id: "guardian", icon: "🛡", label: "Strażnik JARVISA — napraw, przyspiesz, ulepsz, doradź", fn: onGuardian },
    { id: "mind", icon: "🧠", label: "Umysł JARVISA — odprawa, Twój świat, wzorce, samoocena", fn: onMind },
    { id: "goal", icon: "🎯", label: "Zleć cel — rozłóż na kroki i zrób za mnie (do-for-me)", fn: onGoal },
    { id: "notifications", icon: "🔔", label: "Powiadomienia — co wymaga uwagi", fn: onNotifications },
    { id: "status", icon: "🩺", label: "Stan systemu — co działa (zielone/czerwone)", fn: onStatus },
    { id: "profile", icon: "👤", label: "Mój profil — kim jestem (pamięć)", fn: onProfile },
    { id: "memory", icon: "🧠", label: "Co JARVIS o mnie wie (pamięć — edytuj/usuń)", fn: onMemory },
    { id: "audit", icon: "📜", label: "Dziennik działań — co przeszło przez program", fn: onAudit },
    { id: "costs", icon: "💸", label: "Koszty AI — zużycie, prognoza, budżet", fn: onCosts },
    { id: "tasks", icon: "✅", label: "Zadania Pro — projekty, priorytety (GTD)", fn: onTasks },
    { id: "dayplan", icon: "🗓", label: "Plan Dnia — zadania i notatnik", fn: onDayPlan },
    { id: "bargain", icon: "🏷", label: "Łowca Okazji — znajdź najtaniej (nowe/używane)", fn: onBargain },
    { id: "wheretobuy", icon: "📍", label: "Gdzie kupię w pobliżu (najbliżej / taniej dalej)", fn: onWhereToBuy },
    { id: "shoppinglist", icon: "🛒", label: "Lista zakupów — kup wszystko najtaniej", fn: onShoppingList },
    { id: "money", icon: "💰", label: "Zarabianie — autopilot dochodu", fn: onMoney },
    { id: "journal", icon: "📔", label: "Mój dziennik (przemyślenia)", fn: onJournal },
    { id: "cards", icon: "🧠", label: "Kapsuły Wiedzy — ucz się i pamiętaj", fn: onCards },
    { id: "translator", icon: "🌍", label: "Tłumacz na żywo (rozmowa 2 języki)", fn: onTranslator },
    { id: "transcribe", icon: "🎙", label: "Transkrypcja spotkań (mowa→tekst)", fn: onTranscribe },
    { id: "sales", icon: "📈", label: "Pulpit Sprzedaży (leady, CRM)", fn: onSales },
    { id: "content", icon: "📱", label: "Maszynka do kontentu (posty na social media)", fn: onContent },
    { id: "ads", icon: "📢", label: "Generator reklam (Google Ads / Facebook / Instagram)", fn: onAds },
    { id: "sent", icon: "📤", label: "Skrzynka wysłanych (gdzie wysłałem maile)", fn: onSent },
    { id: "web", icon: "🌐", label: "Kreator stron — zbuduj witrynę", fn: onWeb },
    { id: "hud", icon: "👁", label: "Wizja HUD (kamera) — co widzisz?", fn: onHud },
    ...(onScreen ? [{ id: "screen", icon: "🖥️", label: "Spójrz na mój ekran (analiza)", fn: onScreen }] : []),
    { id: "studio", icon: "🎨", label: "Studio Obrazów — generuj/edytuj", fn: onStudio },
    { id: "projects", icon: "📁", label: "Projekty / dokumenty", fn: onProjects },
    { id: "history", icon: "🕘", label: "Historia rozmów", fn: onHistory },
    { id: "data", icon: "▣", label: "Dane (zadania, targ, audyt…)", fn: onData },
    { id: "gadgets", icon: "🧰", label: "Gadżety (latarka, kompas, QR…)", fn: onGadgets },
    { id: "faq", icon: "❓", label: "FAQ — do czego służy każda funkcja", fn: onFaq },
    { id: "help", icon: "📖", label: "Pomoc — jak korzystać (szybki start)", fn: onHelp },
    { id: "admin", icon: "🔐", label: "Panel administratora (licencje)", fn: onAdmin },
  ];

  // Funkcje pogrupowane w czytelne sekcje — łatwiej znaleźć, mniej przewijania.
  const GROUPS: { title: string; ids: string[] }[] = [
    { title: "📈 Sprzedaż i biznes", ids: ["sales", "sent", "content", "ads", "web", "money"] },
    { title: "✅ Praca i organizacja", ids: ["tasks", "dayplan", "projects", "journal", "cards"] },
    { title: "🛒 Zakupy i okazje", ids: ["bargain", "wheretobuy", "shoppinglist"] },
    { title: "🎙 Narzędzia AI", ids: ["translator", "transcribe", "hud", "screen", "studio"] },
    { title: "🧠 Ja i pamięć", ids: ["mind", "profile", "memory"] },
    { title: "⚙️ System i pomoc", ids: ["command", "notifications", "status", "history", "data", "audit", "gadgets", "faq", "help", "admin"] },
  ];

  type Item = (typeof items)[number];
  const byId = new Map<string, Item>(items.map((i) => [i.id, i]));

  // Adaptive UI: po tygodniu danych „⭐ Skróty" na górze pokazują najczęściej używane
  // funkcje (wg pory dnia) — reszta menu zostaje czytelnie pogrupowana poniżej.
  const shortcuts = useMemo<Item[]>(() => {
    if (store.settings.adaptiveUi === false) return [];
    const order = adaptiveOrder(items.map((i) => i.id));
    if (!order) return [];
    if (shouldAnnounceAdapt()) {
      toast("Dodałem na górze skróty do najczęściej używanych funkcji ✓", {
        label: "Cofnij",
        onClick: () => store.setSettings({ adaptiveUi: false }),
      });
    }
    return order.map((id) => byId.get(id)).filter((x): x is Item => !!x).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections: { title: string; rows: Item[] }[] = [];
  if (shortcuts.length) sections.push({ title: "⭐ Skróty (najczęściej używane)", rows: shortcuts });
  for (const g of GROUPS) {
    const rows = g.ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
    if (rows.length) sections.push({ title: g.title, rows });
  }

  const Row = (it: Item) => (
    <div
      key={it.id}
      className="list-item"
      style={{ cursor: "pointer", fontSize: 16, padding: "13px 0" }}
      onClick={() => {
        track(it.id);
        onClose();
        it.fn();
      }}
    >
      <span style={{ width: 28, fontSize: 18 }}>{it.icon}</span>
      <span>{it.label}</span>
    </div>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>Menu</h2>
        </div>
        <div className="panel-body">
          {sections.map((sec) => (
            <div key={sec.title}>
              <h3 style={{ marginTop: sec === sections[0] ? 4 : 18 }}>{sec.title}</h3>
              {sec.rows.map(Row)}
            </div>
          ))}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
