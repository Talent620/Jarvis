// Lekka warstwa i18n (PL/EN) — czysta i testowalna, bez zależności. Klucz → tekst w danym języku,
// z fallbackiem na polski (źródło prawdy) i prostą interpolacją {zmiennych}. Cel 10/10 oś #6:
// odblokowanie rynku EN; zasada „nowy kod bez zaszytych stringów" — używaj t(key, lang).
export type Lang = "pl" | "en";

type Dict = Record<string, string>;

// Polski = źródło prawdy (pełny). EN uzupełniany etapami; brak klucza w EN → fallback na PL.
const PL: Dict = {
  "empty.greeting": "Witaj. Jestem JARVIS.",
  "empty.prompt": "Powiedz „Jarvis” lub napisz polecenie.",
  "empty.needsSetup": "⚠ Aby zacząć, dodaj darmowy klucz API (bez karty) albo podłącz lokalny model.",
  "empty.addKey": "🔑 Dodaj darmowy klucz",
  "empty.hint": "☎ rozmowa na żywo · ＋ nowa rozmowa · ⋯ menu",
  "edge.badges": "🔒 Prywatny · ♾ Bez limitów · 🧠 Pamięta Ciebie · ⚡ Działa offline",
  "settings.language": "Język interfejsu",
  "lang.pl": "Polski",
  "lang.en": "English",
};

const EN: Dict = {
  "empty.greeting": "Hello. I'm JARVIS.",
  "empty.prompt": "Say “Jarvis” or type a command.",
  "empty.needsSetup": "⚠ To get started, add a free API key (no card) or connect a local model.",
  "empty.addKey": "🔑 Add a free key",
  "empty.hint": "☎ live talk · ＋ new chat · ⋯ menu",
  "edge.badges": "🔒 Private · ♾ No limits · 🧠 Remembers you · ⚡ Works offline",
  "settings.language": "Interface language",
  "lang.pl": "Polski",
  "lang.en": "English",
};

const DICTS: Record<Lang, Dict> = { pl: PL, en: EN };

/** Pure: ustal język — zapis użytkownika ma pierwszeństwo, inaczej z przeglądarki (domyślnie PL). */
export function detectLang(saved: string | undefined, navLang: string | undefined): Lang {
  if (saved === "pl" || saved === "en") return saved;
  return /^en\b|^en-/i.test(navLang || "") ? "en" : "pl";
}

/** Pure: tłumaczenie klucza. Fallback: EN→PL→sam klucz. Interpolacja {zmienna}. */
export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  let s = DICTS[lang]?.[key] ?? PL[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
  return s;
}
