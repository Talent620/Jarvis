// Polish referring expressions and verbs, rule based (no LLM). Handles inflection of the
// domain nouns, ordinals in every case and gender, "następny / nie ten / poprzedni",
// demonstratives and "wróćmy do ...". Input may come without diacritics from STT.

import { normalizeUtterance } from "./util";
import type { ReferentType } from "./types";

export type NounKind =
  | "comment" | "reply" | "video" | "tab" | "window" | "page" | "link" | "button" | "selection"
  | "clipboard" | "email" | "file" | "task" | "text" | "contact" | "letter" | "char" | "word";

export type VerbKind =
  | "copy" | "paste" | "select" | "send" | "open" | "click" | "scroll_down" | "scroll_up"
  | "read" | "close" | "find" | "undo" | "highlight" | "show";

export interface RefQuery {
  /** 1-based; negative counts from the end (-1 = last). */
  ordinal?: number;
  relative?: "next" | "previous" | "current";
  /** "nie ten": the current item is rejected. */
  reject?: boolean;
  noun?: NounKind;
  demonstrative?: boolean;
  /** Bare "to"/"tego" used as an object without a noun. */
  pronoun?: boolean;
  returnTo?: boolean;
  /** Count for "pierwsze cztery litery" style ranges. */
  count?: number;
  /** Delivery channel named in instrumental case ("mailem", "SMS-em"); never the object. */
  channel?: "email" | "sms";
  /** "komentarz od Ani": the author (normalized, may be inflected). */
  author?: string;
  /** "komentarz o Łodzi": words the item's text should contain (normalized, may be inflected). */
  about?: string;
}

const CHANNELS: Record<string, "email" | "sms"> = {
  mailem: "email", emailem: "email", mejlem: "email", smsem: "sms", esemesem: "sms",
};

// Stems are matched on normalized (diacritic-free) tokens.
const NOUNS: [NounKind, RegExp][] = [
  ["comment", /^komentarz(a|u|em|e|y|ami|ach|om|owi)?$/],
  ["reply", /^odpowiedz(i|ia|ie|iami|iach|iom)?$/],
  ["video", /^(film(u|ie|em|y|ow|ami|ach)?|filmik(u|iem|i|ow|a)?|wideo|video|nagrani(e|a|u|em))$/],
  ["tab", /^(kart(a|e|y|cie|a|ami|ach|om)?|zakladk(a|e|i|a|ami|ach|om))$/],
  ["window", /^okn(o|a|ie|em|ami|ach|om)$/],
  ["page", /^stron(a|e|y|ie|a|ami|ach|om|ka|ke|ki)?$/],
  ["link", /^(link(u|iem|i|ow|ach|ami)?|odnosnik(a|u|iem|i|ow)?)$/],
  ["button", /^przycisk(u|iem|i|ow|ami)?$/],
  ["selection", /^zaznaczeni(e|a|u|em)$/],
  ["clipboard", /^schow(ek|ka|ku|kiem)$/],
  ["email", /^(e ?mail(a|u|em|e|i|ow|ami)?|mail(a|u|em|e|i|ow|ami)?|maila|wiadomos(c|ci|cia|ciami))$/],
  ["file", /^plik(u|iem|i|ow|ami)?$/],
  ["task", /^zadani(e|a|u|em|ami)$/],
  ["text", /^(tekst(u|em|y|ow)?|fragment(u|em|y|ow)?)$/],
  ["contact", /^kontakt(u|em|y|ow)?$/],
  ["letter", /^liter(a|e|y|ami|ach|om|ke|ki|ka)?$/],
  ["char", /^znak(u|iem|i|ow|ami)?$/],
  ["word", /^slow(o|a|em|ie|ami)?$/],
];

/** Which referent types a noun can denote. */
export const NOUN_TYPES: Record<NounKind, ReferentType[]> = {
  comment: ["Element"], reply: ["Element"], video: ["Page", "Element"], tab: ["Tab"], window: ["Window"],
  page: ["Page"], link: ["Element"], button: ["Element"], selection: ["Selection"], clipboard: ["Clipboard"],
  email: ["Email"], file: ["File"], task: ["Task"], text: ["TextRange", "Selection", "Element"], contact: ["Contact"],
  letter: ["TextRange"], char: ["TextRange"], word: ["TextRange"],
};

