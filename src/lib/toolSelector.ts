// === Dobór narzędzi wg intencji (mniej definicji na turę = szybciej, taniej, trafniej) ===
// Zamiast wysyłać do modelu wszystkie ~88 narzędzia w KAŻDEJ turze, wybieramy mały zestaw:
// rdzeń + grupy domenowe i trafne definicje dynamiczne, ze wspólnym limitem schematów.
// Nazwy i opisy są danymi do rankingu, nigdy źródłem uprawnień ani instrukcji.

import type { ToolDef } from "./tools";

// Narzędzia ZAWSZE dostępne (nawigacja + uniwersalne) — niezależnie od intencji.
const CORE_TOOLS = new Set<string>([
  "open_screen", "project_knowledge", "calculate", "daily_briefing", "chief_of_staff", "web_research", "skill_search", "skill_manage", "skill_run",
]);

// Grupy domenowe: nazwy narzędzi.
const GROUP_TOOLS: Record<string, string[]> = {
  skills: ["skill_search", "skill_manage", "skill_run"],
  sales: ["find_leads", "list_leads", "save_lead", "lead_dossier", "lead_followup", "sales_autopilot", "sales_plan",
    "salesos_open", "salesos_push", "salesos_email", "salesos_flush_emails", "salesos_set_status", "salesos_stats", "salesos_sync",
    "business_status", "business_next_step"],
  finance: ["finance_add_project", "finance_set_status", "finance_summary"],
  mail: ["gmail_search", "gmail_read", "gmail_reply", "gmail_send", "send_offers_all", "send_test_email"],
  calendar: ["gcal_list", "gcal_day", "gcal_add", "add_calendar_event", "list_calendar"],
  memory: ["remember_fact", "forget_fact", "world_recall", "reflect"],
  productivity: ["add_task", "complete_task", "list_tasks", "add_note", "list_notes", "add_reminder",
    "add_shopping_item", "list_shopping", "add_journal_entry", "add_tally_item", "tally_report", "clear_tally",
    "create_flashcards", "set_timer"],
  device: ["make_call", "send_sms", "call_contact", "text_contact", "smart_home", "run_scene", "create_scene",
    "list_scenes", "navigate_to", "open_service", "open_url", "run_automation"],
  desktop: ["desktop_launch_app", "desktop_open", "desktop_power", "desktop_volume", "desktop_media", "desktop_active_window", "desktop_list_windows", "desktop_focus_window", "desktop_clipboard_read", "desktop_click", "desktop_type", "desktop_hotkey"],
  monitoring: ["monitor_create", "monitor_status", "monitor_control"],
  files: ["system_workspace_status", "system_files_list", "system_files_read", "system_files_write", "system_browser_read_public", "system_browser_open", "browser_session"],
  android: ["android_type", "android_tap", "android_global", "android_open_app", "android_open_settings"],
  info: ["get_weather", "get_news", "get_markets"],
  system: ["set_mode", "set_preference", "set_theme", "set_voice", "switch_ai", "lock_assistant", "suggest_ai", "system_health", "self_check",
    "backup_data", "predictions", "deep_solve"],
};

