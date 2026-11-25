import { store, uid } from "./store";
import { assessPhoneRisk } from "./phoneAgent";
import { recordGuardianEvent } from "./guardianHistory";
import type { AuditEntry } from "../types";

export type AutonomyProfile = "STANDARD" | "OPERATOR";

// Codzienne narzędzia operacyjne wykonywane płynnie w trybie OPERATOR bez popupów
// (nawigacja, otwieranie aplikacji/URL, bezpieczne przewijanie/cofanie, smart home, media).
const OPERATOR_SAFE_OUTBOUND = new Set([
  "navigate_to", "open_service", "open_url", "smart_home", "run_scene",
  "android_open_app", "android_open_settings", "android_scroll", "android_back", "android_global",
  "desktop_launch_app", "desktop_open", "desktop_volume", "desktop_media",
  "desktop_cursor_move", "desktop_scroll", "desktop_windows_list", "desktop_window_focus",
  "desktop_sentinel_start",
]);

// Narzędzia interakcji UI, które w trybie OPERATOR przechodzą TYLKO jeśli RiskGuard potwierdzi brak
// ryzyka (isPassword / money / security / delete / send). W przeciwnym razie twarda blokada lub zgoda.
const OPERATOR_UI_CHECKED = new Set([
  "android_tap_id", "android_tap", "android_type",
  "desktop_mouse_action", "desktop_drag", "desktop_visual_act",
]);

// Twarde akcje krytyczne: wysyłka na zewnątrz, dzwonienie, usuwanie/destrukcja, płatności, system, pełna autonomia pulpitu.
// NIGDY nie są auto-zatwierdzane przez tryb OPERATOR.
const CRITICAL_RISKGUARD_TOOLS = new Set([
  "gmail_send", "gmail_reply", "send_test_email", "send_offers_all", "salesos_email", "salesos_flush_emails",
  "send_sms", "text_contact", "make_call", "call_contact",
  "clear_tally", "desktop_power", "desktop_omni_task", "run_automation",
  "system_terminal", "system_git", "system_docker", "system_http_request", "system_files_write", "system_generate_tool", "system_generated_tool",
]);

/** Zwróć aktywny profil autonomii (domyślnie STANDARD). */
export function getAutonomyProfile(): AutonomyProfile {
  return store.settings.autonomyProfile === "OPERATOR" ? "OPERATOR" : "STANDARD";
}

/** Przełącz profil autonomii (STANDARD | OPERATOR). */
export function setAutonomyProfile(profile: AutonomyProfile): void {
  store.setSettings({ autonomyProfile: profile === "OPERATOR" ? "OPERATOR" : "STANDARD" });
}

/** Pure: wyłuskaj kontekst ryzyka z parametrów narzędzia dla twardego RiskGuard. */
function assessToolInputRisk(tool: string, input: unknown) {
  const rec = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const isPassword =
    rec.isPassword === true ||
    rec.password === true ||
    String(rec.expectedLabel || rec.label || "") === "[PASSWORD_BLOCKED]";
  const label = String(rec.expectedLabel || rec.label || rec.target || rec.text || "");
  const packageName = String(rec.packageName || rec.app || "");
  const extraText = String(rec.text || rec.body || rec.query || "");
  return assessPhoneRisk({ action: tool, label, packageName, extraText, isPassword });
}

/** Pure: czy RiskGuard TWARDO BLOKUJE akcję (np. pole hasła isPassword — zakaz bezwzględny). */
export function isHardRiskGuardBlocked(tool: string, input: unknown): boolean {
  return assessToolInputRisk(tool, input).blocked;
}

/** Pure: czy narzędzie może przejść bez popupu w trybie OPERATOR (po przejściu twardego RiskGuard). */
export function isOperatorAutoAllowed(tool: string, input: unknown): boolean {
  if (store.settings.requireConsentAlways === true) return false;
  if (getAutonomyProfile() !== "OPERATOR") return false;
  if (CRITICAL_RISKGUARD_TOOLS.has(tool)) return false;
  const uiRisk = assessToolInputRisk(tool, input);
  if (uiRisk.blocked || uiRisk.requiresConfirmation) return false;
  if (OPERATOR_SAFE_OUTBOUND.has(tool)) return true;
  if (OPERATOR_UI_CHECKED.has(tool)) return true;
  return false;
}

