import { Capacitor, registerPlugin } from "@capacitor/core";
import { assessPhoneRisk, parseUiTree } from "./phoneAgent";

// === Pełne sterowanie telefonem (Android "Phone Use" Agent + RiskGuard) ===
// Most JS → natywna usługa Dostępności (Accessibility): odczyt skompresowanego drzewa ekranu
// `[id] Role "Label" (x,y)`, akcje Check-then-Act (tapById, type, scroll, back, openApp)
// oraz twardy RiskGuard (natywne potwierdzenia money/security/delete/send + blokada haseł).

export interface UiTreeResponse {
  ok: boolean;
  packageName?: string;
  signature?: string;
  count?: number;
  tree?: string;
  detail?: string;
}

export interface ActionResponse {
  ok: boolean;
  aborted?: boolean;
  blocked?: boolean;
  riskCategory?: string;
  detail?: string;
}

export interface SystemActionsPlugin {
  isEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  getUiTree(): Promise<UiTreeResponse>;
  tapById(opts: { id: number; expectedSignature?: string; expectedLabel?: string }): Promise<ActionResponse>;
  type(opts: { text: string; id?: number; expectedSignature?: string }): Promise<ActionResponse>;
  scroll(opts: { direction: string; id?: number; expectedSignature?: string }): Promise<ActionResponse>;
  back(): Promise<{ ok: boolean }>;
  tap(opts: { x: number; y: number }): Promise<{ ok: boolean }>;
  global(opts: { action: string }): Promise<{ ok: boolean }>; // back | home | recents | notifications
  openApp(opts: { name: string }): Promise<ActionResponse>;
  openSettings(opts: { section?: string }): Promise<{ ok: boolean }>;
  launch(opts: { uri: string }): Promise<{ ok: boolean }>;
}

const SA = registerPlugin<SystemActionsPlugin>("SystemActions");

export const systemActionsAvailable = (): boolean => Capacitor.getPlatform?.() === "android";

/** Czy usługa Dostępności jest włączona (warunek „pisania/dotykania" w innych apkach). */
export async function saIsEnabled(): Promise<boolean> {
  if (!systemActionsAvailable()) return false;
  try { return !!(await SA.isEnabled()).enabled; } catch { return false; }
}

/** Otwórz systemowy ekran Dostępności, by użytkownik włączył usługę JARVIS-a. */
export async function saOpenAccessibility(): Promise<void> {
  if (!systemActionsAvailable()) return;
  try { await SA.openAccessibilitySettings(); } catch { /* ignore */ }
}

const NEED_ACCESS =
  "Aby Szef mógł pisać i klikać w aplikacjach, włącz raz „JARVIS — sterowanie” w Ustawieniach → Dostępność. Otworzyłem te ustawienia.";

async function ensureAccess(): Promise<string | null> {
  if (!systemActionsAvailable()) return "Sterowanie telefonem działa tylko w aplikacji na Androidzie.";
  if (await saIsEnabled()) return null;
  try { await SA.openAccessibilitySettings(); } catch { /* ignore */ }
  return NEED_ACCESS;
}