// Słowa-wyzwalacze (PL) → grupa. Proste includes na małych literach (S9-safe).
const GROUP_KEYWORDS: Record<string, string[]> = {
  skills: ["skill", "umiejętno", "umiejetno", "adapter", "plugin", "nieznany format", "konwerter"],
  sales: ["lead", "leady", "klient", "klienci", "sprzedaż", "sprzedaz", "crm", "oferta", "oferty", "pulpit", "follow", "teczka", "sales os", "salesos"],
  finance: ["finans", "przychód", "przychod", "zysk", "marża", "marza", "faktur", "projekt finans", "zarobi", "kasa", "wpłat", "wplat", "opłac", "oplac", "pieniądz", "pieniadz", "kpi", "lejek", "płatnoś", "platnos"],
  mail: ["mail", "e-mail", "email", "poczta", "wyślij maila", "wyslij maila", "gmail", "wiadomość mailo", "wiadomosc mailo"],
  calendar: ["kalendarz", "spotkani", "termin", "wydarzeni", "umów", "umow", "rezerwacj"],
  memory: ["zapamiętaj", "zapamietaj", "pamięć", "pamiec", "zapomnij", "wiem o", "co wiesz", "fakt o"],
  productivity: ["zadani", "todo", "notat", "przypomnij", "przypomnien", "lista zakup", "zakupy", "dziennik", "fiszk", "minutnik", "stoper", "timer", "licznik"],
  device: ["zadzwoń", "zadzwon", "dzwoń", "dzwon", "sms", "nawiguj", "trasa", "dojazd", "scena", "dom", "światło", "swiatlo", "automatyzacj", "otwórz aplikacj", "otworz aplikacj"],
  desktop: ["komputer", "pulpit windows", "desktop", "głośność", "glosnosc", "uruchom program", "uruchom aplik", "wciśnij", "wcisnij", "kliknij", "myszk", "na ekranie", "okno", "okna", "fokus", "schow", "zaznacz", "skopiuj", "wklej", "edytor"],
  monitoring: ["monitor", "obserw", "co godzin", "co minut", "aż się", "az sie", "gdy pojawi", "śledź", "sledz", "czuwaj", "harmonogram"],
  files: ["plik", "katalog", "folder", "zapisz", "odczytaj", "csv", "json", "pdf", "arkusz", "stron", "przegląd", "przeglad"],
  android: ["telefon", "kliknij w", "wpisz na ekran", "ustawienia androida", "dostępnoś", "dostepnos"],
  info: ["pogoda", "wiadomości", "wiadomosci", "newsy", "kurs", "giełda", "gielda", "krypto", "bitcoin", "akcje"],
  system: ["motyw", "ustaw tryb", "przełącz ai", "przelacz ai", "głos jarvisa", "glos jarvisa", "kopia", "backup", "diagnoza", "stan systemu", "preferencj", "stały umysł", "staly umysl", "stały głos", "staly glos", "nie zmieniaj głosu", "nie zmieniaj glosu", "stały model", "staly model", "zablokuj mózg", "zablokuj mozg", "stały mózg", "staly mozg", "który ai", "ktory ai", "który model", "ktory model", "najlepszy ai", "co polecasz", "jaki mózg", "jaki mozg", "mądrzejszy", "madrzejszy"],
};

/** Pure: zbiór grup pasujących do zapytania (po słowach-wyzwalaczach). */
export function matchedGroups(query: string): string[] {
  const q = (query || "").toLowerCase();
  if (!q.trim()) return [];
  const out: string[] = [];
  for (const [group, words] of Object.entries(GROUP_KEYWORDS)) {
    if (words.some((w) => q.includes(w))) out.push(group);
  }
  return out;
}

function words(value: string): string[] {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l")
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
}

/** Lexical relevance is only a retrieval hint; it is not an LLM capability test. */
function relevance(query: string, definition: ToolDef): number {
  const tokens = new Set(words(`${definition.name} ${definition.description}`));
  return [...new Set(words(query))].reduce((score, term) => score + ([...tokens].some((token) => token === term || (Math.min(token.length, term.length) >= 5 && token.slice(0, 5) === term.slice(0, 5))) ? 1 : 0), 0);
}

/**
 * Pure: wybierz narzędzia do wysłania modelowi dla danego zapytania.
 * Limit dotyczy również nieznanych/pluginowych narzędzi. Niepełny wybór nie upoważnia
 * adaptera do wykonania narzędzia spoza zestawu. Nie obcinamy definicji JSON w połowie.
 */
export function selectToolsForIntent(query: string, defs: ToolDef[], limits: { maxTools?: number; maxChars?: number } = {}): ToolDef[] {
  const groups = matchedGroups(query);
  const allowed = new Set<string>();
  for (const g of groups) for (const name of GROUP_TOOLS[g] || []) allowed.add(name);
  const maxTools = Math.max(0, Math.min(32, limits.maxTools ?? 24));
  const maxChars = Math.max(0, Math.min(32_000, limits.maxChars ?? 10_000));
  const ranked = defs.map((def, index) => ({ def, index, score: relevance(query, def) * 4 + (allowed.has(def.name) ? 12 : 0) + (CORE_TOOLS.has(def.name) ? 8 : 0) }))
    .filter(({ def, score }) => score > 0 && (query.trim() || !def.name.startsWith("skill_"))).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: ToolDef[] = [];
  let chars = 0;
  for (const { def } of ranked) {
    const size = JSON.stringify(def).length;
    if (selected.length >= maxTools) break;
    if (chars + size > maxChars) continue;
    selected.push(def); chars += size;
  }
  return selected;
}

/** Pure: zmierz koszt zestawu narzędzi (liczba + przybliżona długość schematów). */
export function toolsetSize(defs: ToolDef[]): { count: number; chars: number } {
  let chars = 0;
  for (const d of defs) chars += JSON.stringify(d).length;
  return { count: defs.length, chars };
}

/** Wyłącznie jednoznaczne powitanie: brak akcji i potrzeby narzędzi w tej turze. */
export function isToolFreeGreeting(query: string): boolean {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l")
    .replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:czesc|hej|witaj|dzien dobry)(?: jarvis)?(?: przedstaw (?:swoje|twoje) mozliwosci)?$/.test(q);
}