const ORDINAL_STEMS: [RegExp, number][] = [
  [/^pierwsz/, 1], [/^drug/, 2], [/^trzec/, 3], [/^czwart/, 4], [/^piat/, 5],
  [/^szost/, 6], [/^siodm/, 7], [/^osm/, 8], [/^dziewiat/, 9], [/^dziesiat/, 10],
  [/^przedostatn/, -2], [/^ostatn/, -1],
];
// Hard (pierwszy, czwarty) and soft (drugi, trzeci, ostatni) adjective endings, all cases.
const ORDINAL_ENDING = /^(y|a|e|ego|ej|emu|ym|ymi|ych|i|ia|ie|iego|iej|iemu|im|imi|ich)?$/;

const CARDINALS: Record<string, number> = {
  jeden: 1, jedna: 1, jedno: 1, dwa: 2, dwie: 2, dwoch: 2, trzy: 3, trzech: 3, cztery: 4, czterech: 4,
  piec: 5, pieciu: 5, szesc: 6, szesciu: 6, siedem: 7, siedmiu: 7, osiem: 8, osmiu: 8,
  dziewiec: 9, dziewieciu: 9, dziesiec: 10, dziesieciu: 10,
  jedenascie: 11, jedenastu: 11, dwanascie: 12, dwunastu: 12, trzynascie: 13, trzynastu: 13,
  czternascie: 14, czternastu: 14, pietnascie: 15, pietnastu: 15, szesnascie: 16, szesnastu: 16,
  siedemnascie: 17, siedemnastu: 17, osiemnascie: 18, osiemnastu: 18, dziewietnascie: 19, dziewietnastu: 19,
  dwadziescia: 20, dwudziestu: 20,
};

const DEMONSTRATIVE = /^(ten|ta|to|te|tego|tej|temu|tym|tamten|tamta|tamto|tamtego|tamtej)$/;

function ordinalOf(tok: string): number | undefined {
  for (const [re, n] of ORDINAL_STEMS) {
    const m = re.exec(tok);
    if (m && ORDINAL_ENDING.test(tok.slice(m[0].length))) return n;
  }
  return undefined;
}

export function nounOf(tok: string): NounKind | undefined {
  for (const [kind, re] of NOUNS) if (re.test(tok)) return kind;
  return undefined;
}

/** Parse the referring part of an utterance ("nie ten, następny", "trzeci komentarz", "to"). */
export function parseReference(text: string): RefQuery {
  const norm = normalizeUtterance(text);
  const toks = norm.split(" ").filter(Boolean);
  const q: RefQuery = {};

  if (/\b(nie ten|nie ta|nie to|nie tego|zly|zla|zle)\b/.test(norm)) q.reject = true;
  if (/\bwr(o|u)c(my|my sie|imy)?\b.*\bdo\b|\bwracamy do\b|\bz powrotem do\b/.test(norm)) q.returnTo = true;

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (CHANNELS[tok]) { q.channel = CHANNELS[tok]; continue; }
    if (tok === "e" && toks[i + 1] === "mailem") { q.channel = "email"; i++; continue; }
    const noun = nounOf(tok);
    if (noun && !q.noun) q.noun = noun;
    const ord = ordinalOf(tok);
    // The noun right after an ordinal or demonstrative is the head ("odpowiedz drugiemu komentarzowi").
    const nextTok = toks[i + 1];
    const headNoun = (ord !== undefined || DEMONSTRATIVE.test(tok)) && nextTok && !CHANNELS[nextTok] ? nounOf(nextTok) : undefined;
    if (headNoun) q.noun = headNoun;
    if (ord !== undefined && q.ordinal === undefined) {
      // "pierwsze cztery litery": ordinal "first" + cardinal count.
      const next = toks[i + 1];
      if (ord === 1 && next !== undefined && CARDINALS[next] !== undefined) {
        q.count = CARDINALS[next];
      } else {
        q.ordinal = ord;
      }
    }
    if (/^(nastepn|kolejn)/.test(tok) || tok === "dalej") q.relative = "next";
    if (/^(poprzedn|wczesniejsz)/.test(tok)) q.relative = "previous";
    if ((tok === "numer" || tok === "nr") && toks[i + 1]) {
      const v = Number(toks[i + 1]);
      const c = Number.isFinite(v) && v > 0 ? v : CARDINALS[toks[i + 1]];
      if (c) q.ordinal = c;
    }
    if (/^\d+$/.test(tok) && i > 0 && nounOf(toks[i - 1]) && q.ordinal === undefined) q.ordinal = Number(tok);
    if (DEMONSTRATIVE.test(tok)) {
      if (tok === "to" || tok === "tego") q.pronoun = true;
      q.demonstrative = true;
    }
  }
  if (q.count === undefined) {
    const m = /\b(pierwsz\w*|ostatni\w*)\s+(\d+)\s+(liter\w*|znak\w*|slow\w*)/.exec(norm);
    if (m) q.count = Number(m[2]);
  }
  if (q.reject && !q.relative) q.relative = "next";
  if (/\bten sam\b|\bta sama\b|\bto samo\b|\btego samego\b/.test(norm)) q.relative = "current";
  // A noun or an ordinal wins over a bare pronoun ("ten komentarz" is not a pronoun reference).
  if (q.pronoun && (q.noun || q.ordinal !== undefined)) q.pronoun = false;
  // "komentarz od Ani", "komentarz o Łodzi": describe the item instead of counting it.
  if ((q.noun === "comment" || q.noun === "reply") && q.ordinal === undefined && !q.relative) {
    const by = /\b(?:komentarz\w*|odpowiedz\w*)\b(?: \w+)? (?:od|autorstwa|uzytkownika|napisan\w* przez) @?([a-z0-9_ ]{2,40})$/.exec(norm);
    const on = /\b(?:komentarz\w*|odpowiedz\w*)\b(?: \w+)? (?:o|na temat|ze slow\w*|zawierajac\w*|w ktorym jest|gdzie jest) ([a-z0-9 ]{2,60})$/.exec(norm);
    if (by) q.author = by[1].trim();
    else if (on) q.about = on[1].trim();
  }
  return q;
}

