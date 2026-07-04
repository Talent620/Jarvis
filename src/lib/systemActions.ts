import { Capacitor, registerPlugin } from "@capacitor/core";

// === Pełne sterowanie telefonem (Android) dla Szefa ===
// Most JS → natywna usługa Dostępności (Accessibility): „pisz", „dotknij", cofnij/ekran
// główny, otwórz aplikację/ustawienia. Dzięki temu Szef realnie DZIAŁA w telefonie, a nie
// tylko otwiera linki. Wymaga JEDNORAZOWEGO włączenia usługi Dostępności przez użytkownika
// (Android tak chroni te uprawnienia — i dobrze). Bez niej funkcje grzecznie tłumaczą, co zrobić.

export interface SystemActionsPlugin {
  isEnabled(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  type(opts: { text: string }): Promise<{ ok: boolean }>;
  tap(opts: { x: number; y: number }): Promise<{ ok: boolean }>;
  global(opts: { action: string }): Promise<{ ok: boolean }>; // back | home | recents | notifications
  openApp(opts: { name: string }): Promise<{ ok: boolean; detail?: string }>;
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

/** Wpisz tekst w aktualnie aktywne pole. */
export async function saType(text: string): Promise<string> {
  const gate = await ensureAccess();
  if (gate) return gate;
  try { const r = await SA.type({ text }); return r.ok ? `✅ Wpisałem: „${text}”.` : "Nie udało się wpisać — czy kursor jest w polu tekstowym?"; }
  catch (e) { return `Błąd wpisywania: ${e instanceof Error ? e.message : String(e)}`; }
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

/** Otwórz aplikację po nazwie (np. „WhatsApp”, „Ustawienia”). Nie wymaga Dostępności. */
export async function saOpenApp(name: string): Promise<string> {
  if (!systemActionsAvailable()) return "Otwieranie aplikacji działa w aplikacji na Androidzie.";
  try { const r = await SA.openApp({ name }); return r.ok ? `✅ Otwieram: ${name}.` : (r.detail || `Nie znalazłem aplikacji: ${name}.`); }
  catch (e) { return `Błąd otwierania: ${e instanceof Error ? e.message : String(e)}`; }
}

/** Otwórz ekran Ustawień systemu (opcjonalnie sekcja: wifi, bluetooth, sound, display…). */
export async function saOpenSettings(section?: string): Promise<string> {
  if (!systemActionsAvailable()) return "Ustawienia systemu otworzę tylko w aplikacji na Androidzie.";
  try { const r = await SA.openSettings({ section }); return r.ok ? "✅ Otworzyłem Ustawienia." : "Nie udało się otworzyć tej sekcji ustawień."; }
  catch (e) { return `Błąd: ${e instanceof Error ? e.message : String(e)}`; }
}
