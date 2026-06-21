// === 💡 Porady (coaching / feature-discovery) — nienachalne dymki „możesz zrobić to i tamto” ===
// Rdzeń CZYSTY i testowalny: pula porad + wybór następnej (rotacja bez powtórek, z warunkami
// kontekstu). KIEDY pokazać decyduje UI (App) — tu tylko CO. Każda porada może mieć akcję
// (id polecenia z ⌘K), więc dymek jest klikalny i od razu otwiera funkcję.

export interface TipCtx {
  hasBrain: boolean;   // jest skonfigurowany model (klucz/lokalny) — bez tego nie kuś funkcjami
  messages: number;    // ile wiadomości w bieżącej rozmowie
  desktop: boolean;
}

export interface Tip {
  id: string;
  text: string;
  actionId?: string;   // id polecenia (z rejestru ⌘K) — klik w dymek je uruchomi
  actionLabel?: string;
  cond?: (c: TipCtx) => boolean;
}

// Kolejność = kuratorowana ważność (najpierw to, co najbardziej „odblokowuje” JARVISA).
export const TIPS: Tip[] = [
  { id: "cmdk", text: "💡 Naciśnij ⌘K (lub ⋯ → Szybkie polecenia), by błyskawicznie otworzyć cokolwiek.", cond: (c) => c.desktop },
  { id: "voice", text: "💡 Powiedz „Jarvis” albo dotknij Orbu — możesz mówić zamiast pisać.", actionId: "voicemode", actionLabel: "Włącz głos" },
  { id: "goal", text: "💡 Masz złożone zadanie? Zleć cel — rozłożę je na kroki i zrobię za Ciebie.", actionId: "goal", actionLabel: "Zleć cel" },
  { id: "memory", text: "💡 Powiedz „zapamiętaj, że…” — będę o tym pamiętał. Zobacz, co już o Tobie wiem.", actionId: "memory", actionLabel: "Co wiem o Tobie" },
  { id: "private", text: "💡 Chcesz rozmowę, która NIE trafi do historii? Włącz 🕶 czat prywatny.", actionId: "private", actionLabel: "Czat prywatny" },
  { id: "studio", text: "💡 Studio Obrazów: dołącz zdjęcie i napisz, co zmienić — przerobię je.", actionId: "studio", actionLabel: "Otwórz Studio" },
  { id: "goal2", text: "💡 „Zaplanuj…”, „Rozpisz strategię…” — daj cały cel, a poprowadzę go od początku do końca.", actionId: "goal", actionLabel: "Zleć cel" },
  { id: "briefing", text: "💡 Włącz poranny briefing w ⚙ → Zachowanie — odezwę się rano sam, z planem dnia.", actionId: "settings", actionLabel: "Ustawienia" },
  { id: "bargain", text: "💡 Łowca Okazji znajdzie najtaniej — nowe i używane, z linkami.", actionId: "bargain", actionLabel: "Szukaj okazji" },
  { id: "research", text: "💡 Włącz 🔬 w polu pisania — zrobię research ze źródłami [1][2], a nie „z głowy”.", cond: (c) => c.messages > 0 },
  { id: "sales", text: "💡 Prowadzisz biznes? Pulpit Sprzedaży: leady, oferty i maile w jednym miejscu.", actionId: "sales", actionLabel: "Pulpit Sprzedaży" },
];

/** Pure: porady spełniające warunki kontekstu i jeszcze nieobejrzane. */
export function eligibleTips(ctx: TipCtx, shown: Iterable<string>): Tip[] {
  const seen = new Set(shown);
  return TIPS.filter((t) => (!t.cond || t.cond(ctx)) && !seen.has(t.id));
}

