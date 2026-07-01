// === Jedna nawigacja (uiRoute) — czysty router ekranów ===
// Zamiast kilkudziesięciu równoległych flag showX — JEDEN aktywny „zwykły" ekran + stos historii
// (dla „Wstecz z zachowaniem kontekstu"). Systemowe overlaye (zgoda, blokada, Live/Boss/HUD) NIE
// przechodzą przez ten router — mają własny stan. Reducer jest czysty i w pełni testowalny. S9-safe.

export interface RouteEntry { screen: string; ctx?: unknown }
export interface RouteState {
  screen: string | null;   // aktywny zwykły ekran (null = tylko czat/ekran główny)
  ctx?: unknown;           // kontekst trasy (np. lead/projekt) — podróżuje z ekranem, nie przez przypadkowe flagi
  stack: RouteEntry[];     // historia do „Wstecz"
}

export type RouteAction =
  | { type: "open"; screen: string; ctx?: unknown }
  | { type: "close" }
  | { type: "closeIf"; screen: string } // zamknij TYLKO gdy ten ekran jest aktywny (bezpieczny odpowiednik setShowX(false))
  | { type: "back" }
  | { type: "reset" };

export const initialRoute: RouteState = { screen: null, stack: [] };

// Ile wpisów historii trzymamy (ochrona przed nieskończonym narastaniem przy pętlach nawigacji).
const MAX_STACK = 20;

/**
 * Pure: przejścia nawigacji. „open" ZAMYKA poprzedni zwykły ekran (najwyżej jeden aktywny) i odkłada
 * go na stos; ten sam ekran → tylko aktualizacja kontekstu (bez duplikatu w historii). „back" wraca do
 * poprzedniego z JEGO kontekstem. „close"/„reset" czyszczą.
 */
export function uiRouteReducer(state: RouteState, action: RouteAction): RouteState {
  switch (action.type) {
    case "open": {
      if (state.screen === action.screen) return { ...state, ctx: action.ctx }; // ten sam ekran → odśwież kontekst
      const stack = state.screen ? [...state.stack, { screen: state.screen, ctx: state.ctx }].slice(-MAX_STACK) : state.stack;
      return { screen: action.screen, ctx: action.ctx, stack };
    }
    case "close":
      return { screen: null, ctx: undefined, stack: [] };
    case "closeIf":
      return state.screen === action.screen ? { screen: null, ctx: undefined, stack: [] } : state;
    case "back": {
      const prev = state.stack[state.stack.length - 1];
      if (!prev) return { screen: null, ctx: undefined, stack: [] };
      return { screen: prev.screen, ctx: prev.ctx, stack: state.stack.slice(0, -1) };
    }
    case "reset":
      return initialRoute;
    default:
      return state;
  }
}

/** Pure: czy da się cofnąć (jest historia). */
export function canGoBack(state: RouteState): boolean {
  return state.stack.length > 0;
}

/** Pure: czy dany ekran jest teraz aktywny (do wyprowadzenia starych flag showX bez rozjazdu). */
export function isActiveScreen(state: RouteState, screen: string): boolean {
  return state.screen === screen;
}