/**
 * A crude Polish stem: drop an inflection ending so "Łodzi" matches "Łódź", "Piotrkowskiej"
 * matches "Piotrkowską", "Ani" matches "Ania". Long words lose up to three letters, never below four.
 */
const stem = (w: string): string =>
  w.length >= 8 ? w.slice(0, w.length - 3) : w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w.length > 3 ? w.slice(0, -1) : w;

/** Does an item (author, text) match a described reference? Inputs are free text, normalized here. */
export function matchesDescription(q: Pick<RefQuery, "author" | "about">, item: { author?: string; text?: string }): boolean {
  if (q.author) {
    const who = normalizeUtterance(item.author ?? "").replace(/[@\s_]/g, "");
    const want = q.author.replace(/[@\s_]/g, "");
    if (!who || !(who.startsWith(stem(want)) || who.includes(want))) return false;
  }
  if (q.about) {
    const text = normalizeUtterance(item.text ?? "");
    const words = q.about.split(" ").filter((w) => w.length > 2);
    if (!words.length || !words.every((w) => text.includes(stem(w)))) return false;
  }
  return !!(q.author || q.about);
}

// ---------------------------------------------------------------- verbs

const VERBS: [VerbKind, RegExp][] = [
  ["copy", /\b(s?kopiuj\w*|skopiowac)\b/],
  ["paste", /\b(wklej\w*)\b/],
  ["select", /\b(zaznacz\w*)\b/],
  ["send", /\b(wyslij|wyslijcie|przeslij|wyslac|przeslac|wysylaj)\b/],
  ["click", /\b(kliknij|nacisnij|wcisnij|klik)\b/],
  ["scroll_down", /\b(zjedz\w*|zjechac|przewin\w* (w dol|nizej)|nizej|w dol)\b/],
  ["scroll_up", /\b(wjedz\w*|przewin\w* (w gore|wyzej)|wyzej|w gore)\b/],
  ["open", /\b(otworz\w*|otwieraj|wejdz|wejsc|uruchom\w*|odpal\w*|wlacz)\b/],
  ["read", /\b(przeczytaj|czytaj|odczytaj)\b/],
  ["close", /\b(zamknij)\b/],
  ["find", /\b(znajdz\w*|wyszukaj|poszukaj|szukaj)\b/],
  ["undo", /\b(cofnij|odwroc)\b/],
  ["highlight", /\b(podswietl\w*)\b/],
  ["show", /\b(pokaz\w*)\b/],
];

export function parseVerb(text: string): VerbKind | undefined {
  const norm = normalizeUtterance(text);
  for (const [kind, re] of VERBS) if (re.test(norm)) return kind;
  return undefined;
}

/** Referent types a verb accepts as its object, in preference order (mission 5.3 typing). */
export const VERB_OBJECT_TYPES: Partial<Record<VerbKind, ReferentType[]>> = {
  copy: ["Selection", "TextRange"],
  paste: ["Clipboard"],
  select: ["TextRange", "Element"],
  send: ["Selection", "Clipboard", "TextRange", "Email", "File"],
  click: ["Element"],
  open: ["Element", "Tab", "Page", "File", "Email"],
  read: ["Selection", "Element", "Clipboard", "Email", "TextRange"],
  close: ["Tab", "Window"],
  highlight: ["Element", "TextRange"],
  show: ["Element", "Collection"],
};
