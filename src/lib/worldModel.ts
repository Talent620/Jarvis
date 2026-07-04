// === World Model — trwały graf encji i relacji z rozmów (local-first, bez zewnętrznej bazy) ===
// Buduje osobisty „model świata": ludzie, projekty, firmy, zadania + powiązania i pewność.
// Ekstrakcja jest CZYSTA i konserwatywna (wysoka precyzja, niska liczba śmieci); pewność rośnie
// z liczbą wzmianek, a graf żyje w store. Fundament pod predykcje i tryb Chief of Staff.
import { store, uid } from "./store";
import type { WorldEntity, WorldRelation, WorldGraph, EntityKind } from "../types";

/** Pure: normalizacja nazwy do dopasowania (małe litery, bez ogonków interpunkcji). */
export function normalizeName(s: string): string {
  return (s || "").toLowerCase().replace(/[„""'.,!?:;()]+/g, " ").replace(/\s+/g, " ").trim();
}

// Słowa, które wyglądają jak nazwa, ale nią nie są (anty-śmieci dla osób).
const PERSON_STOP = new Set([
  "ja", "ty", "on", "ona", "ono", "my", "wy", "oni", "to", "tego", "pan", "pani", "państwo",
  "dziś", "dzisiaj", "jutro", "wczoraj", "poniedziałek", "wtorek", "środa", "czwartek", "piątek",
  "sobota", "niedziela", "rano", "wieczorem", "potem", "teraz",
]);

interface Extracted { kind: EntityKind; name: string }

/**
 * Pure: wyłuskaj encje z tekstu wg wyraźnych sygnałów (konserwatywnie — lepiej pominąć niż zaśmiecić).
 *  - firma: „firma X", „X sp. z o.o.", „X S.A."
 *  - projekt: „projekt(em/u) X"
 *  - osoba: „spotkanie/rozmowa/telefon/mail z/do X", „pan(a)/pani(ą) X"
 */
export function extractEntities(text: string): Extracted[] {
  const t = text || "";
  const out: Extracted[] = [];
  const push = (kind: EntityKind, raw: string) => {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length < 2) return;
    if (kind === "person" && PERSON_STOP.has(name.toLowerCase())) return;
    out.push({ kind, name });
  };

  // Firmy ze skrótem prawnym (nazwa z WIELKIEJ litery; sam skrót dowolną wielkością liter).
  for (const m of t.matchAll(/\b([A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśżź&.-]+(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśżź&.-]+){0,3})\s+(?:[Ss][Pp]\.?\s*[Zz]\s*[Oo]\.?\s*[Oo]\.?|[Ss]\.?\s*[Aa]\.?)\b/g)) {
    push("company", m[1]);
  }
  // „firma/firmą/firmy/firmie X" (też przypadek narzędnikowy „firmą").
  for (const m of t.matchAll(/\bfirm[aąęy]\w{0,3}\s+„?([A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśżź&.-]+(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][\wąćęłńóśżź&.-]+){0,2})/g)) {
    push("company", m[1]);
  }
  // Projekt („projekt"/„Projekt"; nazwa z wielkiej litery/cyfry).
  for (const m of t.matchAll(/\b[Pp]rojekt(?:cie|u|em|ach|y|ów)?\s+„?([A-ZŁŚŻŹĆŃÓĄĘ0-9][\wąćęłńóśżź -]{1,40}?)(?=["”.,!?]|\s+(?:dla|w|na|z|i|oraz)\b|$)/g)) {
    push("project", m[1]);
  }
  // Osoba po sygnale relacyjnym (sygnał dowolną wielkością; IMIĘ z wielkiej litery).
  for (const m of t.matchAll(/\b(?:[Ss]potkani[ae]|[Rr]ozmow[aęy]|[Tt]elefon|[Mm]ail|[Ww]iadomo[śs][ćc])\s+(?:z|do)\s+(?:[Pp]an[aią]?\s+|[Pp]ani[ąa]?\s+)?([A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśżź]{2,}(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśżź]{2,})?)/g)) {
    push("person", m[1]);
  }
  // „pan/pani X" (bez sygnału relacyjnego).
  for (const m of t.matchAll(/\b(?:pan|pani|pana|pani[ąa]|panem)\s+([A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśżź]{2,}(?:\s+[A-ZŁŚŻŹĆŃÓĄĘ][a-ząćęłńóśżź]{2,})?)/g)) {
    push("person", m[1]);
  }

  // Dedup w obrębie wiadomości (po kind+nazwa).
  const seen = new Set<string>();
  return out.filter((e) => { const k = `${e.kind}:${normalizeName(e.name)}`; return seen.has(k) ? false : (seen.add(k), true); });
}

/** Pure: pewność encji rosnąca z liczbą wzmianek (start ~0.4, nasycenie ~1). */
export function entityConfidence(mentions: number): number {
  const n = Math.max(1, mentions);
  return Math.min(1, 0.4 + 0.6 * (Math.log1p(n - 1) / Math.log1p(15)));
}

/** Dołóż/scal encję w liście (mutuje + zwraca). Dopasowanie po kind + znormalizowana nazwa/alias. */
export function upsertEntity(list: WorldEntity[], kind: EntityKind, name: string, now = Date.now()): WorldEntity {
  const norm = normalizeName(name);
  const hit = list.find((e) => e.kind === kind && (normalizeName(e.name) === norm || (e.aliases || []).some((a) => normalizeName(a) === norm)));
  if (hit) {
    hit.mentions += 1;
    hit.lastSeen = now;
    hit.confidence = entityConfidence(hit.mentions);
    // Zachowaj „ładniejszy" (dłuższy) wariant nazwy jako kanoniczny, krótszy jako alias.
    if (name.trim().length > hit.name.length) { hit.aliases = [...new Set([...(hit.aliases || []), hit.name])]; hit.name = name.trim(); }
    else if (normalizeName(name) !== normalizeName(hit.name)) hit.aliases = [...new Set([...(hit.aliases || []), name.trim()])];
    return hit;
  }
  const ent: WorldEntity = { id: uid(), kind, name: name.trim(), confidence: entityConfidence(1), mentions: 1, firstSeen: now, lastSeen: now };
  list.unshift(ent);
  return ent;
}

/** Dołóż/scal relację współwystępowania między dwiema encjami (mutuje listę). */
export function upsertRelation(list: WorldRelation[], from: string, to: string, type = "powiązany", now = Date.now()): void {
  const a = from < to ? from : to;
  const b = from < to ? to : from; // nieskierowana — porządkuj, by uniknąć duplikatów
  const hit = list.find((r) => r.type === type && ((r.from === a && r.to === b)));
  if (hit) { hit.mentions += 1; hit.lastSeen = now; hit.confidence = entityConfidence(hit.mentions); return; }
  list.unshift({ id: uid(), from: a, to: b, type, confidence: entityConfidence(1), mentions: 1, lastSeen: now });
}

const MAX_ENTITIES = 400;
const MAX_RELATIONS = 800;

/** Zapisz encje i powiązania z fragmentu rozmowy do grafu świata (best-effort). */
export function recordWorld(text: string): WorldEntity[] {
  const ents = extractEntities(text);
  if (!ents.length) return [];
  const now = Date.now();
  const touched: WorldEntity[] = [];
  store.setData((d) => {
    const w: WorldGraph = d.world || (d.world = { entities: [], relations: [] });
    const ids: string[] = [];
    for (const e of ents) { const x = upsertEntity(w.entities, e.kind, e.name, now); ids.push(x.id); touched.push(x); }
    // Relacje współwystępowania — tylko gdy w wiadomości jest 2–4 encje (inaczej eksplozja par).
    if (ids.length >= 2 && ids.length <= 4) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) upsertRelation(w.relations, ids[i], ids[j], "powiązany", now);
    }
    // Przytnij po pewności (najsłabsze wypadają), trzymając limity.
    if (w.entities.length > MAX_ENTITIES) w.entities = [...w.entities].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_ENTITIES);
    if (w.relations.length > MAX_RELATIONS) w.relations = [...w.relations].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_RELATIONS);
  });
  return touched;
}