// --- Klasyfikacja ryzyka narzędzi ---
export type Risk = "read" | "write" | "outbound";

const RISK: Record<string, Risk> = {
  // read — wykonują się automatycznie
  list_tasks: "read", list_notes: "read", list_shopping: "read", list_calendar: "read",
  list_scenes: "read", get_weather: "read", daily_briefing: "read", web_research: "read",
  gmail_search: "read", gcal_list: "read", tally_report: "read", calculate: "read", find_leads: "read",
  list_leads: "read", get_news: "read", get_markets: "read",
  salesos_sync: "read", salesos_stats: "read",
  // Parytet głos↔UI: podgląd i „co dalej" tylko czytają; drafty ZAPISUJĄ lokalnie (write), NIE są
  // działaniem zewnętrznym → NIE wymagają zgody outbound. Wysyłka/publikacja/płatności mają własne tooly.
  preview_lead_candidates: "read", client_next_action: "read",
  import_lead_candidates: "write", prepare_lead_demo: "write",
  create_content_draft: "write", create_campaign_draft: "write",
  // read — tylko pisze gotowy szkic follow-upu (bez wysyłki, bez zapisu w store)
  lead_followup: "read",
  // write — zapisuje teczkę (dossier/intel) w leadzie; AI lokalnie, bez wysyłki na zewnątrz
  lead_dossier: "write",
  // read — tylko czytają/analizują (bez efektów ubocznych)
  gcal_day: "read", gmail_read: "read", chief_of_staff: "read", deep_solve: "read",
  predictions: "read", reflect: "read", sales_plan: "read", self_check: "read",
  system_health: "read", world_recall: "read", local_research_agent: "read",
  // read — lokalna nawigacja / odczyt (bez efektów na zewnątrz, bez pytania o zgodę)
  open_screen: "read", project_knowledge: "read", finance_summary: "read",
  business_status: "read", business_next_step: "read", suggest_ai: "read",
  // read — czyste symulacje „co jeśli" (businessSimulator): zero zapisu, zero efektów ubocznych;
  // wynik zawsze niesie założenia/widełki, nie jest przedstawiany jako pewny fakt.
  simulate_price_change: "read", simulate_send_offers: "read", rank_clients_by_efficiency: "read",
  // read — odczyt Dziennika Predykcji (samoocena celności), zero zapisu
  prediction_ledger_status: "read",
  // Sprint 2 & 3 / Rada Ekspertów + Live Vision + Samowiedza i ustawienia własne
  expert_council: "read",
  live_vision: "read",
  get_jarvis_status: "read",
  update_jarvis_settings: "write",
  rollback_jarvis_settings: "write",
  // Sztafeta Misji (Horizon): status tylko czyta; pokaz pisze LOKALNY dziennik misji
  // i rusza wyłącznie emulator w pamięci (jawna symulacja) — zero akcji wychodzących.
  mission_status: "read", mission_why: "read", mission_demo: "write",
  // Cofnięcie kroku misji: operacja odwrotna na emulatorze w pamięci + dopisanie kwitu
  // do lokalnego dziennika (odwracalne, lokalne) — write, nie outbound.
  mission_undo: "write",
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
  // sterowanie komputerem (Linux/Windows) — wymaga zgody lub profilu OPERATOR + RiskGuard
  desktop_launch_app: "outbound", desktop_open: "outbound", desktop_power: "outbound",
  desktop_volume: "outbound", desktop_media: "outbound", desktop_type: "outbound", desktop_hotkey: "outbound",
  desktop_click: "outbound", desktop_active_window: "outbound", system_browser_read_public: "outbound",
  // OMNI-PILOT & Frontier (płynny kursor, okna, drzewo OS, wizja, strażnik w tle, diagnostyka)
  desktop_windows_list: "read", desktop_visual_locate: "read",
  desktop_ui_tree: "read", desktop_diagnose: "read", desktop_sentinel_stop: "read",
  desktop_cursor_move: "outbound", desktop_mouse_action: "outbound", desktop_scroll: "outbound", desktop_drag: "outbound",
  desktop_window_focus: "outbound", desktop_visual_act: "outbound", desktop_omni_task: "outbound",
  desktop_sentinel_start: "outbound",
  // pełne sterowanie telefonem (Android, usługa Dostępności + RiskGuard)
  android_ui_tree: "read",
  android_tap_id: "outbound", android_scroll: "outbound", android_back: "outbound",
  android_type: "outbound", android_tap: "outbound", android_global: "outbound",
  android_open_app: "outbound", android_open_settings: "outbound",
  // narzędzia lokalnego workspace / MCP (Electron) — jawna klasyfikacja ryzyka
  system_workspace_status: "read", system_files_list: "read", system_files_read: "read", system_database_read: "read",
  system_files_write: "write",
  system_git: "outbound", system_terminal: "outbound", system_docker: "outbound",
  system_http_request: "outbound", system_browser_open: "outbound", system_generate_tool: "outbound",
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
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([name, value]) => name !== "__proto__" && value === "allow")) as ConsentMap;
  } catch { return {}; }
}
function saveConsents(c: ConsentMap): boolean {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); return true; } catch { return false; }
}
/** Dostęp do istniejących trwałych zgód bez wyświetlania danych wejściowych. */
export function listRememberedConsents(): string[] { return Object.keys(loadConsents()).sort(); }
export function revokeConsent(tool: string): boolean {
  const saved = loadConsents();
  delete saved[tool];
  return saveConsents(saved);
}
export function resetConsents(): boolean { return saveConsents({}); }

