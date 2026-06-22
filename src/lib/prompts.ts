// === Biblioteka promptów / szybkie startery (jak ChatGPT/LibreChat) ===
// Gotowe, kompletne polecenia do jednego tknięcia z ⌘K — od razu ruszają z robotą.
export interface Preset { id: string; title: string; icon: string; kw: string; text: string }

export const PRESETS: Preset[] = [
  { id: "p_brief", title: "Odprawa dnia — co dziś najważniejsze?", icon: "🌅", kw: "odprawa dzien plan priorytet poranek",
    text: "Zrób mi krótką odprawę dnia: co dziś najważniejsze, co zaległe, na czym się skupić. Zwięźle, po polsku." },
  { id: "p_tasks", title: "Uporządkuj moje zadania", icon: "✅", kw: "zadania kolejnosc priorytet gtd uporzadkuj",
    text: "Spójrz na moje zadania i zaproponuj najlepszą kolejność na dziś z krótkim uzasadnieniem." },
  { id: "p_earn", title: "3 sposoby, żebym dziś zarobił", icon: "💡", kw: "zarobek pieniadze pomysl dochod biznes",
    text: "Zaproponuj 3 konkretne, wykonalne dziś sposoby, żebym zarobił — dopasowane do tego, co o mnie wiesz." },
  { id: "p_mail", title: "Napisz profesjonalnego maila", icon: "📧", kw: "mail email pismo oferta napisz",
    text: "Pomóż mi napisać profesjonalnego maila. Najpierw dopytaj o adresata, cel i ton, potem przygotuj treść." },
  { id: "p_learn", title: "Naucz mnie czegoś w 10 minut", icon: "🧠", kw: "nauka ucz wiedza mikro lekcja",
    text: "Zaproponuj jedną wartościową rzecz do nauczenia się dziś w 10 minut i przeprowadź mnie przez nią krok po kroku." },
  { id: "p_research", title: "Research tematu ze źródłami", icon: "🔎", kw: "research badanie zrodla szukaj analiza",
    text: "Zrób dokładny research tematu, który podam, i podaj wnioski ze źródłami [1][2]. Zacznij od dopytania o temat." },
  { id: "p_social", title: "Pomysł na post na social media", icon: "📱", kw: "social media post content marketing tresc",
    text: "Zaproponuj angażujący post na social media o mojej branży, z hakiem na początku i wezwaniem do działania." },
];