// Wyzwalacze KONTEKSTOWE: gdy treść użytkownika pasuje do funkcji, podpowiadamy ją „w samą porę".
const TRIGGERS: Record<string, RegExp> = {
  goal: /zaplanuj|\bplan\b|strategi|rozpisz|krok po kroku|wieloetapow|\bprojekt/i,
  studio: /zdj[ęe]ci|\bobraz|\bfoto|przer[óo]b|edytuj zdj|usu[ńn] (t[łl]o|obiekt)/i,
  memory: /zapami[ęe]taj|zapomnij|pami[ęe][ćc]/i,
  bargain: /najtaniej|\btanio\b|okazj|gdzie kupi[ęe]|przecen/i,
  research: /[źz]r[óo]d[łl]|research|sprawd[źz] w sieci|cytat|aktualne (ceny|dane|info)/i,
  sales: /\blead|\bklient|\boferta|sprzeda|\bcrm\b/i,
};

/** Pure: porada DOPASOWANA do treści użytkownika (gdy nie była jeszcze pokazana). null = brak trafienia. */
export function contextualTip(text: string, shown: Iterable<string>): Tip | null {
  const t = (text || "").toLowerCase();
  if (t.length < 8) return null;
  const seen = new Set(shown);
  for (const tip of TIPS) {
    const re = TRIGGERS[tip.id];
    if (re && re.test(t) && !seen.has(tip.id)) return tip;
  }
  return null;
}

/** Pure: dzienny digest „💡 Dziś możesz: A · B · C" z 2–3 nieobejrzanych funkcji z akcją. */
export function dailyDigestTip(ctx: TipCtx, shown: Iterable<string>): Tip | null {
  if (!ctx.hasBrain) return null;
  const withAction = (arr: Tip[]) => arr.filter((t) => t.actionLabel);
  let pool = withAction(eligibleTips(ctx, shown));
  if (pool.length < 2) pool = withAction(TIPS.filter((t) => !t.cond || t.cond(ctx)));
  const picks = pool.slice(0, 3);
  if (picks.length < 2) return null;
  return {
    id: "digest",
    text: `💡 Dziś możesz: ${picks.map((t) => t.actionLabel).join(" · ")}.`,
    actionId: picks[0].actionId,
    actionLabel: picks[0].actionLabel,
  };
}

/**
 * Pure: następna porada do pokazania. Najpierw nieobejrzane (wg kuratorowanej ważności); gdy
 * wszystkie pasujące już pokazane — rotuj od nowa (najstarsza pierwsza). null gdy brak mózgu
 * albo brak pasujących porad.
 */
export function pickTip(ctx: TipCtx, shown: Iterable<string>): Tip | null {
  if (!ctx.hasBrain) return null; // bez modelu nie kusimy funkcjami — najpierw onboarding klucza
  const fresh = eligibleTips(ctx, shown);
  if (fresh.length) return fresh[0];
  const all = TIPS.filter((t) => !t.cond || t.cond(ctx));
  return all[0] || null;
}

// --- Trwałość obejrzanych porad (rotacja między sesjami) ---
const SHOWN_KEY = "jarvis.tips.shown.v1";
function loadShownTips(): string[] {
  try { return JSON.parse(localStorage.getItem(SHOWN_KEY) || "[]") as string[]; } catch { return []; }
}
/** Zapisz, że porada została pokazana (rotacja). Trzyma ostatnie ~30. */
export function recordTipShown(id: string): void {
  const arr = loadShownTips().filter((x) => x !== id);
  arr.push(id);
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify(arr.slice(-30))); } catch { /* quota — pomiń */ }
}
/** Wybierz następną poradę z bieżącego stanu (obejrzane z localStorage). */
export function nextTip(ctx: TipCtx): Tip | null {
  return pickTip(ctx, loadShownTips());
}

const tipDayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** Porada dopasowana do treści (z localStorage). */
export function contextualTipNow(text: string): Tip | null {
  return contextualTip(text, loadShownTips());
}

/** Dzienny digest — RAZ dziennie (null gdy już dziś pokazany). */
export function dailyDigestNow(ctx: TipCtx): Tip | null {
  if (loadShownTips().includes(`digest:${tipDayKey()}`)) return null;
  return dailyDigestTip(ctx, loadShownTips());
}

/** Zaznacz, że dzienny digest pokazano (dedup na dziś). */
export function recordDigestShown(): void {
  recordTipShown(`digest:${tipDayKey()}`);
}
