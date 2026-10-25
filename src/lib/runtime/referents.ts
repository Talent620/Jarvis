// Referent Registry operations (mission 5.3). Pure functions over ReferentRegistry; only the
// kernel reducer calls the mutating helpers, so the registry has a single writer.

import type { CollectionMeta, Referent, ReferentRegistry, ReferentType } from "./types";
import { SCREEN_BOUND } from "./types";

export const MAX_REFERENTS = 400;
const MAX_RECENT = 64;

export const emptyRegistry = (): ReferentRegistry => ({ byId: {}, collections: {}, recent: [] });

function touchRecent(recent: string[], id: string): string[] {
  const next = [id, ...recent.filter((x) => x !== id)];
  return next.length > MAX_RECENT ? next.slice(0, MAX_RECENT) : next;
}

/** Drop the oldest invalid referents first, then the oldest valid ones, to stay under the cap. */
function prune(reg: ReferentRegistry): ReferentRegistry {
  const ids = Object.keys(reg.byId);
  if (ids.length <= MAX_REFERENTS) return reg;
  const sorted = ids
    .map((id) => reg.byId[id])
    .sort((a, b) => Number(a.valid) - Number(b.valid) || a.createdAt - b.createdAt);
  const drop = new Set(sorted.slice(0, ids.length - MAX_REFERENTS).map((r) => r.id));
  const byId: Record<string, Referent> = {};
  for (const id of ids) if (!drop.has(id)) byId[id] = reg.byId[id];
  const collections: Record<string, CollectionMeta> = {};
  for (const [id, c] of Object.entries(reg.collections)) if (!drop.has(id)) collections[id] = c;
  return { byId, collections, recent: reg.recent.filter((id) => !drop.has(id)) };
}

export function addReferent(reg: ReferentRegistry, r: Referent, collection?: { items: string[]; itemKind: string }): ReferentRegistry {
  const byId = { ...reg.byId, [r.id]: r };
  const collections = collection
    ? { ...reg.collections, [r.id]: { items: [...collection.items], cursor: -1, rejected: [], itemKind: collection.itemKind } }
    : reg.collections;
  return prune({ byId, collections, recent: touchRecent(reg.recent, r.id) });
}

export function patchReferent(reg: ReferentRegistry, id: string, patch: Partial<Referent>, touch = false): ReferentRegistry {
  const cur = reg.byId[id];
  if (!cur) return reg;
  const next = { ...cur, ...patch, metadata: patch.metadata ? { ...cur.metadata, ...patch.metadata } : cur.metadata };
  return { ...reg, byId: { ...reg.byId, [id]: next }, recent: touch ? touchRecent(reg.recent, id) : reg.recent };
}

/**
 * Invalidate screen-bound referents after a navigation or a major DOM change. With a scope,
 * only referents in that scope are affected; without one, every screen-bound referent is.
 */
export function invalidateScope(reg: ReferentRegistry, scope: string | undefined, reason: string): ReferentRegistry {
  let changed = false;
  const byId: Record<string, Referent> = {};
  for (const [id, r] of Object.entries(reg.byId)) {
    if (r.valid && SCREEN_BOUND.has(r.type) && (scope === undefined || r.scope === scope)) {
      byId[id] = { ...r, valid: false, invalidatedReason: reason };
      changed = true;
    } else {
      byId[id] = r;
    }
  }
  return changed ? { ...reg, byId } : reg;
}

export function moveCursor(reg: ReferentRegistry, collectionId: string, cursor: number, rejected?: string): ReferentRegistry {
  const c = reg.collections[collectionId];
  if (!c) return reg;
  const next: CollectionMeta = {
    ...c,
    cursor,
    rejected: rejected && !c.rejected.includes(rejected) ? [...c.rejected, rejected] : c.rejected,
  };
  return { ...reg, collections: { ...reg.collections, [collectionId]: next } };
}

// ---------------------------------------------------------------- read helpers

export const isUsable = (r: Referent | undefined): r is Referent => !!r && r.valid;

/** Valid referents of the given types, most recently touched first. */
export function candidates(reg: ReferentRegistry, types: readonly ReferentType[]): Referent[] {
  const want = new Set(types);
  const seen = new Set<string>();
  const out: Referent[] = [];
  for (const id of reg.recent) {
    const r = reg.byId[id];
    if (isUsable(r) && want.has(r.type)) { out.push(r); seen.add(id); }
  }
  for (const r of Object.values(reg.byId)) {
    if (!seen.has(r.id) && isUsable(r) && want.has(r.type)) out.push(r);
  }
  return out;
}

/** Most recent collection (valid) whose items are of the given kind, or any kind when omitted. */
export function latestCollection(reg: ReferentRegistry, itemKind?: string): Referent | undefined {
  return candidates(reg, ["Collection"]).find((r) => !itemKind || reg.collections[r.id]?.itemKind === itemKind);
}

export function currentItem(reg: ReferentRegistry, collectionId: string): Referent | undefined {
  const c = reg.collections[collectionId];
  if (!c || c.cursor < 0) return undefined;
  return reg.byId[c.items[c.cursor]];
}
