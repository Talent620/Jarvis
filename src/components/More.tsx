import { useMemo, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { adaptiveOrder, track, shouldAnnounceAdapt } from "../lib/usage";
import { toast } from "../lib/toast";
import { store } from "../lib/store";
import { nextBestAction } from "../lib/livingPulse";
import { requestScreen } from "../lib/navIntent";

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
  onBoss,
  onRecall,
  onMind,
  onGoal,
  onGrowthDay,
  onCandidates,
  onCommand,
  onStudio,
  onWeb,
  onScreen,
  onHelp,
  onAdmin,
  onCards,
  onTranscribe,
  onProfile,
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
  onBrand,
  onMail,
  onFinance,
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
  onBoss: () => void;
  onRecall: () => void;
  onMind: () => void;
  onGoal: () => void;
  onGrowthDay: () => void;
  onCandidates: () => void;
  onCommand: () => void;
  onStudio: () => void;
  onWeb: () => void;
  onScreen?: () => void;
  onHelp: () => void;
  onAdmin: () => void;
  onCards: () => void;
  onTranscribe: () => void;
  onProfile: () => void;
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
  onBrand: () => void;
  onMail: () => void;
  onFinance: () => void;
  onFaq: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [query, setQuery] = useState("");

  // Każda funkcja: krótka NAZWA (na kafelku) + OPIS (podtytuł kafelka i pole wyszukiwania).
  const items = [
    { id: "boss", icon: "⬢", name: "Szef", desc: "Agent głosowy: zrób za mnie, napraw, doradź", fn: onBoss },
    { id: "command", icon: "⌘", name: "Polecenia", desc: "Znajdź/otwórz wszystko (⌘K)", fn: onCommand },
    { id: "recall", icon: "🔎", name: "Recall", desc: "Znajdź wszystko u siebie (czaty, dziennik, pamięć…)", fn: onRecall },
    { id: "guardian", icon: "🩺", name: "Diagnoza", desc: "Diagnoza i naprawa (dawny Strażnik)", fn: onGuardian },
    { id: "mind", icon: "🧠", name: "Umysł", desc: "Odprawa, Twój świat, wzorce, samoocena", fn: onMind },
    { id: "goal", icon: "🎯", name: "Zleć cel", desc: "Rozłóż na kroki i zrób za mnie (do-for-me)", fn: onGoal },
    { id: "growthDay", icon: "📅", name: "Plan dnia", desc: "Co dziś najbardziej ruszy biznes (3 działania)", fn: onGrowthDay },
    { id: "candidates", icon: "🧲", name: "Kandydaci leadów", desc: "Szukaj firm — importuj tylko wybrane (bez zaśmiecania CRM)", fn: onCandidates },
    { id: "notifications", icon: "🔔", name: "Powiadomienia", desc: "Co wymaga uwagi", fn: onNotifications },
    { id: "status", icon: "🟢", name: "Stan systemu", desc: "Co działa (zielone/czerwone)", fn: onStatus },
    { id: "profile", icon: "👤", name: "Mój profil", desc: "Kim jestem (pamięć)", fn: onProfile },
    { id: "memory", icon: "🗃", name: "Pamięć o mnie", desc: "Co JARVIS o mnie wie (edytuj/usuń)", fn: onMemory },
    { id: "audit", icon: "📜", name: "Dziennik działań", desc: "Co przeszło przez program", fn: onAudit },
    { id: "costs", icon: "💸", name: "Koszty AI", desc: "Zużycie, prognoza, budżet", fn: onCosts },
    { id: "tasks", icon: "✅", name: "Zadania Pro", desc: "Projekty, priorytety (GTD)", fn: onTasks },
    { id: "bargain", icon: "🏷", name: "Łowca Okazji", desc: "Znajdź najtaniej (nowe/używane)", fn: onBargain },
    { id: "wheretobuy", icon: "📍", name: "Gdzie kupię", desc: "W pobliżu — najbliżej / taniej dalej", fn: onWhereToBuy },
    { id: "shoppinglist", icon: "🛒", name: "Lista zakupów", desc: "Kup wszystko najtaniej", fn: onShoppingList },
    { id: "money", icon: "💰", name: "Zarabianie", desc: "Autopilot dochodu", fn: onMoney },
    { id: "journal", icon: "📔", name: "Dziennik", desc: "Moje przemyślenia", fn: onJournal },
    { id: "cards", icon: "🎴", name: "Kapsuły Wiedzy", desc: "Ucz się i pamiętaj", fn: onCards },
    { id: "translator", icon: "🌍", name: "Tłumacz", desc: "Na żywo (rozmowa 2 języki)", fn: onTranslator },
    { id: "transcribe", icon: "🎙", name: "Transkrypcja", desc: "Spotkań (mowa→tekst)", fn: onTranscribe },
    { id: "sales", icon: "📈", name: "Sprzedaż", desc: "Pulpit Sprzedaży (leady, CRM)", fn: onSales },
    { id: "content", icon: "📱", name: "Kontent", desc: "Posty na social media", fn: onContent },
    { id: "ads", icon: "📢", name: "Reklamy", desc: "Google Ads / Facebook / Instagram", fn: onAds },
    { id: "brand", icon: "🎨", name: "Dusza Marki", desc: "Ton, kolory, fonty — spójne strony, treści i obrazy", fn: onBrand },
    { id: "mail", icon: "✉", name: "Wyślij e-mail", desc: "Ręczna wysyłka maila z JARVIS-a (kontrola + AI)", fn: onMail },
    { id: "finance", icon: "💰", name: "Finanse", desc: "Dashboard: projekty, zysk, marża, cash flow, KPI", fn: onFinance },
    { id: "sent", icon: "📤", name: "Wysłane", desc: "Gdzie wysłałem maile", fn: onSent },
    { id: "web", icon: "🌐", name: "Kreator stron", desc: "Zbuduj witrynę", fn: onWeb },
    { id: "hud", icon: "👁", name: "Wizja HUD", desc: "Kamera — co widzisz?", fn: onHud },
    ...(onScreen ? [{ id: "screen", icon: "🖥️", name: "Mój ekran", desc: "Spójrz i przeanalizuj", fn: onScreen }] : []),
    { id: "studio", icon: "🎨", name: "Studio Obrazów", desc: "Generuj/edytuj", fn: onStudio },
    { id: "projects", icon: "📁", name: "Projekty", desc: "Projekty / dokumenty", fn: onProjects },
    { id: "history", icon: "🕘", name: "Historia", desc: "Historia rozmów", fn: onHistory },
    { id: "data", icon: "▣", name: "Dane", desc: "Zadania, targ, audyt…", fn: onData },
    { id: "gadgets", icon: "🧰", name: "Gadżety", desc: "Latarka, kompas, QR…", fn: onGadgets },
    { id: "faq", icon: "❓", name: "FAQ", desc: "Do czego służy każda funkcja", fn: onFaq },
    { id: "help", icon: "📖", name: "Pomoc", desc: "Jak korzystać (szybki start)", fn: onHelp },
    { id: "admin", icon: "🔐", name: "Administrator", desc: "Panel (licencje)", fn: onAdmin },
  ];

  // Funkcje pogrupowane w czytelne sekcje — łatwiej znaleźć, mniej przewijania.
  const GROUPS: { title: string; ids: string[] }[] = [
    { title: "📈 Sprzedaż i biznes", ids: ["growthDay", "candidates", "sales", "finance", "mail", "sent", "content", "ads", "brand", "web", "money"] },
    { title: "✅ Praca i organizacja", ids: ["tasks", "projects", "journal", "cards"] },
    { title: "🛒 Zakupy i okazje", ids: ["bargain", "wheretobuy", "shoppinglist"] },
    { title: "🎙 Narzędzia AI", ids: ["translator", "transcribe", "hud", "screen", "studio"] },
    { title: "🧠 Ja i pamięć", ids: ["mind", "profile", "memory"] },
    { title: "⬢ Szef i sterowanie", ids: ["boss", "command", "recall", "goal"] },
    { title: "⚙️ System i pomoc", ids: ["notifications", "status", "guardian", "history", "data", "audit", "gadgets", "faq", "help", "admin"] },
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

  // Wyszukiwarka: ignoruje wielkość liter i polskie znaki (ł→l, ż→z…), szuka w nazwie i opisie.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // zdejmij znaki diakrytyczne (ą→a, ż→z…)
      .replace(/ł/g, "l"); // ł → l (nie rozkłada się przez NFD)
  const q = norm(query.trim());
  const filtered = q ? items.filter((it) => norm(`${it.name} ${it.desc}`).includes(q)) : null;

  // Sekcje do wyświetlenia. Przy wyszukiwaniu — jedna płaska lista wyników (bez grupowania).
  const sections: { title: string; rows: Item[] }[] = [];
  if (filtered) {
    if (filtered.length) sections.push({ title: `🔎 Wyniki (${filtered.length})`, rows: filtered });
  } else {
    if (shortcuts.length) sections.push({ title: "⭐ Skróty (najczęściej używane)", rows: shortcuts });
    for (const g of GROUPS) {
      const rows = g.ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
      if (rows.length) sections.push({ title: g.title, rows });
    }
  }

  const Tile = (it: Item) => (
    <button
      key={it.id}
      type="button"
      className="menu-tile"
      title={it.desc}
      onClick={() => {
        track(it.id);
        onClose();
        it.fn();
      }}
    >
      <span className="ic" aria-hidden="true">{it.icon}</span>
      <span className="nm">{it.name}</span>
      <span className="ds">{it.desc}</span>
    </button>
  );

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>Centrum</h2>
        </div>
        <div className="panel-body">
          {/* ⚡ Teraz — jedna najlepsza czynność na górze Centrum (ten sam silnik co ekran startowy).
              Tylko gdy nie szukasz; wszystkie kafle/grupy poniżej bez zmian. */}
          {!query.trim() && (() => {
            const a = (() => { try { return nextBestAction(store.data, Date.now()); } catch { return null; } })();
            if (!a) return null;
            return (
              <button
                className="journal-card"
                onClick={() => { requestScreen(a.screen); onClose(); }}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 10, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--gold)", background: "linear-gradient(135deg, rgba(245,200,90,.08), transparent 70%)", cursor: "pointer" }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>⚡ TERAZ</span>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, marginTop: 2 }}>{a.what}</span>
                <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{a.why}</span>
              </button>
            );
          })()}
          <input
            className="menu-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Szukaj funkcji…"
            aria-label="Szukaj funkcji"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered && filtered.length === 0 ? (
            <div className="menu-empty">Brak funkcji dla „{query.trim()}". Spróbuj inaczej.</div>
          ) : (
            sections.map((sec) => (
              <div key={sec.title}>
                <h3 className="menu-sec">{sec.title}</h3>
                <div className="menu-grid">{sec.rows.map(Tile)}</div>
              </div>
            ))
          )}
        </div>
        <div className="panel-foot">
          <button className="btn" onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
