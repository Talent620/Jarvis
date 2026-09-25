// Polish command grammar for the action lane (no LLM): maps a final utterance to a typed
// command. Conversation and side chat are routed elsewhere (M3); here only actions.

import { normalizeUtterance } from "./util";
import { parseReference, parseVerb, type RefQuery } from "./polish";
import type { ScrollAmount } from "./env/types";

export type Command =
  | { type: "browser.launch" }
  | { type: "browser.gotoSite"; site: "youtube"; openFirst: boolean }
  | { type: "browser.openItem"; itemKind: "video"; query: RefQuery }
  | { type: "scroll"; direction: "down" | "up"; amount: ScrollAmount }
  | { type: "findCollection"; itemKind: "comment" | "video"; more: boolean }
  | { type: "focusItem"; query: RefQuery }
  | { type: "selectText"; query: RefQuery }
  | { type: "copy"; query: RefQuery }
  | { type: "send"; channel: "email" | "sms"; query: RefQuery }
  | { type: "browser.use"; target: "managed" | "user" }
  | { type: "unknown"; text: string };

const LITTLE = /\b(troche|troszke|troszeczke|lekko|odrobine|ciut|kawalek|kapke)\b/;
const MORE = /\b(jeszcze|bardziej|wiecej|mocniej|duzo)\b/;
const TO_END = /\b(do konca|na sam dol|na dol strony|na koniec)\b/;
const TO_START = /\b(na gore strony|na sama gore|na poczatek|do gory strony)\b/;

export function scrollAmount(norm: string): ScrollAmount {
  if (TO_END.test(norm)) return "end";
  if (TO_START.test(norm)) return "start";
  if (LITTLE.test(norm)) return "little";
  if (MORE.test(norm)) return "more";
  return "page";
}

/** Imperative or infinitive navigation verbs (not past or future forms like "otworzyles"). */
const NAV_VERB = /\b(wejdz|wejsc|wchodz|idz|isc|przejdz|przejsc|otworz|otworzyc|odpal|odpalic|wlacz|wlaczyc|uruchom|uruchomic|pokaz|pokazac|zaprowadz|daj|lec|skocz)\b/;
/** A question about something (not a polite request such as "czy możesz wejść..."). */
const QUESTION = /^(?:jarvis )?(co|jak|jaki|jaka|jakie|dlaczego|czemu|ile|kiedy|gdzie|kto|ktory|ktora|ktore|po co|czy (?!mozesz|moglbys|moglabys|dasz rade|bys|zechcesz))\b/;
const MAX_NAV_WORDS = 12;

/** "Wejdź na YouTube", "YouTube", "możesz otworzyć YouTube?", but not "co sądzisz o YouTube?". */
function isNavigationRequest(norm: string): boolean {
  if (QUESTION.test(norm)) return false;
  const words = norm.split(" ").filter((w) => w && w !== "jarvis" && w !== "prosze");
  if (words.length > MAX_NAV_WORDS) return false;
  if (words.length <= 2 && words.every((w) => w === "na" || /^(you ?tub|jutub)/.test(w) || w === "tube")) return true;
  return NAV_VERB.test(norm);
}

// "w mojej przeglądarce" / "moim Chromie" (the user's own browser, through the bridge) and "w swojej
// przeglądarce" / "w przeglądarce Jarvisa" (JARVIS's managed one). A bare "przeglądarka, Jarvis"
// is not a choice: the managed form needs a preposition before "przeglądarce Jarvisa".
const USER_BROWSER = /\b(?:(?:w|we|na|do|z) )?(?:moj(?:a|ej|ego|e)?|moim) (?:przegladar\w*|chrom\w*|firefox\w*|edge\w*)|\bprzegladar\w* uzytkownika\b/;
const MANAGED_BROWSER = /\b(?:w|we|na|do|z) przegladar\w* jarvis(?:a|owej|owa)?\b|\b(?:(?:w|we|na|do|z) )?(?:osobn|zarzadzan|swoj|twoj|twoi)\w* przegladar\w*/;
const PREPOSITION_FORM = /\b(?:w|we|na|do|z) (?:moj|moim|swoj|twoj|twoi|osobn|zarzadzan|przegladar)/;
/** Verbs that make "moja przeglądarka" an instruction rather than a remark. */
const SWITCH_VERB = /\b(uzyj\w*|pracuj\w*|przelacz\w*|korzystaj\w*|dzialaj|zostan|otworz\w*|otwieraj|uruchom\w*|odpal\w*|wlacz\w*|wroc\w*)\b/;
const OPEN_VERB = /\b(otworz\w*|otwieraj|uruchom\w*|odpal\w*|wlacz\w*)\b/;

