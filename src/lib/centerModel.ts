// === Model Centrum wg CELÓW (centerModel) — czysty, testowalny ===
// Użytkownik ma widzieć SZEŚĆ celów, nie kilkadziesiąt modułów. Ten model definiuje 6 głównych wejść
// oraz pełną taksonomię „Wszystkie funkcje" (grupy id-ków). Komponent More renderuje ten model —
// dzięki temu testem pilnujemy, że każde stare id pozostaje osiągalne i nie ma duplikatów. S9-safe.

export interface CenterGoal {
  id: string;
  icon: string;
  label: string;
  desc: string;
  /** Ekran otwierany po kliknięciu celu (id z taksonomii). */
  opens: string;
}

// SZEŚĆ celów — jednoznaczne przeznaczenie, zero nakładania się.
export const CENTER_GOALS: CenterGoal[] = [
  { id: "today", icon: "📅", label: "Dziś", desc: "Co dziś najbardziej ruszy biznes", opens: "growthDay" },
  { id: "clients", icon: "🧲", label: "Klienci", desc: "Kandydaci, kontakt, CRM, sprzedaż", opens: "sales" },
  { id: "work", icon: "✅", label: "Praca", desc: "Zadania, projekty, dziennik", opens: "tasks" },
  { id: "marketing", icon: "📣", label: "Marketing", desc: "Treści, reklamy, marka, strony", opens: "content" },
  { id: "finance", icon: "💰", label: "Finanse", desc: "Projekty, zysk, koszty, zarabianie", opens: "finance" },
  { id: "jarvis", icon: "🧠", label: "JARVIS", desc: "Umysł, cele, sterowanie głosem", opens: "mind" },
];

// „Wszystkie funkcje" — pełna taksonomia (grupy). KAŻDE id pojawia się DOKŁADNIE raz (bez duplikatów).
// „Dane" → „Moje dane i kopie"; „Pomoc i FAQ" scalone; Status/Diagnoza/dziennik = jeden obszar systemowy.
export const CENTER_GROUPS: { title: string; ids: string[] }[] = [
  { title: "📈 Sprzedaż i biznes", ids: ["growthDay", "candidates", "sales", "finance", "mail", "sent", "money"] },
  { title: "📣 Marketing", ids: ["content", "ads", "brand", "web"] },
  { title: "✅ Praca i organizacja", ids: ["tasks", "projects", "journal", "cards"] },
  { title: "🛒 Zakupy i okazje", ids: ["bargain", "wheretobuy", "shoppinglist"] },
  { title: "🎙 Narzędzia AI", ids: ["translator", "transcribe", "hud", "screen", "studio"] },
  { title: "🧠 Ja i pamięć", ids: ["mind", "profile", "memory"] },
  { title: "⬢ Szef i sterowanie", ids: ["boss", "command", "recall", "goal", "goalStatus"] },
  { title: "⚙️ System, dane i pomoc", ids: ["notifications", "status", "guardian", "history", "data", "audit", "costs", "gadgets", "helpfaq", "admin"] },
];

/** Pure: wszystkie id z taksonomii (kolejność zachowana). */
export function allCenterIds(): string[] {
  return CENTER_GROUPS.flatMap((g) => g.ids);
}

/** Pure: id występujące w więcej niż jednej grupie (powinno być puste — brak zduplikowanych wejść). */
export function duplicateCenterIds(): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of allCenterIds()) { if (seen.has(id)) dup.add(id); else seen.add(id); }
  return [...dup];
}

/** Pure: które z podanych id NIE są osiągalne w żadnej grupie (powinno być puste). */
export function unreachableCenterIds(required: string[]): string[] {
  const have = new Set(allCenterIds());
  return required.filter((id) => !have.has(id));
}