/** Pobierz skompresowane, ponumerowane drzewo aktywnego ekranu UI (`[id] Role "Label" (x,y)`). */
export async function saGetUiTree(): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  try {
    const r = await SA.getUiTree();
    if (!r.ok) return r.detail || "Nie udało się odczytać drzewa ekranu.";
    const parsed = parseUiTree(r.tree || "");
    const header = `Ekran: ${r.packageName || "?"} | sygnatura: ${r.signature || "?"} | elementów: ${parsed.length}`;
    return `${header}\n${r.tree || "(brak widocznych elementów)"}`;
  } catch (e) {
    return `Błąd odczytu ekranu: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Check-then-Act: kliknij element UI po [id] z weryfikacją sygnatury ekranu i RiskGuard. */
export async function saTapById(id: number, expectedSignature?: string, expectedLabel?: string): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  const pre = assessPhoneRisk({ action: "tapById", label: expectedLabel });
  if (pre.blocked) return `🛡 ${pre.reason}`;
  try {
    const r = await SA.tapById({ id, expectedSignature, expectedLabel });
    if (r.ok) return `✅ ${r.detail || `Kliknięto element [${id}].`}`;
    if (r.blocked) return `🛡 ${r.detail || "Zablokowano przez RiskGuard."}`;
    if (r.aborted) return `⚠️ ${r.detail || "Ekran zmienił się przed kliknięciem (Check-then-Act)."}`;
    return r.detail || `Nie udało się kliknąć elementu [${id}].`;
  } catch (e) {
    return `Błąd kliknięcia [${id}]: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Wpisz tekst w aktywne (lub wskazane po [id]) pole — z blokadą pól haseł i Check-then-Act. */
export async function saType(text: string, id?: number, expectedSignature?: string): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  try {
    const r = await SA.type({ text, ...(id ? { id } : {}), ...(expectedSignature ? { expectedSignature } : {}) });
    if (r.ok) return `✅ Wpisałem: „${text}”.`;
    if (r.blocked) return `🛡 ${r.detail || "Zablokowano przez RiskGuard (pole hasła)."}`;
    if (r.aborted) return `⚠️ ${r.detail || "Ekran zmienił się przed wpisaniem (Check-then-Act)."}`;
    return r.detail || "Nie udało się wpisać — czy kursor jest w polu tekstowym?";
  } catch (e) {
    return `Błąd wpisywania: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Przewiń ekran: down | up | left | right (Check-then-Act). */
export async function saScroll(direction: string, id?: number, expectedSignature?: string): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  const dir = (direction || "down").toLowerCase();
  try {
    const r = await SA.scroll({ direction: dir, ...(id ? { id } : {}), ...(expectedSignature ? { expectedSignature } : {}) });
    if (r.ok) return `✅ ${r.detail || `Przewinięto (${dir}).`}`;
    if (r.aborted) return `⚠️ ${r.detail || "Ekran zmienił się przed przewinięciem."}`;
    return r.detail || `Nie udało się przewinąć (${dir}).`;
  } catch (e) {
    return `Błąd przewijania: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Cofnij ekran (przycisk Wstecz). */
export async function saBack(): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  try {
    const r = await SA.back();
    return r.ok ? "✅ Cofnięto (Wstecz)." : "Nie udało się cofnąć.";
  } catch (e) {
    return `Błąd cofania: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Dotknij ekranu w punkcie (px). */
export async function saTap(x: number, y: number): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  try { const r = await SA.tap({ x, y }); return r.ok ? `✅ Dotknąłem (${x}, ${y}).` : "Nie udało się dotknąć w tym punkcie."; }
  catch (e) { return `Błąd dotknięcia: ${e instanceof Error ? e.message : String(e)}`; }
}

/** Akcja globalna: back | home | recents | notifications. */
export async function saGlobal(action: string): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  const a = action.toLowerCase();
  try { const r = await SA.global({ action: a }); return r.ok ? `✅ Wykonałem: ${a}.` : `Nie udało się: ${a}.`; }
  catch (e) { return `Błąd akcji ${a}: ${e instanceof Error ? e.message : String(e)}`; }
}

/** Otwórz aplikację po nazwie (np. „WhatsApp”, „Ustawienia”). Z RiskGuard dla banków/bezpieczeństwa. */
export async function saOpenApp(name: string): Promise<string> {
  if (!systemActionsAvailable()) return "Otwieranie aplikacji działa w aplikacji na Androidzie.";
  try {
    const r = await SA.openApp({ name });
    if (r.ok) return `✅ Otwieram: ${name}.`;
    if (r.blocked) return `🛡 ${r.detail || "Odrzucono przez RiskGuard."}`;
    return r.detail || `Nie znalazłem aplikacji: ${name}.`;
  } catch (e) {
    return `Błąd otwierania: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Otwórz ekran Ustawień systemu (opcjonalnie sekcja: wifi, bluetooth, sound, display…). */
export async function saOpenSettings(section?: string): Promise<string> {
  if (!systemActionsAvailable()) return "Ustawienia systemu otworzę tylko w aplikacji na Androidzie.";
  try { const r = await SA.openSettings({ section }); return r.ok ? "✅ Otworzyłem Ustawienia." : "Nie udało się otworzyć tej sekcji ustawień."; }
  catch (e) { return `Błąd: ${e instanceof Error ? e.message : String(e)}`; }
}