/**
 * "w mojej przeglądarce" -> the user's own browser; "w swojej przeglądarce" -> JARVIS's. Only an
 * instruction counts: a question, a negation ("nie używaj mojej przeglądarki") or a remark
 * ("moja przeglądarka jest wolna") never switches browsers.
 */
export function browserChoice(text: string): "user" | "managed" | undefined {
  const norm = normalizeUtterance(text);
  if (QUESTION.test(norm) || /^(?:jarvis )?nie\b/.test(norm)) return undefined;
  const which = USER_BROWSER.test(norm) ? "user" : MANAGED_BROWSER.test(norm) ? "managed" : undefined;
  if (!which) return undefined;
  return PREPOSITION_FORM.test(norm) || SWITCH_VERB.test(norm) ? which : undefined;
}

export function parseCommand(text: string): Command {
  const choice = browserChoice(text);
  if (choice) {
    // "Wejdź na YouTube w mojej przeglądarce": the command itself, the session switches first.
    // "Otwórz swoją przeglądarkę": a launch there. "Użyj mojej przeglądarki": only the switch.
    const norm0 = normalizeUtterance(text);
    const rest = parseCommand(norm0.replace(choice === "user" ? USER_BROWSER : MANAGED_BROWSER, " ").replace(/\s+/g, " ").trim());
    if (rest.type !== "unknown") return rest;
    return OPEN_VERB.test(norm0) ? { type: "browser.launch" } : { type: "browser.use", target: choice };
  }
  const norm = normalizeUtterance(text);
  const verb = parseVerb(text);
  const q = parseReference(text);

  if (/\bprzegladark\w*|\bchrom\w*|\bfirefox\w*|\bbrowser\w*/.test(norm) && isNavigationRequest(norm)) {
    return { type: "browser.launch" };
  }
  if (/\byou ?tub\w*|\bjutub\w*/.test(norm) && isNavigationRequest(norm)) {
    return { type: "browser.gotoSite", site: "youtube", openFirst: /\b(film\w*|filmik\w*|wideo|nagrani\w*)\b/.test(norm) };
  }
  if (verb === "scroll_down" || verb === "scroll_up" || /\bprzewin\w*/.test(norm)) {
    // The adverb decides the direction ("zjedź wyżej" goes up); the verb is the default.
    const up = /\b(wyzej|w gore|do gory|na gore|na poczatek)\b/.test(norm);
    const down = /\b(nizej|w dol|na dol|do konca)\b/.test(norm);
    const direction = up && !down ? "up" : down && !up ? "down" : verb === "scroll_up" ? "up" : "down";
    return { type: "scroll", direction, amount: scrollAmount(norm) };
  }
  if (verb === "send") return { type: "send", channel: q.channel ?? "email", query: q };
  if (verb === "select") return { type: "selectText", query: q };
  if (verb === "copy") return { type: "copy", query: q };
  if (q.noun === "video" && (verb === "open" || verb === "show" || /\b(pusc|odtworz|wlacz|zagraj)\w*/.test(norm))) {
    return { type: "browser.openItem", itemKind: "video", query: q.ordinal !== undefined || q.relative ? q : { ...q, ordinal: 1 } };
  }
  // "komentarz od Ani", "komentarz o Łodzi" describe one item, like an ordinal does.
  const itemRef = q.ordinal !== undefined || q.relative !== undefined || q.reject || !!q.author || !!q.about;
  if ((q.noun === "comment" || q.noun === "reply") && !itemRef && !q.returnTo && (verb === "find" || verb === "show" || verb === undefined || /\b(wiecej|kolejne|zaladuj)\b/.test(norm))) {
    return { type: "findCollection", itemKind: "comment", more: /\b(wiecej|kolejne|dalsze|zaladuj)\b/.test(norm) };
  }
  if (q.noun === "video" && (verb === "find" || verb === "show")) return { type: "findCollection", itemKind: "video", more: false };
  if (itemRef || (q.demonstrative && q.noun === "comment") || q.returnTo) return { type: "focusItem", query: q };
  return { type: "unknown", text };
}
