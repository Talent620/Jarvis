import { store, uid } from "./store";
import type { AuditEntry } from "../types";

// --- Klasyfikacja ryzyka narzędzi ---
export type Risk = "read" | "write" | "outbound";

const RISK: Record<string, Risk> = {
  // read — wykonują się automatycznie
  list_tasks: "read", list_notes: "read", list_shopping: "read", list_calendar: "read",
  list_scenes: "read", get_weather: "read", daily_briefing: "read", web_research: "read",
  gmail_search: "read", gcal_list: "read", tally_report: "read", calculate: "read", find_leads: "read",
  list_leads: "read", get_news: "read", get_markets: "read",
  salesos_sync: "read", salesos_stats: "read",
  // read — tylko pisze gotowy szkic follow-upu (bez wysyłki, bez zapisu w store)
  lead_followup: "read",
  // write — zapisuje teczkę (dossier/intel) w leadzie; AI lokalnie, bez wysyłki na zewnątrz
  lead_dossier: "write",
  // read — tylko czytają/analizują (bez efektów ubocznych)
  gcal_day: "read", gmail_read: "read", chief_of_staff: "read", deep_solve: "read",
  predictions: "read", reflect: "read", sales_plan: "read", self_check: "read",
  system_health: "read", world_recall: "read",
  // read — lokalna nawigacja / odczyt (bez efektów na zewnątrz, bez pytania o zgodę)
  open_screen: "read", project_knowledge: "read", finance_summary: "read",
  business_status: "read", business_next_step: "read", suggest_ai: "read",
  // write — lokalny zapis projektów finansowych (cofalne, wymaga zgody)
  finance_add_project: "write", finance_set_status: "write",
  // write — lokalne, odwracalne ustawienia/zapisy
  set_mode: "write", set_preference: "write", set_theme: "write", set_voice: "write",
  switch_ai: "write", lock_assistant: "write", sales_autopilot: "write", backup_data: "write",
  // write
  forget_fact: "write", save_lead: "write",
  // write — lokalny zapis (wymaga zgody, można zapamiętać)
  add_task: "write", complete_task: "write", add_note: "write", add_reminder: "write",
  add_shopping_item: "write", add_calendar_event: "write", remember_fact: "write",
  create_scene: "write", set_timer: "write", add_tally_item: "write", add_journal_entry: "write",
  create_flashcards: "write",
  // outbound — zewnętrzne lub nieodwracalne (wymaga zgody)
  gmail_send: "outbound", gmail_reply: "outbound", gcal_add: "outbound", clear_tally: "outbound", run_automation: "outbound",
  send_test_email: "outbound", send_offers_all: "outbound",
  salesos_open: "outbound", salesos_push: "outbound",
  salesos_email: "outbound", salesos_flush_emails: "outbound", salesos_set_status: "outbound",
  // outbound — działania na zewnątrz / nieodwracalne (wymaga zgody)
  make_call: "outbound", send_sms: "outbound", smart_home: "outbound", run_scene: "outbound",
  open_service: "outbound", navigate_to: "outbound", call_contact: "outbound", text_contact: "outbound",
  open_url: "outbound",
  // sterowanie komputerem (Windows) — wymaga zgody
  desktop_launch_app: "outbound", desktop_open: "outbound", desktop_power: "outbound",
  desktop_volume: "outbound", desktop_media: "outbound", desktop_type: "outbound", desktop_hotkey: "outbound",
  // pełne sterowanie telefonem (Android, usługa Dostępności) — wymaga zgody
  android_type: "outbound", android_tap: "outbound", android_global: "outbound",
  android_open_app: "outbound", android_open_settings: "outbound",
};

/** Czy narzędzie ma JAWNĄ klasyfikację ryzyka (a nie tylko fail-safe outbound)? */
export function isClassified(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(RISK, tool);
}

export function riskOf(tool: string): Risk {
  // Fail-safe: nieznane narzędzia (MCP / pluginy / skille / przyszłe) traktujemy jako
  // `outbound` → wymagają zgody. Wszystkie wbudowane narzędzia są jawnie sklasyfikowane wyżej,
  // więc ta gałąź dotyczy tylko zewnętrznych/dynamicznie rejestrowanych narzędzi.
  return RISK[tool] ?? "outbound";
}

// Kolekcje store, do których trafiają dodania narzędzi (cofalne).
type CollectionKey = "tasks" | "notes" | "reminders" | "shopping" | "calendar" | "scenes" | "memory" | "tally" | "journal" | "leads";

// Mapa narzędzie -> kolekcja w store (dla cofania dodań)
const UNDO_COLLECTION: Record<string, CollectionKey> = {
  add_task: "tasks", add_note: "notes", add_reminder: "reminders",
  add_shopping_item: "shopping", add_calendar_event: "calendar",
  create_scene: "scenes", remember_fact: "memory", add_tally_item: "tally", add_journal_entry: "journal",
  save_lead: "leads",
};

