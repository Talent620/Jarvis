// === Dobór narzędzi wg intencji (mniej definicji na turę = szybciej, taniej, trafniej) ===
// Zamiast wysyłać do modelu wszystkie ~88 narzędzia w KAŻDEJ turze, wybieramy mały zestaw:
// rdzeń (zawsze) + grupy domenowe pasujące do zapytania + WSZYSTKIE narzędzia dynamiczne
// (MCP/pluginy). BEZPIECZNIE: gdy intencja niejasna (brak trafienia) — zwracamy PEŁNY zestaw,
// więc nigdy nie jest gorzej niż dziś. S9-safe (bez regex /u, proste includes).

import type { ToolDef } from "./tools";

// Narzędzia ZAWSZE dostępne (nawigacja + uniwersalne) — niezależnie od intencji.
const CORE_TOOLS = new Set<string>([
  "open_screen", "project_knowledge", "calculate", "daily_briefing", "chief_of_staff", "web_research",
]);

// Grupy domenowe: nazwy narzędzi.
const GROUP_TOOLS: Record<string, string[]> = {
  sales: ["find_leads", "list_leads", "save_lead", "lead_dossier", "lead_followup", "sales_autopilot", "sales_plan",
    "salesos_open", "salesos_push", "salesos_email", "salesos_flush_emails", "salesos_set_status", "salesos_stats", "salesos_sync"],
  finance: ["finance_add_project", "finance_set_status", "finance_summary"],
  mail: ["gmail_search", "gmail_read", "gmail_reply", "gmail_send", "send_offers_all", "send_test_email"],
  calendar: ["gcal_list", "gcal_day", "gcal_add", "add_calendar_event", "list_calendar"],
  memory: ["remember_fact", "forget_fact", "world_recall", "reflect"],
  productivity: ["add_task", "complete_task", "list_tasks", "add_note", "list_notes", "add_reminder",
    "add_shopping_item", "list_shopping", "add_journal_entry", "add_tally_item", "tally_report", "clear_tally",
    "create_flashcards", "set_timer"],
  device: ["make_call", "send_sms", "call_contact", "text_contact", "smart_home", "run_scene", "create_scene",
    "list_scenes", "navigate_to", "open_service", "open_url", "run_automation"],
  desktop: ["desktop_launch_app", "desktop_open", "desktop_power", "desktop_volume", "desktop_media", "desktop_type", "desktop_hotkey"],
  android: ["android_type", "android_tap", "android_global", "android_open_app", "android_open_settings"],
  info: ["get_weather", "get_news", "get_markets"],
  system: ["set_mode", "set_preference", "set_theme", "set_voice", "switch_ai", "system_health", "self_check",
    "backup_data", "predictions", "deep_solve"],
};

// Słowa-wyzwalacze (PL) → grupa. Proste includes na małych literach (S9-safe).
const GROUP_KEYWORDS: Record<string, string[]> = {
  sales: ["lead", "leady", "klient", "klienci", "sprzedaż", "sprzedaz", "crm", "oferta", "oferty", "pulpit", "follow", "teczka", "sales os", "salesos"],
  finance: ["finans", "przychód", "przychod", "zysk", "marża", "marza", "faktur", "projekt finans", "zarobi", "kasa", "wpłat", "wplat", "opłac", "oplac", "pieniądz", "pieniadz", "kpi", "lejek", "płatnoś", "platnos"],
  mail: ["mail", "e-mail", "email", "poczta", "wyślij maila", "wyslij maila", "gmail", "wiadomość mailo", "wiadomosc mailo"],
  calendar: ["kalendarz", "spotkani", "termin", "wydarzeni", "umów", "umow", "rezerwacj"],
  memory: ["zapamiętaj", "zapamietaj", "pamięć", "pamiec", "zapomnij", "wiem o", "co wiesz", "fakt o"],
  productivity: ["zadani", "todo", "notat", "przypomnij", "przypomnien", "lista zakup", "zakupy", "dziennik", "fiszk", "minutnik", "stoper", "timer", "licznik"],
  device: ["zadzwoń", "zadzwon", "dzwoń", "dzwon", "sms", "nawiguj", "trasa", "dojazd", "scena", "dom", "światło", "swiatlo", "automatyzacj", "otwórz aplikacj", "otworz aplikacj"],
  desktop: ["komputer", "pulpit windows", "desktop", "głośność", "glosnosc", "uruchom program", "wciśnij", "wcisnij"],
  android: ["telefon", "kliknij w", "wpisz na ekran", "ustawienia androida", "dostępnoś", "dostepnos"],
  info: ["pogoda", "wiadomości", "wiadomosci", "newsy", "kurs", "giełda", "gielda", "krypto", "bitcoin", "akcje"],
  system: ["motyw", "ustaw tryb", "przełącz ai", "przelacz ai", "głos jarvisa", "glos jarvisa", "kopia", "backup", "diagnoza", "stan systemu", "preferencj"],
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

const KNOWN_TOOLS = new Set<string>(Object.values(GROUP_TOOLS).flat());

/**
 * Pure: wybierz narzędzia do wysłania modelowi dla danego zapytania.
 * - brak trafionej grupy → ZWRÓĆ WSZYSTKO (bezpieczny fallback, nigdy nie gorzej niż dziś);
 * - trafione grupy → rdzeń + narzędzia tych grup + WSZYSTKIE nieznane (MCP/pluginy).
 */
export function selectToolsForIntent(query: string, defs: ToolDef[]): ToolDef[] {
  const groups = matchedGroups(query);
  if (groups.length === 0) return defs; // niejasna intencja — pełny zestaw
  const allowed = new Set<string>(CORE_TOOLS);
  for (const g of groups) for (const name of GROUP_TOOLS[g] || []) allowed.add(name);
  // Narzędzia dynamiczne (pluginy/MCP) nie są w żadnej grupie — zawsze je zostawiamy.
  return defs.filter((d) => allowed.has(d.name) || !KNOWN_TOOLS.has(d.name));
}

/** Pure: zmierz koszt zestawu narzędzi (liczba + przybliżona długość schematów). */
export function toolsetSize(defs: ToolDef[]): { count: number; chars: number } {
  let chars = 0;
  for (const d of defs) chars += JSON.stringify(d).length;
  return { count: defs.length, chars };
}
