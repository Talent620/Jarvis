// Reference resolution (mission 5.3) without an LLM: collections with a cursor, typed pronouns
// ("skopiuj" needs a Selection, "wyślij to" needs content), freshness, and stale detection.
// Pure: returns the events the caller must dispatch so the kernel stays the single writer.

import type { EventInput } from "./events";
import { parseReference, parseVerb, NOUN_TYPES, VERB_OBJECT_TYPES, type NounKind, type RefQuery, type VerbKind } from "./polish";
import type { KernelState } from "./reducer";
import type { Referent, ReferentRegistry, ReferentType } from "./types";

/** Nouns whose referents live as items of a collection ("komentarze", "linki", "filmy"). */
const ITEM_KINDS: ReadonlySet<NounKind> = new Set<NounKind>(["comment", "reply", "link", "button", "video"]);
const TEXT_UNITS: ReadonlySet<NounKind> = new Set<NounKind>(["letter", "char", "word"]);

export type Resolution =
  | {
      status: "resolved";
      referent: Referent;
      via: "collection" | "noun" | "pronoun" | "return" | "text_range";
      collectionId?: string;
      cursor?: number;
      /** For "pierwsze cztery litery": the unit and count inside the referent's text. */
      range?: { unit: "letter" | "char" | "word"; count: number; from: "start" | "end" };
      events: EventInput[];
    }
  | { status: "stale"; referent: Referent; reason: string; events: EventInput[] }
  | { status: "none"; reason: "no_collection" | "out_of_range" | "end_of_collection" | "start_of_collection" | "no_candidate" | "no_current"; needMore?: boolean; events: EventInput[] }
  | { status: "ambiguous"; candidates: Referent[]; reason: string; events: EventInput[] };

export interface ResolveInput {
  text?: string;
  query?: RefQuery;
  verb?: VerbKind;
  utteranceId?: string;
}

const recency = (r: Referent): number => Math.max(r.lastMentioned ?? 0, r.lastActed ?? 0, r.createdAt);

// Timestamps have millisecond resolution and fast environments produce ties; the registry's
// "recent" list records the real order of events, so it breaks ties deterministically.
let recentRank: Map<string, number> = new Map();
const rank = (r: Referent): number => recentRank.get(r.id) ?? Number.MAX_SAFE_INTEGER;

function byRecency(list: Referent[]): Referent[] {
  return [...list].sort((a, b) => recency(b) - recency(a) || rank(a) - rank(b) || b.salience - a.salience);
}

const kindOf = (r: Referent): string | undefined => (typeof r.metadata.kind === "string" ? r.metadata.kind : undefined);

/** All referents (valid or not) of the given types, optionally filtered by semantic kind. */
function allOf(reg: ReferentRegistry, types: readonly ReferentType[], kind?: string): Referent[] {
  const want = new Set(types);
  return Object.values(reg.byId).filter((r) => want.has(r.type) && (!kind || kindOf(r) === kind || r.type !== "Element"));
}

/**
 * Pick the freshest candidate. If the freshest one was invalidated (navigation, DOM change),
 * report it as stale instead of silently falling back to an older, still valid one.
 */
function freshest(list: Referent[]): { ok: Referent } | { stale: Referent } | null {
  const sorted = byRecency(list);
  if (!sorted.length) return null;
  return sorted[0].valid ? { ok: sorted[0] } : { stale: sorted[0] };
}

/**
 * Collection a navigation phrase refers to. With a noun: the freshest collection of that kind.
 * Without one: the collection the user last navigated, else the most salient one.
 */
function findCollection(reg: ReferentRegistry, itemKind?: string): Referent | undefined {
  const colls = Object.values(reg.byId).filter((r) => r.type === "Collection" && (!itemKind || reg.collections[r.id]?.itemKind === itemKind));
  if (itemKind) return byRecency(colls)[0];
  const mentioned = colls.filter((r) => r.lastMentioned !== undefined).sort((a, b) => (b.lastMentioned ?? 0) - (a.lastMentioned ?? 0) || rank(a) - rank(b));
  if (mentioned.length) return mentioned[0];
  return [...colls].sort((a, b) => b.salience - a.salience || recency(b) - recency(a))[0];
}

function mention(referentId: string, utteranceId?: string, verb?: string): EventInput {
  return { type: "ReferentResolved", referentId, utteranceId, verb };
}

function navigateCollection(reg: ReferentRegistry, coll: Referent, q: RefQuery, input: ResolveInput, verb?: VerbKind): Resolution {
  if (!coll.valid) return { status: "stale", referent: coll, reason: coll.invalidatedReason ?? "stale", events: [] };
  const meta = reg.collections[coll.id];
  const n = meta.items.length;
  const skip = new Set(meta.rejected);
  let idx: number;
  let rejected: string | undefined;
  if (q.ordinal !== undefined) {
    idx = q.ordinal > 0 ? q.ordinal - 1 : n + q.ordinal;
    if (idx < 0 || idx >= n) return { status: "none", reason: "out_of_range", needMore: q.ordinal > 0, events: [] };
  } else if (q.relative === "current") {
    if (meta.cursor < 0) return { status: "none", reason: "no_current", events: [] };
    idx = meta.cursor;
  } else if (q.relative === "previous") {
    // An explicit "poprzedni" goes back to the adjacent item even if it was rejected before:
    // the user changed their mind (D-020).
    idx = meta.cursor - 1;
    if (idx < 0) return { status: "none", reason: "start_of_collection", events: [] };
  } else {
    if (q.reject && meta.cursor >= 0) {
      rejected = meta.items[meta.cursor];
      skip.add(rejected);
    }
    idx = meta.cursor < 0 ? 0 : meta.cursor + 1;
    while (idx < n && skip.has(meta.items[idx])) idx++;
    if (idx >= n) {
      return {
        status: "none", reason: "end_of_collection", needMore: true,
        // The rejection itself still counts even if nothing is loaded yet.
        events: rejected ? [{ type: "CollectionCursorMoved", collectionId: coll.id, cursor: meta.cursor, rejected }] : [],
      };
    }
  }
  const item = reg.byId[meta.items[idx]];
  if (!item) return { status: "none", reason: "no_candidate", events: [] };
  if (!item.valid) return { status: "stale", referent: item, reason: item.invalidatedReason ?? "stale", events: [] };
  return {
    status: "resolved", referent: item, via: "collection", collectionId: coll.id, cursor: idx,
    events: [
      { type: "CollectionCursorMoved", collectionId: coll.id, cursor: idx, rejected },
      mention(item.id, input.utteranceId, verb),
    ],
  };
}