// Zatwierdzenie dotyczy konkretnej treści i adresata; trwała zgoda na typ narzędzia
// albo ogólny zakres sesji nie mogą zastąpić decyzji dla następnej wysyłki.
const ALWAYS_CONFIRM = new Set([
  "gmail_send", "gmail_reply", "send_test_email", "send_offers_all", "salesos_email", "salesos_flush_emails",
  "send_sms", "text_contact", "desktop_power", "desktop_click", "desktop_active_window", "desktop_type", "desktop_hotkey", "desktop_omni_task", "clear_tally",
  "salesos_push", "salesos_set_status", "gcal_add", "run_automation",
  "system_terminal", "system_git", "system_docker", "system_http_request", "system_files_write", "system_generate_tool", "system_generated_tool",
]);
export function requiresFreshConsent(tool: string): boolean {
  return ALWAYS_CONFIRM.has(tool) || store.settings.requireConsentAlways === true;
}

// --- Most do UI: handler zgody i emiter kroków ---
export interface ConsentRequest { tool: string; input: unknown; risk: Risk; freshOnly?: boolean; }
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

const GUARDIAN_BRIDGE_TOOL_RE = /^(?:desktop_|omni_|android_|system_|sentinel_|riskguard_)/;

// --- Audyt + cofanie + wspólny most z Runtime Guardian ---
export function audit(entry: Omit<AuditEntry, "id" | "at">) {
  store.setData((d) => {
    d.audit.unshift({ ...entry, input: redactInput(entry.input), id: uid(), at: Date.now() });
    if (d.audit.length > 200) d.audit.length = 200;
  });
  if (GUARDIAN_BRIDGE_TOOL_RE.test(entry.tool) || entry.status !== "ok") {
    const kind =
      entry.status !== "ok" &&
      (entry.status === "denied" || /riskguard|zablokow|odmow|kill/i.test(`${entry.tool} ${entry.output || ""}`))
        ? "security"
        : "action";
    const summary = `[${entry.tool}] ${String(entry.output || (entry.status === "ok" ? "OK" : "Błąd")).slice(0, 160)}`;
    try { recordGuardianEvent(kind, summary); } catch { /* best-effort */ }
  }
}

/**
 * Wspólny most zdarzeń operacyjnych (OMNI-PILOT / Sentinel / RiskGuard / Kill-Switch):
 * zapisuje spójny ślad jednocześnie w AuditLog (`store.data.audit`) oraz telemetrii Runtime Guardiana.
 */
