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

export function parseCommand(text: string): Command {
  const norm = normalizeUtterance(text);
  const verb = parseVerb(text);
  const q = parseReference(text);

  if (/\bprzegladark\w*|\bchrom\w*|\bfirefox\w*|\bbrowser\w*/.test(norm) && (verb === "open" || /\b(uruchom|odpal|wlacz|otworz)\w*/.test(norm))) {
    return { type: "browser.launch" };
  }
  if (/\byou ?tub\w*|\bjutub\w*/.test(norm)) {
    return { type: "browser.gotoSite", site: "youtube", openFirst: /\b(film\w*|filmik\w*|wideo|nagrani\w*)\b/.test(norm) };
  }
  if (verb === "scroll_down" || verb === "scroll_up" || /\bprzewin\w*/.test(norm)) {
    // The adverb decides the direction ("zjedź wyżej" goes up); the verb is the default.
    const up = /\b(wyzej|w gore|do gory|na gore|na poczatek)\b/.test(norm);
    const down = /\b(nizej|w dol|na dol|do konca)\b/.test(norm);
    const direction = up && !down ? "up" : down && !up ? "down" : verb === "scroll_up" ? "up" : "down";
    return { type: "scroll", direction, amount: scrollAmount(norm) };
  }
  if (verb === "select") return { type: "selectText", query: q };
  if (verb === "copy") return { type: "copy", query: q };
  if (q.noun === "video" && (verb === "open" || verb === "show" || /\b(pusc|odtworz|wlacz|zagraj)\w*/.test(norm))) {
    return { type: "browser.openItem", itemKind: "video", query: q.ordinal !== undefined || q.relative ? q : { ...q, ordinal: 1 } };
  }
  const itemRef = q.ordinal !== undefined || q.relative !== undefined || q.reject;
  if ((q.noun === "comment" || q.noun === "reply") && !itemRef && !q.returnTo && (verb === "find" || verb === "show" || verb === undefined || /\b(wiecej|kolejne|zaladuj)\b/.test(norm))) {
    return { type: "findCollection", itemKind: "comment", more: /\b(wiecej|kolejne|dalsze|zaladuj)\b/.test(norm) };
  }
  if (q.noun === "video" && (verb === "find" || verb === "show")) return { type: "findCollection", itemKind: "video", more: false };
  if (itemRef || (q.demonstrative && q.noun === "comment") || q.returnTo) return { type: "focusItem", query: q };
  return { type: "unknown", text };
}