/** Current item of the most recent collection of this kind, if any. */
function currentOf(reg: ReferentRegistry, itemKind?: string): Referent | undefined {
  const coll = findCollection(reg, itemKind);
  if (!coll || !coll.valid) return undefined;
  const meta = reg.collections[coll.id];
  return meta.cursor >= 0 ? reg.byId[meta.items[meta.cursor]] : undefined;
}

export function resolveReference(state: KernelState, input: ResolveInput): Resolution {
  const reg = state.referents;
  recentRank = new Map(reg.recent.map((id, i) => [id, i]));
  const q = input.query ?? parseReference(input.text ?? "");
  const verb = input.verb ?? (input.text ? parseVerb(input.text) : undefined);
  const noun = q.noun;
  const itemKind = noun && ITEM_KINDS.has(noun) ? noun : undefined;

  // "pierwsze cztery litery": a range inside the focused text-bearing element.
  if (noun && TEXT_UNITS.has(noun) && q.count) {
    // The focused item, else the element the user last talked about or acted on. Never a guess
    // among untouched elements (they only differ by creation order).
    const touched = allOf(reg, ["Element", "TextRange"]).filter((r) => typeof r.metadata.text === "string" && (r.lastMentioned !== undefined || r.lastActed !== undefined));
    const base = currentOf(reg) ?? byRecency(touched)[0];
    if (!base) return { status: "none", reason: "no_candidate", events: [] };
    if (!base.valid) return { status: "stale", referent: base, reason: base.invalidatedReason ?? "stale", events: [] };
    return {
      status: "resolved", referent: base, via: "text_range",
      range: { unit: noun as "letter" | "char" | "word", count: q.count, from: "start" },
      events: [mention(base.id, input.utteranceId, verb)],
    };
  }

  // Collection navigation: ordinals, "następny", "nie ten", "poprzedni", "ten sam".
  if (q.ordinal !== undefined || q.relative || q.reject) {
    const coll = findCollection(reg, itemKind);
    if (!coll) return { status: "none", reason: "no_collection", events: [] };
    return navigateCollection(reg, coll, q, input, verb);
  }

  // "wróćmy do komentarza": the most recent referent of that noun, preferring a collection cursor.
  if (q.returnTo && noun) {
    const cur = itemKind ? currentOf(reg, itemKind) : undefined;
    const pick = cur ? { ok: cur } : freshest(allOf(reg, NOUN_TYPES[noun], itemKind));
    if (!pick) return { status: "none", reason: "no_candidate", events: [] };
    if ("stale" in pick) return { status: "stale", referent: pick.stale, reason: pick.stale.invalidatedReason ?? "stale", events: [] };
    return { status: "resolved", referent: pick.ok, via: "return", events: [mention(pick.ok.id, input.utteranceId, verb)] };
  }

  // Noun phrase ("ten komentarz", "zaznaczenie", "schowek", "ta karta").
  if (noun && !TEXT_UNITS.has(noun)) {
    const cur = itemKind ? currentOf(reg, itemKind) : undefined;
    if (cur && cur.valid) return { status: "resolved", referent: cur, via: "noun", events: [mention(cur.id, input.utteranceId, verb)] };
    const pick = freshest(allOf(reg, NOUN_TYPES[noun], itemKind));
    if (!pick) return { status: "none", reason: "no_candidate", events: [] };
    if ("stale" in pick) return { status: "stale", referent: pick.stale, reason: pick.stale.invalidatedReason ?? "stale", events: [] };
    return { status: "resolved", referent: pick.ok, via: "noun", events: [mention(pick.ok.id, input.utteranceId, verb)] };
  }

  // Pronoun or bare verb: type the object by the verb and take the freshest compatible referent.
  const types = verb ? VERB_OBJECT_TYPES[verb] : undefined;
  if (!types) return { status: "none", reason: "no_candidate", events: [] };
  const pool = allOf(reg, types).filter((r) => r.type !== "Element" || typeof r.metadata.text === "string" || verb === "click" || verb === "open" || verb === "select");
  const pick = freshest(pool);
  if (!pick) return { status: "none", reason: "no_candidate", events: [] };
  if ("stale" in pick) return { status: "stale", referent: pick.stale, reason: pick.stale.invalidatedReason ?? "stale", events: [] };
  return { status: "resolved", referent: pick.ok, via: "pronoun", events: [mention(pick.ok.id, input.utteranceId, verb)] };
}