export function recordSystemActionEvent(entry: {
  tool: string;
  risk: Risk;
  input: unknown;
  output: string;
  ok: boolean;
  security?: boolean;
}): void {
  const status: AuditEntry["status"] = entry.ok ? "ok" : entry.security ? "denied" : "error";
  store.setData((d) => {
    d.audit.unshift({
      tool: entry.tool,
      input: redactInput(entry.input),
      output: String(entry.output || "").slice(0, 300),
      status,
      id: uid(),
      at: Date.now(),
    });
    if (d.audit.length > 200) d.audit.length = 200;
  });
  try {
    recordGuardianEvent(
      entry.security || (!entry.ok && /riskguard|zablokow|odmow|kill/i.test(`${entry.tool} ${entry.output}`)) ? "security" : "action",
      `[${entry.tool}] ${String(entry.output || (entry.ok ? "OK" : "Błąd")).slice(0, 160)}`,
    );
  } catch { /* best-effort */ }
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
 * Bramka uprawnień:
 * 1) Twardy RiskGuard: pola haseł (`isPassword`) są BEZWZGLĘDNIE ZABLOKOWANE zawsze (nawet w OPERATOR).
 * 2) Narzędzia read/write przechodzą automatycznie.
 * 3) W trybie OPERATOR bezpieczne codzienne narzędzia (nawigacja, otwieranie aplikacji/URL, bezpieczne UI)
 *    przechodzą płynnie bez popupów — z wyjątkiem krytycznych akcji (wysyłki, przelewy/płatności,
 *    nieodwracalne usuwanie, bezpieczeństwo), które ZAWSZE wymagają jawnego potwierdzenia (freshOnly).
 */
export async function requestConsent(tool: string, input: unknown): Promise<boolean> {
  // 1) Bezwzględny zakaz odczytu/wypełniania pól haseł (RiskGuard — nienaruszalny w każdym profilu).
  if (isHardRiskGuardBlocked(tool, input)) return false;

  const risk = riskOf(tool);
  // 2) Pytamy tylko o akcje zewnętrzne/nieodwracalne; lokalne odczyty/zapisy idą automatycznie.
  if (risk !== "outbound") return true;

  // 3) Tryb OPERATOR: płynne codzienne narzędzia po przejściu oceny RiskGuard.
  if (isOperatorAutoAllowed(tool, input)) return true;

  const uiRisk = assessToolInputRisk(tool, input);
  const freshOnly =
    requiresFreshConsent(tool) ||
    CRITICAL_RISKGUARD_TOOLS.has(tool) ||
    uiRisk.requiresConfirmation;

  // Nieodwracalne wysyłki/płatności/usuwanie i ustawienie „zawsze pytaj” nie respektują szerokich
  // zgód sesyjnych ani zgód zapamiętanych dla samego typu narzędzia.
  if (!freshOnly) {
    if (isAutoConsent()) return true;
    if (hasOutboundScope(tool)) return true;
    if (loadConsents()[tool] === "allow") return true;
  }
  if (!consentHandler) return false;
  const { allow, remember } = await consentHandler({ tool, input, risk, freshOnly });
  if (allow && remember && !freshOnly) {
    const consents = loadConsents();
    consents[tool] = "allow";
    saveConsents(consents);
  }
  return allow;
}

/**
 * Bezpośrednie pytanie do UI zgody — dla TWARDYCH granic STOP (Karta Przekazania misji:
 * płatność/publikacja/MFA…). Celowo SUROWSZE niż requestConsent: nie honoruje zapamiętanych
 * zgód, auto-zgody Trybu Szefa ani zakresu sesyjnego i NICZEGO nie zapamiętuje („zapamiętaj"
 * z dialogu jest ignorowane — taka zgoda jest zawsze jednorazowa). Brak UI → null (fail-closed
 * po stronie wywołującego).
 */
export async function askConsentUI(req: ConsentRequest): Promise<{ allow: boolean } | null> {
  if (!consentHandler) return null;
  const { allow } = await consentHandler({ ...req, freshOnly: true });
  return { allow };
}

/** Po udanym dodaniu — zwróć payload undo (najnowszy element kolekcji). */
export function captureUndo(tool: string): AuditEntry["undo"] {
  const col = UNDO_COLLECTION[tool];
  if (!col) return undefined;
  const list = (store.data as any)[col] as { id: string }[];
  const id = list[0]?.id;
  return id ? { collection: col, id } : undefined;
}