/** Odczyt grafu świata. */
export function getWorld(): WorldGraph {
  return store.data.world || { entities: [], relations: [] };
}

/** Znajdź encje pasujące do zapytania (po nazwie/aliasie), najpewniejsze pierwsze. */
export function recallEntities(query: string, limit = 8): WorldEntity[] {
  const q = normalizeName(query);
  if (!q) return [];
  const terms = q.split(" ").filter((x) => x.length >= 2);
  return getWorld().entities
    .filter((e) => { const hay = normalizeName([e.name, ...(e.aliases || [])].join(" ")); return terms.some((t) => hay.includes(t)); })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

const KIND_LABEL: Record<EntityKind, string> = { person: "👤", project: "📁", company: "🏢", task: "✅", topic: "💡" };

/** Krótkie podsumowanie świata (najpewniejsze encje) — do kontekstu/diagnostyki. */
export function worldSummary(limit = 10): string {
  const ents = [...getWorld().entities].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  if (!ents.length) return "";
  return ents.map((e) => `${KIND_LABEL[e.kind]} ${e.name}${e.mentions > 1 ? ` (×${e.mentions})` : ""}`).join(", ");
}

/** Kontekst dla osoby/projektu wspomnianych w zapytaniu — encje + ich powiązania (do systemPrompt). */
export function worldContextBlock(query: string): string {
  const hits = recallEntities(query, 4);
  if (!hits.length) return "";
  const w = getWorld();
  const lines = hits.map((e) => {
    const rels = w.relations.filter((r) => r.from === e.id || r.to === e.id);
    const linked = rels.map((r) => w.entities.find((x) => x.id === (r.from === e.id ? r.to : r.from))?.name).filter(Boolean);
    return `${KIND_LABEL[e.kind]} ${e.name}${linked.length ? ` — powiązani: ${[...new Set(linked)].slice(0, 5).join(", ")}` : ""}`;
  });
  return `\n\nZ Twojego modelu świata (osoby/projekty/firmy, których dotyczy pytanie):\n${lines.join("\n")}`;
}