// --- Zgody (zapamiętane decyzje) ---
const CONSENT_KEY = "jarvis.consents.v1";
type ConsentMap = Record<string, "allow">;
function loadConsents(): ConsentMap {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}"); } catch { return {}; }
}
function saveConsents(c: ConsentMap) {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
export function resetConsents() { saveConsents({}); }

// --- Most do UI: handler zgody i emiter kroków ---
export interface ConsentRequest { tool: string; input: unknown; risk: Risk; }
let consentHandler: ((req: ConsentRequest) => Promise<{ allow: boolean; remember: boolean }>) | null = null;
export function setConsentHandler(fn: typeof consentHandler) { consentHandler = fn; }

// Auto-zgoda: gdy WŁĄCZONA (tylko w otwartym Trybie Szefa z „pełnym dostępem"), akcje
// WYCHODZĄCE przechodzą bez ekranu zgody — bramką jest głosowe „przewiduj i potwierdź".
// Zakres: tylko outbound (read/write i tak przechodzą wcześniej). Bezpiecznik: auto-wygasa
// po AUTO_CONSENT_MS, żeby nie zostać „otwarte" na stałe (np. gdy ekran nie zdejmie flagi).
const AUTO_CONSENT_MS = 15 * 60_000;
let autoConsentUntil = 0;
export function setAutoConsent(on: boolean, ttlMs = AUTO_CONSENT_MS) {
  autoConsentUntil = on ? Date.now() + Math.max(0, ttlMs) : 0;
}
export function isAutoConsent(): boolean {
  return autoConsentUntil > 0 && Date.now() < autoConsentUntil;
}

// Zakresowa zgoda sesyjna dla trybów BEZ UI (Live/headless): zamiast globalnego fail-open
// nadajemy JAWNY, OGRANICZONY zakres — konkretne narzędzia (lub "*") na określony czas.
// To sankcjonowana droga, gdy nie ma ekranu zgody; domyślnie outbound bez UI jest BLOKOWANY.
let scopeTools: Set<string> | "*" | null = null;
let scopeUntil = 0;
export function grantOutboundScope(tools: string[] | "*", ttlMs = AUTO_CONSENT_MS): void {
  scopeTools = tools === "*" ? "*" : new Set(tools);
  scopeUntil = Date.now() + Math.max(0, ttlMs);
}
export function clearOutboundScope(): void { scopeTools = null; scopeUntil = 0; }
export function hasOutboundScope(tool: string): boolean {
  if (!scopeTools || Date.now() >= scopeUntil) return false;
  return scopeTools === "*" || scopeTools.has(tool);
}

type StepListener = (tool: string | null) => void;
let stepListener: StepListener | null = null;
export function setStepListener(fn: StepListener) { stepListener = fn; }
export function emitStep(tool: string | null) { stepListener?.(tool); }

// Skróć `input` przed zapisem do audytu — inaczej w plaintext localStorage lądują pełne
// treści maili/SMS i base64 obrazów. Trzymamy tylko podgląd (jak `output`, do 300 znaków).
function redactInput(input: unknown): unknown {
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return "[nieserializowalne]";
  }
}

// --- Audyt + cofanie ---
export function audit(entry: Omit<AuditEntry, "id" | "at">) {
  store.setData((d) => {
    d.audit.unshift({ ...entry, input: redactInput(entry.input), id: uid(), at: Date.now() });
    if (d.audit.length > 200) d.audit.length = 200;
  });
}

export function undoAction(entry: AuditEntry): string {
  const u = entry.undo;
  if (!u) return "Tej akcji nie da się cofnąć.";
  store.setData((d) => {
    const list = (d as any)[u.collection] as { id: string }[];
    const i = list.findIndex((x) => x.id === u.id);
    if (i >= 0) list.splice(i, 1);
  });
  return `Cofnięto: ${entry.tool}.`;
}

/**
 * Bramka uprawnień: dla narzędzi read przepuszcza; dla write/outbound pyta UI
 * (chyba że użytkownik zapamiętał zgodę). Zwraca true, jeśli można wykonać.
 */
export async function requestConsent(tool: string, input: unknown): Promise<boolean> {
  const risk = riskOf(tool);
  // Pytamy tylko o akcje zewnętrzne/nieodwracalne; lokalne zapisy idą automatycznie.
  if (risk !== "outbound") return true;
  // Tryb Szefa „pełny dostęp": globalna zgoda na outbound, z auto-wygaśnięciem.
  if (isAutoConsent()) return true;
  // Jawny, ograniczony zakres sesyjny (Live/headless) — sankcjonowana droga bez UI.
  if (hasOutboundScope(tool)) return true;
  const consents = loadConsents();
  if (consents[tool] === "allow") return true;
  // FAIL-CLOSED: brak UI zgody i brak jawnego zakresu → BLOKUJ akcję wychodzącą.
  // (Tryby bez ekranu muszą najpierw nadać grantOutboundScope — nie ma globalnego fail-open.)
  if (!consentHandler) return false;
  const { allow, remember } = await consentHandler({ tool, input, risk });
  if (allow && remember) { consents[tool] = "allow"; saveConsents(consents); }
  return allow;
}

/** Po udanym dodaniu — zwróć payload undo (najnowszy element kolekcji). */
export function captureUndo(tool: string): AuditEntry["undo"] {
  const col = UNDO_COLLECTION[tool];
  if (!col) return undefined;
  const list = (store.data as any)[col] as { id: string }[];
  const id = list[0]?.id;
  return id ? { collection: col, id } : undefined;
}
